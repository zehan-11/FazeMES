package cn.iocoder.yudao.module.mes.controller.admin.assistant;

import cn.iocoder.yudao.framework.apilog.core.annotation.ApiAccessLog;
import cn.iocoder.yudao.framework.common.pojo.CommonResult;
import cn.iocoder.yudao.module.mes.service.assistant.MesEvidenceService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/mes/assistant/evidence")
public class MesEvidenceController {
    private final MesEvidenceService service;
    public MesEvidenceController(MesEvidenceService service){this.service=service;}
    public record Query(String query,List<Long> knowledgeBaseIds,List<String> sources,Integer limit) {}
    @PostMapping("/search") @PreAuthorize("@ss.hasAnyPermissions('mes:assistant:knowledge','mes:assistant:manage')")
    @ApiAccessLog(requestEnable=false,responseEnable=false)
    public CommonResult<?> search(@RequestBody Query query){return CommonResult.success(service.search(query.query(),query.knowledgeBaseIds(),query.sources(),query.limit()==null?5:query.limit()));}
}
