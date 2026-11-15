package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.framework.security.core.service.SecurityFrameworkService;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.module.mes.service.graph.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.web.MockHttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MesKnowledgeAccessTest extends MesAssistantTestDatabase {
    MesKnowledgeAccess access;MesGraphStore store;MesKnowledgeGraphView view;Set<Long> admins=new HashSet<>(Set.of(10L,30L));long personal,rules,privateDoc,publicDoc,draft;
    void login(long tenant,long user){TenantContextHolder.setTenantId(tenant);SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(user).setTenantId(tenant).setUserType(2),new MockHttpServletRequest());}
    @BeforeEach void setupPolicy(){
        var security=mock(SecurityFrameworkService.class);when(security.hasPermission("mes:assistant:config")).thenAnswer(i->admins.contains(SecurityFrameworkUtils.getLoginUserId()));
        access=new MesKnowledgeAccess(jdbc,security);service=new MesAssistantService(jdbc,json,new MesAssistantDocumentParser(),new MesAssistantRetriever(),models,new MesAssistantMessageStore(jdbc,json,new DataSourceTransactionManager(jdbc.getDataSource())),access);
        jdbc.update("INSERT INTO system_role(id,tenant_id,name,code,status,deleted) VALUES(100,1,'工艺员','process_reader',0,0),(200,2,'其他企业角色','foreign',0,0)");jdbc.update("INSERT INTO system_user_role(user_id,role_id) VALUES(20,100)");
        personal=service.saveBase(null,"私人资料","",10);privateDoc=upload(personal,"机密项目","[部件]机密型号 —包含部件→ [部件]机密轴承",true);
        rules=service.saveBase(null,"企业规程","",10,"RULES",List.of(100L));publicDoc=upload(rules,"公开给工艺员的规程","[部件]电机 —包含部件→ [部件]轴承",true);draft=upload(rules,"未审阅秘密草稿","[设备]未公开设备 —包含部件→ [部件]未公开部件",false);
        store=mock(MesGraphStore.class);view=new MesKnowledgeGraphView(store,access);
        when(store.read(any(),anyString(),anyMap())).thenAnswer(i->i.<String>getArgument(1).contains("RETURN properties(n)")?List.of(Map.of("n",node("PRIVATE_NODE_ID","机密原图节点",10))):graphRows);
    }
    List<Map<String,Object>> graphRows=new ArrayList<>();
    long upload(long base,String title,String text,boolean publish){long user=SecurityFrameworkUtils.getLoginUserId();long id=((Number)service.upload(base,title,"relations.md",text.getBytes(StandardCharsets.UTF_8),user).get("id")).longValue();if(publish)service.publish(id,true);return id;}
    Map<String,Object> node(String id,String name,long owner){return new HashMap<>(Map.of("tenantId",1L,"ownerId",owner,"id",id,"name",name,"kind","部件","description","机密私人描述"));}
    Map<String,Object> edge(long document){
        var d=service.document(document,true);@SuppressWarnings("unchecked")var c=((List<Map<String,Object>>)d.get("chunks")).get(0);
        Map<String,Object> r=new HashMap<>();r.put("tenantId",1L);r.put("ownerId",10L);r.put("id","doc-rel:"+document);r.put("documentId",document);r.put("documentVersion",1);r.put("chunkId",c.get("chunkId"));r.put("chunkHash",c.get("contentHash"));r.put("startOffset",c.get("startOffset"));r.put("endOffset",c.get("endOffset"));r.put("sourceExcerpt",c.get("content"));r.put("sourceOriginalName","电机");r.put("targetOriginalName","轴承");r.put("sourceResolvedKind","部件");r.put("targetResolvedKind","部件");r.put("type","包含部件");
        return new HashMap<>(Map.of("a",node("PRIVATE_NODE_ID","机密原图节点",10),"b",node("PRIVATE_BEARING_ID","机密轴承标准名",10),"r",r));
    }
    @SuppressWarnings("unchecked")Map<String,Object> props(Map<String,Object> row){return (Map<String,Object>)row.get("r");}
    @Test void privateLibrariesAreOwnerOnlyEvenForAdministrators(){
        for(long user:List.of(20L,30L)){login(1,user);assertTrue(service.bases(true).stream().noneMatch(b->((Number)b.get("id")).longValue()==personal));assertThrows(RuntimeException.class,()->service.document(privateDoc,true));assertThrows(RuntimeException.class,()->service.download(privateDoc,true));assertThrows(RuntimeException.class,()->service.documentVersions(privateDoc));assertThrows(RuntimeException.class,()->service.publish(privateDoc,true));assertThrows(RuntimeException.class,()->service.deleteDocument(privateDoc));assertThrows(RuntimeException.class,()->service.search("机密",List.of(personal),5));assertThrows(RuntimeException.class,()->service.saveBase(null,"冒充创建者","",10));}
    }
    @Test void explicitTenantRolesReadOnlyPublishedFilesAndCannotMaintainRules(){
        login(1,20);assertEquals(1,service.documents(rules,true).size());assertThrows(RuntimeException.class,()->service.document(draft,true));assertThrows(RuntimeException.class,()->service.documentVersions(publicDoc));assertThrows(RuntimeException.class,()->service.upload(rules,"恶意修改","a.md",new byte[]{65},20));assertThrows(RuntimeException.class,()->service.publish(publicDoc,false));assertThrows(RuntimeException.class,()->service.deleteDocument(publicDoc));assertFalse(((List<?>)service.search("电机",List.of(),5).get("items")).isEmpty());
        jdbc.update("UPDATE system_role SET status=1 WHERE id=100");assertTrue(service.bases(true).isEmpty());assertThrows(RuntimeException.class,()->service.document(publicDoc,false));
        jdbc.update("UPDATE system_role SET status=0 WHERE id=100");jdbc.update("UPDATE system_user_role SET deleted=1 WHERE user_id=20");assertTrue(service.bases(true).isEmpty());
    }
    @Test void grantsCannotReferenceForeignRolesOrPromotePersonalDataToShared(){
        assertThrows(RuntimeException.class,()->service.saveBase(null,"越权角色","",10,"RULES",List.of(200L)));assertThrows(RuntimeException.class,()->service.saveBase(personal,"误共享","",10,"RULES",List.of(100L)));assertThrows(RuntimeException.class,()->service.saveBase(personal,"隐式共享","",10,"PERSONAL",List.of(100L)));
        service.saveBase(rules,"撤销授权","",10,"RULES",List.of());login(1,20);assertTrue(service.bases(true).isEmpty());login(2,20);assertThrows(RuntimeException.class,()->service.document(publicDoc,true));
        TenantContextHolder.setTenantId(1L);assertThrows(RuntimeException.class,()->service.bases(true));
    }
    @Test void graphProjectionUsesVisibleEvidenceAndNeverLeaksPrivateCanonicalNames() throws Exception {
        graphRows.add(edge(privateDoc));graphRows.add(edge(publicDoc));graphRows.add(edge(draft));var foreign=edge(publicDoc);props(foreign).put("tenantId",2L);graphRows.add(foreign);var stale=edge(publicDoc);props(stale).put("documentVersion",2);graphRows.add(stale);var bad=edge(publicDoc);props(bad).put("chunkHash","wrong");graphRows.add(bad);
        login(1,20);var projected=view.snapshot(List.of());assertEquals(1,projected.relations().size());assertEquals(2,projected.nodes().size());assertEquals(Set.of("电机","轴承"),new HashSet<>(projected.nodes().stream().map(n->n.name()).toList()));
        String encoded=json.writeValueAsString(projected);assertFalse(encoded.contains("机密"));assertFalse(encoded.contains("PRIVATE_NODE_ID"));assertThrows(RuntimeException.class,()->view.detail("PRIVATE_NODE_ID"));assertEquals("RULES",projected.relations().get(0).evidence().libraryType());
        assertEquals(1,view.relationPage("",10).items().size());assertEquals(2,view.nodePage("",10).items().size());
    }
    @Test void graphEvidenceStopsImmediatelyOnRevocationWithdrawalDeletionOrVersionChange(){
        graphRows.add(edge(publicDoc));login(1,20);assertEquals(1,view.snapshot(List.of()).relations().size());
        jdbc.update("DELETE FROM mes_assistant_base_role WHERE knowledge_base_id=?",rules);assertTrue(view.snapshot(List.of()).relations().isEmpty());jdbc.update("INSERT INTO mes_assistant_base_role VALUES(1,?,100)",rules);
        jdbc.update("UPDATE mes_assistant_document SET status='DRAFT' WHERE id=?",publicDoc);assertTrue(view.snapshot(List.of()).relations().isEmpty());jdbc.update("UPDATE mes_assistant_document SET status='PUBLISHED',version=2 WHERE id=?",publicDoc);assertTrue(view.snapshot(List.of()).relations().isEmpty());jdbc.update("UPDATE mes_assistant_document SET version=1,deleted=1 WHERE id=?",publicDoc);assertTrue(view.snapshot(List.of()).relations().isEmpty());
    }
    @Test void documentAndGraphEvidenceUseOneContractAndMixedRetrievalIncludesBoth(){
        graphRows.add(edge(publicDoc));login(1,20);var evidence=new MesEvidenceService(service,view).search("电机",List.of(rules),List.of("DOCUMENT","GRAPH"),10);
        @SuppressWarnings("unchecked")var items=(List<MesRetrievalEvidence>)evidence.get("items");assertEquals(2,items.size());assertEquals(Set.of("DOCUMENT","GRAPH"),new HashSet<>(items.stream().map(MesRetrievalEvidence::sourceType).toList()));
        assertEquals(items.get(0).documentId(),items.get(1).documentId());assertEquals(items.get(0).documentVersion(),items.get(1).documentVersion());assertEquals(items.get(0).chunkHash(),items.get(1).chunkHash());assertEquals(items.get(0).text(),items.get(1).text());
    }
    @Test void multiHopRetrievalUsesCurrentLibraryAuthorizationBeforeEntityLinking(){
        graphRows.add(edge(privateDoc));graphRows.add(edge(publicDoc));graphRows.add(edge(draft));login(1,20);
        var retrieval=new MesEvidenceService(service,view);
        var allowed=retrieval.search("请问电机包含哪些部件？",List.of(),null,10,"HYBRID",2);
        var graph=(MesGraphEvidenceRetriever.Result)allowed.get("graph");assertEquals(1,graph.relations().size());assertEquals(publicDoc,graph.relations().get(0).evidence().documentId());
        assertTrue(((MesGraphEvidenceRetriever.Result)retrieval.search("机密型号",List.of(),null,10,"GRAPH",2).get("graph")).matchedEntities().isEmpty());
        jdbc.update("DELETE FROM mes_assistant_base_role WHERE knowledge_base_id=?",rules);
        var revoked=retrieval.search("请问电机包含哪些部件？",List.of(),null,10,"HYBRID",2);assertTrue(((List<?>)revoked.get("items")).isEmpty());assertTrue(((MesGraphEvidenceRetriever.Result)revoked.get("graph")).nodes().isEmpty());
        assertThrows(RuntimeException.class,()->retrieval.search("电机",List.of(rules),null,10,"GRAPH",2));
    }
    @Test void revokedSourcesAreRedactedInHistoryAndExcludedFromNewModelContext() throws Exception {
        login(1,20);var citations=service.search("电机",List.of(rules),5).get("items");long session=service.createSession("已有会话",20);String snapshot=json.writeValueAsString(citations);
        for(String role:List.of("user","assistant"))jdbc.update("INSERT INTO mes_assistant_message(session_id,user_id,role,content_text,status,citations_json,tenant_id) VALUES(?,20,?,'ROLESECRET','ANSWERED',?,1)",session,role,snapshot);
        jdbc.update("DELETE FROM mes_assistant_base_role WHERE knowledge_base_id=?",rules);
        @SuppressWarnings("unchecked")var history=(List<Map<String,Object>>)service.session(session,20).get("messages");assertEquals("EVIDENCE_RESTRICTED",history.get(1).get("status"));assertTrue(((List<?>)history.get(1).get("citations")).isEmpty());
        var fake=mock(MesAssistantModelGateway.class);when(fake.status()).thenReturn(Map.of("configured",true,"model","test"));when(fake.inputBudget()).thenReturn(8192);when(fake.complete(any(MesAssistantModelGateway.Purpose.class),anyList())).thenAnswer(call->{assertFalse(call.getArgument(1).toString().contains("ROLESECRET"));return "一般答复";});
        var next=new MesAssistantService(jdbc,json,new MesAssistantDocumentParser(),new MesAssistantRetriever(),fake,new MesAssistantMessageStore(jdbc,json,new DataSourceTransactionManager(jdbc.getDataSource())),access);assertEquals("ANSWERED",next.send(session,"新的普通问题",List.of(),20).get("status"));verify(fake).complete(any(MesAssistantModelGateway.Purpose.class),anyList());
    }
    @Test void rulesAdministratorCanUpdateEnterpriseFilesWithoutChangingUploader(){
        login(1,30);service.updateDocument(publicDoc,1,null,"new.md","电机规程新版本".getBytes(StandardCharsets.UTF_8),30);assertEquals(10,jdbc.queryForObject("SELECT creator FROM mes_assistant_document WHERE id=?",Integer.class,publicDoc));assertEquals(2,service.documentVersions(publicDoc).size());assertThrows(RuntimeException.class,()->service.updateDocument(privateDoc,1,null,"a.md",new byte[]{65},30));
    }
}
