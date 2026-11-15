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
    private static final String CATALOG="MATCH (n:FazeEntity) WHERE n.tenantId=$tenant AND n.ownerId=$owner RETURN n.id AS id,n.name AS name,n.kind AS kind,n.origin AS origin,n.aliases AS aliases ORDER BY n.id LIMIT 10001";
    private boolean documentSchemaReady;
    private synchronized void documentSchema(){
        if(documentSchemaReady)return;
        try(var session=driver().session(SessionConfig.forDatabase(database))){
            session.run("CREATE CONSTRAINT fazemes_entity_scope IF NOT EXISTS FOR (n:FazeEntity) REQUIRE (n.tenantId,n.ownerId,n.id) IS UNIQUE").consume();
            session.run("CREATE CONSTRAINT fazemes_relation_scope IF NOT EXISTS FOR ()-[r:FazeRelation]-() REQUIRE (r.tenantId,r.ownerId,r.id) IS UNIQUE").consume();
        }
        documentSchemaReady=true;
    }
    /** Atomic, idempotent replacement of one document's contributions, preserving other sources. */
    public void replaceDocument(MesKnowledgeGraphService.Scope scope,long documentId,int version,List<Map<String,Object>> facts){
        documentSchema();
        Map<String,Object> p=new HashMap<>();p.put("tenant",scope.tenant());p.put("owner",scope.owner());p.put("document",documentId);p.put("version",version);p.put("facts",facts);
        try(var session=driver().session(SessionConfig.builder().withDatabase(database).withDefaultAccessMode(AccessMode.WRITE).build())){
            session.executeWrite(tx->{
                var catalog=tx.run(CATALOG,p).list(record->record.asMap());
                if(catalog.size()>10000)throw new IllegalStateException("Entity alignment catalog exceeds capacity");
                p.put("facts",MesEntityAlignment.align(facts,catalog));
                tx.run("MATCH (a:FazeEntity)-[r:FazeRelation]->(b:FazeEntity) WHERE r.tenantId=$tenant AND r.ownerId=$owner AND r.documentId=$document AND a.tenantId=$tenant AND a.ownerId=$owner AND b.tenantId=$tenant AND b.ownerId=$owner DELETE r",p).consume();
                tx.run("""
                    UNWIND $facts AS f
                    MERGE (a:FazeEntity {tenantId:$tenant,ownerId:$owner,id:f.sourceId})
                    ON CREATE SET a.name=f.sourceName,a.kind=f.sourceKind,a.description='',a.origin='DOCUMENT'
                    MERGE (b:FazeEntity {tenantId:$tenant,ownerId:$owner,id:f.targetId})
                    ON CREATE SET b.name=f.targetName,b.kind=f.targetKind,b.description='',b.origin='DOCUMENT'
                    MERGE (a)-[r:FazeRelation {tenantId:$tenant,ownerId:$owner,id:f.relationId}]->(b)
                    SET r.type=f.relation,r.sourceTitle=f.sourceTitle,r.sourceSection=f.sourceSection,r.sourceExcerpt=f.sourceExcerpt,
                        r.knowledgeBaseId=f.knowledgeBaseId,r.documentId=$document,r.documentVersion=$version,
                        r.chunkId=f.chunkId,r.chunkHash=f.chunkHash,r.pageNumber=f.pageNumber,
                        r.startOffset=f.startOffset,r.endOffset=f.endOffset,r.extractionMethod=f.extractionMethod,
                        r.sourceOriginalName=f.sourceOriginalName,r.sourceOriginalKind=f.sourceOriginalKind,
                        r.sourceResolvedKind=f.sourceKind,r.targetResolvedKind=f.targetKind,
                        r.targetOriginalName=f.targetOriginalName,r.targetOriginalKind=f.targetOriginalKind,
                        r.sourceTypingMethod=f.sourceTypingMethod,r.targetTypingMethod=f.targetTypingMethod,
                        r.sourceAlignmentMethod=f.sourceAlignmentMethod,r.targetAlignmentMethod=f.targetAlignmentMethod
                    """,p).consume();
                tx.run("MATCH (n:FazeEntity) WHERE n.tenantId=$tenant AND n.ownerId=$owner AND n.origin='DOCUMENT' AND NOT (n)--() DELETE n",p).consume();
                return null;
            },TransactionConfig.builder().withTimeout(Duration.ofSeconds(10)).build());
        }
    }
    @PreDestroy public synchronized void close(){if(driver!=null){driver.close();driver=null;}}
}
