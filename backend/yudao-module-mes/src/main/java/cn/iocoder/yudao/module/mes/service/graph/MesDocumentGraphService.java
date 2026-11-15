package cn.iocoder.yudao.module.mes.service.graph;

import cn.iocoder.yudao.module.mes.service.assistant.MesAssistantErrors;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import java.time.LocalDateTime;
import java.sql.Timestamp;
import java.util.*;

/** MySQL durable delivery state; workers replace one document atomically in Neo4j. */
@Service
public class MesDocumentGraphService {
    private final JdbcTemplate jdbc; private final ObjectMapper json;
    private final MesDocumentRelationExtractor extractor; private final MesGraphStore graph;
    private final TransactionTemplate transactions;
    public MesDocumentGraphService(JdbcTemplate jdbc,ObjectMapper json,MesDocumentRelationExtractor extractor,MesGraphStore graph,PlatformTransactionManager manager){
        this.jdbc=jdbc;this.json=json;this.extractor=extractor;this.graph=graph;
        transactions=new TransactionTemplate(manager);transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    @Transactional public void stage(long documentId,boolean deleted){
        var actor=MesKnowledgeGraphService.currentScope();long tenant=actor.tenant();
        var docs=jdbc.queryForList("SELECT id,knowledge_base_id,title,content_text,version,status,creator,deleted FROM mes_assistant_document WHERE tenant_id=? AND id=? FOR UPDATE",tenant,documentId);
        if(docs.isEmpty())throw MesAssistantErrors.missing();var doc=docs.get(0);
        long owner=number(doc,"creator");if(owner<=0)throw MesAssistantErrors.invalid("文档缺少上传者，无法建立私有图谱");
        // Public hooks cannot use a caller-provided owner or tenant.
        String desired=deleted?"DELETED":doc.get("status").toString();
        if(!deleted && (Boolean.TRUE.equals(doc.get("deleted")) || "1".equals(doc.get("deleted").toString())))throw MesAssistantErrors.missing();
        int version=(int)number(doc,"version");List<MesDocumentRelationExtractor.Fact> facts=List.of();String failure="";
        if(!deleted){
            var chunks=jdbc.query("SELECT id,heading,page_number,start_offset,end_offset,content_text,content_sha256 FROM mes_assistant_chunk WHERE tenant_id=? AND document_id=? AND deleted=0 ORDER BY chunk_index",
                (rs,i)->new MesDocumentRelationExtractor.Chunk(rs.getLong("id"),rs.getString("heading"),(Integer)rs.getObject("page_number"),rs.getInt("start_offset"),rs.getInt("end_offset"),rs.getString("content_text"),rs.getString("content_sha256")),tenant,documentId);
            try{facts=extractor.extract(number(doc,"knowledge_base_id"),documentId,version,doc.get("title").toString(),jdbc.queryForObject("SELECT content_text FROM mes_assistant_document WHERE tenant_id=? AND id=?",String.class,tenant,documentId),chunks);}
            catch(IllegalArgumentException e){failure=e.getMessage();}
        }
        int entityCount=(int)facts.stream().flatMap(f->java.util.stream.Stream.of(f.sourceId(),f.targetId())).distinct().count();
        String payload;try{payload=json.writeValueAsString(facts);}catch(Exception e){throw new IllegalStateException("Graph payload serialization failed");}
        var previous=jdbc.queryForList("SELECT generation FROM mes_assistant_graph_state WHERE tenant_id=? AND document_id=? FOR UPDATE",tenant,documentId);
        if(!failure.isBlank()&&desired.equals("PUBLISHED"))throw MesAssistantErrors.invalid("文档关系格式不正确，请更新文件后再发布："+failure);
        String status=desired.equals("DRAFT")&&previous.isEmpty()?(!failure.isBlank()?"INVALID":facts.isEmpty()?"EMPTY":"READY"):"PENDING";
        if(previous.isEmpty()){
            jdbc.update("INSERT INTO mes_assistant_graph_state(tenant_id,document_id,owner_id,document_version,generation,desired_state,status,extraction_method,entity_count,relation_count,payload_json,error_message,validation_error,next_attempt_at) VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",tenant,documentId,owner,version,desired,status,MesDocumentRelationExtractor.METHOD,entityCount,facts.size(),payload,failure,failure);
        }else{
            jdbc.update("UPDATE mes_assistant_graph_state SET owner_id=?,document_version=?,generation=generation+1,desired_state=?,status=?,extraction_method=?,entity_count=?,relation_count=?,payload_json=?,attempts=0,error_message=?,validation_error=?,next_attempt_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP,synced_at=NULL WHERE tenant_id=? AND document_id=?",owner,version,desired,status,MesDocumentRelationExtractor.METHOD,entityCount,facts.size(),payload,failure,failure,tenant,documentId);
        }
    }
    /** Only durable committed rows are visible to the scheduler; upload rollback cannot leak a graph. */
    @Scheduled(initialDelayString="${fazemes.graph.ingest-delay-ms:10000}",fixedDelayString="${fazemes.graph.ingest-interval-ms:5000}")
    public void deliver(){
        var jobs=jdbc.queryForList("SELECT tenant_id,document_id FROM mes_assistant_graph_state WHERE status IN ('PENDING','ERROR') AND (attempts<10 OR desired_state IN ('DRAFT','DELETED')) AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ORDER BY update_time LIMIT 5");
        for(var job:jobs){try{process(number(job,"tenant_id"),number(job,"document_id"));}catch(RuntimeException ignored){/* durable pending row remains for retry; never log document bodies or credentials */}}
    }
    public void process(long tenant,long documentId){
        transactions.executeWithoutResult(tx->{
            var rows=jdbc.queryForList("SELECT * FROM mes_assistant_graph_state WHERE tenant_id=? AND document_id=? AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) FOR UPDATE",tenant,documentId);
            if(rows.isEmpty())return;var state=rows.get(0);String status=state.get("status").toString();
            int attempts=(int)number(state,"attempts");
            if(!(status.equals("PENDING")||status.equals("ERROR"))||(attempts>=10&&!Set.of("DRAFT","DELETED").contains(state.get("desired_state").toString())))return;
            try{
                String desired=state.get("desired_state").toString();
                List<Map<String,Object>> facts=desired.equals("PUBLISHED")?json.readValue(jdbc.queryForObject("SELECT payload_json FROM mes_assistant_graph_state WHERE tenant_id=? AND document_id=?",String.class,tenant,documentId),new TypeReference<List<Map<String,Object>>>(){}):List.of();
                graph.replaceDocument(new MesKnowledgeGraphService.Scope(tenant,number(state,"owner_id")),documentId,(int)number(state,"document_version"),facts);
                String validation=Objects.toString(state.get("validation_error"),"");
                String done=desired.equals("DELETED")?"REMOVED":desired.equals("DRAFT")?(!validation.isBlank()?"INVALID":number(state,"relation_count")==0?"EMPTY":"READY"):(facts.isEmpty()?"EMPTY":"SYNCED");
                jdbc.update("UPDATE mes_assistant_graph_state SET status=?,attempts=0,error_message=?,next_attempt_at=NULL,synced_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=?",done,desired.equals("DRAFT")?validation:"",tenant,documentId);
            }catch(Exception e){
                jdbc.update("UPDATE mes_assistant_graph_state SET status='ERROR',attempts=?,error_message=?,next_attempt_at=?,update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=?",Math.min(10,attempts+1),"图谱同步失败，请检查 Neo4j 服务后重新建图",Timestamp.valueOf(LocalDateTime.now().plusSeconds(Math.min(60,5*(attempts+1)))),tenant,documentId);
            }
        });
    }
    static long number(Map<String,Object> row,String key){Object value=row.get(key);return value instanceof Number n?n.longValue():Long.parseLong(value.toString());}
}
