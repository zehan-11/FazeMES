package cn.iocoder.yudao.module.mes.service.graph;

import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.neo4j.driver.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Explicit opt-in only. UUID-scoped fixtures are cleaned up without touching project content. */
@EnabledIfEnvironmentVariable(named="FAZEMES_GRAPH_TEST_CONFIG",matches=".+")
class MesKnowledgeGraphLiveTest {
    void actor(long tenant,long owner){TenantContextHolder.setTenantId(tenant);SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(owner).setTenantId(tenant).setUserType(2),new MockHttpServletRequest());}
    @Test void realNeo4jQueriesRespectUserTenantAndRelationshipScopes() throws Exception {
        var config=new ObjectMapper().readTree(Files.readString(Path.of(System.getenv("FAZEMES_GRAPH_TEST_CONFIG"))));
        String uri=config.path("uri").asText(),user=config.path("username").asText(),password=config.path("password").asText(),database=config.path("database").asText();
        String prefix="graph-test-"+UUID.randomUUID();
        try(var driver=GraphDatabase.driver(uri,AuthTokens.basic(user,password));var session=driver.session(SessionConfig.forDatabase(database));var store=new MesGraphStore(true,uri,user,password,database)){
            try {
                session.run("CREATE (a:FazeEntity {tenantId:900001,ownerId:10,id:$a,name:'test_motor',kind:'部件'}), (b:FazeEntity {tenantId:900001,ownerId:10,id:$b,name:'test_bearing',kind:'部件'}), (c:FazeEntity {tenantId:900001,ownerId:11,id:$c,name:'test_private',kind:'部件'}), (d:FazeEntity {tenantId:900002,ownerId:10,id:$d,name:'test_other_tenant',kind:'部件'}) CREATE (a)-[:FazeRelation {tenantId:900001,ownerId:10,id:$r,type:'包含部件',sourceTitle:'test',sourceSection:'1',sourceExcerpt:'a to b'}]->(b) CREATE (a)-[:FazeRelation {tenantId:900001,ownerId:11,id:$hidden,type:'hidden'}]->(b) CREATE (a)-[:FazeRelation {tenantId:900001,ownerId:10,id:$cross,type:'cross'}]->(c)",Map.of("a",prefix+"a","b",prefix+"b","c",prefix+"c","d",prefix+"d","r",prefix+"r","hidden",prefix+"hidden","cross",prefix+"cross")).consume();
                var service=new MesKnowledgeGraphService(store);actor(900001,10);
                var graph=service.overview(200);assertEquals(2,graph.nodes().size());assertEquals(1,graph.relations().size());
                assertEquals(prefix+"a",graph.relations().get(0).source());assertEquals(prefix+"b",graph.relations().get(0).target());
                assertEquals(2,service.neighbors(prefix+"a",20).nodes().size());assertEquals(1,service.search("motor",20).items().size());
                assertThrows(RuntimeException.class,()->service.detail(prefix+"c"));assertThrows(RuntimeException.class,()->service.detail(prefix+"d"));
                actor(900001,11);assertEquals(1,service.overview(200).nodes().size());assertTrue(service.overview(200).relations().isEmpty());
                actor(900002,10);assertEquals(1,service.overview(200).nodes().size());
                actor(900003,10);assertTrue(service.overview(200).nodes().isEmpty());
            } finally {
                session.run("MATCH (n:FazeEntity) WHERE n.id STARTS WITH $prefix AND n.tenantId IN [900001,900002] DETACH DELETE n",Map.of("prefix",prefix)).consume();
                TenantContextHolder.clear();SecurityContextHolder.clearContext();
            }
        }
    }
}
