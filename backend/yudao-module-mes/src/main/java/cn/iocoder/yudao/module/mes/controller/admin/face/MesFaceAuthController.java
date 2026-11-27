package cn.iocoder.yudao.module.mes.controller.admin.face;

import cn.iocoder.yudao.framework.apilog.core.annotation.ApiAccessLog;
import cn.iocoder.yudao.framework.common.pojo.CommonResult;
import cn.iocoder.yudao.module.mes.service.face.MesFaceAuthService;
import cn.iocoder.yudao.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import static cn.iocoder.yudao.framework.common.pojo.CommonResult.success;

@RestController
@RequestMapping("/mes/face")
@Validated
public class MesFaceAuthController {
    @Resource private MesFaceAuthService service;
    public record Challenge(@NotBlank @Size(max=64) String username){}
    public record Login(@NotBlank @Size(max=64) String username,@NotBlank @Size(max=64) String challenge,
                        @NotBlank @Size(max=2_000_000) String imageBase64){}
    public record Enrollment(@NotBlank @Size(max=128) String password,@NotNull @AssertTrue Boolean consent,
                             @NotNull @Size(min=1,max=3) List<@NotBlank @Size(max=2_000_000) String> images,
                             @PositiveOrZero Long expectedRevision, UUID requestId){}
    public record Disable(@NotBlank @Size(max=128) String password,@PositiveOrZero Long expectedRevision,UUID requestId){}
    public record Targets(@NotEmpty @Size(max=100) List<@NotNull @Positive Long> ids){}
    public record Decision(@NotBlank @Size(max=160) String reason,@NotNull @PositiveOrZero Long expectedRevision,
                           @NotNull UUID requestId){}
    private static final String MANAGE="@ss.hasPermission('system:user:query') and @ss.hasPermission('mes:face:manage')";

    // Binding/JSON exceptions may contain rejected field values. Handle them before the general exception logger.
    @ExceptionHandler({org.springframework.web.bind.MethodArgumentNotValidException.class,
            org.springframework.http.converter.HttpMessageNotReadableException.class,
            jakarta.validation.ConstraintViolationException.class,
            org.springframework.web.method.annotation.HandlerMethodValidationException.class})
    public CommonResult<Boolean> invalidInput(){return CommonResult.error(400,"请检查输入内容并重新提交");}
    @GetMapping("/login-status") @PermitAll
    public CommonResult<Map<String,Object>> publicStatus(){return success(service.publicStatus());}
    @PostMapping("/challenge") @PermitAll @ApiAccessLog(requestEnable=false,responseEnable=false)
    public CommonResult<Map<String,Object>> challenge(@RequestBody @Valid Challenge request,HttpServletRequest http){
        return success(service.challenge(request.username(),http.getRemoteAddr()));
    }
    @PostMapping("/login") @PermitAll @ApiAccessLog(enable=false)
    public CommonResult<AuthLoginRespVO> login(@RequestBody @Valid Login request,HttpServletRequest http){
        return success(service.login(request.username(),request.challenge(),request.imageBase64(),http.getRemoteAddr()));
    }
    @GetMapping("/status") @PreAuthorize("@ss.hasPermission('mes:face:enroll')")
    public CommonResult<Map<String,Object>> status(){return success(service.status());}
    @PostMapping("/enroll") @PreAuthorize("@ss.hasPermission('mes:face:enroll')") @ApiAccessLog(enable=false)
    public CommonResult<Boolean> enroll(@RequestBody @Valid Enrollment request){
        service.enroll(request.password(),Boolean.TRUE.equals(request.consent()),request.images(),request.expectedRevision(),request.requestId());return success(true);
    }
    @PostMapping("/disable") @PreAuthorize("@ss.hasPermission('mes:face:enroll')") @ApiAccessLog(enable=false)
    public CommonResult<Boolean> disable(@RequestBody @Valid Disable request){
        service.disable(request.password(),request.expectedRevision(),request.requestId());return success(true);
    }
    @PostMapping("/admin/status-batch") @PreAuthorize(MANAGE) @ApiAccessLog(enable=false)
    public CommonResult<Map<Long,Map<String,Object>>> adminStatus(@RequestBody @Valid Targets request){
        return success(service.adminStatus(request.ids()));
    }
    @PostMapping("/admin/users/{id}/suspend") @PreAuthorize(MANAGE) @ApiAccessLog(enable=false)
    public CommonResult<Boolean> suspend(@PathVariable("id") long id,@RequestBody @Valid Decision request){
        service.administer(id,true,request.reason().strip(),request.expectedRevision(),request.requestId());return success(true);
    }
    @PostMapping("/admin/users/{id}/require-reenroll") @PreAuthorize(MANAGE) @ApiAccessLog(enable=false)
    public CommonResult<Boolean> requireReenroll(@PathVariable("id") long id,@RequestBody @Valid Decision request){
        service.administer(id,false,request.reason().strip(),request.expectedRevision(),request.requestId());return success(true);
    }
}
