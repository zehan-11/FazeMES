package cn.iocoder.yudao.module.mes.service.face;

import cn.iocoder.yudao.framework.common.exception.ServiceException;
import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import cn.iocoder.yudao.module.system.dal.dataobject.user.AdminUserDO;
import cn.iocoder.yudao.module.system.service.auth.AdminAuthService;
import cn.iocoder.yudao.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import cn.iocoder.yudao.module.system.service.permission.PermissionService;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Synthetic vectors only: no camera, real-person photographs or production credential rows. */
class MesFaceAuthServiceTest {
    @TempDir Path directory;
    private JdbcTemplate jdbc;
    private MesFaceAuthService service;
    private AdminUserService users;
    private AdminAuthService auth;
    private FaceWorkerClient worker;
    private FaceChallengeStore challenges;
    private FaceTemplateCipher cipher;
    private FaceVectorStore vectors;
    private FaceBindingStore bindings;
    private AdminUserDO user;
    private static final String USERNAME="face-test-user";
    private static final String PASSWORD="Test-Face-Password";
    private static final String CHALLENGE="synthetic-single-use-challenge";
    private static final String IP="192.0.2.20";
    private static final String IMAGE="synthetic-frame-only";

    @BeforeEach
    void setup() {
        var source=new DriverManagerDataSource("jdbc:h2:mem:face_"+UUID.randomUUID()+";MODE=MySQL;DB_CLOSE_DELAY=-1","sa","");
        jdbc=new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE mes_face_credential(id BIGINT AUTO_INCREMENT PRIMARY KEY,tenant_id BIGINT,user_id BIGINT,template_cipher VARCHAR(4096),enabled INT DEFAULT 1,deleted INT DEFAULT 0,creator VARCHAR(64),updater VARCHAR(64),update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,binding_status VARCHAR(24) DEFAULT 'UNBOUND',storage_kind VARCHAR(12) DEFAULT 'NONE',row_version BIGINT DEFAULT 0,active_version CHAR(36),sample_count INT DEFAULT 0,model_version VARCHAR(64),consented_at TIMESTAMP,consent_version VARCHAR(16),UNIQUE(tenant_id,user_id))");
        jdbc.execute("CREATE TABLE mes_face_cleanup(tenant_id BIGINT,user_id BIGINT,template_version CHAR(36),due_at TIMESTAMP,attempts INT DEFAULT 0,PRIMARY KEY(tenant_id,user_id,template_version))");
        jdbc.execute("CREATE TABLE mes_face_audit(id BIGINT AUTO_INCREMENT PRIMARY KEY,tenant_id BIGINT,actor_id BIGINT,user_id BIGINT,action VARCHAR(24),request_id CHAR(36),reason VARCHAR(160),result VARCHAR(24),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        users=mock(AdminUserService.class);auth=mock(AdminAuthService.class);worker=mock(FaceWorkerClient.class);challenges=mock(FaceChallengeStore.class);
        cipher=new FaceTemplateCipher(directory.resolve("master.key").toString());
        service=new MesFaceAuthService();
        vectors=mock(FaceVectorStore.class);
        bindings=new FaceBindingStore(jdbc,new TransactionTemplate(new DataSourceTransactionManager(source)),vectors);
        ReflectionTestUtils.setField(service,"bindings",bindings);
        ReflectionTestUtils.setField(service,"vectors",vectors);
        var permission=mock(PermissionService.class);when(permission.hasAnyPermissions(42L,"mes:face:enroll")).thenReturn(true);
        ReflectionTestUtils.setField(service,"permissions",permission);
        ReflectionTestUtils.setField(service,"users",users);ReflectionTestUtils.setField(service,"auth",auth);ReflectionTestUtils.setField(service,"worker",worker);ReflectionTestUtils.setField(service,"cipher",cipher);ReflectionTestUtils.setField(service,"challenges",challenges);
        user=new AdminUserDO();user.setId(42L);user.setUsername(USERNAME);user.setTenantId(1L);user.setStatus(0);
        TenantContextHolder.setTenantId(1L);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(new LoginUser().setId(42L).setTenantId(1L),null,List.of()));
        when(users.getUser(42L)).thenReturn(user);when(users.getUserByUsername(USERNAME)).thenReturn(user);
        when(auth.authenticate(USERNAME,PASSWORD)).thenReturn(user);
        when(challenges.consume(1,USERNAME,IP,CHALLENGE)).thenReturn(true);
        when(worker.extract(IMAGE)).thenReturn(vector(0));
    }
    @AfterEach
    void cleanup(){TenantContextHolder.clear();SecurityContextHolder.clearContext();jdbc.execute("DROP ALL OBJECTS");}
    private float[] vector(int dimension){float[] value=new float[128];value[dimension]=1;return value;}
    private void enroll(String password,boolean consent,List<String> images){service.enroll(password,consent,images,null,UUID.randomUUID());}
    private void disable(String password){service.disable(password,null,UUID.randomUUID());}
    private void credential(long tenant,long id,boolean enabled,boolean deleted){jdbc.update("INSERT INTO mes_face_credential(tenant_id,user_id,template_cipher,enabled,deleted,binding_status,storage_kind,row_version) VALUES(?,?,?,?,?,?,\'LEGACY\',1)",tenant,id,cipher.encrypt(tenant,id,List.of(vector(0))),enabled?1:0,deleted?1:0,enabled?"ACTIVE":"SELF_REVOKED");}
    private void rejectLogin(){assertThrows(ServiceException.class,()->service.login(USERNAME,CHALLENGE,IMAGE,IP));verify(auth,never()).loginByVerifiedFace(anyLong());}

    @Test
    void requiresExplicitConsentCurrentLoginAndPasswordReauthenticationForEnrollment(){
        assertThrows(ServiceException.class,()->enroll(PASSWORD,false,List.of(IMAGE)));verifyNoInteractions(worker);
        assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of()));
        assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of(IMAGE,IMAGE,IMAGE,IMAGE)));
        when(auth.authenticate(USERNAME,"bad-password")).thenThrow(new ServiceException(400,"wrong password"));
        assertThrows(ServiceException.class,()->enroll("bad-password",true,List.of(IMAGE)));verifyNoInteractions(worker);
        SecurityContextHolder.clearContext();assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of(IMAGE)));
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM mes_face_credential",Integer.class));
    }
    @Test
    void cannotEnrollOrDisableCredentialForAnotherTenantOrAuthenticatedUser(){
        TenantContextHolder.setTenantId(2L);
        assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of(IMAGE)));
        assertThrows(ServiceException.class,()->disable(PASSWORD));verifyNoInteractions(worker);verify(auth,never()).authenticate(anyString(),anyString());
        TenantContextHolder.setTenantId(1L);AdminUserDO other=new AdminUserDO();other.setId(99L);other.setTenantId(1L);
        when(auth.authenticate(USERNAME,PASSWORD)).thenReturn(other);
        assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of(IMAGE)));verifyNoInteractions(worker);
    }
    @Test
    void enrollsOnlyTheScopedVectorVersionAndRevokesWithoutTouchingOthers(){
        credential(1,99,true,false);credential(2,42,true,false);
        enroll(PASSWORD,true,List.of(IMAGE));
        String sealed=jdbc.queryForObject("SELECT template_cipher FROM mes_face_credential WHERE tenant_id=1 AND user_id=42",String.class);
        assertEquals("",sealed);
        var previous=bindings.get(1,42);
        assertEquals("PGVECTOR",previous.storage());
        verify(vectors).write(eq(1L),eq(42L),eq(previous.version()),anyList(),any(Runnable.class));
        disable(PASSWORD);
        assertEquals("",jdbc.queryForObject("SELECT template_cipher FROM mes_face_credential WHERE tenant_id=1 AND user_id=42",String.class));
        assertEquals(0,jdbc.queryForObject("SELECT enabled FROM mes_face_credential WHERE tenant_id=1 AND user_id=42",Integer.class));
        assertEquals(2,jdbc.queryForObject("SELECT COUNT(*) FROM mes_face_credential WHERE enabled=1",Integer.class));
        assertTrue(bindings.cleanupPending(1,42));bindings.drain();
        verify(vectors).delete(1,42,previous.version());assertFalse(bindings.cleanupPending(1,42));
    }
    @Test
    void inconsistentEnrollmentImagesAreRejectedAndNeverPersisted(){
        when(worker.extract("different-synthetic-frame")).thenReturn(vector(1));
        assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of(IMAGE,"different-synthetic-frame")));
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM mes_face_credential",Integer.class));verify(auth,never()).loginByVerifiedFace(anyLong());
    }
    @Test
    void missingDisabledAndDeletedCredentialsNeverIssueTokens(){
        rejectLogin();credential(1,42,false,false);rejectLogin();
        jdbc.update("UPDATE mes_face_credential SET enabled=1,deleted=1");rejectLogin();verifyNoInteractions(worker);
    }
    @Test
    void disabledUnknownAndCrossTenantUsersNeverReachFeatureExtraction(){
        credential(1,42,true,false);user.setStatus(1);rejectLogin();
        user.setStatus(0);user.setTenantId(2L);rejectLogin();
        when(users.getUserByUsername(USERNAME)).thenReturn(null);rejectLogin();verifyNoInteractions(worker);
    }
    @Test
    void expiredOrWrongBindingChallengeStopsBeforeUserLookup(){
        credential(1,42,true,false);when(challenges.consume(1,USERNAME,IP,CHALLENGE)).thenReturn(false);
        rejectLogin();verify(users,never()).getUserByUsername(anyString());verifyNoInteractions(worker);
    }
    @Test
    void challengeCannotBeReplayedAfterSuccessfulOneToOneVerification(){
        credential(1,42,true,false);var issued=new AuthLoginRespVO();issued.setUserId(42L);
        when(auth.loginByVerifiedFace(42L)).thenReturn(issued);
        when(challenges.consume(1,USERNAME,IP,CHALLENGE)).thenReturn(true,false);
        assertSame(issued,service.login(USERNAME,CHALLENGE,IMAGE,IP));
        assertThrows(ServiceException.class,()->service.login(USERNAME,CHALLENGE,IMAGE,IP));
        verify(auth,times(1)).loginByVerifiedFace(42L);verify(worker,times(1)).extract(IMAGE);
    }
    @Test
    void correctProbeIssuesOnlyTheClaimedEnabledAccountToken(){
        credential(1,42,true,false);credential(1,99,true,false);credential(2,42,true,false);
        var expected=new AuthLoginRespVO();expected.setUserId(42L);when(auth.loginByVerifiedFace(42L)).thenReturn(expected);
        assertSame(expected,service.login(USERNAME,CHALLENGE,IMAGE,IP));
        verify(auth,only()).loginByVerifiedFace(42L);verify(users).getUserByUsername(USERNAME);
    }
    @Test
    void mismatchedNonFiniteBadDimensionAndBrokenTemplateNeverIssueTokens(){
        credential(1,42,true,false);when(worker.extract(IMAGE)).thenReturn(vector(1));rejectLogin();
        float[] nan=vector(0);nan[1]=Float.NaN;when(worker.extract(IMAGE)).thenReturn(nan);rejectLogin();
        when(worker.extract(IMAGE)).thenReturn(new float[127]);rejectLogin();
        when(worker.extract(IMAGE)).thenReturn(vector(0));
        jdbc.update("UPDATE mes_face_credential SET template_cipher=? WHERE tenant_id=1 AND user_id=42",cipher.encrypt(2,42,List.of(vector(0))));rejectLogin();
    }
    @Test
    void workerFailureAndRateLimitFailClosedWithoutIssuingTokens(){
        credential(1,42,true,false);when(worker.extract(IMAGE)).thenThrow(new IllegalStateException("unavailable"));rejectLogin();
        when(challenges.consume(1,USERNAME,IP,CHALLENGE)).thenThrow(new IllegalArgumentException("limited"));rejectLogin();
    }
    @Test
    void statusIsSelfScopedAndNeverReturnsCiphertext(){
        credential(1,99,true,false);credential(2,42,true,false);when(worker.ready()).thenReturn(true);
        assertEquals(false,service.status().get("enrolled"));credential(1,42,true,false);
        Map<String,Object> status=service.status();assertEquals(true,status.get("enrolled"));assertEquals(false,status.get("livenessSupported"));assertFalse(status.containsKey("templateCipher"));
        assertEquals(Map.of("ready",true,"comparison","1:1","livenessSupported",false),service.publicStatus());
    }

    @Test
    void failedNewVersionPreservesActiveLegacyAndQueuesCandidateForCleanup() {
        credential(1,42,true,false);
        doThrow(new IllegalStateException("offline")).when(vectors).write(anyLong(),anyLong(),any(),anyList(),any(Runnable.class));
        assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of(IMAGE)));
        assertEquals("LEGACY",bindings.get(1,42).storage());
        assertTrue(bindings.cleanupPending(1,42));
        service.login(USERNAME,CHALLENGE,IMAGE,IP);verify(auth).loginByVerifiedFace(42L);
    }

    @Test
    void idempotentUpdatesAndStaleRequestsNeverOverwriteAnAdministrativeDecision() {
        UUID op=UUID.randomUUID();
        service.enroll(PASSWORD,true,List.of(IMAGE),0L,op);
        service.enroll(PASSWORD,true,List.of(IMAGE),0L,op);
        verify(vectors,times(1)).write(anyLong(),anyLong(),any(),anyList(),any(Runnable.class));
        var active=bindings.get(1,42); assertEquals(1,active.revision());
        UUID admin=UUID.randomUUID();
        service.administer(42,true,"设备更换",1,admin);
        service.administer(42,true,"设备更换",1,admin);
        assertThrows(ServiceException.class,()->service.enroll(PASSWORD,true,List.of(IMAGE),1L,UUID.randomUUID()));
        assertThrows(ServiceException.class,()->enroll(PASSWORD,true,List.of(IMAGE)));
        rejectLogin();
        service.administer(42,false,"本人重录",2,UUID.randomUUID());
        service.enroll(PASSWORD,true,List.of(IMAGE),3L,UUID.randomUUID());
        var replacement=bindings.get(1,42);assertNotEquals(active.version(),replacement.version());
        doThrow(new IllegalStateException("offline")).doNothing().when(vectors).delete(1,42,active.version());
        bindings.drain();assertTrue(bindings.cleanupPending(1,42));
        jdbc.update("UPDATE mes_face_cleanup SET due_at=DATEADD('SECOND',-1,CURRENT_TIMESTAMP)");
        bindings.drain();assertFalse(bindings.cleanupPending(1,42));
        verify(vectors,never()).delete(1,42,replacement.version());
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM mes_face_audit WHERE action='SUSPEND' AND result='SUCCESS' AND reason='设备更换'",Integer.class));
    }

    @Test
    void concurrentWritersCanPublishJustOneVersionFromTheSameRevision() throws Exception {
        var gate=new java.util.concurrent.CyclicBarrier(2);
        var pool=java.util.concurrent.Executors.newFixedThreadPool(2);
        java.util.concurrent.Callable<Boolean> publish=()->{
            gate.await(5,java.util.concurrent.TimeUnit.SECONDS);
            try {
                bindings.publish(1,42,0,UUID.randomUUID(),List.of(vector(0)));
                return true;
            } catch (ServiceException conflict) {
                assertEquals(MesFaceAuthService.CONFLICT.getCode(),conflict.getCode());
                return false;
            }
        };
        try {
            var first=pool.submit(publish);
            var second=pool.submit(publish);
            assertNotEquals(first.get(10,java.util.concurrent.TimeUnit.SECONDS),second.get(10,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(1,bindings.get(1,42).revision());
            verify(vectors,times(1)).write(anyLong(),anyLong(),any(),anyList(),any(Runnable.class));
        } finally { pool.shutdownNow(); }
    }

    @Test
    void successfulLegacyUpgradeClearsCipherAndNeverFallsBackDuringOutage() {
        credential(1,42,true,false);
        service.enroll(PASSWORD,true,List.of(IMAGE),1L,UUID.randomUUID());
        var now=bindings.get(1,42);
        assertEquals("PGVECTOR",now.storage());
        assertEquals("",jdbc.queryForObject("SELECT template_cipher FROM mes_face_credential",String.class));
        when(vectors.similarity(eq(1L),eq(42L),eq(now.version()),eq(1),any())).thenThrow(new IllegalStateException("offline"));
        rejectLogin();
    }

    @Test
    void aDecisionMadeDuringMatchingCancelsTokenIssuance() {
        credential(1,42,true,false);
        when(worker.extract(IMAGE)).thenAnswer(call->{
            service.administer(42,false,"重新核对",1,UUID.randomUUID());
            return vector(0);
        });
        rejectLogin();
    }

    @Test
    void scopedUserManagerCannotViewOrMutateAnInvisibleTarget() {
        credential(1,42,true,false);
        assertThrows(ServiceException.class,()->service.administer(99,true,"设备更换",0,UUID.randomUUID()));
        when(users.getUserList(List.of(42L,99L))).thenReturn(List.of(user));
        var visible=service.adminStatus(List.of(42L,99L));
        assertEquals(java.util.Set.of(42L),visible.keySet());
        assertEquals(Map.of("status","ACTIVE","revision",1L),visible.get(42L));
        service.administer(42,true,"设备更换",1,UUID.randomUUID());
        assertEquals("ADMIN_SUSPENDED",service.adminStatus(List.of(42L,99L)).get(42L).get("status"));
        assertEquals("UNBOUND",bindings.get(1,99).status());
    }
}
