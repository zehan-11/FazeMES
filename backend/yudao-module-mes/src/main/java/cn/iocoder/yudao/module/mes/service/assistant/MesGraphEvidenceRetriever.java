package cn.iocoder.yudao.module.mes.service.assistant;

import cn.iocoder.yudao.module.mes.service.graph.MesEntityAlignment;
import cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphView;
import static cn.iocoder.yudao.module.mes.service.graph.MesKnowledgeGraphService.*;
import org.springframework.stereotype.Component;
import java.util.*;
import java.util.regex.Pattern;

/** Bounded local entity linking and undirected traversal; stored relation directions remain intact. */
@Component
public class MesGraphEvidenceRetriever {
    public record Match(Entity entity, String matchMethod) {}
    public record Path(String rootId, List<String> nodeIds, List<String> relationIds) {}
    public record Result(List<Match> matchedEntities, List<Entity> nodes, List<Relation> relations,
                         List<Path> paths, int hops, boolean hasMore) {}
    private record Walk(String root, List<String> nodes, List<String> edges) {}
    private final MesKnowledgeGraphView graph;
    public MesGraphEvidenceRetriever(MesKnowledgeGraphView graph) { this.graph=graph; }

    public Result retrieve(String query, List<Long> baseIds, int hops) {
        if(hops<1||hops>2)throw MesAssistantErrors.invalid("图谱检索跳数只能为1或2");
        // This snapshot has already removed unauthorized, unpublished and stale sources.
        return select(graph.snapshot(baseIds), query, hops);
    }
    static Result select(Graph full, String query, int hops) {
        String key=MesEntityAlignment.nameKey(query);
        var ordered=full.nodes().stream().sorted(Comparator.<Entity>comparingInt(n->MesEntityAlignment.nameKey(n.name()).length()).reversed().thenComparing(Entity::id)).toList();
        var mentions=ordered.stream().filter(n->mentioned(key,MesEntityAlignment.nameKey(n.name()))).toList();
        String method="name_mention";
        if(mentions.isEmpty()&&key.length()>=2&&key.length()<=8){
            mentions=ordered.stream().filter(n->MesEntityAlignment.nameKey(n.name()).contains(key)).toList();method="name_fragment";
        }
        boolean more=mentions.size()>8;String matchMethod=method;
        var matches=mentions.stream().limit(8).map(n->new Match(n,matchMethod)).toList();
        Map<String,Entity> catalog=new HashMap<>();for(var n:full.nodes())catalog.put(n.id(),n);
        Map<String,List<Relation>> adjacent=new HashMap<>();
        for(var r:full.relations().stream().sorted(Comparator.comparing(Relation::id)).toList()){
            if(r.evidence()==null||r.evidence().text()==null||r.evidence().text().isBlank()||!catalog.containsKey(r.source())||!catalog.containsKey(r.target()))continue;
            adjacent.computeIfAbsent(r.source(),k->new ArrayList<>()).add(r);
            if(!r.source().equals(r.target()))adjacent.computeIfAbsent(r.target(),k->new ArrayList<>()).add(r);
        }
        Map<String,Entity> nodes=new LinkedHashMap<>();Map<String,Relation> edges=new LinkedHashMap<>();List<Path> paths=new ArrayList<>();
        Deque<Walk> queue=new ArrayDeque<>();Map<String,Set<String>> visited=new HashMap<>();
        for(var m:matches){var n=m.entity();nodes.put(n.id(),n);queue.add(new Walk(n.id(),List.of(n.id()),List.of()));visited.put(n.id(),new HashSet<>(Set.of(n.id())));}
        outer:while(!queue.isEmpty()){
            var walk=queue.removeFirst();if(walk.edges().size()>=hops)continue;
            String last=walk.nodes().get(walk.nodes().size()-1);
            for(var edge:adjacent.getOrDefault(last,List.of())){
                String next=edge.source().equals(last)?edge.target():edge.source();if(walk.nodes().contains(next))continue;
                if(paths.size()>=80||!edges.containsKey(edge.id())&&edges.size()>=60){more=true;break outer;}
                var route=new ArrayList<>(walk.nodes());route.add(next);var links=new ArrayList<>(walk.edges());links.add(edge.id());
                paths.add(new Path(walk.root(),List.copyOf(route),List.copyOf(links)));edges.putIfAbsent(edge.id(),edge);nodes.putIfAbsent(next,catalog.get(next));
                if(visited.get(walk.root()).add(next))queue.addLast(new Walk(walk.root(),route,links));
            }
        }
        return new Result(matches,List.copyOf(nodes.values()),List.copyOf(edges.values()),List.copyOf(paths),hops,more);
    }
    private static boolean mentioned(String question,String name){
        if(name.isBlank())return false;
        if(name.matches("[a-z0-9 _.-]+"))return Pattern.compile("(?<![a-z0-9])"+Pattern.quote(name)+"(?![a-z0-9])").matcher(question).find();
        return question.contains(name);
    }
}
