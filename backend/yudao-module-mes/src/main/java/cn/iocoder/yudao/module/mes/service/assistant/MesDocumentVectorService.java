package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.module.mes.service.graph.MesGraphStore;
import cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Committed outbox, leased batches and generation checks. Embedding calls never hold MySQL transactions. */
@Service
public class MesDocumentVectorService implements AutoCloseable {
    public record Chunk(long chunkId,int chunkIndex,String heading,Integer pageNumber,int startOffset,int endOffset,String text,String hash) {}
    public record Snapshot(long tenant,long document,long owner,long base,int version,String title,List<Chunk> chunks) {}
    private record Claim(Snapshot snapshot,long generation,String token,String desired,String space,String model,int dimensions,int attempts) {}
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final MesAssistantModelGateway models;
    private final MesGraphStore graph;
    private final MesKnowledgeAccess access;
    private final TransactionTemplate transactions;
    private final AtomicBoolean running = new AtomicBoolean();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {var t=new Thread(r,"mes-vector-ingestion");t.setDaemon(true);return t;});
    public MesDocumentVectorService(JdbcTemplate jdbc,ObjectMapper json,MesAssistantModelGateway models,MesGraphStore graph,
            MesKnowledgeAccess access,PlatformTransactionManager manager) {
        this.jdbc=jdbc;this.json=json;this.models=models;this.graph=graph;this.access=access;
        transactions=new TransactionTemplate(manager);transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    /** Joins the file transaction; neither drafts nor rolled-back publications invoke an external service. */
    @Transactional public void stage(long documentId,boolean deleted) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Vector stage requires file transaction");
        var actor=MesKnowledgeAccess.actor();long tenant=actor.tenant();
        var doc=lockedDocument(tenant,documentId);
        if(doc==null || flag(doc.get("deleted"))!=deleted)throw MesAssistantErrors.missing();
        long base=n(doc,"knowledge_base_id"),owner=n(doc,"creator");access.requireBase(base,true);
        if(owner<=0)throw MesAssistantErrors.invalid("文档缺少上传者，无法建立向量索引");
        String desired=deleted?"DELETED":doc.get("status").toString();
        List<Chunk> chunks=desired.equals("PUBLISHED")?jdbc.query("SELECT id,chunk_index,heading,page_number,start_offset,end_offset,content_text,content_sha256 FROM mes_assistant_chunk WHERE tenant_id=? AND document_id=? AND deleted=0 ORDER BY chunk_index",
                (rs,i)->new Chunk(rs.getLong(1),rs.getInt(2),rs.getString(3),(Integer)rs.getObject(4),rs.getInt(5),rs.getInt(6),rs.getString(7),rs.getString(8)),tenant,documentId):List.of();
        if(desired.equals("PUBLISHED") && (chunks.isEmpty() || chunks.size()!=n(doc,"chunk_count")))throw MesAssistantErrors.invalid("文档分块不完整，请更新文件后重试");
        var snapshot=new Snapshot(tenant,documentId,owner,base,(int)n(doc,"version"),doc.get("title").toString(),chunks);
        var previous=jdbc.queryForList("SELECT generation FROM mes_assistant_vector_state WHERE tenant_id=? AND document_id=? FOR UPDATE",tenant,documentId);
        long generation=previous.isEmpty()?1:Math.addExact(n(previous.get(0),"generation"),1);
        String status=desired.equals("DRAFT")&&previous.isEmpty()?"READY":"PENDING",error="",space="",model="";int dimensions=0;
        if(desired.equals("PUBLISHED")) {
            try {var config=models.embeddingSpace();space=config.spaceId();model=config.model();dimensions=config.dimensions();}
            catch(cn.iocoder.yudao.framework.common.exception.ServiceException exception){status="WAITING_CONFIG";error="请先启用Embedding配置，再建立向量索引";}
        }
        jdbc.update("""
                INSERT INTO mes_assistant_vector_state(tenant_id,document_id,owner_id,knowledge_base_id,document_version,generation,desired_state,status,space_id,model_name,dimensions,chunk_count,payload_json,error_message,next_attempt_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE owner_id=VALUES(owner_id),knowledge_base_id=VALUES(knowledge_base_id),
                document_version=VALUES(document_version),generation=VALUES(generation),desired_state=VALUES(desired_state),status=VALUES(status),space_id=VALUES(space_id),
                model_name=VALUES(model_name),dimensions=VALUES(dimensions),chunk_count=VALUES(chunk_count),payload_json=VALUES(payload_json),error_message=VALUES(error_message),
                completed_chunks=0,claim_token=NULL,lease_until=NULL,attempts=0,next_attempt_at=CURRENT_TIMESTAMP,index_name='',synced_at=NULL,update_time=CURRENT_TIMESTAMP
                """,tenant,documentId,owner,base,snapshot.version(),generation,desired,status,space,model,dimensions,chunks.size(),encode(snapshot),error);
        jdbc.update("DELETE FROM mes_assistant_vector_chunk WHERE tenant_id=? AND document_id=?",tenant,documentId);
    }
    @Transactional public void rebuild(long documentId,int expectedVersion) {
        var actor=MesKnowledgeAccess.actor();access.requireDocument(documentId,true);
        var doc=lockedDocument(actor.tenant(),documentId);
        if(doc==null || flag(doc.get("deleted")))throw MesAssistantErrors.missing();
        if(n(doc,"version")!=expectedVersion)throw MesAssistantErrors.invalid("文档版本已变更，请刷新后重试");
        if(!"PUBLISHED".equals(doc.get("status")))throw MesAssistantErrors.invalid("请先发布文档，再建立向量索引");
        var space=models.embeddingSpace();
        var rows=jdbc.queryForList("SELECT * FROM mes_assistant_vector_state WHERE tenant_id=? AND document_id=? FOR UPDATE",actor.tenant(),documentId);
        if(!rows.isEmpty()) {
            var state=rows.get(0);String status=state.get("status").toString();
            boolean same=n(state,"document_version")==expectedVersion && space.spaceId().equals(state.get("space_id")) && "PUBLISHED".equals(state.get("desired_state"));
            if(same && (status.equals("PENDING") || status.equals("PROCESSING")))return;
            if(same && Set.of("ERROR","WAITING_CONFIG","CONFIG_CHANGED").contains(status)) {
                jdbc.update("UPDATE mes_assistant_vector_state SET status='PENDING',attempts=0,next_attempt_at=CURRENT_TIMESTAMP,claim_token=NULL,lease_until=NULL,error_message='',update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=?",actor.tenant(),documentId);return;
            }
        }
        stage(documentId,false);
    }
    @Scheduled(initialDelayString="${fazemes.vector.ingest-delay-ms:15000}",fixedDelayString="${fazemes.vector.ingest-interval-ms:5000}")
    public void deliver() {
        if(!running.compareAndSet(false,true))return;
        try { worker.execute(()->{
            try {
                var jobs=jdbc.queryForList("SELECT tenant_id,document_id FROM mes_assistant_vector_state WHERE ((status IN ('PENDING','ERROR') AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)) OR (status='PROCESSING' AND lease_until<CURRENT_TIMESTAMP)) AND (attempts<5 OR desired_state<>'PUBLISHED' OR status='PROCESSING') ORDER BY update_time LIMIT 2");
                for(var job:jobs)try{process(n(job,"tenant_id"),n(job,"document_id"));}catch(RuntimeException ignored){/* lease or durable failure is retried; never log source text */}
            } finally {running.set(false);}
        }); } catch(RejectedExecutionException exception){running.set(false);}
    }
    /** One bounded batch per claim, allowing crash recovery without replaying successful batches. */
    public void process(long tenant,long document) {
        if(TransactionSynchronizationManager.isActualTransactionActive())throw new IllegalStateException("Vector worker cannot run in a caller transaction");
        Long previous=TenantContextHolder.getTenantId();TenantContextHolder.setTenantId(tenant);
        Claim claim=null;
        try {
            claim=transactions.execute(tx->claim(tenant,document));if(claim==null)return;
            final Claim active=claim;
            if(!claim.desired().equals("PUBLISHED")){finish(claim,List.of());return;}
            requireSpace(claim);
            var saved=cached(claim);
            Set<Long> completedIds=saved.keySet();
            var remaining=claim.snapshot().chunks().stream().filter(c->!completedIds.contains(c.chunkId())).limit(8).toList();
            if(!remaining.isEmpty()) {
                if(!Boolean.TRUE.equals(transactions.execute(tx->current(active))))return;
                var batch=models.embed(remaining.stream().map(Chunk::text).toList(),claim.space());
                requireSpace(claim);
                boolean accepted=Boolean.TRUE.equals(transactions.execute(tx->{
                    if(!current(active))return false;
                    for(int i=0;i<remaining.size();i++)jdbc.update("INSERT INTO mes_assistant_vector_chunk(tenant_id,document_id,generation,chunk_id,vector_json) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE vector_json=VALUES(vector_json)",tenant,document,active.generation(),remaining.get(i).chunkId(),encode(batch.vectors().get(i)));
                    return true;
                }));if(!accepted)return;
                saved=cached(claim);
            }
            if(saved.size()==claim.snapshot().chunks().size()) {
                graph.ensureVectorIndex(claim.space(),claim.dimensions());requireSpace(claim);
                List<Map<String,Object>> chunks=new ArrayList<>();
                for(var chunk:claim.snapshot().chunks()) {
                    var row=new LinkedHashMap<String,Object>();row.put("chunkId",chunk.chunkId());row.put("chunkIndex",chunk.chunkIndex());row.put("heading",chunk.heading());row.put("pageNumber",chunk.pageNumber());
                    row.put("startOffset",chunk.startOffset());row.put("endOffset",chunk.endOffset());row.put("text",chunk.text());row.put("chunkHash",chunk.hash());row.put("embedding",saved.get(chunk.chunkId()));chunks.add(row);
                }
                finish(claim,chunks);
            } else {
                int completed=saved.size();transactions.executeWithoutResult(tx->{if(current(active))jdbc.update("UPDATE mes_assistant_vector_state SET status='PENDING',completed_chunks=?,attempts=0,claim_token=NULL,lease_until=NULL,next_attempt_at=CURRENT_TIMESTAMP,error_message='',update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=?",completed,tenant,document);});
            }
        } catch(RuntimeException failure){if(claim!=null)fail(claim,failure);}
        finally {TenantContextHolder.setTenantId(previous);}
    }
    private Claim claim(long tenant,long document) {
        var doc=lockedDocument(tenant,document);if(doc==null)return null;
        var rows=jdbc.queryForList("SELECT * FROM mes_assistant_vector_state WHERE tenant_id=? AND document_id=? AND ((status IN ('PENDING','ERROR') AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)) OR (status='PROCESSING' AND lease_until<CURRENT_TIMESTAMP)) FOR UPDATE",tenant,document);
        if(rows.isEmpty())return null;var row=rows.get(0);
        // An interrupted final lease must become a visible failure instead of polling forever.
        if(n(row,"attempts")>=5 && "PUBLISHED".equals(row.get("desired_state"))) {
            if("PROCESSING".equals(row.get("status")))jdbc.update("UPDATE mes_assistant_vector_state SET status='ERROR',claim_token=NULL,lease_until=NULL,error_message='向量任务多次中断，请手动重试' WHERE tenant_id=? AND document_id=?",tenant,document);
            return null;
        }
        String token=UUID.randomUUID().toString();int attempts=(int)Math.min(5,n(row,"attempts")+1);
        Snapshot snapshot;
        try {snapshot=json.readValue(jdbc.queryForObject("SELECT payload_json FROM mes_assistant_vector_state WHERE tenant_id=? AND document_id=?",String.class,tenant,document),Snapshot.class);}
        catch(Exception exception){throw new IllegalStateException("Invalid durable vector snapshot");}
        var claim=new Claim(snapshot,n(row,"generation"),token,row.get("desired_state").toString(),row.get("space_id").toString(),row.get("model_name").toString(),(int)n(row,"dimensions"),attempts);
        jdbc.update("UPDATE mes_assistant_vector_state SET status='PROCESSING',claim_token=?,lease_until=TIMESTAMPADD(SECOND,180,CURRENT_TIMESTAMP),attempts=?,update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=?",token,attempts,tenant,document);
        if(!current(claim)){
            jdbc.update("UPDATE mes_assistant_vector_state SET status='STALE',claim_token=NULL,lease_until=NULL,error_message='文档状态已变更，请重新建立索引' WHERE tenant_id=? AND document_id=?",tenant,document);return null;
        }
        return claim;
    }
    private boolean current(Claim claim) {
        var s=claim.snapshot();var doc=lockedDocument(s.tenant(),s.document());
        var rows=jdbc.queryForList("SELECT generation,claim_token,status FROM mes_assistant_vector_state WHERE tenant_id=? AND document_id=? FOR UPDATE",s.tenant(),s.document());
        if(doc==null || rows.isEmpty())return false;var state=rows.get(0);
        return n(state,"generation")==claim.generation() && claim.token().equals(state.get("claim_token")) && "PROCESSING".equals(state.get("status"))
                && n(doc,"version")==s.version() && n(doc,"creator")==s.owner() && n(doc,"knowledge_base_id")==s.base()
                && (claim.desired().equals("DELETED")?flag(doc.get("deleted")):!flag(doc.get("deleted")) && claim.desired().equals(doc.get("status")));
    }
    private void requireSpace(Claim claim) {
        if(!models.embeddingSpace().spaceId().equals(claim.space()))throw new IllegalStateException("Embedding space changed");
    }
    private Map<Long,List<Double>> cached(Claim claim) {
        Map<Long,List<Double>> result=new HashMap<>();var s=claim.snapshot();
        jdbc.query("SELECT chunk_id,vector_json FROM mes_assistant_vector_chunk WHERE tenant_id=? AND document_id=? AND generation=?",rs->{
            try {result.put(rs.getLong(1),json.readValue(rs.getString(2),new TypeReference<List<Double>>(){}));}
            catch(Exception exception){throw new IllegalStateException("Invalid vector checkpoint");}
        },s.tenant(),s.document(),claim.generation());return result;
    }
    private void finish(Claim claim,List<Map<String,Object>> chunks) {
        transactions.executeWithoutResult(tx->{
            if(!current(claim))return;var s=claim.snapshot();boolean published=claim.desired().equals("PUBLISHED");
            if(published)requireSpace(claim);
            if(!graph.replaceVectorDocument(new MesKnowledgeGraphService.Scope(s.tenant(),s.owner()),s.document(),s.version(),claim.generation(),s.base(),s.title(),claim.space(),claim.model(),claim.dimensions(),chunks,published))
                throw new IllegalStateException("Neo4j rejected obsolete vector generation");
            jdbc.update("UPDATE mes_assistant_vector_state SET status=?,completed_chunks=?,attempts=0,claim_token=NULL,lease_until=NULL,error_message='',next_attempt_at=NULL,index_name=?,synced_at=CURRENT_TIMESTAMP,payload_json='{}',update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=?",
                    published?"INDEXED":claim.desired().equals("DELETED")?"REMOVED":"READY",published?chunks.size():0,published?MesGraphStore.vectorIndexName(claim.space()):"",s.tenant(),s.document());
            jdbc.update("DELETE FROM mes_assistant_vector_chunk WHERE tenant_id=? AND document_id=?",s.tenant(),s.document());
        });
    }
    private void fail(Claim claim,RuntimeException failure) {
        String status="ERROR",message="向量入库失败，请检查Embedding和Neo4j连接后重试";
        if(claim.desired().equals("PUBLISHED")) {
            try {if(!models.embeddingSpace().spaceId().equals(claim.space())){status="CONFIG_CHANGED";message="Embedding模型或接口已变更，请重新建立索引";}}
            catch(cn.iocoder.yudao.framework.common.exception.ServiceException exception){status="WAITING_CONFIG";message="Embedding已停用，请检查配置后重试";}
        }
        if(status.equals("ERROR") && failure instanceof cn.iocoder.yudao.framework.common.exception.ServiceException exception)message=exception.getMessage();
        var s=claim.snapshot();
        jdbc.update("UPDATE mes_assistant_vector_state SET status=?,claim_token=NULL,lease_until=NULL,error_message=?,completed_chunks=(SELECT COUNT(*) FROM mes_assistant_vector_chunk WHERE tenant_id=? AND document_id=? AND generation=?),next_attempt_at=?,update_time=CURRENT_TIMESTAMP WHERE tenant_id=? AND document_id=? AND generation=? AND claim_token=?",
                status,message,s.tenant(),s.document(),claim.generation(),Timestamp.valueOf(LocalDateTime.now().plusSeconds(Math.min(300,10L<<Math.min(claim.attempts(),4)))),s.tenant(),s.document(),claim.generation(),claim.token());
    }
    private Map<String,Object> lockedDocument(long tenant,long document) {
        var rows=jdbc.queryForList("SELECT id,knowledge_base_id,title,version,status,creator,deleted,chunk_count FROM mes_assistant_document WHERE tenant_id=? AND id=? FOR UPDATE",tenant,document);return rows.isEmpty()?null:rows.get(0);
    }
    private String encode(Object value) {try{return json.writeValueAsString(value);}catch(Exception exception){throw new IllegalStateException("Vector checkpoint encoding failed");}}
    private static long n(Map<String,Object> row,String key){return ((Number)row.get(key)).longValue();}
    private static boolean flag(Object value){return Boolean.TRUE.equals(value)||value instanceof Number number&&number.intValue()!=0;}
    @PreDestroy @Override public void close(){worker.shutdownNow();}
}
