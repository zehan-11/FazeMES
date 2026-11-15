package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphView;
import org.springframework.stereotype.Service;
import java.util.*;

/** Local-only evidence retrieval. Graph retrieval here is bounded lexical/adjacency selection, not GraphRAG generation. */
@Service
public class MesEvidenceService {
    private final MesAssistantService documents;private final MesKnowledgeGraphView graph;
    public MesEvidenceService(MesAssistantService documents,MesKnowledgeGraphView graph){this.documents=documents;this.graph=graph;}
    public Map<String,Object> search(String query,List<Long> baseIds,List<String> sources,int size){
        MesKnowledgeAccess.actor();if(query==null||query.isBlank()||query.length()>1000||size<1||size>10)throw MesAssistantErrors.invalid("检索参数无效");
        var requested=sources==null||sources.isEmpty()?Set.of("DOCUMENT"):new HashSet<>(sources);if(!Set.of("DOCUMENT","GRAPH").containsAll(requested))throw MesAssistantErrors.invalid("证据来源类型无效");
        List<MesRetrievalEvidence> result=new ArrayList<>();
        if(requested.contains("DOCUMENT")){
            var response=documents.search(query,baseIds,size);if(response.get("items") instanceof List<?> rows)for(Object item:rows){@SuppressWarnings("unchecked") var row=(Map<String,Object>)item;result.add((MesRetrievalEvidence)row.get("evidence"));}
        }
        if(requested.contains("GRAPH")){
            var full=graph.snapshot(baseIds);String key=query.strip().toLowerCase(Locale.ROOT);Set<String> matches=new HashSet<>();for(var n:full.nodes())if(n.name().toLowerCase(Locale.ROOT).contains(key))matches.add(n.id());
            for(var edge:full.relations())if(edge.evidence()!=null&&!edge.evidence().text().isBlank()&&(matches.contains(edge.source())||matches.contains(edge.target())||edge.evidence().text().toLowerCase(Locale.ROOT).contains(key))){result.add(edge.evidence());if(result.size()>=size*2)break;}
        }
        var docs=result.stream().filter(e->e.sourceType().equals("DOCUMENT")).toList();var graphs=result.stream().filter(e->e.sourceType().equals("GRAPH")).toList();List<MesRetrievalEvidence> mixed=new ArrayList<>();
        for(int i=0;i<Math.max(docs.size(),graphs.size());i++){if(i<docs.size())mixed.add(docs.get(i));if(i<graphs.size())mixed.add(graphs.get(i));}
        return Map.of("schemaVersion",1,"query",query,"items",mixed.stream().limit(size).toList(),"hasMore",mixed.size()>size);
    }
}
