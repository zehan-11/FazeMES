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

class MesDocumentGraphPipelineTest extends MesAssistantTestDatabase {
    MesGraphStore graph;MesDocumentGraphService ingestion;TransactionTemplate tx;
    @BeforeEach void graphPipeline(){
        graph=mock(MesGraphStore.class);var manager=new DataSourceTransactionManager(jdbc.getDataSource());tx=new TransactionTemplate(manager);
        ingestion=new MesDocumentGraphService(jdbc,json,new MesDocumentRelationExtractor(),graph,manager);
        ReflectionTestUtils.setField(service,"documentGraph",ingestion);
    }
    long upload(String text){return tx.execute(status->{long base=service.saveBase(null,"维护资料","",10);return ((Number)service.upload(base,"维护资料","relations.md",text.getBytes(StandardCharsets.UTF_8),10).get("id")).longValue();});}
    String status(long id){return jdbc.queryForObject("SELECT status FROM mes_assistant_graph_state WHERE document_id=?",String.class,id);}
    void publish(long id,boolean value){tx.executeWithoutResult(status->service.publish(id,value));}
    @Test void uploadStagesDraftThenCommittedPublicationDeliversExactProvenance(){
        long id=upload("# 结构\n[部件]电机 —包含部件→ [部件]轴承");assertEquals("READY",status(id));verifyNoInteractions(graph);
        publish(id,true);assertEquals("PENDING",status(id));verifyNoInteractions(graph);ingestion.process(1,id);assertEquals("SYNCED",status(id));
        @SuppressWarnings("unchecked") var capture=org.mockito.ArgumentCaptor.forClass(List.class);
        verify(graph).replaceDocument(eq(new MesKnowledgeGraphService.Scope(1,10)),eq(id),eq(1),capture.capture());
        var fact=(Map<?,?>)capture.getValue().get(0);assertEquals(id,((Number)fact.get("documentId")).longValue());assertNotNull(fact.get("chunkId"));assertNotNull(fact.get("chunkHash"));
        String text=jdbc.queryForObject("SELECT content_text FROM mes_assistant_document WHERE id=?",String.class,id);
        assertEquals(text.substring(((Number)fact.get("startOffset")).intValue(),((Number)fact.get("endOffset")).intValue()),fact.get("sourceExcerpt"));
    }
    @Test void failureIsDurableRedactedAndCanBeRetried(){
        long id=upload("a —关联→ b");publish(id,true);
        doThrow(new IllegalStateException("password=secret")).when(graph).replaceDocument(any(),anyLong(),anyInt(),anyList());ingestion.process(1,id);
        assertEquals("ERROR",status(id));assertEquals(1,jdbc.queryForObject("SELECT attempts FROM mes_assistant_graph_state WHERE document_id=?",Integer.class,id));
        assertFalse(jdbc.queryForObject("SELECT error_message FROM mes_assistant_graph_state WHERE document_id=?",String.class,id).contains("secret"));
        reset(graph);tx.executeWithoutResult(s->service.rebuildGraph(id));ingestion.process(1,id);assertEquals("SYNCED",status(id));
    }
    @Test void withdrawalAndDeletionQueueOnlyThatDocumentsRemoval(){
        long id=upload("a —关联→ b");publish(id,true);ingestion.process(1,id);reset(graph);
        publish(id,false);assertEquals("PENDING",status(id));ingestion.process(1,id);assertEquals("READY",status(id));
        verify(graph).replaceDocument(eq(new MesKnowledgeGraphService.Scope(1,10)),eq(id),eq(1),eq(List.of()));
        reset(graph);tx.executeWithoutResult(s->service.deleteDocument(id));ingestion.process(1,id);assertEquals("REMOVED",status(id));
        verify(graph).replaceDocument(eq(new MesKnowledgeGraphService.Scope(1,10)),eq(id),eq(1),eq(List.of()));
    }
    @Test void rollbackCannotEnqueueOrWriteGraph(){
        assertThrows(RuntimeException.class,()->tx.executeWithoutResult(s->{long base=service.saveBase(null,"临时","",10);service.upload(base,"资料","a.txt","a —关联→ b".getBytes(StandardCharsets.UTF_8),10);throw new RuntimeException("rollback");}));
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_graph_state",Integer.class));verifyNoInteractions(graph);
    }
    @Test void noExplicitRelationsIsReportedHonestlyAndDoesNotCreateFacts(){
        long id=upload("设备出现异常时应通知负责人。");assertEquals("EMPTY",status(id));publish(id,true);ingestion.process(1,id);assertEquals("EMPTY",status(id));
        verify(graph).replaceDocument(eq(new MesKnowledgeGraphService.Scope(1,10)),eq(id),eq(1),eq(List.of()));
    }
    @Test void scopeComesFromDocumentCreatorAndCrossTenantRequestsFail(){
        long id=upload("a —关联→ b");SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(11L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        publish(id,true);ingestion.process(1,id);verify(graph).replaceDocument(eq(new MesKnowledgeGraphService.Scope(1,10)),eq(id),eq(1),anyList());
        TenantContextHolder.setTenantId(2L);assertThrows(RuntimeException.class,()->tx.executeWithoutResult(s->service.rebuildGraph(id)));
    }
    @Test void aNewerWithdrawalSupersedesAnUndeliveredPublication(){
        long id=upload("a —关联→ b");publish(id,true);publish(id,false);ingestion.process(1,id);
        verify(graph).replaceDocument(any(),eq(id),eq(1),eq(List.of()));assertEquals("READY",status(id));
    }
}
