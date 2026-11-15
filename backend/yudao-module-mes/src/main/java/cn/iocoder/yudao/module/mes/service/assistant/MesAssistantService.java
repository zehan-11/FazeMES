package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.*;

/** Native document RAG and user-owned conversation persistence. Every table access is explicitly scoped. */
@Service
public class MesAssistantService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final MesAssistantDocumentParser parser;
    private final MesAssistantRetriever retriever;
    private final MesAssistantModelGateway models;
    private final MesAssistantMessageStore messages;
    private final MesKnowledgeAccess access;
    @Autowired(required=false) private MesGraphEvidenceRetriever graphEvidence;
    @Autowired(required=false) private MesDocumentVectorService documentVectors;
    @Autowired(required=false) private cn.iocoder.yudao.module.mes.service.graph.MesDocumentGraphService documentGraph;
    public MesAssistantService(JdbcTemplate jdbc, ObjectMapper json, MesAssistantDocumentParser parser,
                               MesAssistantRetriever retriever, MesAssistantModelGateway models) {
        this(jdbc,json,parser,retriever,models,new MesAssistantMessageStore(jdbc,json,new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource()))));
    }
    public MesAssistantService(JdbcTemplate jdbc,ObjectMapper json,MesAssistantDocumentParser parser,MesAssistantRetriever retriever,MesAssistantModelGateway models,MesAssistantMessageStore messages){this(jdbc,json,parser,retriever,models,messages,new MesKnowledgeAccess(jdbc,null));}
    @Autowired
    public MesAssistantService(JdbcTemplate jdbc,ObjectMapper json,MesAssistantDocumentParser parser,
                               MesAssistantRetriever retriever,MesAssistantModelGateway models,MesAssistantMessageStore messages,MesKnowledgeAccess access){
        this.access=access;this.jdbc = jdbc; this.json = json; this.parser = parser; this.retriever = retriever; this.models = models;this.messages=messages;
    }

    public List<Map<String,Object>> bases(boolean manage){
        var actor=MesKnowledgeAccess.actor();var visible=access.readableBases();
        for(var base:visible){boolean drafts=manage&&Boolean.TRUE.equals(base.get("canManage"));base.put("documentCount",count("SELECT COUNT(*) FROM mes_assistant_document WHERE tenant_id=? AND knowledge_base_id=? AND deleted=0"+(drafts?"":" AND status='PUBLISHED'"),actor.tenant(),base.get("id")));}
        return visible;
    }
    public List<Map<String,Object>> baseRoles(){return access.enabledRoles();}
    @Transactional
    public long saveBase(Long id,String name,String description,long userId){return saveBase(id,name,description,userId,null,null);}
    @Transactional
    public long saveBase(Long id,String name,String description,long userId,String libraryType,List<Long> readerRoleIds){
        var actor=MesKnowledgeAccess.actor();if(actor.user()!=userId)throw MesAssistantErrors.missing();
        name=text(name,100,"知识库名称");description=optionalText(description,1000,"知识库描述");
        String type=libraryType==null?(id==null?"PERSONAL":access.requireBase(id,true).get("libraryType").toString()):libraryType;
        if(!Set.of("PERSONAL","RULES").contains(type))throw MesAssistantErrors.invalid("知识库类型无效");
        if(type.equals("RULES")&&!access.rulesAdmin())throw MesAssistantErrors.missing();
        if(type.equals("PERSONAL")&&readerRoleIds!=null&&!readerRoleIds.isEmpty())throw MesAssistantErrors.invalid("个人知识库不允许角色共享");
        var roles=type.equals("RULES")?access.validateRoles(readerRoleIds):List.<Long>of();
        if(id==null){
            if(count("SELECT COUNT(*) FROM mes_assistant_knowledge_base WHERE tenant_id=? AND deleted=0",actor.tenant())>=50)throw MesAssistantErrors.invalid("每个租户最多50个知识库");
            id=insert("INSERT INTO mes_assistant_knowledge_base(name,description,tenant_id,creator,owner_id,library_type) VALUES(?,?,?,?,?,?)",name,description,actor.tenant(),actor.user(),actor.user(),type);
        }else{
            var existing=access.requireBase(id,true);if(!type.equals(existing.get("libraryType")))throw MesAssistantErrors.invalid("知识库类型创建后不能变更，请新建目标类型的知识库");
            jdbc.update("UPDATE mes_assistant_knowledge_base SET name=?,description=?,update_time=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND deleted=0",name,description,id,actor.tenant());
        }
        if(type.equals("RULES")&&readerRoleIds!=null){jdbc.update("DELETE FROM mes_assistant_base_role WHERE tenant_id=? AND knowledge_base_id=?",actor.tenant(),id);for(long role:roles)jdbc.update("INSERT INTO mes_assistant_base_role(tenant_id,knowledge_base_id,role_id) VALUES(?,?,?)",actor.tenant(),id,role);}
        return id;
    }
    @Transactional
    public void deleteBase(long id){
        var actor=MesKnowledgeAccess.actor();access.requireBase(id,true);
        if(count("SELECT COUNT(*) FROM mes_assistant_document WHERE knowledge_base_id=? AND tenant_id=? AND deleted=0",id,actor.tenant())!=0)throw MesAssistantErrors.invalid("请先删除知识库中的文档");
        jdbc.update("UPDATE mes_assistant_knowledge_base SET deleted=1 WHERE id=? AND tenant_id=?",id,actor.tenant());
    }

    public List<Map<String, Object>> documents(long baseId, boolean manage) {
        long tenant = tenant(); var policy=access.requireBase(baseId,false); manage=manage&&access.canWrite(policy);
        return rows("SELECT d.id,d.knowledge_base_id,d.title,d.file_name,d.file_type,d.file_size,d.file_sha256,d.chunk_count,d.version,d.status,d.create_time,d.update_time,"
                + " COALESCE(g.status,'NOT_INDEXED') AS graph_status,COALESCE(g.entity_count,0) AS graph_entity_count,COALESCE(g.relation_count,0) AS graph_relation_count,g.error_message AS graph_error,COALESCE(g.attempts,0) AS graph_attempts,"
                + " COALESCE(v.status,'NOT_INDEXED') AS vector_status,COALESCE(v.chunk_count,0) AS vector_chunk_count,COALESCE(v.completed_chunks,0) AS vector_completed_chunks,"
                + " COALESCE(v.attempts,0) AS vector_attempts,v.error_message AS vector_error,v.model_name AS vector_model,v.dimensions AS vector_dimensions,v.space_id AS vector_space_id,v.index_name AS vector_index_name"
                + " FROM mes_assistant_document d LEFT JOIN mes_assistant_graph_state g ON g.tenant_id=d.tenant_id AND g.document_id=d.id LEFT JOIN mes_assistant_vector_state v ON v.tenant_id=d.tenant_id AND v.document_id=d.id WHERE d.knowledge_base_id=? AND d.tenant_id=? AND d.deleted=0"
                + (manage ? "" : " AND d.status='PUBLISHED'") + " ORDER BY d.id DESC", baseId, tenant);
    }

    @Transactional
    public Map<String, Object> upload(long baseId, String title, String fileName, byte[] bytes, long userId) {
        long tenant = tenant(); requireUser(userId); if(MesKnowledgeAccess.actor().user()!=userId)throw MesAssistantErrors.missing();access.requireBase(baseId,true);
        if (count("SELECT COUNT(*) FROM mes_assistant_document WHERE tenant_id=? AND deleted=0", tenant) >= 500)
            throw MesAssistantErrors.invalid("每个租户最多500份文档");
        var parsed = parser.parse(fileName, bytes);
        title = title == null || title.isBlank() ? parsed.fileName() : text(title, 200, "文档标题");
        long id = insert("""
                INSERT INTO mes_assistant_document(knowledge_base_id,title,file_name,file_type,file_size,file_sha256,
                original_bytes,content_text,chunk_count,version,status,tenant_id,creator) VALUES(?,?,?,?,?,?,?,?,?,1,'DRAFT',?,?)
                """, baseId, title, parsed.fileName(), parsed.type(), bytes.length, parsed.hash(), bytes, parsed.text(), parsed.chunks().size(), tenant, userId);
        for (var chunk : parsed.chunks()) {
            jdbc.update("""
                    INSERT INTO mes_assistant_chunk(document_id,chunk_index,heading,page_number,start_offset,end_offset,content_text,content_sha256,tenant_id)
                    VALUES(?,?,?,?,?,?,?,?,?)
                    """, id, chunk.index(), chunk.heading(), chunk.pageNumber(), chunk.startOffset(), chunk.endOffset(), chunk.text(), chunk.hash(), tenant);
        }
        if(documentGraph!=null)documentGraph.stage(id,false);
        if(documentVectors!=null)documentVectors.stage(id,false);
        return Map.of("id", id, "title", title, "chunkCount", parsed.chunks().size(), "status", "DRAFT", "version", 1);
    }

    /** Replaces the current file atomically, retaining an immutable old file/chunk snapshot. */
    @Transactional
    public Map<String,Object> updateDocument(long id,int expectedVersion,String title,String fileName,byte[] bytes,long userId){
        long tenant=tenant();requireUser(userId);if(MesKnowledgeAccess.actor().user()!=userId)throw MesAssistantErrors.missing();access.requireDocument(id,true);
        if(expectedVersion<1)throw MesAssistantErrors.invalid("文档版本无效");
        var parsed=parser.parse(fileName,bytes);
        var locked=access.rows("SELECT d.* FROM mes_assistant_document d JOIN mes_assistant_knowledge_base b ON b.id=d.knowledge_base_id AND b.tenant_id=d.tenant_id AND b.deleted=0 WHERE d.tenant_id=? AND d.id=? AND d.deleted=0 FOR UPDATE",tenant,id);
        if(locked.isEmpty())throw MesAssistantErrors.missing();
        int previous=((Number)locked.get(0).get("version")).intValue();
        if(previous!=expectedVersion)throw MesAssistantErrors.invalid("文档版本已变更，请刷新列表后重试");
        if(previous==Integer.MAX_VALUE)throw MesAssistantErrors.invalid("文档版本超出范围");
        var old=locked.get(0);
        var oldChunks=rows("SELECT id AS chunk_id,chunk_index,heading,page_number,start_offset,end_offset,content_text AS content,content_sha256 AS content_hash FROM mes_assistant_chunk WHERE document_id=? AND tenant_id=? AND deleted=0 ORDER BY chunk_index FOR UPDATE",id,tenant);
        String chunkSnapshot=encode(oldChunks);
        jdbc.update("INSERT INTO mes_assistant_document_revision(tenant_id,document_id,version,knowledge_base_id,title,file_name,file_type,file_size,file_sha256,original_bytes,content_text,chunk_count,chunks_json,status,creator,changed_by,create_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",tenant,id,previous,old.get("knowledgeBaseId"),old.get("title"),old.get("fileName"),old.get("fileType"),old.get("fileSize"),old.get("fileSha256"),old.get("originalBytes"),old.get("contentText"),old.get("chunkCount"),chunkSnapshot,old.get("status"),old.get("creator"),userId,java.sql.Timestamp.valueOf(java.time.LocalDateTime.parse(old.get("createTime").toString())));
        String nextTitle=title==null||title.isBlank()?locked.get(0).get("title").toString():text(title,200,"文档标题");
        int version=previous+1;
        jdbc.update("UPDATE mes_assistant_document SET title=?,file_name=?,file_type=?,file_size=?,file_sha256=?,original_bytes=?,content_text=?,chunk_count=?,version=?,status='DRAFT',update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=? AND deleted=0",nextTitle,parsed.fileName(),parsed.type(),bytes.length,parsed.hash(),bytes,parsed.text(),parsed.chunks().size(),version,tenant,id);
        // IDs and complete metadata of the removed chunks are retained in the archived version.
        jdbc.update("DELETE FROM mes_assistant_chunk WHERE tenant_id=? AND document_id=?",tenant,id);
        for(var chunk:parsed.chunks())jdbc.update("INSERT INTO mes_assistant_chunk(document_id,chunk_index,heading,page_number,start_offset,end_offset,content_text,content_sha256,tenant_id) VALUES(?,?,?,?,?,?,?,?,?)",id,chunk.index(),chunk.heading(),chunk.pageNumber(),chunk.startOffset(),chunk.endOffset(),chunk.text(),chunk.hash(),tenant);
        if(documentGraph!=null)documentGraph.stage(id,false);
        if(documentVectors!=null)documentVectors.stage(id,false);
        return Map.of("id",id,"version",version,"status","DRAFT","chunkCount",parsed.chunks().size());
    }
    @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public List<Map<String,Object>> documentVersions(long id){
        access.requireDocument(id,true);var current=document(id,true);List<Map<String,Object>> versions=new ArrayList<>();
        var latest=new LinkedHashMap<>(current);latest.remove("contentText");latest.remove("chunks");latest.put("isCurrent",true);versions.add(latest);
        var history=rows("SELECT document_id AS id,title,file_name,file_type,file_size,file_sha256,chunk_count,version,status,archived_at FROM mes_assistant_document_revision WHERE tenant_id=? AND document_id=? ORDER BY version DESC",tenant(),id);
        for(var revision:history){revision.put("isCurrent",false);versions.add(revision);}return versions;
    }
    @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Map<String,Object> document(long id,boolean manage,Integer version){
        var current=document(id,manage);
        if(version==null||version.equals(((Number)current.get("version")).intValue()))return current;
        if(!manage||!access.canWrite(access.requireDocument(id,false))||version<1)throw MesAssistantErrors.missing();
        var history=rows("SELECT document_id AS id,knowledge_base_id,title,file_name,file_type,file_size,file_sha256,content_text,chunk_count,version,status,chunks_json FROM mes_assistant_document_revision WHERE tenant_id=? AND document_id=? AND version=?",tenant(),id,version);
        if(history.isEmpty())throw MesAssistantErrors.missing();var revision=history.get(0);revision.put("chunks",decode(revision.remove("chunksJson")));return revision;
    }
    @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Map<String, Object> document(long id, boolean manage) {
        long tenant = tenant();var policy=access.requireDocument(id,false);manage=manage&&access.canWrite(policy);
        var documents = rows("SELECT d.id,d.knowledge_base_id,d.title,d.file_name,d.file_type,d.file_size,d.file_sha256,d.content_text,d.chunk_count,d.version,d.status,d.create_time"
                + " FROM mes_assistant_document d JOIN mes_assistant_knowledge_base b ON b.id=d.knowledge_base_id AND b.tenant_id=? AND b.deleted=0"
                + " WHERE d.id=? AND d.tenant_id=? AND d.deleted=0" + (manage ? "" : " AND d.status='PUBLISHED'"), tenant, id, tenant);
        if (documents.isEmpty()) throw MesAssistantErrors.missing();
        Map<String, Object> result = documents.get(0);
        result.put("chunks", rows("SELECT id AS chunk_id,chunk_index,heading,page_number,start_offset,end_offset,content_text AS content,content_sha256 AS content_hash"
                + " FROM mes_assistant_chunk WHERE document_id=? AND tenant_id=? AND deleted=0 ORDER BY chunk_index", id, tenant));
        return result;
    }

    public record Download(String name, byte[] bytes) {}
    @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Download download(long id, boolean manage) {
        document(id, manage); // verifies document and knowledge-base visibility without trusting the caller's base ID
        long tenant = tenant();
        return jdbc.query("SELECT file_name,original_bytes FROM mes_assistant_document WHERE id=? AND tenant_id=? AND deleted=0",
                (rs, index) -> new Download(rs.getString(1), rs.getBytes(2)), id, tenant).stream().findFirst().orElseThrow(MesAssistantErrors::missing);
    }

    @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Download download(long id,boolean manage,Integer version){
        var current=document(id,manage);
        if(version==null||version.equals(((Number)current.get("version")).intValue()))return download(id,manage);
        if(!manage||!access.canWrite(access.requireDocument(id,false))||version<1)throw MesAssistantErrors.missing();
        return jdbc.query("SELECT file_name,original_bytes FROM mes_assistant_document_revision WHERE tenant_id=? AND document_id=? AND version=?",(rs,index)->new Download(rs.getString(1),rs.getBytes(2)),tenant(),id,version).stream().findFirst().orElseThrow(MesAssistantErrors::missing);
    }

    @Transactional
    public void publish(long id,boolean published){publish(id,published,null);}
    @Transactional
    public void publish(long id, boolean published,Integer expectedVersion) {
        long tenant = tenant();access.requireDocument(id,true);
        var locked=jdbc.queryForList("SELECT d.version FROM mes_assistant_document d JOIN mes_assistant_knowledge_base b ON b.id=d.knowledge_base_id AND b.tenant_id=d.tenant_id AND b.deleted=0 WHERE d.tenant_id=? AND d.id=? AND d.deleted=0 FOR UPDATE",tenant,id);
        if(locked.isEmpty())throw MesAssistantErrors.missing();
        if(expectedVersion!=null&&expectedVersion.intValue()!=((Number)locked.get(0).get("version")).intValue())throw MesAssistantErrors.invalid("文档版本已变更，请重新审核后再发布或撤回");
        jdbc.update("UPDATE mes_assistant_document SET status=?,update_time=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND deleted=0",
                published ? "PUBLISHED" : "DRAFT", id, tenant);
        if(documentGraph!=null)documentGraph.stage(id,false);
        if(documentVectors!=null)documentVectors.stage(id,false);
    }

    @Transactional
    public void deleteDocument(long id) {
        long tenant = tenant();access.requireDocument(id,true);document(id,true);
        jdbc.update("UPDATE mes_assistant_chunk SET deleted=1 WHERE document_id=? AND tenant_id=? AND deleted=0", id, tenant);
        jdbc.update("UPDATE mes_assistant_document SET deleted=1 WHERE id=? AND tenant_id=? AND deleted=0", id, tenant);
        if(documentGraph!=null)documentGraph.stage(id,true);
        if(documentVectors!=null)documentVectors.stage(id,true);
    }

    @Transactional
    public void rebuildGraph(long id){
        access.requireDocument(id,true);document(id,true);
        if(documentGraph==null)throw MesAssistantErrors.invalid("文档建图服务未启用");
        documentGraph.stage(id,false);
    }
    @Transactional
    public void rebuildVectors(long id,int expectedVersion) {
        if(documentVectors==null)throw MesAssistantErrors.invalid("文档向量服务未启用");
        documentVectors.rebuild(id,expectedVersion);
    }

    public Map<String, Object> search(String query, List<Long> baseIds, int limit) {
        long tenant = tenant(); query = text(query, 1000, "检索问题");
        if (limit < 1 || limit > 10) throw MesAssistantErrors.invalid("检索条数需在1至10");
        var chunks=access.searchableChunks(baseIds);var items=retriever.rank(query,chunks,limit);
        for(var citation:items){citation.put("evidence",MesRetrievalEvidence.document(citation));citation.remove("documentOwner");}
        return Map.of("mode","lexical_bm25","query",query,"eligibleChunkCount",chunks.size(),"items",items);
    }

    public List<Map<String, Object>> sessions(long userId) {
        long tenant = tenant(); requireUser(userId);
        return rows("SELECT id,title,create_time,update_time FROM mes_assistant_session WHERE tenant_id=? AND user_id=? AND deleted=0 ORDER BY update_time DESC,id DESC LIMIT 200", tenant, userId);
    }

    public long createSession(String title, long userId) {
        long tenant = tenant(); requireUser(userId);
        if (count("SELECT COUNT(*) FROM mes_assistant_session WHERE tenant_id=? AND user_id=? AND deleted=0", tenant, userId) >= 200)
            throw MesAssistantErrors.invalid("会话达到200个，请先删除旧会话");
        return insert("INSERT INTO mes_assistant_session(title,user_id,tenant_id) VALUES(?,?,?)", title == null || title.isBlank() ? "新会话" : text(title, 100, "会话标题"), userId, tenant);
    }

    public Map<String, Object> session(long id, long userId) {
        long tenant = tenant(); Map<String, Object> session = requireSession(id, userId, false);
        var messages = rows("SELECT id,role,content_text AS content,status,citations_json,model_name,retrieval_mode,retrieval_hops,create_time FROM mes_assistant_message"
                + " WHERE session_id=? AND tenant_id=? AND user_id=? AND deleted=0 ORDER BY id LIMIT 201", id, tenant, userId);
        for(var message:messages){
            @SuppressWarnings("unchecked") var citations=(List<Map<String,Object>>)decode(message.remove("citationsJson"));
            boolean allowed=citations.stream().allMatch(access::canReadHistorical);message.put("citations",allowed?citations:List.of());
            if(!allowed&&"assistant".equals(message.get("role"))){message.put("content","该历史答复引用的知识库当前无权访问。");message.put("status","EVIDENCE_RESTRICTED");}
        }
        session.put("messages", messages); return session;
    }

    public void renameSession(long id, String title, long userId) {
        long tenant = tenant(); requireSession(id, userId, false); title = text(title, 100, "会话标题");
        jdbc.update("UPDATE mes_assistant_session SET title=?,update_time=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND user_id=? AND deleted=0", title, id, tenant, userId);
    }

    @Transactional
    public void deleteSession(long id, long userId) {
        long tenant = tenant(); requireSession(id, userId, true);
        jdbc.update("UPDATE mes_assistant_message SET deleted=1 WHERE session_id=? AND tenant_id=? AND user_id=? AND deleted=0", id, tenant, userId);
        jdbc.update("UPDATE mes_assistant_session SET deleted=1,version=version+1,pending_request_id=NULL,pending_started_at=NULL WHERE id=? AND tenant_id=? AND user_id=? AND deleted=0", id, tenant, userId);
    }

    public Map<String,Object> send(long sessionId,String question,List<Long> baseIds,long userId){return send(sessionId,question,baseIds,userId,"DOCUMENT",2);}
    @SuppressWarnings("unchecked")
    public Map<String,Object> send(long sessionId,String question,List<Long> baseIds,long userId,String mode,int hops){
        if(TransactionSynchronizationManager.isActualTransactionActive())throw MesAssistantErrors.invalid("模型问答不能在活动业务事务中执行，请在事务完成后重试");
        var actor=MesKnowledgeAccess.actor();if(actor.user()!=userId)throw MesAssistantErrors.missing();
        mode=mode==null?"DOCUMENT":mode;if(!Set.of("DOCUMENT","GRAPH","HYBRID").contains(mode)||hops<1||hops>2)throw MesAssistantErrors.invalid("问答检索模式或跳数无效");
        if(!mode.equals("DOCUMENT")&&graphEvidence==null)throw MesAssistantErrors.invalid("图谱问答服务未启用");
        question=text(question,4000,"提问");String query=question.length()>1000?question.substring(0,1000):question;
        var claim=messages.claim(sessionId,userId,question,mode,hops);List<Map<String,Object>> citations=List.of();Map<String,Object> modelStatus=Map.of();
        try{
            Map<String,Object> retrieval=mode.equals("DOCUMENT")?search(query,baseIds,5):new MesEvidenceService(this,graphEvidence).search(query,baseIds,null,10,mode,hops);
            // Preserve useful evidence even if a model quota or context budget rejects generation.
            if(mode.equals("DOCUMENT"))citations=(List<Map<String,Object>>)retrieval.get("items");
            else {var preview=MesAnswerContext.prepare(retrieval,mode,question,Integer.MAX_VALUE,json);citations=preview.citations();}
            modelStatus=models.status();String status="MODEL_NOT_CONFIGURED",answer=null,message="模型尚未配置或启用，本次仅展示知识检索结果。";boolean limited=false;
            if(!mode.equals("DOCUMENT")&&citations.isEmpty()){status="NO_EVIDENCE";message="当前可访问的知识库没有足够证据，请补充具体实体名、调整范围或发布相关资料；本次未调用模型。";}
            else if(Boolean.TRUE.equals(modelStatus.get("configured"))){
                try{
                    var context=MesAnswerContext.prepare(retrieval,mode,question,models.inputBudget(),json);citations=context.citations();limited=context.limited();
                    if(!currentAnswerEvidence(citations,query,baseIds,hops))throw MesAssistantErrors.invalid("来源权限、文件版本或图谱关系已变更，请重新提问");
                    List<Map<String,String>> prompt=new ArrayList<>();prompt.add(Map.of("role","system","content",context.text()));
                    for(var item:claim.history()){
                        if(!mode.equals(item.getOrDefault("retrievalMode","DOCUMENT")))continue;
                        boolean allowed=true;
                        if(item.get("evidenceCitations") instanceof List<?> prior)for(var value:prior){
                            if(!(value instanceof Map<?,?> raw)){allowed=false;break;}
                            var citation=(Map<String,Object>)raw;
                            if(!access.currentCitation(citation)||baseIds!=null&&!baseIds.isEmpty()&&!baseIds.contains(((Number)citation.get("knowledgeBaseId")).longValue())){allowed=false;break;}
                        }
                        if(allowed)prompt.add(Map.of("role",item.get("role").toString(),"content",item.get("content").toString()));
                    }
                    prompt.add(Map.of("role","user","content",question));
                    answer=models.complete(MesAssistantModelGateway.Purpose.KNOWLEDGE_CHAT,prompt);
                    if(!currentAnswerEvidence(citations,query,baseIds,hops)){answer=null;throw MesAssistantErrors.invalid("答复生成期间来源已撤回、更新或取消授权，请重新检索后提问");}
                    if(!mode.equals("DOCUMENT")&&!validReferences(answer,citations.size())){answer=null;throw MesAssistantErrors.invalid("模型答复未提供有效来源编号，请重试；检索证据仍可核对");}
                    status="ANSWERED";message=limited?"已依据部分证据生成答复；上下文容量有限，请核对引用或缩小范围。":"已根据本次检索证据生成答复，请核对来源。";
                }catch(cn.iocoder.yudao.framework.common.exception.ServiceException exception){answer=null;status="MODEL_ERROR";message=exception.getMessage();}
            }
            var saved=messages.finish(claim,question,status,answer,citations,modelStatus.get("model"));
            // Keep archived snapshots for audit, but return only currently usable document evidence.
            var visible=citations.stream().filter(c->access.canReadHistorical(c)&&(c.get("documentId")==null||access.currentCitation(c))).toList();
            Map<String,Object> result=new LinkedHashMap<>();result.put("sessionId",sessionId);result.put("userMessageId",saved.get("userMessageId"));result.put("assistantMessageId",saved.get("assistantMessageId"));result.put("status",status);result.put("message",message);result.put("answer",answer);result.put("citations",visible);result.put("model",modelStatus.get("model"));result.put("retrievalMode",mode.equals("DOCUMENT")?"lexical_bm25":mode.equals("GRAPH")?"graph_query":"hybrid");result.put("mode",mode);result.put("hops",hops);return result;
        }catch(RuntimeException|Error failure){try{messages.release(claim,citations,modelStatus.get("model"));}catch(RuntimeException releaseFailure){failure.addSuppressed(releaseFailure);}throw failure;}
    }
    private boolean currentAnswerEvidence(List<Map<String,Object>> citations,String query,List<Long> baseIds,int hops){
        Map<String,MesRetrievalEvidence> edges=null;
        for(var citation:citations){
            if(!access.canReadHistorical(citation))return false;
            if(citation.get("documentId")!=null&&!access.currentCitation(citation))return false;
            if(citation.get("evidence") instanceof MesRetrievalEvidence e&&e.sourceType().equals("GRAPH")){
                if(edges==null){edges=new HashMap<>();for(var edge:graphEvidence.retrieve(query,baseIds,hops).relations())edges.put(edge.evidence().evidenceId(),edge.evidence());}
                if(!e.equals(edges.get(e.evidenceId())))return false;
            }
        }
        return true;
    }
    static boolean validReferences(String answer,int count){
        if(answer==null)return false;var matcher=java.util.regex.Pattern.compile("\\[(\\d+)\\]").matcher(answer);boolean found=false;
        while(matcher.find()){try{int n=Integer.parseInt(matcher.group(1));if(n<1||n>count)return false;found=true;}catch(NumberFormatException e){return false;}}return found;
    }

    private Map<String, Object> requireSession(long id, long userId, boolean lock) {
        long tenant = tenant(); requireUser(userId);
        var records = rows("SELECT id,title,create_time,update_time FROM mes_assistant_session WHERE id=? AND tenant_id=? AND user_id=? AND deleted=0" + (lock ? " FOR UPDATE" : ""), id, tenant, userId);
        if (records.isEmpty()) throw MesAssistantErrors.missing(); return records.get(0);
    }
    private long count(String sql, Object... arguments) { Long result = jdbc.queryForObject(sql, Long.class, arguments); return result == null ? 0 : result; }
    private long insert(String sql, Object... arguments) {
        var key = new GeneratedKeyHolder();
        jdbc.update(connection -> { var statement = connection.prepareStatement(sql, new String[]{"id"});
            for (int index = 0; index < arguments.length; index++) statement.setObject(index + 1, arguments[index]); return statement; }, key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }
    private List<Map<String, Object>> rows(String sql, Object... arguments) {
        return jdbc.query(sql, (rs, index) -> { Map<String, Object> row = new LinkedHashMap<>(); var metadata = rs.getMetaData();
            for (int column = 1; column <= metadata.getColumnCount(); column++) {
                String[] parts = metadata.getColumnLabel(column).toLowerCase(Locale.ROOT).split("_");
                StringBuilder name = new StringBuilder(parts[0]); for (int part = 1; part < parts.length; part++) name.append(Character.toUpperCase(parts[part].charAt(0))).append(parts[part].substring(1));
                Object value = rs.getObject(column);
                if (value instanceof java.sql.Clob) value = rs.getString(column);
                row.put(name.toString(), value instanceof java.sql.Timestamp time ? time.toLocalDateTime().toString() : value);
            } return row; }, arguments);
    }
    private String encode(Object value) { try { return json.writeValueAsString(value); } catch (Exception exception) { throw new IllegalStateException("Knowledge citation serialization failed"); } }
    private Object decode(Object value) { try { return json.readValue(value.toString(), new TypeReference<List<Map<String, Object>>>() {}); } catch (Exception exception) { throw new IllegalStateException("Knowledge citation history is invalid"); } }
    private static long tenant() { return TenantContextHolder.getRequiredTenantId(); }
    private static void requireUser(long userId) { if (userId <= 0) throw MesAssistantErrors.missing(); }
    private static String text(String value, int maximum, String label) { if (value == null || value.isBlank() || value.strip().length() > maximum) throw MesAssistantErrors.invalid(label + "不能为空且最多" + maximum + "字"); return value.strip(); }
    private static String optionalText(String value, int maximum, String label) { if (value == null || value.isBlank()) return ""; return text(value, maximum, label); }
}
