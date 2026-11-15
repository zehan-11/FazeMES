package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.MesGraphStore;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.*;

/** Current authorized SQL sources constrain ANN before top-k; Neo4j never supplies authoritative text to the caller. */
@Service
public class MesDocumentSearchService {
    private final JdbcTemplate jdbc;
    private final MesKnowledgeAccess access;
    private final MesAssistantRetriever lexical;
    private final MesAssistantModelGateway models;
    private final MesGraphStore graph;
    public MesDocumentSearchService(JdbcTemplate jdbc,MesKnowledgeAccess access,MesAssistantRetriever lexical,MesAssistantModelGateway models,MesGraphStore graph) {
        this.jdbc=jdbc;this.access=access;this.lexical=lexical;this.models=models;this.graph=graph;
    }
    public static String strategy(String value) {
        String selected=value==null?"LEXICAL":value;
        if(!Set.of("LEXICAL","SEMANTIC","COMBINED").contains(selected))throw MesAssistantErrors.invalid("文档检索策略无效");
        return selected;
    }
    public Map<String,Object> search(String query,List<Long> bases,int limit,String requested) {
        String selected=strategy(requested);var actor=MesKnowledgeAccess.actor();
        if(query==null||query.isBlank()||query.length()>1000||limit<1||limit>10)throw MesAssistantErrors.invalid("文档检索参数无效");
        if(TransactionSynchronizationManager.isActualTransactionActive()&&!selected.equals("LEXICAL"))throw MesAssistantErrors.invalid("语义检索不能在活动业务事务中执行");
        var sources=access.searchableChunks(bases);
        if(selected.equals("LEXICAL"))return result(query,sources,lexical.rank(query,sources,limit),selected,"LEXICAL",List.of(),null,false);
        if(sources.isEmpty())return result(query,sources,List.of(),selected,selected,List.of("当前范围暂无可访问的已发布片段"),0,false);
        MesAssistantModelGateway.EmbeddingSpace space;
        try {space=models.embeddingSpace();}
        catch(cn.iocoder.yudao.framework.common.exception.ServiceException failure){return unavailable(query,bases,limit,selected,failure.getMessage());}
        var eligible=catalog(sources,space,actor.tenant());
        if(eligible.isEmpty()) {
            var fresh=access.searchableChunks(bases);
            return result(query,fresh,selected.equals("COMBINED")?lexical.rank(query,fresh,limit):List.of(),selected,
                    selected.equals("COMBINED")?"LEXICAL":"SEMANTIC",List.of("当前范围没有完成当前模型向量索引的片段，请先建立索引"),0,selected.equals("COMBINED"));
        }
        List<Double> questionVector;
        try {questionVector=models.embed(List.of(query),space.spaceId()).vectors().get(0);}
        catch(RuntimeException failure){return unavailable(query,bases,limit,selected,safeFailure(failure));}
        // Permission or file changes while embedding the question must be applied before ANN, too.
        var beforeAnn=access.searchableChunks(bases);
        MesAssistantModelGateway.EmbeddingSpace beforeAnnSpace;
        try {beforeAnnSpace=models.embeddingSpace();}
        catch(cn.iocoder.yudao.framework.common.exception.ServiceException failure){return unavailable(query,bases,limit,selected,failure.getMessage());}
        if(!beforeAnnSpace.spaceId().equals(space.spaceId()))return unavailable(query,bases,limit,selected,"Embedding配置在检索期间变更，请重新检索");
        var annScope=catalog(beforeAnn,space,actor.tenant());
        if(annScope.isEmpty())return result(query,beforeAnn,selected.equals("COMBINED")?lexical.rank(query,beforeAnn,limit):List.of(),selected,
                selected.equals("COMBINED")?"LEXICAL":"SEMANTIC",List.of("检索期间文件或权限已变更，未使用旧向量"),0,false);
        List<Map<String,Object>> candidates;
        try {
            var documents=annScope.values().stream().map(r->n(r,"documentId")).distinct().sorted().toList();
            candidates=graph.searchVectorChunks(actor.tenant(),space.spaceId(),documents,questionVector,50);
        } catch(RuntimeException failure){return unavailable(query,bases,limit,selected,safeFailure(failure));}
        // Reauthorize after both remote calls. Permission failures cannot be converted into keyword fallback.
        var fresh=access.searchableChunks(bases);
        MesAssistantModelGateway.EmbeddingSpace refreshedSpace;
        try {refreshedSpace=models.embeddingSpace();}
        catch(cn.iocoder.yudao.framework.common.exception.ServiceException failure){return unavailable(query,bases,limit,selected,failure.getMessage());}
        if(!refreshedSpace.spaceId().equals(space.spaceId()))return unavailable(query,bases,limit,selected,"Embedding配置在检索期间变更，请重新检索");
        var current=catalog(fresh,space,actor.tenant());
        List<Map<String,Object>> semantic=new ArrayList<>();Set<Long> seen=new HashSet<>();int rejected=0;
        for(var candidate:candidates) {
            if(!(candidate.get("chunk") instanceof Map<?,?> raw)){rejected++;continue;}
            Long id=number(raw.get("chunkId"));var source=id==null?null:current.get(id);
            if(source==null || !validProof(candidate,source,space,actor.tenant()) || !(candidate.get("score") instanceof Number similarity)
                    || !Double.isFinite(similarity.doubleValue()) || similarity.doubleValue()<0 || similarity.doubleValue()>1){rejected++;continue;}
            if(!seen.add(id))continue;
            var row=new LinkedHashMap<>(source);double score=((Number)candidate.get("score")).doubleValue();
            row.put("score",score);row.put("retrievalMethod","vector_cosine");
            row.put("retrievalDetails",new LinkedHashMap<>(Map.of("spaceId",space.spaceId(),"generation",row.get("vectorGeneration"),"semanticScore",score,"semanticRank",semantic.size()+1)));
            semantic.add(row);
        }
        List<String> warnings=new ArrayList<>();
        if(current.size()<fresh.size())warnings.add("部分已发布片段尚未完成当前模型向量索引，语义通道仅覆盖已入库资料");
        if(rejected>0)warnings.add("部分过期或来源不一致的向量候选已排除");
        if(semantic.isEmpty()) {
            warnings.add("未取得当前有效的语义候选，请检查索引状态或重新建立索引");
            return result(query,fresh,selected.equals("COMBINED")?lexical.rank(query,fresh,limit):List.of(),selected,
                    selected.equals("COMBINED")?"LEXICAL":"SEMANTIC",warnings,current.size(),selected.equals("COMBINED"));
        }
        if(selected.equals("SEMANTIC"))return result(query,fresh,semantic.stream().limit(limit).toList(),selected,"SEMANTIC",warnings,current.size(),semantic.size()>limit);
        var fused=fuse(lexical.rank(query,fresh,30),semantic);
        return result(query,fresh,fused.stream().limit(limit).toList(),selected,"COMBINED",warnings,current.size(),fused.size()>limit);
    }
    private Map<Long,Map<String,Object>> catalog(List<Map<String,Object>> sources,MesAssistantModelGateway.EmbeddingSpace space,long tenant) {
        var states=jdbc.queryForList("SELECT v.document_id,v.document_version,v.owner_id,v.knowledge_base_id,v.generation FROM mes_assistant_vector_state v JOIN mes_assistant_document d ON d.tenant_id=v.tenant_id AND d.id=v.document_id AND d.deleted=0 AND d.status='PUBLISHED' AND d.version=v.document_version AND d.creator=v.owner_id AND d.knowledge_base_id=v.knowledge_base_id WHERE v.tenant_id=? AND v.status='INDEXED' AND v.desired_state='PUBLISHED' AND v.space_id=? AND v.model_name=? AND v.dimensions=? AND v.chunk_count>0 AND v.chunk_count=v.completed_chunks AND v.chunk_count=d.chunk_count",tenant,space.spaceId(),space.model(),space.dimensions());
        Map<Long,Map<String,Object>> byDocument=new HashMap<>();for(var state:states)byDocument.put(n(state,"document_id"),state);
        Map<Long,Map<String,Object>> result=new LinkedHashMap<>();
        for(var source:sources) {
            var state=byDocument.get(n(source,"documentId"));
            if(state==null || n(state,"document_version")!=n(source,"version") || n(state,"owner_id")!=n(source,"documentOwner") || n(state,"knowledge_base_id")!=n(source,"knowledgeBaseId"))continue;
            var row=new LinkedHashMap<>(source);row.put("vectorGeneration",n(state,"generation"));result.put(n(source,"chunkId"),row);
        }
        return result;
    }
    private static boolean validProof(Map<String,Object> proof,Map<String,Object> source,MesAssistantModelGateway.EmbeddingSpace space,long tenant) {
        if(!(proof.get("chunk") instanceof Map<?,?> chunk) || !(proof.get("checkpoint") instanceof Map<?,?> checkpoint) || !Boolean.TRUE.equals(checkpoint.get("active")))return false;
        for(var item:List.of(chunk,checkpoint)) {
            if(!eq(item,"tenantId",tenant)||!eq(item,"ownerId",source.get("documentOwner"))||!eq(item,"knowledgeBaseId",source.get("knowledgeBaseId"))
                    ||!eq(item,"documentId",source.get("documentId"))||!eq(item,"documentVersion",source.get("version"))||!eq(item,"generation",source.get("vectorGeneration"))
                    ||!space.spaceId().equals(item.get("spaceId"))||!space.model().equals(item.get("model"))||!eq(item,"dimensions",space.dimensions()))return false;
        }
        return eq(chunk,"chunkId",source.get("chunkId")) && eq(chunk,"chunkIndex",source.get("chunkIndex"))
                && Objects.equals(chunk.get("chunkHash"),source.get("contentHash")) && Objects.equals(chunk.get("text"),source.get("content"))
                && Objects.equals(chunk.get("heading"),source.get("heading")) && eq(chunk,"startOffset",source.get("startOffset"))
                && eq(chunk,"endOffset",source.get("endOffset")) && eq(chunk,"pageNumber",source.get("pageNumber"));
    }
    /** Used before and after generation and for history; never repeats query embedding or ANN. */
    public boolean currentVectorEvidence(List<Map<String,Object>> citations,List<Long> bases) {
        var vector=citations.stream().filter(c->details(c).containsKey("spaceId")).toList();if(vector.isEmpty())return true;
        try {
            var actor=MesKnowledgeAccess.actor();var space=models.embeddingSpace();
            var eligible=catalog(access.searchableChunks(bases),space,actor.tenant());
            List<Long> ids=vector.stream().map(c->n(c,"chunkId")).distinct().toList();if(ids.size()>10)return false;
            Map<Long,Map<String,Object>> proofs=new HashMap<>();
            var documentIds=vector.stream().map(c->n(c,"documentId")).distinct().toList();
            for(var proof:graph.vectorSources(actor.tenant(),space.spaceId(),documentIds,ids))if(proof.get("chunk") instanceof Map<?,?> row&&number(row.get("chunkId"))!=null)proofs.put(number(row.get("chunkId")),proof);
            for(var citation:vector) {
                var source=eligible.get(n(citation,"chunkId"));var info=details(citation);
                if(source==null || !space.spaceId().equals(info.get("spaceId")) || !eq(info,"generation",source.get("vectorGeneration"))
                        || !eq(citation,"documentId",source.get("documentId")) || !eq(citation,"knowledgeBaseId",source.get("knowledgeBaseId")) || !eq(citation,"version",source.get("version"))
                        || !Objects.equals(citation.get("contentHash"),source.get("contentHash")) || !Objects.equals(citation.get("content"),source.get("content"))
                        || !validProof(proofs.getOrDefault(n(citation,"chunkId"),Map.of()),source,space,actor.tenant()))return false;
            }
            return true;
        }catch(RuntimeException failure){return false;}
    }
    public static boolean dependsOnVector(Map<String,Object> row){return details(row).containsKey("spaceId");}
    @SuppressWarnings("unchecked") private static Map<String,Object> details(Map<String,Object> row) {
        if(row.get("retrievalDetails") instanceof Map<?,?> map)return (Map<String,Object>)map;
        if(row.get("evidence") instanceof MesRetrievalEvidence e)return e.retrievalDetails();
        if(row.get("evidence") instanceof Map<?,?> map && map.get("retrievalDetails") instanceof Map<?,?> info)return (Map<String,Object>)info;
        return Map.of();
    }
    private Map<String,Object> unavailable(String query,List<Long> bases,int limit,String selected,String reason) {
        if(selected.equals("SEMANTIC"))throw MesAssistantErrors.model("语义检索暂不可用："+reason);
        var fresh=access.searchableChunks(bases);
        return result(query,fresh,lexical.rank(query,fresh,limit),selected,"LEXICAL",List.of("语义通道暂不可用，已降级为关键词检索："+reason),null,false);
    }
    private static String safeFailure(RuntimeException failure){return failure instanceof cn.iocoder.yudao.framework.common.exception.ServiceException e?e.getMessage():"向量索引连接失败，请检查Neo4j服务或重建索引";}
    @SuppressWarnings("unchecked") private static List<Map<String,Object>> fuse(List<Map<String,Object>> lexical,List<Map<String,Object>> semantic) {
        Map<Long,Map<String,Object>> union=new LinkedHashMap<>();
        for(int channel=0;channel<2;channel++) {
            var list=channel==0?lexical:semantic;
            for(int rank=0;rank<list.size();rank++) {
                var candidate=list.get(rank);long id=n(candidate,"chunkId");
                var row=union.computeIfAbsent(id,key->{var copy=new LinkedHashMap<>(candidate);copy.put("score",0.0);copy.put("retrievalDetails",new LinkedHashMap<String,Object>());return copy;});
                var info=(Map<String,Object>)row.get("retrievalDetails");
                if(channel==1)info.putAll(details(candidate));
                info.put(channel==0?"lexicalRank":"semanticRank",rank+1);info.put(channel==0?"lexicalScore":"semanticScore",candidate.get("score"));
                row.put("score",((Number)row.get("score")).doubleValue()+1.0/(61+rank));row.put("retrievalMethod","document_rrf");
            }
        }
        return union.values().stream().sorted(Comparator.<Map<String,Object>>comparingDouble(r->-((Number)r.get("score")).doubleValue()).thenComparingLong(r->n(r,"chunkId"))).toList();
    }
    private static Map<String,Object> result(String query,List<Map<String,Object>> sources,List<Map<String,Object>> items,String requested,String effective,List<String> warnings,Integer indexed,boolean more) {
        List<Map<String,Object>> output=new ArrayList<>();
        for(var value:items) {var row=new LinkedHashMap<>(value);row.putIfAbsent("retrievalMethod",effective.equals("LEXICAL")?"lexical_bm25":effective.equals("SEMANTIC")?"vector_cosine":"document_rrf");row.put("evidence",MesRetrievalEvidence.document(row));row.remove("documentOwner");row.remove("vectorGeneration");output.add(row);}
        var info=new LinkedHashMap<String,Object>();info.put("requestedStrategy",requested);info.put("effectiveStrategy",effective);info.put("degraded",requested.equals("COMBINED")&&effective.equals("LEXICAL"));info.put("warnings",warnings);info.put("eligibleChunkCount",sources.size());info.put("vectorEligibleChunkCount",indexed);
        return Map.of("mode",effective.equals("LEXICAL")?"lexical_bm25":effective.equals("SEMANTIC")?"vector_cosine":"document_rrf","query",query,"items",output,"eligibleChunkCount",sources.size(),"documentStrategy",requested,"documentRetrieval",info,"hasMore",more);
    }
    private static Long number(Object value){return value instanceof Number n?n.longValue():null;}
    private static long n(Map<?,?> row,String key){return ((Number)row.get(key)).longValue();}
    private static boolean eq(Map<?,?> row,String key,Object expected) {Object actual=row.get(key);return actual instanceof Number a && expected instanceof Number b?a.longValue()==b.longValue():Objects.equals(actual,expected);}
}
