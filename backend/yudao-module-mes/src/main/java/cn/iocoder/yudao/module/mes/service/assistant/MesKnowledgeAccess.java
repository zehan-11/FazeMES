package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.framework.security.core.service.SecurityFrameworkService;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import java.util.*;

/** One source-of-truth policy: personal owner only; rules libraries use explicit active tenant roles. */
@Component
public class MesKnowledgeAccess {
    public record Actor(long tenant,long user) {}
    private final JdbcTemplate jdbc;private final SecurityFrameworkService security;
    @org.springframework.beans.factory.annotation.Autowired
    public MesKnowledgeAccess(JdbcTemplate jdbc,SecurityFrameworkService security){this.jdbc=jdbc;this.security=security;}
    public static Actor actor(){
        long tenant=TenantContextHolder.getRequiredTenantId();var login=SecurityFrameworkUtils.getLoginUser();
        Long trusted=login==null?null:login.getVisitTenantId()!=null?login.getVisitTenantId():login.getTenantId();
        if(login==null||login.getId()==null||!Objects.equals(tenant,trusted))throw MesAssistantErrors.missing();
        return new Actor(tenant,login.getId());
    }
    public boolean rulesAdmin(){actor();return security!=null&&security.hasPermission("mes:assistant:config");}
    private String readable(){return "(b.library_type='PERSONAL' AND b.owner_id=? OR b.library_type='RULES' AND (b.owner_id=? OR ?=1 OR EXISTS (SELECT 1 FROM mes_assistant_base_role ar JOIN system_role sr ON sr.id=ar.role_id AND sr.tenant_id=ar.tenant_id AND sr.deleted=0 AND sr.status=0 JOIN system_user_role ur ON ur.role_id=sr.id AND ur.user_id=? AND ur.deleted=0 WHERE ar.tenant_id=b.tenant_id AND ar.knowledge_base_id=b.id)))";}
    private Object[] args(Actor actor){return new Object[]{actor.tenant(),actor.user(),actor.user(),rulesAdmin()?1:0,actor.user()};}
    public List<Map<String,Object>> readableBases(){
        var a=actor();var rows=rows("SELECT b.id,b.name,b.description,b.library_type,b.owner_id,b.update_time FROM mes_assistant_knowledge_base b WHERE b.tenant_id=? AND b.deleted=0 AND "+readable()+" ORDER BY b.id DESC",args(a));
        for(var row:rows){row.put("canManage",canWrite(row));row.put("readerRoleIds",jdbc.queryForList("SELECT role_id FROM mes_assistant_base_role WHERE tenant_id=? AND knowledge_base_id=? ORDER BY role_id",Long.class,a.tenant(),row.get("id")));}return rows;
    }
    public Map<String,Object> requireBase(long id,boolean write){
        var a=actor();var parameters=new ArrayList<Object>(Arrays.asList(args(a)));parameters.add(id);
        var found=rows("SELECT b.id,b.name,b.library_type,b.owner_id FROM mes_assistant_knowledge_base b WHERE b.tenant_id=? AND b.deleted=0 AND "+readable()+" AND b.id=?",parameters.toArray());
        if(found.isEmpty()||write&&!canWrite(found.get(0)))throw MesAssistantErrors.missing();return found.get(0);
    }
    public boolean canWrite(Map<String,Object> base){
        var a=actor();return base.get("libraryType").equals("PERSONAL")?((Number)base.get("ownerId")).longValue()==a.user():rulesAdmin();
    }
    public Map<String,Object> requireDocument(long id,boolean write){
        var a=actor();var found=jdbc.queryForList("SELECT knowledge_base_id,status,version,creator FROM mes_assistant_document WHERE tenant_id=? AND id=? AND deleted=0",a.tenant(),id);
        if(found.isEmpty())throw MesAssistantErrors.missing();var base=requireBase(((Number)found.get(0).get("knowledge_base_id")).longValue(),write);
        base.put("documentStatus",found.get(0).get("status"));base.put("documentVersion",found.get(0).get("version"));return base;
    }
    public List<Map<String,Object>> searchableChunks(List<Long> requested){
        var a=actor();List<Long> ids=requested==null?List.of():requested.stream().distinct().toList();
        if(ids.size()>20||ids.stream().anyMatch(id->id==null||id<=0))throw MesAssistantErrors.invalid("知识库范围无效");
        for(long id:ids)requireBase(id,false);
        var parameters=new ArrayList<Object>(Arrays.asList(args(a)));String selected="";
        if(!ids.isEmpty()){selected=" AND b.id IN ("+String.join(",",Collections.nCopies(ids.size(),"?"))+")";parameters.addAll(ids);}
        var result=rows("SELECT c.id AS chunk_id,c.document_id,d.knowledge_base_id,d.creator AS document_owner,d.title,d.file_name,c.chunk_index,c.heading,c.page_number,c.start_offset,c.end_offset,c.content_text AS content,c.content_sha256 AS content_hash,d.version,b.library_type FROM mes_assistant_knowledge_base b JOIN mes_assistant_document d ON d.knowledge_base_id=b.id AND d.tenant_id=b.tenant_id AND d.deleted=0 AND d.status='PUBLISHED' JOIN mes_assistant_chunk c ON c.document_id=d.id AND c.tenant_id=d.tenant_id AND c.deleted=0 WHERE b.tenant_id=? AND b.deleted=0 AND "+readable()+selected+" ORDER BY c.id LIMIT 20001",parameters.toArray());
        if(result.size()>20000)throw MesAssistantErrors.invalid("检索范围超过2万段，请选择更小的知识库范围");return result;
    }
    public boolean canReadHistorical(Map<String,Object> citation){
        try{var a=actor();Object id=citation.get("knowledgeBaseId");if(!(id instanceof Number))return false;
            var found=rows("SELECT id,library_type,owner_id,deleted FROM mes_assistant_knowledge_base WHERE tenant_id=? AND id=?",a.tenant(),id);if(found.isEmpty())return false;
            var base=found.get(0);if(base.get("libraryType").equals("PERSONAL"))return ((Number)base.get("ownerId")).longValue()==a.user();
            requireBase(((Number)id).longValue(),false);return true;
        }catch(cn.iocoder.yudao.framework.common.exception.ServiceException e){return false;}
    }
    public boolean currentCitation(Map<String,Object> citation){
        if(!canReadHistorical(citation))return false;
        try{var policy=requireDocument(((Number)citation.get("documentId")).longValue(),false);if(!"PUBLISHED".equals(policy.get("documentStatus"))||!Objects.equals(((Number)policy.get("documentVersion")).intValue(),((Number)citation.get("version")).intValue()))return false;
            var a=actor();return Objects.equals(1,jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_chunk WHERE tenant_id=? AND document_id=? AND id=? AND content_sha256=? AND deleted=0",Integer.class,a.tenant(),citation.get("documentId"),citation.get("chunkId"),citation.get("contentHash")));
        }catch(RuntimeException e){return false;}
    }
    public List<Map<String,Object>> enabledRoles(){
        var a=actor();if(!rulesAdmin())throw MesAssistantErrors.missing();return rows("SELECT id,name,code FROM system_role WHERE tenant_id=? AND deleted=0 AND status=0 ORDER BY id",a.tenant());
    }
    public List<Long> validateRoles(List<Long> roles){
        var a=actor();var ids=roles==null?List.<Long>of():roles.stream().distinct().toList();if(ids.size()>50||ids.stream().anyMatch(v->v==null||v<=0))throw MesAssistantErrors.invalid("授权角色无效");
        for(long id:ids)if(!Objects.equals(1,jdbc.queryForObject("SELECT COUNT(*) FROM system_role WHERE tenant_id=? AND id=? AND deleted=0 AND status=0",Integer.class,a.tenant(),id)))throw MesAssistantErrors.invalid("授权角色不存在或已停用");return ids;
    }
    public List<Map<String,Object>> rows(String sql,Object... args){return jdbc.query(sql,(rs,i)->{
        Map<String,Object> row=new LinkedHashMap<>();var meta=rs.getMetaData();for(int c=1;c<=meta.getColumnCount();c++){
            String[] parts=meta.getColumnLabel(c).toLowerCase(Locale.ROOT).split("_");StringBuilder key=new StringBuilder(parts[0]);for(int j=1;j<parts.length;j++)key.append(Character.toUpperCase(parts[j].charAt(0))).append(parts[j].substring(1));
            Object value=rs.getObject(c);if(value instanceof java.sql.Clob)value=rs.getString(c);if(value instanceof java.sql.Blob)value=rs.getBytes(c);if(value instanceof java.sql.Timestamp t)value=t.toLocalDateTime().toString();row.put(key.toString(),value);
        }return row;},args);}
}
