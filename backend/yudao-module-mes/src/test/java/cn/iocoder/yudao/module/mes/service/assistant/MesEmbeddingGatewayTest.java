package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.common.exception.ServiceException;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class MesEmbeddingGatewayTest extends MesAssistantTestDatabase {
    private void connect(String base) {
        models.save(new MesAssistantModelGateway.Settings("openai", base, "chat-test", "test-only-key", false, .2, 1024, true), 10);
        models.saveEmbeddingSettings(new MesAssistantModelGateway.EmbeddingSettings("text-embedding-3-small", 3, true), 10);
    }
    @Test void configurationIsIndependentTenantScopedAndDoesNotDuplicateSecrets() {
        assertEquals(false, models.embeddingSettings().get("configured"));
        assertThrows(ServiceException.class, () -> models.saveEmbeddingSettings(new MesAssistantModelGateway.EmbeddingSettings("text-embedding-3-small", 1536, true), 10));
        connect("http://127.0.0.1:11434/v1");
        var chat = models.settings();
        var embedding = models.embeddingSettings();
        assertEquals(true, embedding.get("configured"));
        assertFalse(embedding.toString().contains("test-only-key"));
        models.saveEmbeddingSettings(new MesAssistantModelGateway.EmbeddingSettings("text-embedding-3-large", 128, true), 10);
        assertEquals(chat, models.settings());
        TenantContextHolder.setTenantId(2L);
        assertEquals(false, models.embeddingSettings().get("configured"));
        assertEquals(1536, models.embeddingSettings().get("dimensions"));
        TenantContextHolder.setTenantId(1L);
        models.reset();
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM mes_assistant_embedding_config", Integer.class));
    }
    @Test void realHttpProtocolReusesSavedKeyRestoresBatchOrderAndReturnsOnlyTestMetadata() throws Exception {
        var authorization = new AtomicReference<String>(); var payload = new AtomicReference<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/embeddings", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            payload.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            int count = json.readTree(payload.get()).path("input").size();
            List<Map<String,Object>> data = new ArrayList<>();
            for (int i=count-1; i>=0; i--) data.add(Map.of("index", i, "embedding", List.of((double)i+1, .2, -.3)));
            byte[] body=json.writeValueAsBytes(Map.of("data",data,"model","text-embedding-3-small","usage",Map.of("prompt_tokens",12)));
            exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();
        });server.start();
        try {
            connect("http://127.0.0.1:"+server.getAddress().getPort()+"/v1");
            var result=models.embed(List.of("设备运行", "设备停机"));
            assertEquals("Bearer test-only-key", authorization.get());
            var request=json.readTree(payload.get());
            assertEquals("text-embedding-3-small",request.path("model").asText());
            assertEquals(3,request.path("dimensions").asInt());assertEquals("float",request.path("encoding_format").asText());
            assertFalse(request.has("messages"));assertFalse(payload.get().contains("test-only-key"));
            assertEquals(List.of(1.0,.2,-.3),result.vectors().get(0));assertEquals(2.0,result.vectors().get(1).get(0));
            assertEquals(12,result.inputTokens());assertEquals(64,result.spaceId().length());
            var test=models.testEmbeddingConnection();
            assertEquals(true,test.get("connected"));assertEquals(3,test.get("dimensions"));assertFalse(test.containsKey("vectors"));
            assertTrue(payload.get().contains("设备点检"));
            models.saveEmbeddingSettings(new MesAssistantModelGateway.EmbeddingSettings("other-model",3,true),10);
            assertNotEquals(result.spaceId(),models.embed(List.of("测试")).spaceId());
        } finally {server.stop(0);}
    }
    @Test void rejectsInvalidInputsDisabledConfigurationAndCallsInsideTransactionsBeforeHttp() throws Exception {
        var calls=new AtomicInteger();
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/embeddings",exchange->{calls.incrementAndGet();exchange.sendResponseHeaders(500,-1);exchange.close();});server.start();
        try {
            connect("http://127.0.0.1:"+server.getAddress().getPort()+"/v1");
            for(List<String> invalid : List.of(List.<String>of(),List.of(" "),List.of("x".repeat(8193)),Collections.nCopies(17,"x"),Collections.nCopies(9,"x".repeat(8192))))
                assertThrows(ServiceException.class,()->models.embed(invalid));
            assertThrows(ServiceException.class,()->models.embed(null));
            assertThrows(ServiceException.class,()->models.embed(Arrays.asList("valid",null)));
            new TransactionTemplate(new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource())))
                .executeWithoutResult(status->assertThrows(ServiceException.class,()->models.embed(List.of("test"))));
            models.saveEmbeddingSettings(new MesAssistantModelGateway.EmbeddingSettings("text-embedding-3-small",3,false),10);
            assertThrows(ServiceException.class,models::testEmbeddingConnection);assertEquals(0,calls.get());
        } finally {server.stop(0);}
    }
    @Test void rejectsMalformedVectorsMissingDuplicateOrOutOfRangeIndicesAndNonFiniteValues() throws Exception {
        for(String data : List.of("[]", "[{\"index\":0,\"embedding\":[1]}]", "[{\"index\":1,\"embedding\":[1,2]}]",
                "[{\"index\":0.5,\"embedding\":[1,2]}]", "[{\"embedding\":[1,2]}]",
                "[{\"index\":0,\"embedding\":[0,0]}]", "[{\"index\":0,\"embedding\":[\"NaN\",1]}]",
                "[{\"index\":0,\"embedding\":[1e308,1]}]")) {
            var response=json.readTree("{\"data\":"+data+"}");
            assertThrows(ServiceException.class,()->MesAssistantModelGateway.decodeEmbeddings(response,1,2),data);
        }
        var duplicate=json.readTree("{\"data\":[{\"index\":0,\"embedding\":[1,2]},{\"index\":0,\"embedding\":[3,4]}]}");
        assertThrows(ServiceException.class,()->MesAssistantModelGateway.decodeEmbeddings(duplicate,2,2));
    }
    @Test void rejectsInvalidEmbeddingSettingsAndOllamaConnectionWithoutChangingChat() {
        connect("http://127.0.0.1:11434");var original=models.embeddingSettings();
        for(var invalid : List.of(new MesAssistantModelGateway.EmbeddingSettings("",3,true),
                new MesAssistantModelGateway.EmbeddingSettings("bad\nmodel",3,true),
                new MesAssistantModelGateway.EmbeddingSettings("text-embedding-3-small",1537,true),
                new MesAssistantModelGateway.EmbeddingSettings("text-embedding-3-large",3073,true),
                new MesAssistantModelGateway.EmbeddingSettings("model",null,true),
                new MesAssistantModelGateway.EmbeddingSettings("model",0,true)))
            assertThrows(ServiceException.class,()->models.saveEmbeddingSettings(invalid,10));
        assertThrows(ServiceException.class,()->models.saveEmbeddingSettings(null,10));assertEquals(original,models.embeddingSettings());
        models.save(new MesAssistantModelGateway.Settings("ollama","http://127.0.0.1:11434","local","",true,.2,1024,true),10);
        assertEquals(false,models.embeddingSettings().get("connectionReady"));
        assertThrows(ServiceException.class,models::testEmbeddingConnection);
    }
    @Test void providerErrorsDoNotLeakResponseBodyOrSecret() throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/embeddings",exchange->{byte[] body="test-only-key private response".getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(403,body.length);exchange.getResponseBody().write(body);exchange.close();});server.start();
        try {
            connect("http://127.0.0.1:"+server.getAddress().getPort()+"/v1");
            var failure=assertThrows(ServiceException.class,models::testEmbeddingConnection);
            assertTrue(failure.getMessage().contains("403"));assertFalse(failure.getMessage().contains("test-only-key"));
        } finally {server.stop(0);}
    }
}
