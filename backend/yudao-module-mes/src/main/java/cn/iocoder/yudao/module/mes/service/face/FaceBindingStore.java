package cn.iocoder.yudao.module.mes.service.face;

import cn.iocoder.yudao.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import static cn.iocoder.yudao.framework.common.exception.util.ServiceExceptionUtil.exception;

/** MySQL is the only publication point. Each candidate has a durable cleanup ticket before PostgreSQL is touched. */
@Component
public class FaceBindingStore {
    record Binding(String status, String storage, long revision, UUID version, int samples) {
        boolean active() { return status.equals("ACTIVE"); }
        Map<String,Object> metadata() { return Map.of("status", status, "revision", revision); }
    }
    private static final Binding UNBOUND = new Binding("UNBOUND","NONE",0,null,0);
    private static final String COLUMNS = "binding_status,enabled,storage_kind,row_version,active_version,sample_count";
    private static final String ACCOUNT = " WHERE tenant_id=? AND user_id=? AND deleted=0";
    private static final String TICKET = " WHERE tenant_id=? AND user_id=? AND template_version=?";
    private static final RowMapper<Binding> ROW = (r,n) -> new Binding(
            "ACTIVE".equals(r.getString("binding_status")) && !r.getBoolean("enabled") ? "SELF_REVOKED" : r.getString("binding_status"),
            r.getString("storage_kind"), r.getLong("row_version"),
            r.getString("active_version") == null ? null : UUID.fromString(r.getString("active_version")),
            r.getInt("sample_count"));
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final FaceVectorStore vectors;

    public FaceBindingStore(JdbcTemplate db, TransactionTemplate tx, FaceVectorStore vectors) {
        this.db=db;
        this.tx=tx;
        this.vectors=vectors;
    }

    Binding get(long tenant,long user) { return read(tenant,user,false); }

    private Binding read(long tenant,long user,boolean lock) {
        return db.query("SELECT "+COLUMNS+" FROM mes_face_credential"+ACCOUNT+(lock ? " FOR UPDATE" : ""),
                ROW,tenant,user).stream().findFirst().orElse(UNBOUND);
    }

    private Binding lockOrCreate(long tenant,long user) {
        db.update("""
                INSERT INTO mes_face_credential(tenant_id,user_id,template_cipher,enabled) VALUES(?,?,'',0)
                ON DUPLICATE KEY UPDATE id=id""",tenant,user);
        db.update("""
                UPDATE mes_face_credential SET deleted=0,enabled=0,template_cipher='',binding_status='UNBOUND',
                storage_kind='NONE',row_version=0,active_version=NULL,sample_count=0,model_version=NULL
                WHERE tenant_id=? AND user_id=? AND deleted<>0""",tenant,user);
        return read(tenant,user,true);
    }

    String legacy(long tenant,long user,long revision) {
        return db.query("SELECT template_cipher FROM mes_face_credential"+ACCOUNT+
                " AND row_version=? AND storage_kind='LEGACY' AND binding_status='ACTIVE' AND enabled=1",
                (r,n)->r.getString(1),tenant,user,revision).stream().findFirst().orElseThrow(()->exception(MesFaceAuthService.REJECTED));
    }

    Map<Long,Map<String,Object>> metadata(long tenant,List<Long> visible) {
        Map<Long,Map<String,Object>> result = new LinkedHashMap<>();
        if (visible.isEmpty()) return result;
        visible.forEach(id -> result.put(id,UNBOUND.metadata()));
        List<Object> args = new ArrayList<>();
        args.add(tenant);
        args.addAll(visible);
        String placeholders = String.join(",",Collections.nCopies(visible.size(),"?"));
        db.query("SELECT user_id,"+COLUMNS+" FROM mes_face_credential WHERE deleted=0 AND tenant_id=? AND user_id IN ("+placeholders+")",
                rs -> { result.put(rs.getLong("user_id"),ROW.mapRow(rs,0).metadata()); },args.toArray());
        return result;
    }

    boolean cleanupPending(long tenant,long user) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM mes_face_cleanup WHERE tenant_id=? AND user_id=?)",
                Boolean.class,tenant,user));
    }

    void audit(long tenant,Long actor,Long target,String action,UUID request,String reason,String result) {
        db.update("INSERT INTO mes_face_audit(tenant_id,actor_id,user_id,action,request_id,reason,result) VALUES(?,?,?,?,?,?,?)",
                tenant,actor,target,action,request == null ? null : request.toString(),reason,result);
    }

    boolean completed(long tenant,long actor,long user,String action,UUID request) {
        return Boolean.TRUE.equals(db.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM mes_face_audit WHERE tenant_id=? AND user_id=? AND actor_id=?
                    AND action=? AND request_id=? AND result='SUCCESS')""",
                Boolean.class,tenant,user,actor,action,request.toString()));
    }

    private void ticket(long tenant,long user,UUID version,int delay) {
        if (version != null) db.update("INSERT INTO mes_face_cleanup(tenant_id,user_id,template_version,due_at) VALUES(?,?,?,?)",
                tenant,user,version.toString(),Timestamp.from(Instant.now().plusSeconds(delay)));
    }

    private void lockTicket(long tenant,long user,UUID candidate) {
        List<String> owned = db.query("SELECT template_version FROM mes_face_cleanup"+TICKET+" FOR UPDATE",
                (r,n)->r.getString(1),tenant,user,candidate.toString());
        if (owned.isEmpty()) throw exception(MesFaceAuthService.CONFLICT);
    }

    void publish(long tenant,long user,long expected,UUID request,List<float[]> features) {
        UUID candidate = UUID.randomUUID();
        // Commit the recovery record first. An interrupted write (including an uncertain PG commit) can always be cleaned.
        ticket(tenant,user,candidate,120);
        tx.executeWithoutResult(transaction -> {
            lockTicket(tenant,user,candidate);
            Binding old = lockOrCreate(tenant,user);
            if (!completed(tenant,user,user,"ENROLL",request)) {
                if (old.revision()!=expected || old.status().equals("ADMIN_SUSPENDED")) throw exception(MesFaceAuthService.CONFLICT);
                vectors.write(tenant,user,candidate,features,() -> lockTicket(tenant,user,candidate));
                ticket(tenant,user,old.version(),0);
                db.update("""
                        UPDATE mes_face_credential SET binding_status='ACTIVE',storage_kind='PGVECTOR',enabled=1,
                        active_version=?,sample_count=?,model_version=?,template_cipher='',consented_at=CURRENT_TIMESTAMP,
                        consent_version='1',row_version=row_version+1,updater=?"""+ACCOUNT,
                        candidate.toString(),features.size(),FaceVectorStore.MODEL,Long.toString(user),tenant,user);
                audit(tenant,user,user,"ENROLL",request,"","SUCCESS");
            }
            db.update("DELETE FROM mes_face_cleanup"+TICKET,tenant,user,candidate.toString());
        });
    }

    void invalidate(long tenant,long actor,long user,long expected,UUID request,String action,String state,String reason) {
        tx.executeWithoutResult(transaction -> {
            Binding old=lockOrCreate(tenant,user);
            if (completed(tenant,actor,user,action,request)) return;
            if (old.revision()!=expected || (action.equals("REVOKE") && !old.active())) throw exception(MesFaceAuthService.CONFLICT);
            ticket(tenant,user,old.version(),0);
            db.update("""
                    UPDATE mes_face_credential SET binding_status=?,storage_kind='NONE',enabled=0,active_version=NULL,
                    sample_count=0,model_version=NULL,template_cipher='',row_version=row_version+1,updater=?"""+ACCOUNT,
                    state,Long.toString(actor),tenant,user);
            audit(tenant,actor,user,action,request,reason,"SUCCESS");
        });
    }

    AuthLoginRespVO issue(long tenant,long user,Binding checked,Supplier<AuthLoginRespVO> login) {
        return tx.execute(transaction -> {
            Binding now=read(tenant,user,true);
            if (!now.active() || !now.equals(checked)) throw exception(MesFaceAuthService.REJECTED);
            AuthLoginRespVO session=login.get();
            audit(tenant,user,user,"LOGIN",null,"","SUCCESS");
            return session;
        });
    }

    private record Job(long tenant,long user,UUID version) {}
    @Scheduled(initialDelayString="${mes.face-auth.cleanup-ms:15000}",fixedDelayString="${mes.face-auth.cleanup-ms:15000}")
    public void drain() {
        for (int i=0; i<16; i++) {
            Boolean processed=tx.execute(transaction -> {
                List<Job> jobs=db.query("""
                        SELECT tenant_id,user_id,template_version FROM mes_face_cleanup WHERE due_at<=CURRENT_TIMESTAMP
                        ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED""",
                        (r,n)->new Job(r.getLong(1),r.getLong(2),UUID.fromString(r.getString(3))));
                if (jobs.isEmpty()) return false;
                Job job=jobs.get(0);
                try {
                    vectors.delete(job.tenant(),job.user(),job.version());
                    db.update("DELETE FROM mes_face_cleanup"+TICKET,job.tenant(),job.user(),job.version().toString());
                } catch (IllegalStateException unavailable) {
                    db.update("UPDATE mes_face_cleanup SET attempts=attempts+1,due_at=?"+TICKET,
                            Timestamp.from(Instant.now().plusSeconds(30)),job.tenant(),job.user(),job.version().toString());
                }
                return true;
            });
            if (!Boolean.TRUE.equals(processed)) return;
        }
    }
}
