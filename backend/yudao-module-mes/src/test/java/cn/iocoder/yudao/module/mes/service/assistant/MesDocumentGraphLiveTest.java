package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.*;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.mock.web.MockHttpServletRequest;
import org.neo4j.driver.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="FAZEMES_GRAPH_TEST_CONFIG",matches=".+")
class MesDocumentGraphLiveTest extends MesAssistantTestDatabase {
    @Test void realWriterPreservesSharedEntitiesOtherSourcesAndExactVersionProvenance() throws Exception {
        var config=json.readTree(Files.readString(Path.of(System.getenv("FAZEMES_GRAPH_TEST_CONFIG"))));
        String uri=config.path("uri").asText(),user=config.path("username").asText(),password=config.path("password").asText(),database=config.path("database").asText();
        long tenant=9_200_000+new java.security.SecureRandom().nextInt(1_000_000);
        TenantContextHolder.setTenantId(tenant);SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(10L).setTenantId(tenant).setUserType(2),new MockHttpServletRequest());
        try(var store=new MesGraphStore(true,uri,user,password,database);var driver=GraphDatabase.driver(uri,AuthTokens.basic(user,password));var session=driver.session(SessionConfig.forDatabase(database))){
            var manager=new DataSourceTransactionManager(jdbc.getDataSource());var tx=new TransactionTemplate(manager);
            var ingestion=new MesDocumentGraphService(jdbc,json,new MesDocumentRelationExtractor(),store,manager);
            ReflectionTestUtils.setField(service,"documentGraph",ingestion);var queries=new MesKnowledgeGraphService(store);
            try {
                long base=service.saveBase(null,"设备资料","",10);
                long first=tx.execute(t->((Number)service.upload(base,"结构资料","first.md","# 电机结构\n[部件]电机 —包含部件→ [部件]轴承".getBytes(StandardCharsets.UTF_8),10).get("id")).longValue());
                long second=tx.execute(t->((Number)service.upload(base,"检查资料","second.md","[部件]电机 —关联现象→ [故障]异响".getBytes(StandardCharsets.UTF_8),10).get("id")).longValue());
                assertTrue(queries.overview(200).nodes().isEmpty());
                tx.executeWithoutResult(t->{service.publish(first,true);service.publish(second,true);});ingestion.process(tenant,first);ingestion.process(tenant,second);
                var graph=queries.overview(200);assertEquals(3,graph.nodes().size());assertEquals(2,graph.relations().size());
                var relation=graph.relations().stream().filter(e->e.sourceEvidence().documentId().equals(first)).findFirst().orElseThrow();
                var evidence=relation.sourceEvidence();assertEquals(1,evidence.documentVersion());assertEquals(base,evidence.knowledgeBaseId());assertNotNull(evidence.chunkId());assertEquals(64,evidence.chunkHash().length());assertEquals("explicit_v1",evidence.extractionMethod());
                String text=jdbc.queryForObject("SELECT content_text FROM mes_assistant_document WHERE id=?",String.class,first);
                assertEquals(text.substring(evidence.startOffset(),evidence.endOffset()),evidence.excerpt());
                // Retrying a document is idempotent; versions replace only that document's contributions.
                tx.executeWithoutResult(t->{jdbc.update("UPDATE mes_assistant_document SET version=2 WHERE id=?",first);service.rebuildGraph(first);});ingestion.process(tenant,first);
                assertEquals(2,queries.overview(200).relations().size());assertTrue(queries.overview(200).relations().stream().filter(e->e.sourceEvidence().documentId().equals(first)).allMatch(e->e.sourceEvidence().documentVersion()==2));
                tx.executeWithoutResult(t->service.publish(first,false));ingestion.process(tenant,first);
                graph=queries.overview(200);assertEquals(2,graph.nodes().size());assertEquals(1,graph.relations().size());assertEquals(second,graph.relations().get(0).sourceEvidence().documentId());
                tx.executeWithoutResult(t->service.deleteDocument(second));ingestion.process(tenant,second);assertTrue(queries.overview(200).nodes().isEmpty());
            } finally {
                session.run("MATCH (n:FazeEntity {tenantId:$tenant,ownerId:10}) WHERE n.origin='DOCUMENT' DETACH DELETE n",Map.of("tenant",tenant)).consume();
            }
        }
    }
    @Test void existingGraphFusionPreservesEverySourceIsolationAndIndependentComponents() throws Exception {
        var config=json.readTree(Files.readString(Path.of(System.getenv("FAZEMES_GRAPH_TEST_CONFIG"))));
        long tenant=20_000_000+new java.security.SecureRandom().nextInt(1_000_000);
        TenantContextHolder.setTenantId(tenant);SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(10L).setTenantId(tenant).setUserType(2),new MockHttpServletRequest());
        try(var store=new MesGraphStore(true,config.path("uri").asText(),config.path("username").asText(),config.path("password").asText(),config.path("database").asText());
            var driver=GraphDatabase.driver(config.path("uri").asText(),AuthTokens.basic(config.path("username").asText(),config.path("password").asText()));var session=driver.session(SessionConfig.forDatabase(config.path("database").asText()))){
            var tx=new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource()));var scope=new MesKnowledgeGraphService.Scope(tenant,10);
            var ingestion=new MesDocumentGraphService(jdbc,json,new MesDocumentRelationExtractor(),store,new DataSourceTransactionManager(jdbc.getDataSource()));ReflectionTestUtils.setField(service,"documentGraph",ingestion);var queries=new MesKnowledgeGraphService(store);
            try{
                session.run("CREATE (a:FazeEntity {tenantId:$t,ownerId:10,id:'motor',name:'电机',kind:'部件',description:'原始描述',aliases:['驱动电机']}),(b:FazeEntity {tenantId:$t,ownerId:10,id:'bearing',name:'轴承',kind:'部件'}),(c:FazeEntity {tenantId:$t,ownerId:10,id:'other',name:'独立原节点',kind:'设备'}),(a)-[:FazeRelation {tenantId:$t,ownerId:10,id:'seed-edge',type:'包含部件',sourceTitle:'原资料'}]->(b),(x:FazeEntity {tenantId:$t,ownerId:11,id:'private-motor',name:'电机',kind:'设备'}),(y:FazeEntity {tenantId:$other,ownerId:10,id:'foreign-motor',name:'电机',kind:'设备'})",Map.of("t",tenant,"other",tenant+1)).consume();
                long base=service.saveBase(null,"融合资料","",10);
                long first=tx.execute(t->((Number)service.upload(base,"首份资料","first.md","驱动电机 —包含部件→ 轴承".getBytes(StandardCharsets.UTF_8),10).get("id")).longValue());
                tx.executeWithoutResult(t->service.publish(first,true));ingestion.process(tenant,first);
                var graph=queries.overview(200);assertEquals(3,graph.nodes().size());assertEquals(2,graph.relations().size());
                var edge=graph.relations().stream().filter(e->Objects.equals(first,e.sourceEvidence().documentId())).findFirst().orElseThrow();assertEquals("motor",edge.source());assertEquals("bearing",edge.target());assertEquals("seed-edge",graph.relations().stream().filter(e->e.sourceEvidence().documentId()==null).findFirst().orElseThrow().id());
                var audit=store.read(scope,"MATCH ()-[r:FazeRelation]->() WHERE r.tenantId=$tenant AND r.ownerId=$owner AND r.documentId=$doc RETURN properties(r) AS r",Map.of("doc",first)).get(0).get("r");
                @SuppressWarnings("unchecked") var evidence=(Map<String,Object>)audit;assertEquals("实体",evidence.get("sourceOriginalKind"));assertEquals("驱动电机",evidence.get("sourceOriginalName"));assertEquals("curated_alias_type",evidence.get("sourceAlignmentMethod"));assertNotNull(evidence.get("chunkHash"));
                tx.executeWithoutResult(t->service.rebuildGraph(first));ingestion.process(tenant,first);assertEquals(2,queries.overview(200).relations().size());
                long second=tx.execute(t->((Number)service.upload(base,"第二来源","second.md","电机 —关联现象→ [故障]检查异响".getBytes(StandardCharsets.UTF_8),10).get("id")).longValue());
                tx.executeWithoutResult(t->service.publish(second,true));ingestion.process(tenant,second);assertEquals(4,queries.overview(200).nodes().size());assertEquals(3,queries.overview(200).relations().size());
                long third=tx.execute(t->((Number)service.upload(base,"独立资料","third.md","[设备]星图仪 —执行→ [工艺]星体扫描".getBytes(StandardCharsets.UTF_8),10).get("id")).longValue());
                tx.executeWithoutResult(t->service.publish(third,true));ingestion.process(tenant,third);
                graph=queries.overview(200);assertEquals(6,graph.nodes().size());var independent=graph.relations().stream().filter(e->Objects.equals(third,e.sourceEvidence().documentId())).findFirst().orElseThrow();assertNotEquals("motor",independent.source());assertNotEquals("bearing",independent.target());assertEquals(4,graph.relations().size());
                tx.executeWithoutResult(t->service.publish(first,false));ingestion.process(tenant,first);assertEquals(3,queries.overview(200).relations().size());
                tx.executeWithoutResult(t->{service.deleteDocument(second);service.deleteDocument(third);});ingestion.process(tenant,second);ingestion.process(tenant,third);
                assertEquals(3,queries.overview(200).nodes().size());assertEquals(1,queries.overview(200).relations().size());assertEquals("原始描述",queries.detail("motor").description());
                assertEquals(2L,session.run("MATCH (n:FazeEntity) WHERE (n.tenantId=$t AND n.ownerId=11) OR (n.tenantId=$other AND n.ownerId=10) RETURN count(n) AS n",Map.of("t",tenant,"other",tenant+1)).single().get("n").asLong());
            }finally{session.run("MATCH (n:FazeEntity) WHERE n.tenantId IN [$t,$other] AND n.ownerId IN [10,11] DETACH DELETE n",Map.of("t",tenant,"other",tenant+1)).consume();}
        }
    }
}
