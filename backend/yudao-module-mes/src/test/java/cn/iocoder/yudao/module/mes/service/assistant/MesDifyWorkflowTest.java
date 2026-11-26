package cn.iocoder.yudao.module.mes.service.assistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class MesDifyWorkflowTest {
    private final ObjectMapper json = new ObjectMapper();
    private final MesDifyWorkflow workflow = new MesDifyWorkflow(json, "http://localhost/v1", "");

    private MesDifyWorkflow.Run parse(String events) throws IOException {
        return workflow.readRun(new BufferedReader(new StringReader(events)), "点检问题");
    }

    @Test void replaysExecutedNodesOnceInStartOrderAndProjectsOnlyPublicFields() throws IOException {
        var run = parse("""
                event: ping

                data: {"event":"workflow_started","workflow_run_id":"first"}
                data: {"event":"node_started","workflow_run_id":"first","data":{"id":"search","node_type":"knowledge-retrieval","title":"检索"}}
                data: {"event":"node_finished","workflow_run_id":"first","data":{"id":"search","node_type":"knowledge-retrieval","title":"检索","status":"succeeded","outputs":{"result":[{"metadata":{"document_name":"手册"},"content":"点检记录"}]}}}
                data: {"event":"node_finished","workflow_run_id":"first","data":{"id":"search","node_type":"knowledge-retrieval","title":"检索","status":"succeeded","outputs":{"result":[{"metadata":{"document_name":"手册"},"content":"点检记录"}]}}}
                data: {"event":"node_started","workflow_run_id":"first","data":{"id":"miss","node_type":"template-transform","title":"未命中"}}
                data: {"event":"node_finished","workflow_run_id":"first","data":{"id":"miss","node_type":"template-transform","title":"未命中","status":"skipped"}}
                data: {"event":"node_finished","workflow_run_id":"first","data":{"id":"model","node_type":"http-request","title":"调用模型","status":"succeeded","elapsed_time":1.7,"inputs":{"token":"private-input"},"outputs":{"headers":"private-header","body":"private-prompt","status_code":200}}}
                data: {"event":"workflow_finished","workflow_run_id":"first","data":{"status":"succeeded","outputs":{"answer":"记录设备编号"}}}
                """);
        assertEquals("first", run.runId());
        assertEquals("记录设备编号", run.answer());
        assertEquals(List.of("search", "model"), run.steps().stream().map(MesDifyWorkflow.Step::id).toList());
        assertEquals(List.of(new MesDifyWorkflow.Source("手册", "点检记录")), run.sources());
        assertEquals(1.7, run.steps().get(1).seconds());
        assertEquals("HTTP 200", run.steps().get(1).detail());
        assertFalse(json.writeValueAsString(run).contains("private-"));
    }

    @Test void rejectsTruncatedOrMixedRuns() {
        String first = "data: {\"event\":\"workflow_started\",\"workflow_run_id\":\"first\"}\n";
        assertThrows(IOException.class, () -> parse(first));
        assertThrows(IOException.class, () -> parse(first +
                "data: {\"event\":\"workflow_finished\",\"workflow_run_id\":\"other\",\"data\":{\"status\":\"failed\"}}"));
    }

    @Test void returnsFailedExecutionWithoutInventingAnAnswer() throws IOException {
        var run = parse("""
                data: {"event":"node_finished","workflow_run_id":"run","data":{"id":"model","node_type":"http-request","title":"调用模型","status":"failed"}}
                data: {"event":"workflow_finished","workflow_run_id":"run","data":{"status":"failed","error":"upstream failed"}}
                """);
        assertEquals("failed", run.status());
        assertEquals("failed", run.steps().get(0).status());
        assertEquals("", run.answer());
    }
}
