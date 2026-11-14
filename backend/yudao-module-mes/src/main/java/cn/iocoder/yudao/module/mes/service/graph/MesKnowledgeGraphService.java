package cn.iocoder.yudao.module.mes.service.graph;

import cn.iocoder.yudao.framework.common.exception.ServiceException;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class MesKnowledgeGraphService {
    public record Scope(long tenant,long owner) {}
    public record Entity(String id,String name,String kind,String description) {}
    public record Source(String title,String section,String excerpt) {}
    public record Relation(String id,String source,String target,String type,Source sourceEvidence) {}
    public record Graph(List<Entity> nodes,List<Relation> relations,boolean hasMore) {}
    public record Search(List<Entity> items,boolean hasMore) {}
    private final MesGraphStore store;
    public MesKnowledgeGraphService(MesGraphStore store){this.store=store;}
    static final String NODE_SCOPE="n.tenantId=$tenant AND n.ownerId=$owner";
    static final String EDGE_SCOPE="a.tenantId=$tenant AND a.ownerId=$owner AND b.tenantId=$tenant AND b.ownerId=$owner AND r.tenantId=$tenant AND r.ownerId=$owner";
    Scope scope(){
        var login=SecurityFrameworkUtils.getLoginUser();
        Long tenant=TenantContextHolder.getTenantId();
        Long trusted=login==null?null:(login.getVisitTenantId()!=null?login.getVisitTenantId():login.getTenantId());
        if(login==null||login.getId()==null||tenant==null||!tenant.equals(trusted))throw missing();
        return new Scope(tenant,login.getId());
    }
    static ServiceException missing(){return new ServiceException(1_047_150_001,"实体不存在或无权访问");}
    static ServiceException invalid(){return new ServiceException(1_047_150_002,"图谱查询参数无效");}
    static int limit(int value,int max){if(value<1||value>max)throw invalid();return value;}
    static String id(String id){if(id==null||id.isBlank()||id.length()>128)throw invalid();return id;}
    private List<Map<String,Object>> read(Scope scope,String query,Map<String,Object> params){
        try{return store.read(scope,query,params);}
        catch(ServiceException e){throw e;}
        catch(RuntimeException e){throw new ServiceException(1_047_150_000,"知识图谱暂不可用，请检查 Neo4j 服务或后端连接配置后重试");}
    }
    public Graph overview(int size){
        Scope scope=scope();limit(size,200);
        var rows=read(scope,"MATCH (n:FazeEntity) WHERE "+NODE_SCOPE+" RETURN properties(n) AS entity ORDER BY n.id LIMIT $limit",Map.of("limit",size+1));
        boolean more=rows.size()>size;
        List<Entity> nodes=rows.stream().limit(size).map(row->entity(map(row.get("entity")))).toList();
        return graph(scope,nodes,more);
    }
    public Search search(String query,int size){
        Scope scope=scope();limit(size,50);
        if(query==null||query.isBlank()||query.length()>100)throw invalid();
        var rows=read(scope,"MATCH (n:FazeEntity) WHERE "+NODE_SCOPE+" AND (toLower(n.name) CONTAINS toLower($query) OR toLower(n.kind) CONTAINS toLower($query)) RETURN properties(n) AS entity ORDER BY n.name,n.id LIMIT $limit",Map.of("query",query.trim(),"limit",size+1));
        return new Search(rows.stream().limit(size).map(row->entity(map(row.get("entity")))).toList(),rows.size()>size);
    }
    public Entity detail(String value){return detail(scope(),id(value));}
    private Entity detail(Scope scope,String value){
        var rows=read(scope,"MATCH (n:FazeEntity) WHERE "+NODE_SCOPE+" AND n.id=$id RETURN properties(n) AS entity LIMIT 1",Map.of("id",value));
        if(rows.isEmpty())throw missing();return entity(map(rows.get(0).get("entity")));
    }
    public Graph neighbors(String value,int size){
        Scope scope=scope();id(value);limit(size,100);Entity root=detail(scope,value);
        var rows=read(scope,"MATCH (a:FazeEntity)-[r:FazeRelation]-(b:FazeEntity) WHERE "+EDGE_SCOPE+" AND a.id=$id RETURN DISTINCT properties(b) AS entity ORDER BY entity.id LIMIT $limit",Map.of("id",value,"limit",size+1));
        List<Entity> nodes=new ArrayList<>();nodes.add(root);
        rows.stream().limit(size).map(row->entity(map(row.get("entity")))).filter(n->!n.id().equals(value)).forEach(nodes::add);
        return graph(scope,nodes,rows.size()>size);
    }
    private Graph graph(Scope scope,List<Entity> nodes,boolean more){
        if(nodes.isEmpty())return new Graph(nodes,List.of(),more);
        var rows=read(scope,"MATCH (a:FazeEntity)-[r:FazeRelation]->(b:FazeEntity) WHERE "+EDGE_SCOPE+" AND a.id IN $ids AND b.id IN $ids RETURN properties(r) AS relation,a.id AS source,b.id AS target ORDER BY r.id LIMIT 501",Map.of("ids",nodes.stream().map(Entity::id).toList()));
        var edges=rows.stream().limit(500).map(row->{var r=map(row.get("relation"));return new Relation(text(r,"id"),text(row,"source"),text(row,"target"),text(r,"type"),new Source(text(r,"sourceTitle"),text(r,"sourceSection"),text(r,"sourceExcerpt")));}).toList();
        return new Graph(nodes,edges,more||rows.size()>500);
    }
    @SuppressWarnings("unchecked") static Map<String,Object> map(Object value){return (Map<String,Object>)value;}
    static String text(Map<String,Object> row,String key){Object value=row.get(key);return value==null?"":value.toString();}
    static Entity entity(Map<String,Object> row){return new Entity(text(row,"id"),text(row,"name"),text(row,"kind"),text(row,"description"));}
}
