package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.MesGraphStore;
import cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.neo4j.driver.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="FAZEMES_GRAPH_TEST_CONFIG",matches=".+")
class MesDocumentVectorStoreLiveTest {
    @Test void realVectorIndexStoresProvenanceAndFencesObsoleteDocumentsWithoutChangingEntityGraph() throws Exception {
        var c=new ObjectMapper().readTree(Files.readString(Path.of(System.getenv("FAZEMES_GRAPH_TEST_CONFIG"))));
        String uri=c.path("uri").asText(),user=c.path("username").asText(),password=c.path("password").asText(),database=c.path("database").asText();
        long tenant=70_000_000L+new java.security.SecureRandom().nextInt(1_000_000);
        String space=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");
        String index=MesGraphStore.vectorIndexName(space);
        try(var store=new MesGraphStore(true,uri,user,password,database);var driver=GraphDatabase.driver(uri,AuthTokens.basic(user,password));var session=driver.session(SessionConfig.forDatabase(database))) {
            try {
                session.run("CREATE (:FazeEntity {tenantId:$t,ownerId:10,id:'vector-live-original',name:'原图节点',kind:'设备'})",Map.of("t",tenant)).consume();
                store.ensureVectorIndex(space,3);
                var scope=new MesKnowledgeGraphService.Scope(tenant,10);
                var chunk=Map.<String,Object>of("chunkId",100L,"chunkIndex",0,"heading","测试段","text","fixture","chunkHash","1".repeat(64),"startOffset",0,"endOffset",7,"embedding",List.of(1.0,.2,.3));
                assertTrue(store.replaceVectorDocument(scope,1,1,1,10,"测试来源",space,"test-model",3,List.of(chunk),true));
                assertTrue(store.replaceVectorDocument(scope,2,1,1,11,"独立文件",space,"test-model",3,List.of(chunk),true));
                var row=session.run("MATCH (n:FazeVectorChunk {tenantId:$t,documentId:1}) RETURN n.documentVersion AS version,n.chunkHash AS hash,n.knowledgeBaseId AS base,size(n.embedding) AS dimensions,n.startOffset AS start,n.endOffset AS end",Map.of("t",tenant)).single();
                assertEquals(1,row.get("version").asInt());assertEquals("1".repeat(64),row.get("hash").asString());assertEquals(10,row.get("base").asInt());assertEquals(3,row.get("dimensions").asInt());assertEquals(0,row.get("start").asInt());assertEquals(7,row.get("end").asInt());
                var hits=session.run("CALL db.index.vector.queryNodes($index,5,$query) YIELD node,score WHERE node.tenantId=$t RETURN node.documentId AS document,score",Map.of("index",index,"query",List.of(1.0,.2,.3),"t",tenant)).list();
                assertEquals(2,hits.size());assertTrue(hits.stream().allMatch(h->h.get("score").asDouble()>.99));
                assertTrue(store.replaceVectorDocument(scope,1,2,2,10,"新版来源",space,"test-model",3,List.of(chunk),true));
                assertFalse(store.replaceVectorDocument(scope,1,1,1,10,"旧任务",space,"test-model",3,List.of(chunk),true));
                assertEquals(2,session.run("MATCH (n:FazeVectorChunk {tenantId:$t,documentId:1}) RETURN n.documentVersion AS v",Map.of("t",tenant)).single().get("v").asInt());
                assertTrue(store.replaceVectorDocument(scope,1,2,3,10,"新版来源","","",0,List.of(),false));
                assertFalse(store.replaceVectorDocument(scope,1,2,2,10,"迟到任务",space,"test-model",3,List.of(chunk),true));
                assertEquals(1,session.run("MATCH (n:FazeVectorChunk {tenantId:$t}) RETURN count(n) AS n",Map.of("t",tenant)).single().get("n").asInt());
                assertEquals(1,session.run("MATCH (n:FazeEntity {tenantId:$t}) RETURN count(n) AS n",Map.of("t",tenant)).single().get("n").asInt());
            } finally {
                session.run("MATCH (n) WHERE n.tenantId=$t AND (n:FazeVectorChunk OR n:FazeVectorDocument OR n:FazeEntity) DETACH DELETE n",Map.of("t",tenant)).consume();
                session.run("DROP INDEX "+index+" IF EXISTS").consume();
            }
        }
    }
}
