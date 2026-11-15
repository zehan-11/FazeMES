package cn.iocoder.yudao.module.mes.service.assistant;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.mock.env.MockEnvironment;
import java.net.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** No API key or paid model request: 401 from /v1/models proves DNS, proxy, TLS and HTTP. */
@EnabledIfEnvironmentVariable(named="FAZEMES_MODEL_NETWORK_LIVE",matches="1")
class MesModelNetworkLiveTest {
    @Test void realOpenAiPublicDnsAndProxyTlsConnection() throws Exception {
        var network=new MesModelNetworkSettings(new MockEnvironment());var uri=URI.create("https://api.openai.com/v1");
        var target=MesAssistantModelGateway.validateTarget(uri.toString(),network::resolve);
        assertTrue(MesModelNetworkSettings.isPublic(target.address()));assertFalse(MesModelNetworkSettings.isFake(target.address()));
        var response=MesAssistantModelGateway.exchange(target,"GET","/v1/models",new byte[0],"","application/json",15000,network.proxyFor(uri));
        assertEquals(401,response.status(),"Expected official missing-key HTTP response after successful TLS");
        System.out.println("MODEL_NETWORK_OK host="+uri.getHost()+" publicIp="+target.address().getHostAddress()+" proxy="+network.proxyFor(uri)+" TLS=verified HTTP="+response.status());
    }
}
