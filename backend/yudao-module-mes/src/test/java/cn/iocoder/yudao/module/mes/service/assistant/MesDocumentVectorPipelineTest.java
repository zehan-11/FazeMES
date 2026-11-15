package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.common.exception.ServiceException;
import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.module.mes.service.graph.MesGraphStore;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class MesDocumentVectorPipelineTest extends MesAssistantTestDatabase {
    MesGraphStore store; MesAssistantModelGateway gateway; MesDocumentVectorService vectors; TransactionTemplate tx;
    AtomicReference<MesAssistantModelGateway.EmbeddingSpace> space; AtomicInteger calls; AtomicReference<Runnable> duringCall;
    long base;
    @BeforeEach void vectorPipeline() {
        store=mock(MesGraphStore.class);gateway=mock(MesAssistantModelGateway.class);
        space=new AtomicReference<>(new MesAssistantModelGateway.EmbeddingSpace("test-embedding",3,"a".repeat(64)));
        calls=new AtomicInteger();duringCall=new AtomicReference<>();
        when(gateway.embeddingSpace()).thenAnswer(i->space.get());
        when(gateway.embed(anyList(),anyString())).thenAnswer(i->{
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());calls.incrementAndGet();
            var input=(List<?>)i.getArgument(0);var config=space.get();
            assertEquals(config.spaceId(),i.getArgument(1));
            var action=duringCall.getAndSet(null);if(action!=null)action.run();
            return new MesAssistantModelGateway.EmbeddingBatch(config.model(),3,config.spaceId(),Collections.nCopies(input.size(),List.of(1.0,.2,.3)),input.size());
        });
        when(store.replaceVectorDocument(any(),anyLong(),anyInt(),anyLong(),anyLong(),anyString(),anyString(),anyString(),anyInt(),anyList(),anyBoolean())).thenReturn(true);
        var manager=new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource()));tx=new TransactionTemplate(manager);
        vectors=new MesDocumentVectorService(jdbc,json,gateway,store,new MesKnowledgeAccess(jdbc,null),manager);
        service=new MesAssistantService(jdbc,json,new MesAssistantDocumentParser(),new MesAssistantRetriever(),gateway);
        ReflectionTestUtils.setField(service,"documentVectors",vectors);
        base=tx.execute(t->service.saveBase(null,"向量测试","",10));
    }
    @AfterEach void stopWorker(){vectors.close();}
    long upload(String text){return tx.execute(t->((Number)service.upload(base,"测试文件","test.txt",text.getBytes(StandardCharsets.UTF_8),10).get("id")).longValue());}
    String status(long document){return jdbc.queryForObject("SELECT status FROM mes_assistant_vector_state WHERE document_id=?",String.class,document);}
    void publish(long document){tx.executeWithoutResult(t->service.publish(document,true));}
    void due(long document){jdbc.update("UPDATE mes_assistant_vector_state SET next_attempt_at=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP) WHERE document_id=?",document);}
    @Test void draftsAndRolledBackPublicationNeverCallApiAndPublishedBatchesAreComplete() {
        long document=upload("inspection "+"valid maintenance ".repeat(1400));assertEquals("READY",status(document));
        vectors.process(1,document);assertEquals(0,calls.get());
        tx.executeWithoutResult(t->{service.publish(document,true);t.setRollbackOnly();});
        assertEquals("READY",status(document));vectors.process(1,document);assertEquals(0,calls.get());
        publish(document);int count=jdbc.queryForObject("SELECT chunk_count FROM mes_assistant_vector_state WHERE document_id=?",Integer.class,document);
        assertTrue(count>8);
        for(int i=0;i<20 && !status(document).equals("INDEXED");i++)vectors.process(1,document);
        assertEquals("INDEXED",status(document));assertEquals((count+7)/8,calls.get());
        assertEquals(count,jdbc.queryForObject("SELECT completed_chunks FROM mes_assistant_vector_state WHERE document_id=?",Integer.class,document));
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_vector_chunk",Integer.class));
        verify(store).ensureVectorIndex("a".repeat(64),3);
        verify(store).replaceVectorDocument(argThat(s->s.tenant()==1 && s.owner()==10),eq(document),eq(1),eq(2L),eq(base),eq("测试文件"),eq("a".repeat(64)),eq("test-embedding"),eq(3),argThat(rows->rows.size()==count && rows.stream().allMatch(r->r.get("chunkHash").toString().length()==64)),eq(true));
        vectors.process(1,document);assertEquals((count+7)/8,calls.get());
    }
    @Test void completedApiBatchesSurviveWriterFailureAndWorkerRestartWithoutAnotherApiCall() {
        long document=upload("设备点检出现异常后，应按规程处理。");publish(document);
        doThrow(new IllegalStateException("test Neo4j failure")).doNothing().when(store).ensureVectorIndex(anyString(),anyInt());
        vectors.process(1,document);assertEquals("ERROR",status(document));assertEquals(1,calls.get());
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_vector_chunk",Integer.class));
        vectors.close();vectors=new MesDocumentVectorService(jdbc,json,gateway,store,new MesKnowledgeAccess(jdbc,null),new DataSourceTransactionManager(jdbc.getDataSource()));
        due(document);vectors.process(1,document);assertEquals("INDEXED",status(document));assertEquals(1,calls.get());
    }
    @ParameterizedTest @ValueSource(strings={"withdraw","update","delete"})
    void changesDuringApiCallDiscardTheOldResultAndOnlyDeliverCleanup(String change) {
        long document=upload("旧设备操作说明。");publish(document);
        duringCall.set(()->tx.executeWithoutResult(t->{
            if(change.equals("withdraw"))service.publish(document,false);
            else if(change.equals("update"))service.updateDocument(document,1,null,"new.txt","新设备说明。".getBytes(StandardCharsets.UTF_8),10);
            else service.deleteDocument(document);
        }));
        vectors.process(1,document);assertEquals("PENDING",status(document));assertEquals(1,calls.get());
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_vector_chunk",Integer.class));
        verify(store,never()).replaceVectorDocument(any(),anyLong(),anyInt(),anyLong(),anyLong(),anyString(),anyString(),anyString(),anyInt(),anyList(),eq(true));
        vectors.process(1,document);assertEquals(change.equals("delete")?"REMOVED":"READY",status(document));assertEquals(1,calls.get());
        verify(store).replaceVectorDocument(any(),eq(document),eq(change.equals("update")?2:1),eq(3L),eq(base),anyString(),eq(""),eq(""),eq(0),eq(List.of()),eq(false));
    }
    @Test void activeLeasesRejectDuplicateWorkersAndExpiredLeasesCanBeRecovered() {
        long document=upload("租约测试。");publish(document);
        jdbc.update("UPDATE mes_assistant_vector_state SET status='PROCESSING',claim_token='old',lease_until=TIMESTAMPADD(SECOND,60,CURRENT_TIMESTAMP) WHERE document_id=?",document);
        vectors.process(1,document);assertEquals(0,calls.get());
        jdbc.update("UPDATE mes_assistant_vector_state SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP) WHERE document_id=?",document);
        vectors.process(1,document);assertEquals("INDEXED",status(document));assertEquals(1,calls.get());
    }
    @Test void configurationChangesDuringApiCallBlockDeliveryUntilAnExplicitRebuild() {
        long document=upload("模型切换测试。");publish(document);
        duringCall.set(()->space.set(new MesAssistantModelGateway.EmbeddingSpace("new-model",3,"b".repeat(64))));
        vectors.process(1,document);assertEquals("CONFIG_CHANGED",status(document));
        verify(store,never()).ensureVectorIndex(anyString(),anyInt());
        tx.executeWithoutResult(t->vectors.rebuild(document,1));vectors.process(1,document);
        assertEquals("INDEXED",status(document));assertEquals(2,calls.get());
        verify(store).ensureVectorIndex("b".repeat(64),3);
    }
    @Test void publicationWithoutConfigurationRemainsPublishedAndCanBeRebuiltAfterConfiguration() {
        long document=upload("未配置时也允许保存发布。");
        when(gateway.embeddingSpace()).thenThrow(MesAssistantErrors.model("not configured"));publish(document);
        assertEquals("WAITING_CONFIG",status(document));vectors.process(1,document);assertEquals(0,calls.get());
        assertEquals("PUBLISHED",service.document(document,true).get("status"));
        doAnswer(i->space.get()).when(gateway).embeddingSpace();tx.executeWithoutResult(t->vectors.rebuild(document,1));
        vectors.process(1,document);assertEquals("INDEXED",status(document));
    }
    @Test void retryRetainsSuccessfulBatchesAndVersionOrOwnershipGuardsRejectInvalidRebuilds() {
        long document=upload("权限与重试测试。");publish(document);
        doThrow(new IllegalStateException("test failure")).doNothing().when(store).ensureVectorIndex(anyString(),anyInt());
        vectors.process(1,document);assertEquals("ERROR",status(document));
        assertThrows(ServiceException.class,()->tx.executeWithoutResult(t->vectors.rebuild(document,2)));
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(11L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        assertThrows(ServiceException.class,()->tx.executeWithoutResult(t->vectors.rebuild(document,1)));
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(10L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        tx.executeWithoutResult(t->vectors.rebuild(document,1));vectors.process(1,document);
        assertEquals("INDEXED",status(document));assertEquals(1,calls.get());
    }
    @Test void anExpiredFinalAttemptBecomesFailedInsteadOfRemainingProcessingForever() {
        long document=upload("中断次数上限测试。");publish(document);
        jdbc.update("UPDATE mes_assistant_vector_state SET status='PROCESSING',attempts=5,claim_token='old',lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP) WHERE document_id=?",document);
        vectors.process(1,document);assertEquals("ERROR",status(document));assertEquals(0,calls.get());
    }
    Map<String,Object> visible(long document){return service.documents(base,true).stream().filter(r->((Number)r.get("id")).longValue()==document).findFirst().orElseThrow();}
    @Test void repeatedPublicationDoesNotInvalidateAnActiveClaimOrRepeatEmbedding() {
        long document=upload("幂等发布测试。");publish(document);
        duringCall.set(()->publish(document));vectors.process(1,document);
        assertEquals("INDEXED",status(document));assertEquals(1,calls.get());assertEquals(true,visible(document).get("vectorUsable"));
        publish(document);vectors.process(1,document);assertEquals(1,calls.get());
        assertEquals(2,jdbc.queryForObject("SELECT generation FROM mes_assistant_vector_state WHERE document_id=?",Integer.class,document));
        tx.executeWithoutResult(t->service.publish(document,false));tx.executeWithoutResult(t->service.publish(document,false));
        assertEquals(3,jdbc.queryForObject("SELECT generation FROM mes_assistant_vector_state WHERE document_id=?",Integer.class,document));
        assertEquals(false,visible(document).get("vectorUsable"));assertEquals("REMOVE",visible(document).get("vectorAction"));
        vectors.process(1,document);assertEquals("READY",status(document));assertEquals("NONE",visible(document).get("vectorAction"));
    }
    @Test void updatingAnIndexedFileInvalidatesItsOldSourcesBeforePhysicalCleanupAndRepublishesOnlyTheNewVersion() {
        long document=upload("OLDVERSIONMARKER original guidance.");publish(document);vectors.process(1,document);
        assertEquals(true,visible(document).get("vectorUsable"));
        tx.executeWithoutResult(t->service.updateDocument(document,1,null,"new.txt","NEWVERSIONMARKER replacement guidance.".getBytes(StandardCharsets.UTF_8),10));
        var draft=visible(document);assertEquals("DRAFT",draft.get("status"));assertEquals("REMOVE",draft.get("vectorAction"));assertEquals(false,draft.get("vectorUsable"));assertNull(draft.get("vectorIndexedVersion"));
        assertTrue(((List<?>)service.search("OLDVERSIONMARKER",List.of(base),5).get("items")).isEmpty());
        assertThrows(ServiceException.class,()->tx.executeWithoutResult(t->service.updateDocument(document,1,null,"stale.txt",new byte[]{65},10)));
        // Republish before the previous cleanup worker runs: the newest generation replaces every older vector.
        publish(document);vectors.process(1,document);
        assertEquals("INDEXED",status(document));assertEquals(true,visible(document).get("vectorUsable"));assertEquals(2,((Number)visible(document).get("vectorIndexedVersion")).intValue());
        assertEquals(2,calls.get());assertEquals(2,service.documentVersions(document).size());
        assertTrue(((List<?>)service.search("OLDVERSIONMARKER",List.of(base),5).get("items")).isEmpty());
        verify(store).replaceVectorDocument(any(),eq(document),eq(2),eq(4L),eq(base),anyString(),anyString(),anyString(),eq(3),argThat(rows->rows.stream().allMatch(r->r.get("text").toString().contains("NEWVERSIONMARKER"))),eq(true));
    }
    @Test void aRejectedReplacementKeepsThePublishedVersionAndItsVectorIndexUsable() {
        long document=upload("Valid published contents.");publish(document);vectors.process(1,document);
        assertThrows(ServiceException.class,()->tx.executeWithoutResult(t->service.updateDocument(document,1,null,"bad.txt",new byte[]{(byte)0xff},10)));
        assertEquals("PUBLISHED",visible(document).get("status"));assertEquals(true,visible(document).get("vectorUsable"));assertEquals(1,((Number)visible(document).get("version")).intValue());
        assertEquals(1,calls.get());assertEquals(1,service.documentVersions(document).size());
    }
    @Test void cleanupContinuesBeyondFiveFailuresWithoutEmbeddingAndRecoversAfterConfigurationIsDisabled() {
        long document=upload("撤回清理测试。");publish(document);vectors.process(1,document);
        tx.executeWithoutResult(t->service.publish(document,false));
        doThrow(MesAssistantErrors.model("disabled")).when(gateway).embeddingSpace();
        doThrow(new IllegalStateException("Neo4j temporarily unavailable")).when(store).replaceVectorDocument(any(),anyLong(),anyInt(),anyLong(),anyLong(),anyString(),anyString(),anyString(),anyInt(),anyList(),eq(false));
        for(int i=0;i<7;i++){due(document);vectors.process(1,document);}
        assertEquals("ERROR",status(document));assertEquals(1,calls.get());assertEquals("REMOVE",visible(document).get("vectorAction"));assertEquals(false,visible(document).get("vectorUsable"));
        doReturn(true).when(store).replaceVectorDocument(any(),anyLong(),anyInt(),anyLong(),anyLong(),anyString(),anyString(),anyString(),anyInt(),anyList(),eq(false));
        due(document);vectors.process(1,document);assertEquals("READY",status(document));assertEquals(1,calls.get());
    }
    @Test void modelConfigurationChangesImmediatelyInvalidateTheListViewWithoutPretendingTheStoredIndexWasRemoved() {
        long document=upload("配置变化状态测试。");publish(document);vectors.process(1,document);
        assertEquals(true,visible(document).get("vectorUsable"));
        space.set(new MesAssistantModelGateway.EmbeddingSpace("replacement-model",3,"b".repeat(64)));
        assertEquals("CONFIG_CHANGED",visible(document).get("vectorStatus"));assertEquals(false,visible(document).get("vectorUsable"));
        assertEquals("INDEXED",status(document));assertEquals(1,calls.get());
        tx.executeWithoutResult(t->vectors.rebuild(document,1));vectors.process(1,document);assertEquals(true,visible(document).get("vectorUsable"));assertEquals(2,calls.get());
        doThrow(MesAssistantErrors.model("disabled")).when(gateway).embeddingSpace();
        assertEquals("WAITING_CONFIG",visible(document).get("vectorStatus"));assertEquals(false,visible(document).get("vectorUsable"));
    }
    @Test void inconsistentIndexSourceMetadataIsNeverReportedAsAUsableCurrentVersion() {
        long document=upload("来源校验测试。");publish(document);vectors.process(1,document);
        for(String column:List.of("document_version","owner_id","knowledge_base_id","completed_chunks")) {
            int old=jdbc.queryForObject("SELECT "+column+" FROM mes_assistant_vector_state WHERE document_id=?",Integer.class,document);
            jdbc.update("UPDATE mes_assistant_vector_state SET "+column+"=? WHERE document_id=?",old+1,document);
            assertEquals("STALE",visible(document).get("vectorStatus"));assertEquals(false,visible(document).get("vectorUsable"));
            jdbc.update("UPDATE mes_assistant_vector_state SET "+column+"=? WHERE document_id=?",old,document);
        }
        assertEquals(true,visible(document).get("vectorUsable"));
        assertFalse(visible(document).containsKey("documentOwner"));assertFalse(visible(document).containsKey("vectorOwner"));assertFalse(visible(document).containsKey("vectorSpaceId"));
    }
    @Test void anExistingPublishedFileStillRequiresAnExplicitIndexBuildAndIsNotBackfilledByDuplicatePublish() {
        long document=upload("历史已发布文件。");publish(document);
        jdbc.update("DELETE FROM mes_assistant_vector_state WHERE document_id=?",document);
        publish(document);assertEquals("NOT_INDEXED",visible(document).get("vectorStatus"));assertEquals(0,calls.get());
        tx.executeWithoutResult(t->vectors.rebuild(document,1));vectors.process(1,document);assertEquals(true,visible(document).get("vectorUsable"));assertEquals(1,calls.get());
    }
    @Test void apiFailuresStopAfterFiveAttemptsAndKeepAnHonestFailureStatus() {
        long document=upload("API失败测试。");publish(document);
        doThrow(MesAssistantErrors.model("模型服务返回HTTP 503")).when(gateway).embed(anyList(),anyString());
        for(int i=0;i<7;i++){due(document);vectors.process(1,document);}
        assertEquals("ERROR",status(document));assertEquals(5,jdbc.queryForObject("SELECT attempts FROM mes_assistant_vector_state WHERE document_id=?",Integer.class,document));
        verify(gateway,times(5)).embed(anyList(),anyString());verify(store,never()).ensureVectorIndex(anyString(),anyInt());
    }
}
