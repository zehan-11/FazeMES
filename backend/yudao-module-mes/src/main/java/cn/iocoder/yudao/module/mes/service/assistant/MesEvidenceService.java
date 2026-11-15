package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphView;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.*;

/** Retrieves evidence without generating an answer. Semantic strategies embed only the question via the configured API. */
@Service
public class MesEvidenceService {
    private final MesAssistantService documents;
    private final MesGraphEvidenceRetriever graph;
    public MesEvidenceService(MesAssistantService documents,MesKnowledgeGraphView graph){this(documents,new MesGraphEvidenceRetriever(graph));}
    @Autowired
    public MesEvidenceService(MesAssistantService documents,MesGraphEvidenceRetriever graph){this.documents=documents;this.graph=graph;}
    public Map<String,Object> search(String query,List<Long> baseIds,List<String> sources,int size){return search(query,baseIds,sources,size,null,2);}
    public Map<String,Object> search(String query,List<Long> baseIds,List<String> sources,int size,String mode,int hops){return search(query,baseIds,sources,size,mode,hops,"LEXICAL");}
    public Map<String,Object> search(String query,List<Long> baseIds,List<String> sources,int size,String mode,int hops,String documentStrategy){
        documentStrategy=MesDocumentSearchService.strategy(documentStrategy);
        MesKnowledgeAccess.actor();if(query==null||query.isBlank()||query.length()>1000||size<1||size>10||hops<1||hops>2)throw MesAssistantErrors.invalid("检索参数无效");
        if(sources!=null&&(sources.size()>2||sources.stream().anyMatch(Objects::isNull)))throw MesAssistantErrors.invalid("证据来源类型无效");
        var requested=sources==null||sources.isEmpty()?Set.of("DOCUMENT"):new HashSet<>(sources);
        if(!Set.of("DOCUMENT","GRAPH").containsAll(requested))throw MesAssistantErrors.invalid("证据来源类型无效");
        if(mode!=null){
            Set<String> selected=switch(mode){case "DOCUMENT"->Set.of("DOCUMENT");case "GRAPH"->Set.of("GRAPH");case "HYBRID"->Set.of("DOCUMENT","GRAPH");default->throw MesAssistantErrors.invalid("检索模式无效");};
            if(sources!=null&&!sources.isEmpty()&&!selected.equals(requested))throw MesAssistantErrors.invalid("检索模式与来源不一致");requested=selected;
        }
        String effective=requested.size()==2?"HYBRID":requested.iterator().next();
        List<MesRetrievalEvidence> docs=new ArrayList<>(),graphs=new ArrayList<>();Map<String,Object> result=new LinkedHashMap<>();
        result.put("schemaVersion",1);result.put("mode",effective);result.put("query",query);boolean more=false;
        if(requested.contains("DOCUMENT")){
            var response=documents.search(query,baseIds,10,documentStrategy);result.put("eligibleChunkCount",response.get("eligibleChunkCount"));result.put("documentStrategy",documentStrategy);result.put("documentRetrieval",response.get("documentRetrieval"));
            if(response.get("items") instanceof List<?> rows)for(Object item:rows){@SuppressWarnings("unchecked") var row=(Map<String,Object>)item;docs.add((MesRetrievalEvidence)row.get("evidence"));}
            // Existing ranker caps at 10; conservatively report possible additional candidates.
            more=docs.size()==10;
        }
        if(requested.contains("GRAPH")){
            var found=graph.retrieve(query,baseIds,hops);result.put("graph",found);for(var edge:found.relations())graphs.add(edge.evidence());more|=found.hasMore();
        }
        List<MesRetrievalEvidence> mixed=new ArrayList<>();
        for(int i=0;i<Math.max(docs.size(),graphs.size());i++){if(i<docs.size())mixed.add(docs.get(i));if(i<graphs.size())mixed.add(graphs.get(i));}
        result.put("items",mixed.stream().limit(size).toList());result.put("hasMore",more||mixed.size()>size);return result;
    }
}
