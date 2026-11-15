package cn.iocoder.yudao.module.mes.service.assistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import java.net.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

/** Application-only DNS recovery for explicitly allowed model hosts; never accepts fake IPs as destinations. */
@Component
public class MesModelNetworkSettings {
    @FunctionalInterface interface SystemDns { InetAddress[] lookup(String host) throws Exception; }
    @FunctionalInterface interface PublicDns { Resolution lookup(String host,InetSocketAddress proxy) throws Exception; }
    record Resolution(List<InetAddress> addresses,long ttlSeconds) {}
    private record Cached(Resolution result,long expires) {}
    private final MesJevProxySettings proxy;
    private final Set<String> hosts;
    private final SystemDns system;
    private final PublicDns publicDns;
    private final LongSupplier clock;
    private final Map<String,Cached> cache=new ConcurrentHashMap<>();

    @org.springframework.beans.factory.annotation.Autowired
    public MesModelNetworkSettings(Environment env){
        this(new MesJevProxySettings(env.getProperty("mes.model.proxy-url","system"),System.getProperty("os.name","").startsWith("Windows"),MesJevProxySettings::readWindowsProxy),
            hostSet(env.getProperty("mes.model.real-dns-hosts","api.openai.com")),InetAddress::getAllByName,MesModelNetworkSettings::queryPublicDns,System::nanoTime);
    }
    MesModelNetworkSettings(MesJevProxySettings proxy,Set<String> hosts,SystemDns system,PublicDns publicDns,LongSupplier clock){
        this.proxy=proxy;this.hosts=Set.copyOf(hosts);this.system=system;this.publicDns=publicDns;this.clock=clock;
    }
    private static Set<String> hostSet(String names){
        Set<String> result=new HashSet<>();
        for(String value:names.split(",")){
            String host=value.strip().toLowerCase(Locale.ROOT);if(host.isEmpty())continue;
            if(!host.matches("(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?")||!host.contains(".")||host.contains(".."))throw new IllegalArgumentException("Invalid real DNS host allowlist");
            result.add(host);
        }
        return result;
    }
    public InetSocketAddress proxyFor(URI destination){
        // Local Ollama/development traffic must never leave the machine, even with an explicit proxy.
        if("127.0.0.1".equals(destination.getHost()))return null;
        return proxy.resolve(destination);
    }
    public InetAddress[] resolve(URI destination) throws Exception {
        String host=destination.getHost().toLowerCase(Locale.ROOT);InetAddress[] initial;
        try{initial=system.lookup(host);}catch(UnknownHostException e){if(!hosts.contains(host))throw e;initial=new InetAddress[0];}
        boolean fake=Arrays.stream(initial).anyMatch(MesModelNetworkSettings::isFake);
        if(initial.length>0&&!fake)return initial;
        // Only fake-IP / failed resolution may trigger recovery. Private/mixed answers still fail closed.
        if(!hosts.contains(host)||Arrays.stream(initial).anyMatch(a->!isFake(a)&&!isPublic(a)))return initial;
        InetSocketAddress route=proxyFor(destination);String key=host+"|"+Objects.toString(route,"direct");long now=clock.getAsLong();
        var existing=cache.get(key);if(existing!=null&&now<existing.expires())return existing.result().addresses().toArray(InetAddress[]::new);
        try{
            Resolution result=publicDns.lookup(host,route);
            if(result.addresses().isEmpty()||result.addresses().stream().anyMatch(a->!isPublic(a)))throw new IllegalArgumentException();
            long ttl=Math.min(60,Math.max(0,result.ttlSeconds()));
            if(ttl>0){if(cache.size()>=128)cache.clear();cache.put(key,new Cached(result,clock.getAsLong()+TimeUnit.SECONDS.toNanos(ttl)));}
            return result.addresses().toArray(InetAddress[]::new);
        }catch(Exception e){throw MesAssistantErrors.model("模型域名的真实公网DNS解析失败，请检查本机HTTP代理及Cloudflare DoH连通性；不会连接虚拟IP或私网地址");}
    }
    static boolean isFake(InetAddress address){byte[] b=address.getAddress();return b.length==4&&(b[0]&255)==198&&((b[1]&255)==18||(b[1]&255)==19);}
    static boolean isPublic(InetAddress address){
        byte[] b=address.getAddress();
        boolean reserved=b.length==4&&((b[0]&255)==0||(b[0]&255)==100&&(b[1]&255)>=64&&(b[1]&255)<=127||(b[0]&255)>=224||isFake(address));
        boolean privateV6=b.length==16&&(b[0]&254)==252;
        return !(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress()||address.isMulticastAddress()||reserved||privateV6);
    }
    private static Resolution queryPublicDns(String host,InetSocketAddress proxy) throws Exception {
        // Bootstrap by numeric address to avoid resolving the resolver through the same fake DNS.
        // TLS still verifies cloudflare-dns.com and uses that name as SNI/Host.
        var target=new MesAssistantModelGateway.Target(URI.create("https://cloudflare-dns.com"),InetAddress.getByAddress(new byte[]{1,1,1,1}),443);
        var response=MesAssistantModelGateway.exchange(target,"GET","/dns-query?name="+URLEncoder.encode(host,java.nio.charset.StandardCharsets.UTF_8)+"&type=A",new byte[0],"","application/dns-json",10_000,proxy);
        if(response.status()!=200||response.body().length>65536)throw new IllegalArgumentException();
        return parseAnswer(host,response.body());
    }
    static Resolution parseAnswer(String host,byte[] body) throws Exception {
        var json=new ObjectMapper().readTree(body);
        if(json.path("Status").asInt(-1)!=0||json.path("TC").asBoolean()||json.path("Question").size()!=1||!name(json.path("Question").get(0).path("name").asText()).equals(host)||json.path("Question").get(0).path("type").asInt()!=1)throw new IllegalArgumentException();
        Set<String> names=new HashSet<>(Set.of(host));long ttl=60;
        // Accept A records for the requested owner or its bounded CNAME chain only.
        for(int i=0;i<8;i++){boolean added=false;for(var answer:json.path("Answer")){
            if(answer.path("type").asInt()==5&&names.contains(name(answer.path("name").asText()))){
                added|=names.add(name(answer.path("data").asText()));ttl=Math.min(ttl,Math.max(0,answer.path("TTL").asLong(0)));
            }
        }if(!added)break;}
        List<InetAddress> result=new ArrayList<>();
        for(var answer:json.path("Answer")){
            if(answer.path("type").asInt()!=1||!names.contains(name(answer.path("name").asText())))continue;
            String[] parts=answer.path("data").asText().split("\\.",-1);if(parts.length!=4)throw new IllegalArgumentException();byte[] bytes=new byte[4];
            for(int i=0;i<4;i++){if(!parts[i].matches("0|[1-9][0-9]{0,2}"))throw new IllegalArgumentException();int n=Integer.parseInt(parts[i]);if(n>255)throw new IllegalArgumentException();bytes[i]=(byte)n;}
            InetAddress address=InetAddress.getByAddress(bytes);if(!isPublic(address))throw new IllegalArgumentException();result.add(address);
            ttl=Math.min(ttl,Math.max(0,answer.path("TTL").asLong(0)));
        }
        if(result.isEmpty())throw new IllegalArgumentException();return new Resolution(List.copyOf(new LinkedHashSet<>(result)),ttl);
    }
    private static String name(String text){return text.toLowerCase(Locale.ROOT).replaceFirst("\\.$","");}
}
