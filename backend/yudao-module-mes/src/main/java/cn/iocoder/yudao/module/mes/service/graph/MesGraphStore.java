package cn.iocoder.yudao.module.mes.service.graph;

import jakarta.annotation.PreDestroy;
import org.neo4j.driver.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.util.*;

/** Private, server-side connection. No browser receives database configuration. */
@Component
public class MesGraphStore implements AutoCloseable {
    private final boolean enabled;
    private final String uri, username, password, database;
    private Driver driver;
    public MesGraphStore(@Value("${fazemes.graph.enabled:false}") boolean enabled,
            @Value("${fazemes.graph.uri:bolt://127.0.0.1:7688}") String uri,
            @Value("${fazemes.graph.username:neo4j}") String username,
            @Value("${fazemes.graph.password:}") String password,
            @Value("${fazemes.graph.database:neo4j}") String database) {
        this.enabled=enabled;this.uri=uri;this.username=username;this.password=password;this.database=database;
    }
    private synchronized Driver driver() {
        if(!enabled || password.isBlank()) throw new IllegalStateException("Graph not configured");
        if(driver==null) driver=GraphDatabase.driver(uri,AuthTokens.basic(username,password),Config.builder()
            .withConnectionTimeout(3,java.util.concurrent.TimeUnit.SECONDS)
            .withConnectionAcquisitionTimeout(3,java.util.concurrent.TimeUnit.SECONDS)
            .withMaxTransactionRetryTime(0,java.util.concurrent.TimeUnit.SECONDS).withMaxConnectionPoolSize(8).build());
        return driver;
    }
    public List<Map<String,Object>> read(MesKnowledgeGraphService.Scope scope,String query,Map<String,Object> parameters) {
        Map<String,Object> bounded=new HashMap<>(parameters);
        bounded.put("tenant",scope.tenant()); bounded.put("owner",scope.owner());
        try(var session=driver().session(SessionConfig.builder().withDatabase(database).withDefaultAccessMode(AccessMode.READ).build())) {
            return session.executeRead(tx -> tx.run(query,bounded).list(record -> record.asMap()),
                TransactionConfig.builder().withTimeout(Duration.ofSeconds(5)).build());
        }
    }
    @PreDestroy public synchronized void close(){if(driver!=null){driver.close();driver=null;}}
}
