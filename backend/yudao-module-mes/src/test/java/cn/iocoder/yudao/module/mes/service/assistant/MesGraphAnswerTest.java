package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.*;
import static cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphService.*;
import cn.iocoder.yudao.framework.common.exception.ServiceException;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MesGraphAnswerTest extends MesAssistantTestDatabase {
    MesKnowledgeAccess access;MesKnowledgeGraphView view;MesAssistantModelGateway fake;long kb,first,second;
    Graph full;
    @BeforeEach void prepare(){
        fake=mock(MesAssistantModelGateway.class);when(fake.status()).thenReturn(Map.of("configured",true,"model","fake-model"));when(fake.inputBudget()).thenReturn(30000);when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenReturn("设备通过部件关联到润滑不足，不能直接推断因果。[1][2]");
        access=new MesKnowledgeAccess(jdbc,null);service=new MesAssistantService(jdbc,json,new MesAssistantDocumentParser(),new MesAssistantRetriever(),fake,new MesAssistantMessageStore(jdbc,json,new DataSourceTransactionManager(jdbc.getDataSource())),access);
        kb=service.saveBase(null,"设备资料","",10);first=file("设备 —包含部件→ 轴承");second=file("轴承 —可能原因→ 润滑不足");
        full=new Graph(List.of(new Entity("a","设备","设备",""),new Entity("b","轴承","部件",""),new Entity("c","润滑不足","原因","")),List.of(edge("r1","a","b",first),edge("r2","b","c",second)),false);
        view=mock(MesKnowledgeGraphView.class);when(view.snapshot(anyList())).thenReturn(full);ReflectionTestUtils.setField(service,"graphEvidence",new MesGraphEvidenceRetriever(view));
    }
    long file(String text){long id=((Number)service.upload(kb,"设备资料","facts.md",text.getBytes(StandardCharsets.UTF_8),10).get("id")).longValue();service.publish(id,true);return id;}
    Relation edge(String id,String from,String to,long doc){
        var chunk=access.searchableChunks(List.of(kb)).stream().filter(c->((Number)c.get("documentId")).longValue()==doc).findFirst().orElseThrow();var docEvidence=MesRetrievalEvidence.document(chunk);
        var e=new MesRetrievalEvidence("graph:"+id,"GRAPH","graph_query","PERSONAL",kb,doc,1,docEvidence.chunkId(),docEvidence.chunkHash(),"设备资料","片段",docEvidence.text(),null,docEvidence.startOffset(),docEvidence.endOffset(),null,List.of(from,to),List.of(id));
        return new Relation(id,from,to,"关联",new Source("设备资料","片段",e.text()),e);
    }
    Map<String,Object> send(String mode){return service.send(service.createSession(null,10),"设备有哪些关联原因？",List.of(kb),10,mode,2);}
    @Test void graphAnswerUsesCompleteTwoHopEvidenceAndPersistsModeAndIndependentSources(){
        when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenAnswer(call->{List<Map<String,String>> prompt=call.getArgument(1);String context=prompt.get(0).get("content");assertTrue(context.contains("包含部件"));assertTrue(context.contains("可能原因"));assertTrue(context.contains("\"source\":\"设备\""));assertTrue(context.contains("\"target\":\"润滑不足\""));assertTrue(context.contains("不代表因果"));return "关联结果。[1][2]";});
        var result=send("GRAPH");assertEquals("ANSWERED",result.get("status"));var citations=(List<?>)result.get("citations");assertEquals(2,citations.size());
        long session=((Number)result.get("sessionId")).longValue();var messages=(List<?>)service.session(session,10).get("messages");assertEquals(2,messages.size());var answer=(Map<?,?>)messages.get(1);assertEquals("GRAPH",answer.get("retrievalMode"));assertEquals(2,((Number)answer.get("retrievalHops")).intValue());assertEquals(2,((List<?>)answer.get("citations")).size());
    }
    @Test void hybridAnswerHasDocumentAndGraphEvidence(){
        var result=send("HYBRID");assertEquals("ANSWERED",result.get("status"));Set<String> types=new HashSet<>();for(var c:(List<?>)result.get("citations"))types.add(((MesRetrievalEvidence)((Map<?,?>)c).get("evidence")).sourceType());assertEquals(Set.of("DOCUMENT","GRAPH"),types);
    }
    @Test void noEntityDoesNotCallModelAndLeavesSessionReusable(){
        long id=service.createSession(null,10);var result=service.send(id,"完全无匹配内容",List.of(kb),10,"GRAPH",2);assertEquals("NO_EVIDENCE",result.get("status"));assertNull(result.get("answer"));assertNull(jdbc.queryForObject("SELECT pending_request_id FROM mes_assistant_session WHERE id=?",String.class,id));verify(fake,never()).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
    }
    @Test void fabricatedOrMissingReferenceIsRejectedAndRealEvidenceRemains(){
        for(String answer:List.of("臆造结果[999]","没有来源编号的结果")){when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenReturn(answer);var result=send("GRAPH");assertEquals("MODEL_ERROR",result.get("status"));assertNull(result.get("answer"));assertEquals(2,((List<?>)result.get("citations")).size());}
    }
    @Test void withdrawnSourceDuringModelCallSuppressesAnswerAndCurrentCitation(){
        when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenAnswer(call->{service.publish(second,false);return "迟到答复[1][2]";});
        var result=send("GRAPH");assertEquals("MODEL_ERROR",result.get("status"));assertNull(result.get("answer"));assertEquals(1,((List<?>)result.get("citations")).size());
    }
    @Test void changedGraphRelationDuringModelCallSuppressesAnswer(){
        when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenAnswer(call->{when(view.snapshot(anyList())).thenReturn(new Graph(full.nodes(),List.of(full.relations().get(0)),false));return "迟到答复[1][2]";});assertEquals("MODEL_ERROR",send("GRAPH").get("status"));
    }
    @Test void quotaFailurePreservesEvidenceAndReleasesClaim(){
        when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenThrow(new ServiceException(1,"额度不足"));var result=send("GRAPH");assertEquals("MODEL_ERROR",result.get("status"));assertEquals(2,((List<?>)result.get("citations")).size());assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_session WHERE pending_request_id IS NOT NULL",Integer.class));
    }
    @Test void graphPathGroupCannotBeSplitToFitBudget(){
        var graph=new MesGraphEvidenceRetriever.Result(List.of(),full.nodes(),full.relations(),List.of(new MesGraphEvidenceRetriever.Path("a",List.of("a","b","c"),List.of("r1","r2"))),2,false);
        var retrieval=Map.<String,Object>of("items",List.of(),"graph",graph);var prepared=MesAnswerContext.prepare(retrieval,"GRAPH","设备",30000,json);int exact=MesAssistantModelGateway.tokenUpperBound(List.of(Map.of("role","system","content",prepared.text()),Map.of("role","user","content","设备")));
        assertEquals(2,prepared.citations().size());assertThrows(ServiceException.class,()->MesAnswerContext.prepare(retrieval,"GRAPH","设备",exact-1,json));
    }
    @Test void legacyPrivateGraphHistoryIsOwnerOnlyAndNeverUsedAsUnvalidatedFutureContext(){
        var row=MesAnswerContext.citation(new MesRetrievalEvidence("graph:seed","GRAPH","graph_query","LEGACY_PRIVATE",null,null,null,null,null,"原图谱","来源","事实",null,null,null,null,List.of("a","b"),List.of("seed")),Map.of("source","设备","type","关联","target","轴承"),MesKnowledgeAccess.actor());assertTrue(access.canReadHistorical(row));assertFalse(access.currentCitation(row));row.put("graphOwnerId",20L);assertFalse(access.canReadHistorical(row));
    }
    @Test void modesDoNotReuseOldModeOrOutOfScopeHistory(){
        long id=service.createSession(null,10);for(String role:List.of("user","assistant"))jdbc.update("INSERT INTO mes_assistant_message(session_id,user_id,role,content_text,status,citations_json,tenant_id,retrieval_mode) VALUES(?,10,?,'OLD-DOCUMENT-CONTEXT','ANSWERED','[]',1,'DOCUMENT')",id,role);
        when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenAnswer(call->{assertFalse(call.getArgument(1).toString().contains("OLD-DOCUMENT-CONTEXT"));return "结果[1][2]";});assertEquals("ANSWERED",service.send(id,"设备",List.of(kb),10,"GRAPH",2).get("status"));
    }
}
