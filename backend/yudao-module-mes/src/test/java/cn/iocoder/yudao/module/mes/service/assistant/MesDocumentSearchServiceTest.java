package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.common.exception.ServiceException;
import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.module.mes.service.graph.MesGraphStore;
import org.junit.jupiter.api.*;
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

class MesDocumentSearchServiceTest extends MesAssistantTestDatabase {
    MesKnowledgeAccess access;MesDocumentSearchService search;MesAssistantModelGateway gateway;MesGraphStore store;
    AtomicReference<MesAssistantModelGateway.EmbeddingSpace> space;
    AtomicReference<Runnable> duringEmbedding,duringAnn;
    List<Map<String,Object>> candidates;AtomicInteger embeddings;long base;
    @BeforeEach void semanticFixture() {
        access=new MesKnowledgeAccess(jdbc,null);gateway=mock(MesAssistantModelGateway.class);store=mock(MesGraphStore.class);
        space=new AtomicReference<>(new MesAssistantModelGateway.EmbeddingSpace("test-embedding",3,"a".repeat(64)));
        duringEmbedding=new AtomicReference<>();duringAnn=new AtomicReference<>();candidates=new ArrayList<>();embeddings=new AtomicInteger();
        when(gateway.embeddingSpace()).thenAnswer(i->space.get());
        when(gateway.embed(anyList(),anyString())).thenAnswer(i->{
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());assertEquals(1,((List<?>)i.getArgument(0)).size());embeddings.incrementAndGet();
            var config=space.get();var hook=duringEmbedding.getAndSet(null);if(hook!=null)hook.run();
            return new MesAssistantModelGateway.EmbeddingBatch(config.model(),3,config.spaceId(),List.of(List.of(1.0,.2,.3)),1);
        });
        when(store.searchVectorChunks(anyLong(),anyString(),anyList(),anyList(),anyInt())).thenAnswer(i->{var hook=duringAnn.getAndSet(null);if(hook!=null)hook.run();return List.copyOf(candidates);});
        when(store.vectorSources(anyLong(),anyString(),anyList(),anyList())).thenAnswer(i->{
            List<Long> docs=i.getArgument(2),chunks=i.getArgument(3);
            return candidates.stream().filter(p->{var c=(Map<?,?>)p.get("chunk");return docs.contains(((Number)c.get("documentId")).longValue())&&chunks.contains(((Number)c.get("chunkId")).longValue());}).toList();
        });
        when(gateway.status()).thenReturn(Map.of("configured",true,"model","test-chat"));when(gateway.inputBudget()).thenReturn(16000);
        when(gateway.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenReturn("依据本次资料处理。[1]");
        search=new MesDocumentSearchService(jdbc,access,new MesAssistantRetriever(),gateway,store);
        service=new MesAssistantService(jdbc,json,new MesAssistantDocumentParser(),new MesAssistantRetriever(),gateway);
        ReflectionTestUtils.setField(service,"documentSearch",search);
        base=service.saveBase(null,"语义测试","",10);
    }
    @SuppressWarnings("unchecked") List<Map<String,Object>> items(Map<String,Object> result){return (List<Map<String,Object>>)result.get("items");}
    @SuppressWarnings("unchecked") Map<String,Object> info(Map<String,Object> result){return (Map<String,Object>)result.get("documentRetrieval");}
    long doc(String title,String text,boolean indexed) {
        long id=((Number)service.upload(base,title,"test.txt",text.getBytes(StandardCharsets.UTF_8),10).get("id")).longValue();service.publish(id,true);
        if(indexed) {
            int count=jdbc.queryForObject("SELECT chunk_count FROM mes_assistant_document WHERE id=?",Integer.class,id);
            jdbc.update("INSERT INTO mes_assistant_vector_state(tenant_id,document_id,owner_id,knowledge_base_id,document_version,generation,desired_state,status,space_id,model_name,dimensions,chunk_count,completed_chunks,payload_json,index_name) VALUES(1,?,10,?,1,7,'PUBLISHED','INDEXED',?,'test-embedding',3,?,?, '{}',?)",id,base,space.get().spaceId(),count,count,MesGraphStore.vectorIndexName(space.get().spaceId()));
        }
        return id;
    }
    Map<String,Object> source(long id){return access.searchableChunks(List.of(base)).stream().filter(r->((Number)r.get("documentId")).longValue()==id).findFirst().orElseThrow();}
    Map<String,Object> proof(long id,double score) {
        var s=source(id);Map<String,Object> cp=new HashMap<>();cp.put("tenantId",1L);cp.put("ownerId",10L);cp.put("knowledgeBaseId",base);cp.put("documentId",id);cp.put("documentVersion",1L);cp.put("generation",7L);cp.put("spaceId",space.get().spaceId());cp.put("model",space.get().model());cp.put("dimensions",3L);cp.put("active",true);
        Map<String,Object> c=new HashMap<>(cp);c.put("chunkId",s.get("chunkId"));c.put("chunkIndex",s.get("chunkIndex"));c.put("chunkHash",s.get("contentHash"));c.put("heading",s.get("heading"));c.put("text",s.get("content"));c.put("pageNumber",s.get("pageNumber"));c.put("startOffset",s.get("startOffset"));c.put("endOffset",s.get("endOffset"));
        return new HashMap<>(Map.of("chunk",c,"checkpoint",cp,"score",score));
    }
    @Test void keywordSearchNeverCallsEmbeddingOrNeo4j() {
        long id=doc("规程","inspection maintenance",true);
        var result=search.search("inspection",List.of(base),5,"LEXICAL");assertEquals(id,items(result).get(0).get("documentId"));assertEquals("lexical_bm25",((MesRetrievalEvidence)items(result).get(0).get("evidence")).retrievalMethod());
        verifyNoInteractions(store);verify(gateway,never()).embed(anyList(),anyString());verify(gateway,never()).embeddingSpace();
    }
    @Test void semanticSearchOnlySendsTheAuthorizedIndexedDocumentIdsAndReturnsAuthoritativeSqlSources() {
        long indexed=doc("润滑说明","转轴干磨应补充润滑脂。",true);doc("未入库","其他设备说明。",false);
        long draft=doc("草稿","尚未审核。",true);service.publish(draft,false);
        candidates.add(proof(indexed,.93));var result=search.search("bearing needs oil",List.of(base),5,"SEMANTIC");
        assertEquals(1,items(result).size());assertEquals("vector_cosine",result.get("mode"));assertEquals(1,info(result).get("vectorEligibleChunkCount"));
        var row=items(result).get(0);assertEquals(indexed,row.get("documentId"));assertFalse(row.containsKey("documentOwner"));
        var evidence=(MesRetrievalEvidence)row.get("evidence");assertEquals(.93,evidence.retrievalDetails().get("semanticScore"));assertEquals(7L,evidence.retrievalDetails().get("generation"));
        verify(store).searchVectorChunks(eq(1L),eq(space.get().spaceId()),eq(List.of(indexed)),anyList(),eq(50));
    }
    @Test void aGuessedPrivateLibraryIsRejectedBeforeSendingTheQuestionToAnyProvider() {
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(20L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        long privateBase=service.saveBase(null,"其他人的个人库","",20);
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(10L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        assertThrows(ServiceException.class,()->search.search("secret question",List.of(privateBase),5,"COMBINED"));
        verifyNoInteractions(store);verify(gateway,never()).embeddingSpace();verify(gateway,never()).embed(anyList(),anyString());
    }
    @Test void emptyOrUnindexedScopesDoNotCallEmbeddingAndCombinedReportsKeywordFallback() {
        assertTrue(items(search.search("问题",List.of(base),5,"SEMANTIC")).isEmpty());
        doc("说明","inspection",false);var combined=search.search("inspection",List.of(base),5,"COMBINED");
        assertEquals("LEXICAL",info(combined).get("effectiveStrategy"));assertEquals(true,info(combined).get("degraded"));assertFalse(((List<?>)info(combined).get("warnings")).isEmpty());
        assertTrue(items(search.search("inspection",List.of(base),5,"SEMANTIC")).isEmpty());verify(gateway,never()).embed(anyList(),anyString());
    }
    @Test void providerFailureIsExplicitInCombinedAndFailsStrictSemanticWithoutInventingResults() {
        long id=doc("规程","inspection",true);candidates.add(proof(id,.9));
        doThrow(MesAssistantErrors.model("模型服务返回HTTP 503")).when(gateway).embed(anyList(),anyString());
        assertThrows(ServiceException.class,()->search.search("inspection",List.of(base),5,"SEMANTIC"));
        var result=search.search("inspection",List.of(base),5,"COMBINED");assertEquals("lexical_bm25",result.get("mode"));assertEquals(true,info(result).get("degraded"));assertEquals(1,items(result).size());verifyNoInteractions(store);
    }
    @Test void withdrawalWhileEmbeddingTheQuestionPreventsAnnAndWithdrawalDuringAnnRemovesTheOldResult() {
        long id=doc("规程","inspection",true);var candidate=proof(id,.9);candidates.add(candidate);
        duringEmbedding.set(()->service.publish(id,false));assertTrue(items(search.search("inspection",List.of(base),5,"SEMANTIC")).isEmpty());verifyNoInteractions(store);
        service.publish(id,true);duringAnn.set(()->service.publish(id,false));assertTrue(items(search.search("inspection",List.of(base),5,"SEMANTIC")).isEmpty());
    }
    @Test void aModelChangeWhileEmbeddingTheQuestionNeverQueriesTheOldOrNewIndexSilently() {
        long id=doc("规程","inspection",true);candidates.add(proof(id,.9));
        duringEmbedding.set(()->space.set(new MesAssistantModelGateway.EmbeddingSpace("other",3,"b".repeat(64))));
        assertThrows(ServiceException.class,()->search.search("inspection",List.of(base),5,"SEMANTIC"));verifyNoInteractions(store);
    }
    @SuppressWarnings("unchecked") @Test void malformedStaleAndWrongOwnerCandidatesAreExcludedWithoutLeakingTheirText() {
        long id=doc("规程","inspection",true);var valid=proof(id,.8);
        for(String field:List.of("ownerId","documentVersion","generation","dimensions","chunkHash","text","startOffset")) {
            var bad=proof(id,.99);((Map<String,Object>)bad.get("chunk")).put(field,field.equals("chunkHash")||field.equals("text")?"PRIVATE-INVALID-SOURCE":999L);candidates.add(bad);
        }
        var inactive=proof(id,.99);((Map<String,Object>)inactive.get("checkpoint")).put("active",false);candidates.add(inactive);candidates.add(valid);
        var result=search.search("inspection",List.of(base),10,"SEMANTIC");assertEquals(1,items(result).size());assertFalse(jsonString(result).contains("PRIVATE-INVALID-SOURCE"));assertFalse(((List<?>)info(result).get("warnings")).isEmpty());
    }
    @Test void reciprocalRankFusionRewardsBothSignalsWithoutAddingIncompatibleRawScores() {
        long first=doc("A","maintenance maintenance checklist",true),second=doc("B","rotate grease",true),third=doc("C","maintenance note",true);
        candidates.add(proof(second,.99));candidates.add(proof(first,.90));var result=search.search("maintenance",List.of(base),10,"COMBINED");
        var rows=items(result);assertEquals(List.of(first,second,third),rows.stream().map(r->((Number)r.get("documentId")).longValue()).toList());
        assertTrue(((Number)rows.get(0).get("score")).doubleValue()<.1);assertEquals("document_rrf",result.get("mode"));assertEquals(false,info(result).get("degraded"));
        assertEquals(2,((Map<?,?>)rows.get(0).get("retrievalDetails")).get("semanticRank"));assertEquals(3,rows.stream().map(r->r.get("chunkId")).distinct().count());
    }
    @Test void vectorEvidenceIsRecheckedWithoutAnotherEmbeddingAndBecomesInvalidOnGenerationChange() {
        long id=doc("规程","inspection",true);candidates.add(proof(id,.9));var citations=items(search.search("inspection",List.of(base),5,"SEMANTIC"));
        assertTrue(search.currentVectorEvidence(citations,List.of(base)));assertEquals(1,embeddings.get());
        jdbc.update("UPDATE mes_assistant_vector_state SET generation=8 WHERE document_id=?",id);assertFalse(search.currentVectorEvidence(citations,List.of(base)));assertEquals(1,embeddings.get());
    }
    @Test void semanticAnswersPersistActualStrategyProvenanceAndHistoryAndRequireValidReferences() {
        long id=doc("规程","inspection",true);candidates.add(proof(id,.9));long session=service.createSession(null,10);
        var answer=service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"SEMANTIC");assertEquals("ANSWERED",answer.get("status"));assertEquals("SEMANTIC",info(answer).get("effectiveStrategy"));
        var messages=(List<?>)service.session(session,10).get("messages");assertEquals(2,messages.size());
        for(var item:messages){var row=(Map<?,?>)item;assertEquals("SEMANTIC",row.get("documentStrategy"));assertEquals("SEMANTIC",((Map<?,?>)row.get("documentRetrieval")).get("effectiveStrategy"));}
        doReturn("没有来源编号的回答").when(gateway).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
        var rejected=service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"SEMANTIC");assertEquals("MODEL_ERROR",rejected.get("status"));assertNull(rejected.get("answer"));
    }
    @Test void withdrawalDuringGenerationBlocksTheAnswerAndAnEmptySemanticScopeNeverCallsTheChatModel() {
        long id=doc("规程","inspection",true);candidates.add(proof(id,.9));long session=service.createSession(null,10);
        doAnswer(i->{service.publish(id,false);return "旧来源答复[1]";}).when(gateway).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
        var result=service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"SEMANTIC");assertEquals("MODEL_ERROR",result.get("status"));assertNull(result.get("answer"));assertTrue(((List<?>)result.get("citations")).isEmpty());
        clearInvocations(gateway);var empty=service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"SEMANTIC");assertEquals("NO_EVIDENCE",empty.get("status"));verify(gateway,never()).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
        assertNull(jdbc.queryForObject("SELECT pending_request_id FROM mes_assistant_session WHERE id=?",String.class,session));
    }
    @Test void semanticSearchRejectsActiveTransactionsBeforeAnyExternalCall() {
        doc("规程","inspection",true);new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())).executeWithoutResult(t->assertThrows(ServiceException.class,()->search.search("inspection",List.of(base),5,"SEMANTIC")));
        verifyNoInteractions(store);verify(gateway,never()).embed(anyList(),anyString());
    }
    @Test void roleRevocationWhileEmbeddingCannotBeHiddenByCombinedKeywordFallback() {
        long id=doc("企业规程","inspection",true);candidates.add(proof(id,.9));
        jdbc.update("UPDATE mes_assistant_knowledge_base SET library_type='RULES' WHERE id=?",base);
        jdbc.update("INSERT INTO system_role(id,tenant_id,name,code,status,deleted) VALUES(100,1,'readers','reader',0,0)");
        jdbc.update("INSERT INTO mes_assistant_base_role VALUES(1,?,100)",base);jdbc.update("INSERT INTO system_user_role(user_id,role_id,deleted) VALUES(20,100,0)");
        SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(20L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());
        duringEmbedding.set(()->jdbc.update("DELETE FROM mes_assistant_base_role WHERE knowledge_base_id=?",base));
        assertThrows(ServiceException.class,()->search.search("inspection",List.of(base),5,"COMBINED"));verifyNoInteractions(store);
    }
    @Test void retrievalFailureBeforeChatConfigurationIsReadStillReleasesANonNullableModelMessage() {
        doc("规程","inspection",true);long session=service.createSession(null,10);
        doThrow(MesAssistantErrors.model("Embedding connection failed")).when(gateway).embed(anyList(),anyString());
        assertThrows(ServiceException.class,()->service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"SEMANTIC"));
        assertNull(jdbc.queryForObject("SELECT pending_request_id FROM mes_assistant_session WHERE id=?",String.class,session));
        assertEquals("",jdbc.queryForObject("SELECT model_name FROM mes_assistant_message WHERE session_id=?",String.class,session));
        verify(gateway,never()).status();
        assertEquals("ANSWERED",service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"LEXICAL").get("status"));
    }
    @Test void strategyChangesDoNotReplayAPreviousStrategiesAnswerAsNewQuestionContext() {
        long id=doc("规程","inspection",true);candidates.add(proof(id,.9));long session=service.createSession(null,10);
        doReturn("OLD-STRATEGY-REPLY [1]").when(gateway).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
        assertEquals("ANSWERED",service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"SEMANTIC").get("status"));
        doAnswer(i->{assertFalse(i.getArgument(1).toString().contains("OLD-STRATEGY-REPLY"));return "新的综合答复[1]";}).when(gateway).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
        assertEquals("ANSWERED",service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"COMBINED").get("status"));
    }
    @Test void aNewIndexGenerationDuringAnsweringBlocksTheAnswerAndItsStaleSemanticPreview() {
        long id=doc("规程","inspection",true);candidates.add(proof(id,.9));long session=service.createSession(null,10);
        doAnswer(i->{jdbc.update("UPDATE mes_assistant_vector_state SET generation=8,status='PENDING' WHERE document_id=?",id);return "旧代次答复[1]";}).when(gateway).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
        var result=service.send(session,"inspection",List.of(base),10,"DOCUMENT",2,"SEMANTIC");assertEquals("MODEL_ERROR",result.get("status"));assertNull(result.get("answer"));assertTrue(((List<?>)result.get("citations")).isEmpty());
    }
    private String jsonString(Object value){try{return json.writeValueAsString(value);}catch(Exception e){throw new RuntimeException(e);}}
}
