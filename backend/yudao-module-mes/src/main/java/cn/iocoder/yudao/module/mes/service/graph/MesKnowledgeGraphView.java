package cn.iocoder.yudao.module.mes.service.graph;

import cn.iocoder.yudao.module.mes.service.assistant.*;
import org.springframework.stereotype.Service;
import java.util.*;
import java.nio.charset.StandardCharsets;
import static cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphService.*;

/** Authorized projection: filter live source evidence BEFORE deriving visible nodes and relationships. */
@Service
public class MesKnowledgeGraphView {
    private final MesGraphStore store;private final MesKnowledgeAccess access;
    public MesKnowledgeGraphView(MesGraphStore store,MesKnowledgeAccess access){this.store=store;this.access=access;}
    public Graph snapshot(List<Long> baseIds){
        var actor=MesKnowledgeAccess.actor();var scope=new Scope(actor.tenant(),actor.user());
        var chunks=access.searchableChunks(baseIds);Map<String,Map<String,Object>> live=new HashMap<>();Set<Long> documents=new HashSet<>();
        for(var chunk:chunks){live.put(chunk.get("documentId")+":"+chunk.get("chunkId"),chunk);documents.add(((Number)chunk.get("documentId")).longValue());}
        try{
            List<Map<String,Object>> seeds=baseIds==null||baseIds.isEmpty()?store.read(scope,"MATCH (n:FazeEntity) WHERE n.tenantId=$tenant AND n.ownerId=$owner AND coalesce(n.origin,'')<>'DOCUMENT' RETURN properties(n) AS n ORDER BY n.id LIMIT 10001",Map.of()):List.of();
            var rows=store.read(scope,"MATCH (a:FazeEntity)-[r:FazeRelation]->(b:FazeEntity) WHERE a.tenantId=$tenant AND b.tenantId=$tenant AND r.tenantId=$tenant AND a.ownerId=r.ownerId AND b.ownerId=r.ownerId AND ((r.documentId IS NULL AND r.ownerId=$owner AND $seeds) OR r.documentId IN $documents) RETURN properties(a) AS a,properties(b) AS b,properties(r) AS r ORDER BY r.ownerId,r.id LIMIT 50001",Map.of("documents",new ArrayList<>(documents),"seeds",baseIds==null||baseIds.isEmpty()));
            if(seeds.size()>10000||rows.size()>50000)throw invalid();
            Map<String,Entity> nodes=new TreeMap<>();Map<String,List<Entity>> seedNames=new HashMap<>();
            for(var raw:seeds){var n=map(raw.get("n"));if(!Objects.equals(optionalLong(n,"tenantId"),actor.tenant())||!Objects.equals(optionalLong(n,"ownerId"),actor.user()))continue;var node=new Entity(text(n,"id"),text(n,"name"),text(n,"kind"),text(n,"description"));nodes.put(node.id(),node);Set<String> names=new HashSet<>(Set.of(node.name()));if(n.get("aliases") instanceof List<?> aliases)for(Object alias:aliases)if(alias instanceof String value)names.add(value);for(String name:names)seedNames.computeIfAbsent(MesEntityAlignment.nameKey(name)+"|"+MesEntityAlignment.kind(node.kind()),k->new ArrayList<>()).add(node);}
            List<Relation> edges=new ArrayList<>();
            for(var row:rows){var r=map(row.get("r"));var a=map(row.get("a"));var b=map(row.get("b"));Long document=optionalLong(r,"documentId");
                if(!Objects.equals(optionalLong(r,"tenantId"),actor.tenant())||!Objects.equals(optionalLong(a,"tenantId"),actor.tenant())||!Objects.equals(optionalLong(b,"tenantId"),actor.tenant())||!Objects.equals(optionalLong(a,"ownerId"),optionalLong(r,"ownerId"))||!Objects.equals(optionalLong(b,"ownerId"),optionalLong(r,"ownerId")))continue;
                if(document==null){
                    if(!Objects.equals(optionalLong(r,"ownerId"),actor.user())||!nodes.containsKey(text(a,"id"))||!nodes.containsKey(text(b,"id")))continue;
                    var source=new Source(text(r,"sourceTitle"),text(r,"sourceSection"),text(r,"sourceExcerpt"));String id=text(r,"id");var evidence=new MesRetrievalEvidence("graph:"+id,"GRAPH","graph_query","LEGACY_PRIVATE",null,null,null,null,null,source.title(),source.section(),source.excerpt(),null,null,null,null,List.of(text(a,"id"),text(b,"id")),List.of(id));edges.add(new Relation(id,text(a,"id"),text(b,"id"),text(r,"type"),source,evidence));continue;
                }
                var chunk=live.get(document+":"+r.get("chunkId"));if(chunk==null||!validSource(r,chunk))continue;
                Entity from=visibleNode(a,r,"source",chunk,actor,seedNames),to=visibleNode(b,r,"target",chunk,actor,seedNames);if(from==null||to==null)continue;
                String id=text(r,"id");String heading=text(chunk,"heading")+" · 片段 #"+chunk.get("chunkId");
                var source=new Source(text(chunk,"title"),heading,text(r,"sourceExcerpt"),optionalLong(chunk,"knowledgeBaseId"),document,optionalInt(chunk,"version"),optionalLong(chunk,"chunkId"),text(chunk,"contentHash"),optionalInt(chunk,"pageNumber"),optionalInt(r,"startOffset"),optionalInt(r,"endOffset"),text(r,"extractionMethod"));
                var evidence=new MesRetrievalEvidence("graph:"+id,"GRAPH","graph_query",text(chunk,"libraryType"),source.knowledgeBaseId(),document,source.documentVersion(),source.chunkId(),source.chunkHash(),source.title(),source.section(),source.excerpt(),source.pageNumber(),source.startOffset(),source.endOffset(),null,List.of(from.id(),to.id()),List.of(id));
                nodes.putIfAbsent(from.id(),from);nodes.putIfAbsent(to.id(),to);edges.add(new Relation(id,from.id(),to.id(),text(r,"type"),source,evidence));
            }
            if(nodes.size()>10000)throw invalid();edges.sort(Comparator.comparing(Relation::id));return new Graph(List.copyOf(nodes.values()),List.copyOf(edges),false);
        }catch(cn.iocoder.yudao.framework.common.exception.ServiceException e){throw e;}catch(RuntimeException e){throw new cn.iocoder.yudao.framework.common.exception.ServiceException(1_047_150_000,"知识图谱暂不可用，请检查 Neo4j 服务或后端连接配置后重试");}
    }
    private boolean validSource(Map<String,Object> r,Map<String,Object> chunk){
        if(!Objects.equals(optionalLong(r,"ownerId"),optionalLong(chunk,"documentOwner"))||!Objects.equals(optionalInt(r,"documentVersion"),optionalInt(chunk,"version"))||!text(r,"chunkHash").equals(text(chunk,"contentHash")))return false;
        Integer from=optionalInt(r,"startOffset"),until=optionalInt(r,"endOffset"),start=optionalInt(chunk,"startOffset"),end=optionalInt(chunk,"endOffset");String content=text(chunk,"content");
        if(from==null||until==null||start==null||end==null||from<start||until>end||until<=from||until-start>content.length())return false;
        return content.substring(from-start,until-start).equals(text(r,"sourceExcerpt"))&&MesAssistantDocumentParser.sha256(content.getBytes(StandardCharsets.UTF_8)).equals(text(chunk,"contentHash"))&&Objects.equals(optionalInt(r,"pageNumber"),optionalInt(chunk,"pageNumber"));
    }
    private Entity visibleNode(Map<String,Object> n,Map<String,Object> r,String end,Map<String,Object> chunk,MesKnowledgeAccess.Actor actor,Map<String,List<Entity>> seedNames){
        String name=text(r,end+"OriginalName");boolean own=Objects.equals(optionalLong(n,"ownerId"),actor.user());
        if(name.isBlank()){if(!own)return null;name=text(n,"name");}
        String type=text(r,end+"ResolvedKind");if(type.isBlank())type=own?text(n,"kind"):text(r,end+"OriginalKind");type=MesEntityAlignment.kind(type);
        if(text(chunk,"libraryType").equals("PERSONAL")){
            var seed=seedNames.getOrDefault(MesEntityAlignment.nameKey(name)+"|"+type,List.of());if(seed.size()==1)return seed.get(0);
        }
        // Different library permission domains never share opaque private canonical IDs or descriptions.
        String prefix=text(chunk,"libraryType").equals("RULES")?"kb:"+chunk.get("knowledgeBaseId"):"private:"+actor.user();
        String id=prefix+":"+MesEntityAlignment.entityId(name,type).substring("doc-entity:".length());return new Entity(id,name,type,"");
    }
    public Graph overview(int size){limit(size,200);return subset(snapshot(List.of()),size);}
    private Graph subset(Graph full,int size){var nodes=full.nodes().stream().limit(size).toList();return induced(full,nodes,full.nodes().size()>size);}
    private Graph induced(Graph full,List<Entity> nodes,boolean more){var ids=new HashSet<>(nodes.stream().map(Entity::id).toList());var edges=full.relations().stream().filter(r->ids.contains(r.source())&&ids.contains(r.target())).toList();return new Graph(nodes,edges.stream().limit(500).toList(),more||edges.size()>500);}
    public Search search(String query,int size){limit(size,50);if(query==null||query.isBlank()||query.length()>100)throw invalid();String key=query.strip().toLowerCase(Locale.ROOT);var found=snapshot(List.of()).nodes().stream().filter(n->n.name().toLowerCase(Locale.ROOT).contains(key)||n.kind().toLowerCase(Locale.ROOT).contains(key)).toList();return new Search(found.stream().limit(size).toList(),found.size()>size);}
    public Entity detail(String value){id(value);return snapshot(List.of()).nodes().stream().filter(n->n.id().equals(value)).findFirst().orElseThrow(MesKnowledgeGraphService::missing);}
    public Graph neighbors(String value,int size){id(value);limit(size,100);var full=snapshot(List.of());var root=full.nodes().stream().filter(n->n.id().equals(value)).findFirst().orElseThrow(MesKnowledgeGraphService::missing);Set<String> linked=new TreeSet<>();for(var r:full.relations()){if(r.source().equals(value))linked.add(r.target());if(r.target().equals(value))linked.add(r.source());}linked.remove(value);boolean more=linked.size()>size;var ids=new HashSet<>(linked.stream().limit(size).toList());List<Entity> nodes=new ArrayList<>();nodes.add(root);full.nodes().stream().filter(n->ids.contains(n.id())).forEach(nodes::add);return induced(full,nodes,more);}
    public Page<Entity> nodePage(String after,int size){limit(size,200);if(after==null)after="";if(after.length()>128)throw invalid();final String cursor=after;var nodes=snapshot(List.of()).nodes().stream().filter(n->n.id().compareTo(cursor)>0).toList();var items=nodes.stream().limit(size).toList();return new Page<>(items,nodes.size()>size?items.get(items.size()-1).id():null);}
    public Page<Relation> relationPage(String after,int size){limit(size,500);if(after==null)after="";if(after.length()>128)throw invalid();final String cursor=after;var edges=snapshot(List.of()).relations().stream().filter(r->r.id().compareTo(cursor)>0).toList();var items=edges.stream().limit(size).toList();return new Page<>(items,edges.size()>size?items.get(items.size()-1).id():null);}
}
