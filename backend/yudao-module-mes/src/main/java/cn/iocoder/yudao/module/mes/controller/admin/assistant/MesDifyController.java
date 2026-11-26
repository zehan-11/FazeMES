package cn.iocoder.yudao.module.mes.controller.admin.assistant;

import cn.iocoder.yudao.framework.apilog.core.annotation.ApiAccessLog;
import cn.iocoder.yudao.framework.common.pojo.CommonResult;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.module.mes.service.assistant.MesDifyWorkflow;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import static cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils.getLoginUserId;

@RestController
@RequestMapping("/mes/assistant/dify")
public class MesDifyController {
    private final MesDifyWorkflow workflow;

    public MesDifyController(MesDifyWorkflow workflow) {
        this.workflow = workflow;
    }

    public record Question(@NotBlank @Size(max = 300) String question) {}

    @PostMapping("/run")
    @PreAuthorize("@ss.hasPermission('mes:assistant:chat') and @ss.hasPermission('mes:assistant:knowledge')")
    @ApiAccessLog(requestEnable = false, responseEnable = false)
    public CommonResult<MesDifyWorkflow.Run> run(@Valid @RequestBody Question body) {
        String user = "mes-" + TenantContextHolder.getTenantId() + "-" + getLoginUserId();
        return CommonResult.success(workflow.run(body.question().strip(), user));
    }
}
