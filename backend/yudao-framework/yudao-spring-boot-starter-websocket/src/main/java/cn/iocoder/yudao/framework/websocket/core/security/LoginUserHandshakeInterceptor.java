package cn.iocoder.yudao.framework.websocket.core.security;

import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.common.biz.system.oauth2.OAuth2TokenCommonApi;
import cn.iocoder.yudao.framework.common.biz.system.oauth2.dto.OAuth2AccessTokenCheckRespDTO;
import cn.iocoder.yudao.framework.common.exception.ServiceException;
import lombok.RequiredArgsConstructor;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.framework.websocket.core.util.WebSocketFrameworkUtils;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.List;
import java.util.Map;

/** Authenticate the upgrade and bind its verified principal to the socket session. */
@RequiredArgsConstructor
public class LoginUserHandshakeInterceptor implements HandshakeInterceptor {

    public static final String PROTOCOL = "fazemes.v1";
    private final OAuth2TokenCommonApi tokenApi;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        LoginUser loginUser = SecurityFrameworkUtils.getLoginUser();
        if (loginUser == null) {
            List<String> protocols = new WebSocketHttpHeaders(request.getHeaders()).getSecWebSocketProtocol();
            if (protocols.size() == 2 && PROTOCOL.equals(protocols.get(0)) && protocols.get(1).startsWith("bearer.")) {
                try {
                    OAuth2AccessTokenCheckRespDTO token = tokenApi.checkAccessToken(protocols.get(1).substring(7));
                    if (token != null) {
                        loginUser = new LoginUser().setId(token.getUserId()).setUserType(token.getUserType())
                                .setTenantId(token.getTenantId()).setInfo(token.getUserInfo())
                                .setScopes(token.getScopes()).setExpiresTime(token.getExpiresTime());
                    }
                } catch (ServiceException invalidToken) {
                    return false;
                }
            }
        }
        if (loginUser == null) {
            return false;
        }
        WebSocketFrameworkUtils.setLoginUser(loginUser, attributes);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // do nothing
    }

}
