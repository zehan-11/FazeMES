package cn.iocoder.yudao.module.mes.service.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.io.input.BoundedInputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class MesDifyWorkflow {

    public record Source(String title, String text) {}
    public record Step(String id, String type, String title, String status, Double seconds, String detail) {}
    public record Run(String runId, String status, String question, String answer, List<Source> sources, List<Step> steps) {}

    private static final Duration RUN_TIMEOUT = Duration.ofSeconds(180);
    private static final int MAX_STREAM_BYTES = 8 * 1024 * 1024;
    private final ObjectMapper mapper;
    private final String endpoint;
    private final String apiKey;

    public MesDifyWorkflow(ObjectMapper mapper,
                           @Value("${mes.dify.base-url:http://127.0.0.1:18780/v1}") String baseUrl,
                           @Value("${mes.dify.api-key:}") String apiKey) {
        this.mapper = mapper;
        this.endpoint = baseUrl.replaceAll("/+$", "") + "/workflows/run";
        this.apiKey = apiKey;
    }

    public Run run(String question, String user) {
        if (apiKey.isBlank()) throw MesAssistantErrors.model("后端尚未配置 Dify 工作流密钥");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(endpoint).toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout((int) RUN_TIMEOUT.toMillis());
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "text/event-stream");
            byte[] body = mapper.writeValueAsBytes(Map.of("inputs", Map.of("question", question),
                    "response_mode", "streaming", "user", user));
            connection.setFixedLengthStreamingMode(body.length);
            try (var out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            if (status != 200) throw MesAssistantErrors.model("Dify 请求失败（HTTP " + status + "）");
            try (var bounded = BoundedInputStream.builder().setInputStream(connection.getInputStream())
                    .setMaxCount(MAX_STREAM_BYTES).get();
                 var reader = new BufferedReader(new InputStreamReader(bounded, StandardCharsets.UTF_8))) {
                return readRun(reader, question);
            }
        } catch (SocketTimeoutException ex) {
            throw MesAssistantErrors.model("等待 Dify 超时，请在工作室查看本次运行状态");
        } catch (IOException ex) {
            throw MesAssistantErrors.model("未收到完整的 Dify 运行记录，请检查工作室与本机服务");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    Run readRun(BufferedReader reader, String question) throws IOException {
        Map<String, Step> steps = new LinkedHashMap<>();
        Map<String, List<Source>> retrievals = new LinkedHashMap<>();
        String runId = null;
        long started = System.nanoTime();
        for (String line; (line = reader.readLine()) != null;) {
            if (System.nanoTime() - started > RUN_TIMEOUT.toNanos()) throw new SocketTimeoutException();
            if (!line.startsWith("data:")) continue;
            JsonNode event = mapper.readTree(line.substring(5).strip());
            String kind = event.path("event").asText();
            if ("error".equals(kind)) throw MesAssistantErrors.model("Dify 工作流执行出错，请查看工作室日志");
            if (!"workflow_started".equals(kind) && !"workflow_finished".equals(kind)
                    && !"node_started".equals(kind) && !"node_finished".equals(kind)) continue;
            String id = event.path("workflow_run_id").asText("");
            if (id.isBlank() || (runId != null && !runId.equals(id))) throw new IOException("Unexpected workflow run ID");
            runId = id;
            JsonNode data = event.path("data");
            if ("workflow_started".equals(kind)) continue;
            if ("workflow_finished".equals(kind)) {
                String status = data.path("status").asText("");
                String answer = data.path("outputs").path("answer").asText("");
                if (status.isBlank() || ("succeeded".equals(status) && (steps.isEmpty() || answer.isBlank())))
                    throw new IOException("Missing workflow result");
                var sources = retrievals.values().stream().flatMap(List::stream).toList();
                return new Run(id, status, question, answer, sources, List.copyOf(steps.values()));
            }
            String executionId = data.path("id").asText("");
            if (executionId.isBlank()) throw new IOException("Missing node execution ID");
            String status = data.path("status").asText("started");
            if ("skipped".equals(status)) {
                steps.remove(executionId);
                retrievals.remove(executionId);
                continue;
            }
            JsonNode outputs = data.path("outputs");
            String type = data.path("node_type").asText();
            if ("knowledge-retrieval".equals(type) && outputs.path("result").isArray()) {
                List<Source> sources = new ArrayList<>();
                for (JsonNode item : outputs.path("result")) {
                    sources.add(new Source(item.path("metadata").path("document_name").asText(item.path("title").asText()),
                            item.path("content").asText()));
                }
                retrievals.put(executionId, sources);
            }
            // Project public fields only. HTTP headers, prompts and internal node inputs stay on the server.
            String detail = switch (type) {
                case "if-else" -> outputs.path("selected_case_id").asText("");
                case "http-request" -> outputs.has("status_code") ? "HTTP " + outputs.path("status_code").asText() : "";
                case "template-transform" -> outputs.path("output").asText("");
                case "code", "end" -> outputs.path("answer").asText("");
                default -> "";
            };
            Double seconds = data.path("elapsed_time").isNumber() ? data.path("elapsed_time").doubleValue() : null;
            // A started/finished pair has one execution ID; different executions may have the same title or node type.
            steps.put(executionId, new Step(executionId, type, data.path("title").asText(), status, seconds, detail));
        }
        throw new IOException("Missing terminal workflow event");
    }
}
