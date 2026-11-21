package cn.iocoder.yudao.module.mes.service.graph;

import jakarta.annotation.PreDestroy;
import org.neo4j.driver.*;
import org.neo4j.driver.exceptions.DatabaseException;
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
            // Discard idle Bolt connections left behind by a local Neo4j restart.
            .withConnectionLivenessCheckTimeout(1,java.util.concurrent.TimeUnit.SECONDS)
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
    public static String vectorIndexName(String spaceId) {
        if (spaceId == null || !spaceId.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid vector space");
        return "fazemes_vector_" + spaceId;
    }
    private synchronized void vectorSchema() {
        try (var session = driver().session(SessionConfig.forDatabase(database))) {
            session.run("CREATE CONSTRAINT fazemes_vector_document IF NOT EXISTS FOR (n:FazeVectorDocument) REQUIRE (n.tenantId,n.documentId) IS UNIQUE").consume();
            session.run("CREATE CONSTRAINT fazemes_vector_chunk IF NOT EXISTS FOR (n:FazeVectorChunk) REQUIRE (n.tenantId,n.documentId,n.chunkId) IS UNIQUE").consume();
        }
    }
    /** Separate labels keep vector chunks out of the entity graph. Index identifiers are server-generated hex only. */
    public void ensureVectorIndex(String spaceId, int dimensions) {
        String name = vectorIndexName(spaceId), label = "FazeVector_" + spaceId;
        if (dimensions < 1 || dimensions > 4096) throw new IllegalArgumentException("Invalid vector dimensions");
        vectorSchema();
        try (var session = driver().session(SessionConfig.forDatabase(database))) {
            session.run("CYPHER 25 CREATE VECTOR INDEX " + name + " IF NOT EXISTS FOR (n:" + label + ") ON n.embedding "
                    + "WITH [n.tenantId,n.knowledgeBaseId,n.documentId,n.documentVersion,n.ownerId,n.generation] "
                    + "OPTIONS {indexConfig: {`vector.dimensions`:$dimensions,`vector.similarity_function`:'cosine'}}",
                    Map.of("dimensions", dimensions)).consume();
            session.run("CALL db.awaitIndex($name,5)", Map.of("name", name)).consume();
            var index = session.run("SHOW INDEXES YIELD name,type,state,labelsOrTypes,properties,options WHERE name=$name RETURN *", Map.of("name", name)).single();
            var config = index.get("options").asMap().get("indexConfig");
            if (!"VECTOR".equals(index.get("type").asString()) || !"ONLINE".equals(index.get("state").asString())
                    || !index.get("labelsOrTypes").asList().equals(List.of(label))
                    || !(config instanceof Map<?,?> values) || !Objects.equals(((Number)values.get("vector.dimensions")).intValue(), dimensions))
                throw new IllegalStateException("Vector index schema mismatch");
        }
    }
    /** MySQL callers serialize final delivery; the retained Neo4j generation additionally fences late deliveries. */
    public boolean replaceVectorDocument(MesKnowledgeGraphService.Scope scope,long documentId,int version,long generation,
            long knowledgeBaseId,String title,String spaceId,String model,int dimensions,List<Map<String,Object>> chunks,boolean published) {
        if (generation < 1 || version < 1 || (!published && !chunks.isEmpty())) throw new IllegalArgumentException("Invalid vector document");
        if (published) vectorIndexName(spaceId);
        vectorSchema();
        var p = new HashMap<String,Object>();
        p.put("tenant",scope.tenant());p.put("owner",scope.owner());p.put("document",documentId);p.put("version",version);
        p.put("generation",generation);p.put("base",knowledgeBaseId);p.put("title",title);p.put("space",spaceId);
        p.put("model",model);p.put("dimensions",dimensions);p.put("chunks",chunks);p.put("published",published);
        try (var session = driver().session(SessionConfig.forDatabase(database))) {
            return session.executeWrite(tx -> {
                var accepted = tx.run("MERGE (d:FazeVectorDocument {tenantId:$tenant,documentId:$document}) "
                        + "SET d.fence=coalesce(d.fence,0)+1 WITH d WHERE coalesce(d.generation,0)<=$generation "
                        + "SET d.generation=$generation,d.ownerId=$owner,d.knowledgeBaseId=$base,d.documentVersion=$version,"
                        + "d.spaceId=$space,d.model=$model,d.dimensions=$dimensions,d.active=$published RETURN d.generation",p);
                if (!accepted.hasNext()) return false;
                accepted.consume();
                tx.run("MATCH (n:FazeVectorChunk {tenantId:$tenant,documentId:$document}) DELETE n",p).consume();
                if (published) tx.run("UNWIND $chunks AS c CREATE (n:FazeVectorChunk:FazeVector_" + spaceId + ") "
                        + "SET n=c,n.tenantId=$tenant,n.ownerId=$owner,n.knowledgeBaseId=$base,n.documentId=$document,"
                        + "n.documentVersion=$version,n.generation=$generation,n.spaceId=$space,n.model=$model,n.dimensions=$dimensions,n.title=$title",p).consume();
                return true;
            },TransactionConfig.builder().withTimeout(Duration.ofSeconds(15)).build());
        }
    }
    private static final String VECTOR_SOURCE = "n{.tenantId,.ownerId,.knowledgeBaseId,.documentId,.documentVersion,.generation,.spaceId,.model,.dimensions,.chunkId,.chunkIndex,.chunkHash,.heading,.text,.pageNumber,.startOffset,.endOffset}";
    private static final String VECTOR_CHECKPOINT = "d{.tenantId,.ownerId,.knowledgeBaseId,.documentId,.documentVersion,.generation,.spaceId,.model,.dimensions,.active}";
    /** Authorization-derived document IDs filter inside the ANN index, before its top-k selection. */
    public List<Map<String,Object>> searchVectorChunks(long tenant,String spaceId,List<Long> documents,List<Double> vector,int limit) {
        String index=vectorIndexName(spaceId);
        if(tenant<=0 || documents==null || documents.isEmpty() || documents.size()>500 || documents.stream().anyMatch(id->id==null||id<=0)
                || vector==null || vector.isEmpty() || vector.size()>4096 || limit<1 || limit>50)throw new IllegalArgumentException("Invalid bounded vector search");
        String query="CYPHER 25 MATCH (n:FazeVector_"+spaceId+") SEARCH n IN (VECTOR INDEX "+index+" FOR $vector "
                +"WHERE n.tenantId=$tenant AND n.documentId IN $documents LIMIT $limit) SCORE AS score "
                +"WITH n,score OPTIONAL MATCH (d:FazeVectorDocument {tenantId:$tenant,documentId:n.documentId}) "
                +"RETURN "+VECTOR_SOURCE+" AS chunk,"+VECTOR_CHECKPOINT+" AS checkpoint,score ORDER BY score DESC,n.chunkId LIMIT $limit";
        var scope = new MesKnowledgeGraphService.Scope(tenant, 0);
        Map<String,Object> parameters = Map.of("documents", documents, "vector", vector,
                "limit", limit, "space", spaceId);
        try {
            return read(scope, query, parameters);
        } catch (DatabaseException failure) {
            if (!"Neo.DatabaseError.Statement.ExecutionFailed".equals(failure.code())) throw failure;
            // A filtered ANN query can fail inside Neo4j during index recovery. Reuse the same query vector.
            return read(scope, """
                    MATCH (d:FazeVectorDocument {tenantId:$tenant, active:true, spaceId:$space})
                    WHERE d.documentId IN $documents
                    MATCH (n:FazeVectorChunk {tenantId:$tenant, documentId:d.documentId, spaceId:$space})
                    WHERE n.generation=d.generation AND n.documentVersion=d.documentVersion
                      AND n.embedding IS NOT NULL AND size(n.embedding)=size($vector)
                    WITH n,d LIMIT 20000
                    WITH n,d,vector.similarity.cosine(n.embedding,$vector) AS score
                    RETURN %s AS chunk,%s AS checkpoint,score ORDER BY score DESC,n.chunkId LIMIT $limit
                    """.formatted(VECTOR_SOURCE, VECTOR_CHECKPOINT), parameters);
        }
    }
    /** Revalidates selected vector sources without embedding the question or repeating an ANN search. */
    public List<Map<String,Object>> vectorSources(long tenant,String spaceId,List<Long> documents,List<Long> chunks) {
        vectorIndexName(spaceId);
        if(tenant<=0 || documents==null || documents.isEmpty() || documents.size()>10 || chunks==null || chunks.isEmpty() || chunks.size()>10)throw new IllegalArgumentException("Invalid vector proof scope");
        String query="MATCH (n:FazeVector_"+spaceId+") WHERE n.tenantId=$tenant AND n.documentId IN $documents AND n.chunkId IN $chunks "
                +"OPTIONAL MATCH (d:FazeVectorDocument {tenantId:$tenant,documentId:n.documentId}) RETURN "+VECTOR_SOURCE+" AS chunk,"+VECTOR_CHECKPOINT+" AS checkpoint";
        return read(new MesKnowledgeGraphService.Scope(tenant,0),query,Map.of("documents",documents,"chunks",chunks));
    }
    @PreDestroy public synchronized void close(){if(driver!=null){driver.close();driver=null;}}
}
