package cn.iocoder.yudao.module.mes.service.face;

import cn.iocoder.yudao.framework.common.exception.ErrorCode;
import cn.iocoder.yudao.framework.common.exception.ServiceException;
import cn.iocoder.yudao.framework.datapermission.core.util.DataPermissionUtils;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import cn.iocoder.yudao.module.system.dal.dataobject.user.AdminUserDO;
import cn.iocoder.yudao.module.system.service.auth.AdminAuthService;
import cn.iocoder.yudao.module.system.service.permission.PermissionService;
import cn.iocoder.yudao.module.system.service.user.AdminUserService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.iocoder.yudao.framework.common.exception.util.ServiceExceptionUtil.exception;
import static cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils.getLoginUser;

/** One-to-one verification. The claimed account and tenant come from MES's authentication flow. */
@Service
public class MesFaceAuthService {
    static final ErrorCode UNAVAILABLE=new ErrorCode(1_047_140_000,"人脸服务暂不可用，可继续使用密码登录");
    static final ErrorCode REJECTED=new ErrorCode(1_047_140_001,"核验未通过，请保持单人正脸再试，或使用密码登录");
    static final ErrorCode INVALID=new ErrorCode(1_047_140_002,"请确认授权并重新采集同一人的清晰正脸，每次仅一人入镜");
    static final ErrorCode RATE_LIMITED=new ErrorCode(1_047_140_003,"人脸核验过于频繁，请稍后重试");
    static final ErrorCode CONFLICT=new ErrorCode(1_047_140_004,"绑定状态已变化，请刷新状态后重试");
    static final ErrorCode SCOPE=new ErrorCode(1_047_140_005,"无权操作该用户");
    private static final double MIN_SIMILARITY = 0.54;
    @Resource private AdminUserService users;
    @Resource private AdminAuthService auth;
    @Resource private PermissionService permissions;
    @Resource private FaceWorkerClient worker;
    @Resource private FaceTemplateCipher cipher;
    @Resource private FaceChallengeStore challenges;
    @Resource private FaceBindingStore bindings;
    @Resource private FaceVectorStore vectors;

    private long tenant() { return TenantContextHolder.getRequiredTenantId(); }
    private String username(String value) {
        if (value==null || value.isBlank() || value.length()>64) throw exception(INVALID);
        return value.trim();
    }
    private long actor() {
        var login=getLoginUser();
        if (login==null || !Objects.equals(login.getTenantId(),tenant())) throw exception(SCOPE);
        return login.getId();
    }
    private void confirm(long id,String password) {
        try { challenges.limit("enroll:"+tenant()+":"+id,300,5); }
        catch (IllegalArgumentException ex) { throw exception(RATE_LIMITED); }
        // A self-service employee may have no department-list scope. Only reauthenticate the signed-in subject.
        DataPermissionUtils.executeIgnore(() -> {
            AdminUserDO user=users.getUser(id);
            if (user==null || !Objects.equals(user.getTenantId(),tenant())) throw exception(REJECTED);
            AdminUserDO verified=auth.authenticate(user.getUsername(),password);
            if (verified==null || !Objects.equals(verified.getId(),id) || !Objects.equals(verified.getTenantId(),tenant()))
                throw exception(REJECTED);
        });
    }

    public Map<String,Object> status() {
        long id=actor();
        var binding=bindings.get(tenant(),id);
        var data=new HashMap<String,Object>(binding.metadata());
        data.put("enrolled",binding.active());
        data.put("ready",worker.ready() && vectors.ready());
        data.put("cleanupPending",bindings.cleanupPending(tenant(),id));
        data.put("model","SFace+YuNet");
        data.put("comparison","1:1");
        data.put("livenessSupported",false);
        return data;
    }

    public Map<String,Object> publicStatus() {
        return Map.of("ready",worker.ready(),"comparison","1:1","livenessSupported",false);
    }

    public Map<String,Object> challenge(String username,String ip) {
        try { return Map.of("challenge",challenges.issue(tenant(),username(username),ip),"expiresIn",60); }
        catch (IllegalArgumentException ex) { throw exception(RATE_LIMITED); }
    }

    private long expected(long user,Long revision) {
        return revision==null ? bindings.get(tenant(),user).revision() : revision;
    }
    private UUID requestId(UUID id) { return id==null ? UUID.randomUUID() : id; }

    private void mutation(long actor,long user,String action,UUID request,String reason,Runnable change) {
        try {
            change.run();
        } catch (RuntimeException ex) {
            String result=ex instanceof ServiceException err && Objects.equals(err.getCode(),CONFLICT.getCode()) ? "CONFLICT" :
                    ex instanceof IllegalStateException ? "UNAVAILABLE" : "REJECTED";
            bindings.audit(tenant(),actor,user,action,request,reason,result);
            if (ex instanceof IllegalStateException) throw exception(UNAVAILABLE);
            if (ex instanceof IllegalArgumentException) throw exception(INVALID);
            throw ex;
        }
    }

    public void enroll(String password,boolean consent,List<String> images,Long revision,UUID id) {
        long user=actor();
        UUID request=requestId(id);
        mutation(user,user,"ENROLL",request,"",() -> {
            if (!consent || images==null || images.isEmpty() || images.size()>3) throw exception(INVALID);
            confirm(user,password);
            if (bindings.completed(tenant(),user,user,"ENROLL",request)) return;
            var current=bindings.get(tenant(),user);
            if (current.status().equals("ADMIN_SUSPENDED") || (revision!=null && current.revision()!=revision))
                throw exception(CONFLICT);
            List<float[]> samples=new ArrayList<>();
            for (String image:images) {
                float[] sample=worker.extract(image);
                FaceTemplateCipher.validate(sample);
                if (!samples.isEmpty() && similarity(samples.get(0),sample)<MIN_SIMILARITY) throw exception(INVALID);
                samples.add(sample);
            }
            bindings.publish(tenant(),user,current.revision(),request,samples);
        });
    }

    public void disable(String password,Long revision,UUID id) {
        long user=actor();
        UUID request=requestId(id);
        mutation(user,user,"REVOKE",request,"",() -> {
            confirm(user,password);
            bindings.invalidate(tenant(),user,user,expected(user,revision),request,"REVOKE","SELF_REVOKED","");
        });
    }

    public Map<Long,Map<String,Object>> adminStatus(List<Long> ids) {
        actor();
        List<Long> visible=users.getUserList(ids).stream().filter(u -> Objects.equals(u.getTenantId(),tenant()))
                .map(AdminUserDO::getId).toList();
        return bindings.metadata(tenant(),visible);
    }

    public void administer(long user,boolean suspend,String reason,long revision,UUID request) {
        long actor=actor();
        String action=suspend ? "SUSPEND" : "REQUIRE_REENROLL";
        mutation(actor,user,action,request,reason,() -> {
            // Same MyBatis tenant/department/user rules as UserController's user list.
            AdminUserDO target=users.getUser(user);
            if (target==null || !Objects.equals(target.getTenantId(),tenant())) throw exception(SCOPE);
            bindings.invalidate(tenant(),actor,user,revision,request,action,
                    suspend ? "ADMIN_SUSPENDED" : "REENROLL_REQUIRED",reason);
        });
    }

    public AuthLoginRespVO login(String username,String challenge,String image,String ip) {
        String name=username(username);
        try { if (!challenges.consume(tenant(),name,ip,challenge)) throw exception(REJECTED); }
        catch (IllegalArgumentException ex) { throw exception(RATE_LIMITED); }
        AdminUserDO user=users.getUserByUsername(name);
        if (user==null || !Objects.equals(user.getTenantId(),tenant()) || !Objects.equals(user.getStatus(),0))
            throw exception(REJECTED);
        long id=user.getId();
        try {
            var binding=bindings.get(tenant(),id);
            if (!binding.active()) throw exception(REJECTED);
            float[] probe=worker.extract(image);
            double match=switch(binding.storage()) {
                case "LEGACY" -> cipher.decrypt(tenant(),id,bindings.legacy(tenant(),id,binding.revision())).stream()
                        .mapToDouble(ref -> similarity(probe,ref)).max().orElse(-1);
                case "PGVECTOR" -> vectors.similarity(tenant(),id,binding.version(),binding.samples(),probe);
                default -> -1;
            };
            if (!Double.isFinite(match) || match<MIN_SIMILARITY) throw exception(REJECTED);
            return bindings.issue(tenant(),id,binding,() -> {
                if (!permissions.hasAnyPermissions(id,"mes:face:enroll")) throw exception(REJECTED);
                return auth.loginByVerifiedFace(id);
            });
        } catch (RuntimeException ex) {
            bindings.audit(tenant(),null,id,"LOGIN",null,"",ex instanceof IllegalStateException ? "UNAVAILABLE" : "REJECTED");
            if (ex instanceof IllegalStateException) throw exception(UNAVAILABLE);
            if (ex instanceof IllegalArgumentException) throw exception(REJECTED);
            throw ex;
        }
    }

    static double similarity(float[] left,float[] right) {
        FaceTemplateCipher.validate(left);
        FaceTemplateCipher.validate(right);
        double result=0;
        for (int i=0;i<128;i++) result+=left[i]*right[i];
        return result;
    }
}
