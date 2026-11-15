package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.*;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.mock.web.MockHttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MesDocumentVersionSyncTest extends MesAssistantTestDatabase {
    MesGraphStore graph;MesDocumentGraphService ingestion;TransactionTemplate tx;long base;
    static byte[] data(String text){return text.getBytes(StandardCharsets.UTF_8);}
    @BeforeEach void pipeline(){graph=mock(MesGraphStore.class);var manager=new DataSourceTransactionManager(jdbc.getDataSource());tx=new TransactionTemplate(manager);ingestion=new MesDocumentGraphService(jdbc,json,new MesDocumentRelationExtractor(),graph,manager);ReflectionTestUtils.setField(service,"documentGraph",ingestion);base=service.saveBase(null,"版本资料","",10);}
    long upload(){return tx.execute(t->((Number)service.upload(base,"电机手册","v1.md",data("[部件]电机 —包含部件→ [部件]轴承"),10).get("id")).longValue());}
    void publish(long id){tx.executeWithoutResult(t->service.publish(id,true));ingestion.process(1,id);assertEquals("SYNCED",state(id),()->jdbc.queryForMap("SELECT desired_state,status,attempts,next_attempt_at,error_message FROM mes_assistant_graph_state WHERE document_id=?",id).toString());}
    void update(long id,int version,String text){tx.executeWithoutResult(t->service.updateDocument(id,version,"新版手册","v"+(version+1)+".md",data(text),10));}
    String state(long id){return jdbc.queryForObject("SELECT status FROM mes_assistant_graph_state WHERE document_id=?",String.class,id);}
    @Test void replacingFileArchivesExactOldSourcesAndReturnsToDraftUntilRepublished() throws Exception {
        long id=upload();publish(id);var old=service.document(id,true);var oldFile=service.download(id,true);var citation=service.search("电机",List.of(base),5).get("items");
        long session=service.createSession("历史依据",10);String snapshot=json.writeValueAsString(citation);
        jdbc.update("INSERT INTO mes_assistant_message(session_id,user_id,role,content_text,status,citations_json,tenant_id) VALUES(?,10,'assistant','历史答复','ANSWERED',?,1)",session,snapshot);
        reset(graph);update(id,1,"[部件]电机 —包含部件→ [部件]转子");
        var current=service.document(id,true);assertEquals(2,((Number)current.get("version")).intValue());assertEquals("DRAFT",current.get("status"));assertEquals("PENDING",state(id));verifyNoInteractions(graph);
        assertArrayEquals(oldFile.bytes(),service.download(id,true,1).bytes());assertEquals(old.get("contentText"),service.document(id,true,1).get("contentText"));
        @SuppressWarnings("unchecked") var oldChunks=(List<Map<String,Object>>)old.get("chunks");@SuppressWarnings("unchecked") var archived=(List<Map<String,Object>>)service.document(id,true,1).get("chunks");
        assertEquals(((Number)oldChunks.get(0).get("chunkId")).longValue(),((Number)archived.get(0).get("chunkId")).longValue());assertEquals(oldChunks.get(0).get("contentHash"),archived.get(0).get("contentHash"));
        assertEquals(snapshot,jdbc.queryForObject("SELECT citations_json FROM mes_assistant_message WHERE session_id=?",String.class,session));assertEquals(0,((List<?>)service.search("电机",List.of(base),5).get("items")).size());
        assertEquals(2,service.documentVersions(id).size());assertEquals(true,service.documentVersions(id).get(0).get("isCurrent"));
        ingestion.process(1,id);assertEquals("READY",state(id));verify(graph).replaceDocument(any(),eq(id),eq(2),eq(List.of()));reset(graph);publish(id);
        @SuppressWarnings("unchecked") var capture=org.mockito.ArgumentCaptor.forClass(List.class);verify(graph).replaceDocument(any(),eq(id),eq(2),capture.capture());var fact=(Map<?,?>)capture.getValue().get(0);assertEquals(2,((Number)fact.get("documentVersion")).intValue());assertEquals("转子",fact.get("targetName"));assertEquals("SYNCED",state(id));
    }
    @Test void staleVersionsAndBadFilesCannotOverwriteCurrentDataOrCreateExtraRevisions(){
        long id=upload();update(id,1,"[部件]电机 —包含部件→ [部件]转子");var expected=service.download(id,true).bytes();
        assertThrows(RuntimeException.class,()->update(id,1,"过时内容"));assertThrows(RuntimeException.class,()->tx.executeWithoutResult(t->service.publish(id,true,1)));assertEquals("DRAFT",service.document(id,true).get("status"));assertThrows(RuntimeException.class,()->tx.executeWithoutResult(t->service.updateDocument(id,2,null,"bad.exe",data("bad"),10)));
        assertArrayEquals(expected,service.download(id,true).bytes());assertEquals(2,service.documentVersions(id).size());assertEquals(2,jdbc.queryForObject("SELECT version FROM mes_assistant_document WHERE id=?",Integer.class,id));
    }
    @Test void rollbackRestoresFileChunksRevisionAndGraphQueueTogether(){
        long id=upload();publish(id);var file=service.download(id,true).bytes();String queue=jdbc.queryForObject("SELECT payload_json FROM mes_assistant_graph_state WHERE document_id=?",String.class,id);
        assertThrows(RuntimeException.class,()->tx.executeWithoutResult(t->{service.updateDocument(id,1,null,"v2.md",data("a —关联→ b"),10);throw new RuntimeException("rollback");}));
        assertArrayEquals(file,service.download(id,true).bytes());assertEquals(1,service.documentVersions(id).size());assertEquals(queue,jdbc.queryForObject("SELECT payload_json FROM mes_assistant_graph_state WHERE document_id=?",String.class,id));assertEquals("SYNCED",state(id));
    }
    @Test void historicalAccessIsTenantBoundAndManagerOnlyAndOwnerDoesNotChange(){
        long id=upload();SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(11L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        assertThrows(RuntimeException.class,()->tx.executeWithoutResult(t->service.updateDocument(id,1,null,"v2.md",data("a —关联→ b"),11)));
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(10L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        tx.executeWithoutResult(t->service.updateDocument(id,1,null,"v2.md",data("a —关联→ b"),10));assertEquals(10,jdbc.queryForObject("SELECT creator FROM mes_assistant_document WHERE id=?",Integer.class,id));assertEquals(10,jdbc.queryForObject("SELECT changed_by FROM mes_assistant_document_revision WHERE document_id=?",Integer.class,id));
        publish(id);assertThrows(RuntimeException.class,()->service.document(id,false,1));assertThrows(RuntimeException.class,()->service.download(id,false,1));
        TenantContextHolder.setTenantId(2L);assertThrows(RuntimeException.class,()->service.documentVersions(id));assertThrows(RuntimeException.class,()->service.download(id,true,1));assertThrows(RuntimeException.class,()->update(id,2,"a —关联→ b"));
    }
    @Test void malformedDraftStillClearsOldGraphAndCannotPublishAndDeletionRetriesAfterTenFailures(){
        long id=upload();publish(id);reset(graph);update(id,1,"a".repeat(101)+" —关联→ b");assertEquals("PENDING",state(id));ingestion.process(1,id);
        assertEquals("INVALID",state(id));verify(graph).replaceDocument(any(),eq(id),eq(2),eq(List.of()));assertThrows(RuntimeException.class,()->tx.executeWithoutResult(t->service.publish(id,true)));assertEquals("DRAFT",service.document(id,true).get("status"));
        tx.executeWithoutResult(t->service.deleteDocument(id));jdbc.update("UPDATE mes_assistant_graph_state SET status='ERROR',attempts=10,next_attempt_at=NULL WHERE document_id=?",id);reset(graph);ingestion.deliver();assertEquals("REMOVED",state(id));verify(graph).replaceDocument(any(),eq(id),eq(2),eq(List.of()));assertThrows(RuntimeException.class,()->service.documentVersions(id));
    }
    @Test void newerUpdatesAndDeletionSupersedeUndeliveredVersions(){
        long id=upload();publish(id);reset(graph);update(id,1,"a —关联→ b");update(id,2,"c —关联→ d");tx.executeWithoutResult(t->{service.publish(id,true);service.deleteDocument(id);});ingestion.process(1,id);
        verify(graph).replaceDocument(any(),eq(id),eq(3),eq(List.of()));assertEquals("REMOVED",state(id));assertEquals(2,jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_document_revision WHERE document_id=?",Integer.class,id));
    }
    @Test void retryEligibilityUsesDatabaseClockAndDoesNotRunBeforeDue(){
        long id=upload();tx.executeWithoutResult(t->service.publish(id,true));
        jdbc.update("UPDATE mes_assistant_graph_state SET next_attempt_at=? WHERE document_id=?",java.sql.Timestamp.valueOf(java.time.LocalDateTime.now().plusDays(1)),id);
        ingestion.process(1,id);verifyNoInteractions(graph);assertEquals("PENDING",state(id));
        jdbc.update("UPDATE mes_assistant_graph_state SET next_attempt_at=NULL WHERE document_id=?",id);ingestion.process(1,id);assertEquals("SYNCED",state(id));verify(graph).replaceDocument(any(),eq(id),eq(1),anyList());
    }
}
