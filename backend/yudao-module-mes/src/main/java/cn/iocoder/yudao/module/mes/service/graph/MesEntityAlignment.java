package cn.iocoder.yudao.module.mes.service.graph;

import cn.iocoder.yudao.module.mes.service.assistant.MesAssistantDocumentParser;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.*;

/** Exact canonical names / curated aliases only; all classification and matching stays local. */
public final class MesEntityAlignment {
    private MesEntityAlignment() {}
    public static String nameKey(String value){return Normalizer.normalize(value,Normalizer.Form.NFKC).strip().replaceAll("\\s+"," ").toLowerCase(Locale.ROOT);}
    public static String kind(String value){return switch(nameKey(value)){
        case "device","equipment","设备" -> "设备";
        case "part","component","部件","组件","零部件" -> "部件";
        case "fault","failure","故障","故障现象" -> "故障";
        case "cause","原因" -> "原因";
        case "action","measure","措施","处理措施" -> "措施";
        case "process","工艺" -> "工艺";
        case "entity","实体","未知","" -> "实体";
        default -> value.strip();
    };}
    public static String entityId(String name,String type){return "doc-entity:"+MesAssistantDocumentParser.sha256((kind(type)+"\n"+nameKey(name)).getBytes(StandardCharsets.UTF_8));}
    static String text(Map<String,Object> row,String key){return Objects.toString(row.get(key),"");}
    private record Candidate(String id,String name,String kind,boolean original) {}
    private static Map<String,List<Candidate>> index(List<Map<String,Object>> catalog){
        Map<String,List<Candidate>> index=new HashMap<>();
        for(var row:catalog){String type=kind(text(row,"kind"));if(type.equals("实体"))continue;
            var candidate=new Candidate(text(row,"id"),text(row,"name"),type,!"DOCUMENT".equals(text(row,"origin")));
            Set<String> keys=new HashSet<>(Set.of(nameKey(candidate.name())));
            if(row.get("aliases") instanceof List<?> aliases)for(Object alias:aliases)if(alias instanceof String name&&!name.isBlank())keys.add(nameKey(name));
            for(String key:keys)index.computeIfAbsent(key,k->new ArrayList<>()).add(candidate);
        }
        return index;
    }
    private static List<Candidate> candidates(String name,Map<String,List<Candidate>> index){
        String key=nameKey(name);var all=index.getOrDefault(key,List.of());
        var exact=all.stream().filter(c->nameKey(c.name()).equals(key)).toList();return exact.isEmpty()?all:exact;
    }
    private static String hint(String relation,boolean source){
        if(source)return "实体";
        return switch(relation){case "包含部件","组成部件" -> "部件";case "可能原因","关联原因" -> "原因";case "关联检查","处理措施" -> "措施";default -> "实体";};
    }
    public static List<Map<String,Object>> prepareTypes(List<Map<String,Object>> facts,List<Map<String,Object>> catalog){return prepareTypes(facts,index(catalog));}
    private static List<Map<String,Object>> prepareTypes(List<Map<String,Object>> facts,Map<String,List<Candidate>> index){
        Map<String,Set<String>> declared=new HashMap<>();
        for(var row:facts)for(String end:List.of("source","target")){
            String type=kind(text(row,end+"Kind"));if(!type.equals("实体"))declared.computeIfAbsent(nameKey(text(row,end+"Name")),k->new HashSet<>()).add(type);
        }
        Map<String,Set<String>> inferred=new HashMap<>();
        for(var row:facts)for(String end:List.of("source","target")){
            String type=hint(text(row,"relation"),end.equals("source"));
            if(!type.equals("实体"))inferred.computeIfAbsent(nameKey(text(row,end+"Name")),k->new HashSet<>()).add(type);
        }
        List<Map<String,Object>> result=new ArrayList<>();
        for(var fact:facts){var row=new LinkedHashMap<>(fact);
            for(String end:List.of("source","target")){
                String raw=text(row,end+"Name"),type=kind(text(row,end+"Kind"));
                row.putIfAbsent(end+"OriginalName",raw);row.putIfAbsent(end+"OriginalKind",text(row,end+"Kind"));
                String method=type.equals("实体")?"unresolved":"explicit";
                if(type.equals("实体")){
                    var declarations=declared.getOrDefault(nameKey(raw),Set.of());
                    Set<String> types=new HashSet<>();for(var c:candidates(raw,index))types.add(c.kind());
                    if(declarations.size()==1){type=declarations.iterator().next();method="document_declaration";}
                    else if(declarations.isEmpty()&&types.size()==1){type=types.iterator().next();method="catalog";}
                    else if(declarations.isEmpty()&&types.isEmpty()){var hints=inferred.getOrDefault(nameKey(raw),Set.of());if(hints.size()==1){type=hints.iterator().next();method="relation_rule";}}
                }
                row.put(end+"Kind",type);row.put(end+"TypingMethod",method);
            }
            result.add(row);
        }
        return result;
    }
    /** Fresh scoped catalog and endpoint decisions belong to the same Neo4j write transaction. */
    public static List<Map<String,Object>> align(List<Map<String,Object>> facts,List<Map<String,Object>> catalog){
        var index=index(catalog);var result=prepareTypes(facts,index);
        for(var row:result)for(String end:List.of("source","target")){
            String raw=text(row,end+"Name"),type=text(row,end+"Kind");
            var matches=candidates(raw,index).stream().filter(c->c.kind().equals(type)).toList();
            // Existing document duplicates must not obscure a unique original node.
            var original=matches.stream().filter(Candidate::original).toList();if(!original.isEmpty())matches=original;
            String id=entityId(raw,type),method="new";
            if(matches.size()==1){var match=matches.get(0);id=match.id();method=nameKey(match.name()).equals(nameKey(raw))?"exact_name_type":"curated_alias_type";}
            else if(matches.size()>1){method="ambiguous";id=entityId("ambiguous\n"+row.get("documentId")+"\n"+raw,type);}
            if(type.equals("实体")){method="unresolved";id=entityId("unresolved\n"+row.get("documentId")+"\n"+raw,type);}
            row.put(end+"Id",id);row.put(end+"AlignmentMethod",method);
        }
        return result;
    }
}
