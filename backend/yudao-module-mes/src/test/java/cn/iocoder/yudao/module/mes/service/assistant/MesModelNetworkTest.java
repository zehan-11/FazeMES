package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.framework.common.exception.ServiceException;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class MesModelNetworkTest extends MesAssistantTestDatabase {
    private static final URI OPENAI=URI.create("https://api.openai.com/v1");
    private static InetAddress ip(String value) throws Exception {return InetAddress.getByName(value);}
    private MesModelNetworkSettings network(MesModelNetworkSettings.SystemDns system,MesModelNetworkSettings.PublicDns dns,AtomicLong clock){
        return new MesModelNetworkSettings(new MesJevProxySettings("http://127.0.0.1:7897",false,Map::of),Set.of("api.openai.com"),system,dns,clock::get);
    }
    @Test void fakeIpRecoversPublicAddressThroughSelectedProxyAndHonorsDnsTtl() throws Exception {
        var now=new AtomicLong();var calls=new AtomicInteger();
        var network=network(h->new InetAddress[]{ip("198.18.0.238")},(h,p)->{assertEquals("api.openai.com",h);assertEquals(7897,p.getPort());calls.incrementAndGet();return new MesModelNetworkSettings.Resolution(List.of(ip("104.18.1.1")),2);},now);
        assertEquals("104.18.1.1",network.resolve(OPENAI)[0].getHostAddress());network.resolve(OPENAI);assertEquals(1,calls.get());
        now.set(TimeUnit.SECONDS.toNanos(3));network.resolve(OPENAI);assertEquals(2,calls.get());
        assertNull(network.proxyFor(URI.create("http://127.0.0.1:11434")));
    }
    @Test void privateAndMixedAnswersCannotTriggerRecoveryAndUnlistedHostStillFailsValidation() throws Exception {
        for(String unsafe:List.of("10.1.2.3","127.0.0.1","169.254.169.254")){
            var network=network(h->new InetAddress[]{ip("198.18.0.238"),ip(unsafe)},(h,p)->{fail("Private DNS must not trigger DoH");return null;},new AtomicLong());
            assertThrows(ServiceException.class,()->MesAssistantModelGateway.validateTarget(OPENAI.toString(),network::resolve));
        }
        var network=network(h->new InetAddress[]{ip("198.19.0.1")},(h,p)->{fail("Host is not allowlisted");return null;},new AtomicLong());
        assertThrows(ServiceException.class,()->MesAssistantModelGateway.validateTarget("https://other.example/v1",network::resolve));
        assertThrows(ServiceException.class,()->MesAssistantModelGateway.validateTarget("https://api.openai.com@169.254.169.254/v1",network::resolve));
    }
    @Test void publicSystemDnsIsUsedDirectlyAndFailedDnsCanRecoverOnlyForAllowedHost() throws Exception {
        var network=network(h->new InetAddress[]{ip("104.18.1.1")},(h,p)->{fail("Public DNS must not need recovery");return null;},new AtomicLong());
        assertEquals("104.18.1.1",network.resolve(OPENAI)[0].getHostAddress());
        var recovery=network(h->{throw new UnknownHostException();},(h,p)->new MesModelNetworkSettings.Resolution(List.of(ip("104.18.1.2")),0),new AtomicLong());
        assertEquals("104.18.1.2",recovery.resolve(OPENAI)[0].getHostAddress());
        assertThrows(UnknownHostException.class,()->recovery.resolve(URI.create("https://other.example")));
    }
    private static byte[] answer(String record){return ("{\"Status\":0,\"Question\":[{\"name\":\"api.openai.com.\",\"type\":1}],\"Answer\":["+record+"]}").getBytes(StandardCharsets.UTF_8);}
    @Test void dnsJsonRequiresMatchingQuestionAndPublicNumericAnswersIncludingCnameTtl() throws Exception {
        var data=answer("{\"name\":\"api.openai.com.\",\"type\":5,\"TTL\":3,\"data\":\"edge.example.\"},{\"name\":\"edge.example.\",\"type\":1,\"TTL\":30,\"data\":\"104.18.1.1\"}");
        var result=MesModelNetworkSettings.parseAnswer("api.openai.com",data);assertEquals(3,result.ttlSeconds());assertEquals("104.18.1.1",result.addresses().get(0).getHostAddress());
        for(String unsafe:List.of("198.18.0.2","10.0.0.1","169.254.169.254","127.0.0.1","100.64.0.1","host.example","1.2.3.999")){
            assertThrows(Exception.class,()->MesModelNetworkSettings.parseAnswer("api.openai.com",answer("{\"name\":\"api.openai.com.\",\"type\":1,\"TTL\":20,\"data\":\""+unsafe+"\"}")));
        }
        assertThrows(Exception.class,()->MesModelNetworkSettings.parseAnswer("wrong.example",data));
        assertThrows(Exception.class,()->MesModelNetworkSettings.parseAnswer("api.openai.com",answer("{\"name\":\"unrelated.example\",\"type\":1,\"TTL\":20,\"data\":\"104.18.1.1\"}")));
    }
    @Test void fallbackFailureNeverAcceptsFakeIpOrReturnsResolverDetails() throws Exception {
        var network=network(h->new InetAddress[]{ip("198.18.1.1")},(h,p)->{throw new IOException("PRIVATE-DETAILS");},new AtomicLong());
        var error=assertThrows(ServiceException.class,()->MesAssistantModelGateway.validateTarget(OPENAI.toString(),network::resolve));
        assertTrue(error.getMessage().contains("真实公网DNS"));assertFalse(error.getMessage().contains("PRIVATE-DETAILS"));
    }
    @Test void ordinaryChatUsesPinnedRealIpConnectTunnelWithoutSendingModelKeyBeforeTls() throws Exception {
        try(var listener=new ServerSocket(0,1,ip("127.0.0.1"))){
            var proxy=new MesJevProxySettings("http://127.0.0.1:"+listener.getLocalPort(),false,Map::of);
            var network=new MesModelNetworkSettings(proxy,Set.of("api.openai.com"),h->new InetAddress[]{ip("198.18.0.238")},(h,p)->new MesModelNetworkSettings.Resolution(List.of(ip("104.18.1.1")),30),System::nanoTime);
            ReflectionTestUtils.setField(models,"modelNetwork",network);
            models.save(new MesAssistantModelGateway.Settings("openai",OPENAI.toString(),"test-model","PRIVATE-MODEL-KEY",false,.2,1024,true),10);
            var worker=Executors.newSingleThreadExecutor();
            try{
                var received=worker.submit(()->{try(var client=listener.accept()){
                    client.setSoTimeout(2500);var reader=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.US_ASCII));var text=new StringBuilder();
                    for(String line=reader.readLine();line!=null&&!line.isEmpty();line=reader.readLine())text.append(line).append('\n');
                    client.getOutputStream().write("HTTP/1.1 502 Failed\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));return text.toString();
                }});
                assertThrows(ServiceException.class,models::testConnection);String request=received.get(3,TimeUnit.SECONDS);
                assertTrue(request.startsWith("CONNECT 104.18.1.1:443 HTTP/1.1"));assertFalse(request.contains("198.18."));assertFalse(request.contains("Authorization"));assertFalse(request.contains("PRIVATE-MODEL-KEY"));
            }finally{worker.shutdownNow();}
        }
    }
}
