package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphView;
import static cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphService.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MesGraphEvidenceRetrieverTest extends MesAssistantTestDatabase {
    Entity node(String id,String name){return new Entity(id,name,"部件","");}
    Relation edge(String id,String a,String b,long doc){
        var evidence=new MesRetrievalEvidence("graph:"+id,"GRAPH","graph_query","PERSONAL",1L,doc,1,doc,"hash","文件"+doc,"片段","关系原文",null,0,4,null,List.of(a,b),List.of(id));
        return new Relation(id,a,b,"关联",new Source("文件"+doc,"片段","关系原文"),evidence);
    }
    Graph fixture(){return new Graph(List.of(node("a","风扇"),node("b","轴承"),node("c","润滑不足"),node("d","无关设备"),node("e","其他部件")),List.of(edge("r1","a","b",1),edge("r2","b","c",2),edge("r3","d","e",3)),false);}
    @Test void naturalQuestionLinksEntityAndTraversesTwoHopsWithEachSource(){
        var result=MesGraphEvidenceRetriever.select(fixture(),"请问风扇的关联原因有哪些？",2);
        assertEquals(List.of("a"),result.matchedEntities().stream().map(m->m.entity().id()).toList());
        assertEquals(Set.of("r1","r2"),new HashSet<>(result.relations().stream().map(Relation::id).toList()));
        assertTrue(result.paths().stream().anyMatch(p->p.nodeIds().equals(List.of("a","b","c"))&&p.relationIds().equals(List.of("r1","r2"))));
        assertEquals(List.of(1L,2L),result.relations().stream().map(r->r.evidence().documentId()).toList());
    }
    @Test void oneHopDoesNotReachSecondLevelAndIncomingDirectionIsPreserved(){
        var one=MesGraphEvidenceRetriever.select(fixture(),"风扇",1);assertEquals(1,one.relations().size());assertFalse(one.nodes().stream().anyMatch(n->n.id().equals("c")));
        var reversed=MesGraphEvidenceRetriever.select(fixture(),"润滑不足怎么排查？",2);assertTrue(reversed.paths().stream().anyMatch(p->p.nodeIds().equals(List.of("c","b","a"))));assertEquals("b",reversed.relations().get(0).source());assertEquals("c",reversed.relations().get(0).target());
    }
    @Test void noEntityDoesNotFallBackToUnrelatedExcerptAndDisconnectedClustersStaySeparate(){
        var none=MesGraphEvidenceRetriever.select(fixture(),"今天气温是多少",2);assertTrue(none.matchedEntities().isEmpty());assertTrue(none.relations().isEmpty());
        var found=MesGraphEvidenceRetriever.select(fixture(),"风扇",2);assertFalse(found.nodes().stream().anyMatch(n->n.id().equals("d")));
        var isolated=MesGraphEvidenceRetriever.select(new Graph(List.of(node("alone","独立实体")),List.of(),false),"独立实体",2);assertEquals(1,isolated.matchedEntities().size());assertTrue(isolated.paths().isEmpty());
    }
    @Test void handlesCyclesParallelSourcesAndAmbiguousNamesWithoutMergingIds(){
        var graph=new Graph(List.of(node("a","轴承"),node("b","电机"),node("c","轴承")),List.of(edge("one","a","b",1),edge("two","a","b",2),edge("back","b","a",3),edge("other","c","b",4)),false);
        var found=MesGraphEvidenceRetriever.select(graph,"轴承",2);assertEquals(2,found.matchedEntities().size());assertEquals(4,found.relations().size());for(var p:found.paths())assertEquals(p.nodeIds().size(),new HashSet<>(p.nodeIds()).size());
    }
    @Test void normalizesNamesAndRespectsEnglishWordBoundaries(){
        var graph=new Graph(List.of(node("a","FAN-01"),node("b","Fan")),List.of(),false);
        assertEquals("a",MesGraphEvidenceRetriever.select(graph,"ＦＡＮ－０１的情况",2).matchedEntities().get(0).entity().id());
        assertTrue(MesGraphEvidenceRetriever.select(graph,"fancy weather today",2).matchedEntities().isEmpty());
        assertEquals("name_fragment",MesGraphEvidenceRetriever.select(new Graph(List.of(node("a","主轴轴承")),List.of(),false),"轴承",2).matchedEntities().get(0).matchMethod());
    }
    @Test void highDegreeGraphIsBoundedAndMarksTruncation(){
        List<Entity> nodes=new ArrayList<>(List.of(node("root","风扇")));List<Relation> edges=new ArrayList<>();
        for(int i=0;i<100;i++){nodes.add(node("n"+i,"部件"+i));edges.add(edge("r"+i,"root","n"+i,i));}
        var found=MesGraphEvidenceRetriever.select(new Graph(nodes,edges,false),"风扇",2);assertEquals(60,found.relations().size());assertTrue(found.hasMore());assertTrue(found.paths().size()<=80);
    }
    @Test void modesUseOnlyRequestedRetrieversAndRejectConflictingOrInvalidOptions(){
        var docs=mock(MesAssistantService.class);var graph=mock(MesGraphEvidenceRetriever.class);
        when(docs.search(anyString(),anyList(),anyInt())).thenReturn(Map.of("items",List.of(),"eligibleChunkCount",0));
        when(graph.retrieve(anyString(),anyList(),anyInt())).thenReturn(MesGraphEvidenceRetriever.select(fixture(),"风扇",2));
        var service=new MesEvidenceService(docs,graph);
        assertEquals("DOCUMENT",service.search("风扇",List.of(),null,10,"DOCUMENT",2).get("mode"));verifyNoInteractions(graph);
        clearInvocations(docs);var result=service.search("风扇",List.of(),null,10,"GRAPH",2);verifyNoInteractions(docs);assertNotNull(result.get("graph"));
        service.search("风扇",List.of(),null,10,"HYBRID",1);verify(docs).search("风扇",List.of(),10);verify(graph).retrieve("风扇",List.of(),1);
        assertThrows(RuntimeException.class,()->service.search("风扇",List.of(),List.of("DOCUMENT"),5,"GRAPH",2));assertThrows(RuntimeException.class,()->service.search("风扇",List.of(),null,5,"INVALID",2));assertThrows(RuntimeException.class,()->service.search("风扇",List.of(),null,5,"GRAPH",3));
    }
    @Test void publicRetrieverObtainsAuthorizedSnapshotForExplicitScope(){
        var view=mock(MesKnowledgeGraphView.class);when(view.snapshot(List.of(7L))).thenReturn(fixture());var found=new MesGraphEvidenceRetriever(view).retrieve("风扇怎么排查",List.of(7L),2);assertEquals(2,found.relations().size());verify(view).snapshot(List.of(7L));assertThrows(RuntimeException.class,()->new MesGraphEvidenceRetriever(view).retrieve("风扇",List.of(),0));
    }
}
