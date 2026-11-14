package cn.iocoder.yudao.module.mes.controller.admin.graph;

import cn.iocoder.yudao.framework.apilog.core.annotation.ApiAccessLog;
import cn.iocoder.yudao.framework.common.pojo.CommonResult;
import cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import static cn.iocoder.yudao.framework.common.pojo.CommonResult.success;

@RestController
@RequestMapping("/mes/knowledge-graph")
@PreAuthorize("@ss.hasAnyPermissions('mes:assistant:knowledge','mes:assistant:manage')")
public class MesKnowledgeGraphController {
    private final MesKnowledgeGraphService service;
    public MesKnowledgeGraphController(MesKnowledgeGraphService service){this.service=service;}
    @ApiAccessLog(requestEnable=false,responseEnable=false)
    @GetMapping("/overview") public CommonResult<?> overview(@RequestParam(defaultValue="8") int limit){return success(service.overview(limit));}
    @ApiAccessLog(requestEnable=false,responseEnable=false)
    @GetMapping("/search") public CommonResult<?> search(@RequestParam String query,@RequestParam(defaultValue="30") int limit){return success(service.search(query,limit));}
    @ApiAccessLog(requestEnable=false,responseEnable=false)
    @GetMapping("/node") public CommonResult<?> node(@RequestParam String id){return success(service.detail(id));}
    @ApiAccessLog(requestEnable=false,responseEnable=false)
    @GetMapping("/neighbors") public CommonResult<?> neighbors(@RequestParam String id,@RequestParam(defaultValue="20") int limit){return success(service.neighbors(id,limit));}
}
