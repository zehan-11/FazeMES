package cn.iocoder.yudao.module.mes.service.graph;

import cn.iocoder.yudao.module.mes.service.assistant.MesAssistantDocumentParser;
import org.springframework.stereotype.Component;
import java.text.Normalizer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;

/** Extracts written triples and supported manual prose with source spans. */
@Component
public class MesDocumentRelationExtractor {
    public static final String METHOD="explicit_v1";
    public record Chunk(long id,String heading,Integer page,int start,int end,String text,String hash) {}
    public record Fact(String sourceId,String sourceName,String sourceKind,String targetId,String targetName,String targetKind,
                       String relation,String relationId,long knowledgeBaseId,long documentId,int documentVersion,
                       long chunkId,String chunkHash,Integer pageNumber,int startOffset,int endOffset,
                       String sourceTitle,String sourceSection,String sourceExcerpt,String extractionMethod) {}
    record Entity(String id,String name,String kind) {}
    private static final Pattern ARROW=Pattern.compile("^(.+?)\\s*(?:—|--|－)\\s*([^—→>\\r\\n]{1,60}?)\\s*(?:—?→|--?>)\\s*(.+?)$");
    private static final Pattern TYPED=Pattern.compile("^\\[([^\\[\\]]{1,20})]\\s*(.+)$");
    private static String hash(String text){return MesAssistantDocumentParser.sha256(text.getBytes(StandardCharsets.UTF_8));}
    private static String normalized(String text){return Normalizer.normalize(text,Normalizer.Form.NFKC).strip().replaceAll("\\s+"," ");}
    private static Entity entity(String raw){
        String name=normalized(raw),kind="实体";var typed=TYPED.matcher(name);
        if(typed.matches()){kind=normalized(typed.group(1));name=normalized(typed.group(2));}
        if(name.isBlank()||name.length()>100||kind.isBlank()||kind.length()>20||name.matches(".*[\\p{Cntrl}].*"))throw new IllegalArgumentException("实体名称或类型超出限制");
        return new Entity("doc-entity:"+hash(kind+"\n"+name.toLowerCase(Locale.ROOT)),name,kind);
    }
    public List<Fact> extract(long baseId,long docId,int version,String title,String text,List<Chunk> chunks){
        List<Fact> result=new ArrayList<>();int offset=0;boolean table=false;char delimiter=',';
        for(String raw:text.split("\n",-1)){
            int lineStart=offset;offset+=raw.length()+1;String line=raw.strip();if(line.isBlank())continue;
            String content=line.replaceFirst("^[-*]\\s+","");String source=null,relation=null,target=null;
            var arrow=ARROW.matcher(content);
            if(arrow.matches()){source=arrow.group(1);relation=arrow.group(2);target=arrow.group(3);}
            else {
                char nextDelimiter=content.startsWith("|")?'|':',';
                List<String> cells=cells(content,nextDelimiter);
                if(cells.equals(List.of("源实体","关系","目标实体"))||cells.equals(List.of("source","relation","target"))){table=true;delimiter=nextDelimiter;continue;}
                if(table&&nextDelimiter==delimiter&&cells.size()==3&&!cells.get(0).matches(":?-+:?")){
                    source=cells.get(0);relation=cells.get(1);target=cells.get(2);
                }else{
                    if(!content.matches("^[| :\\-]+$"))table=false;
                    if(!content.startsWith("|"))appendManual(result,baseId,docId,version,title,text,chunks,line,lineStart+raw.indexOf(line));
                    continue;
                }
            }
            relation=normalized(relation);
            if(relation.isBlank()||relation.length()>60||relation.contains("|")||relation.contains("→"))throw new IllegalArgumentException("关系类型无效");
            Entity from=entity(source),to=entity(target);
            int start=lineStart+raw.indexOf(line),end=start+line.length();
            Chunk chunk=chunks.stream().filter(c->c.start()<=start&&c.end()>=end).findFirst().orElse(null);
            if(chunk==null)throw new IllegalArgumentException("关系行跨越分块边界，请缩短关系行后重试");
            if(start<0||end>text.length()||!text.substring(start,end).equals(line))throw new IllegalArgumentException("关系来源位置无效");
            addFact(result,baseId,docId,version,title,chunk,start,end,line,from,to,relation,METHOD);
        }
        return List.copyOf(result);
    }
    private void appendManual(List<Fact> facts,long base,long document,int version,String title,String text,
                              List<Chunk> chunks,String line,int lineStart) {
        for (var match : MesManualRelationRules.extract(line)) {
            int start = lineStart + match.start(), end = lineStart + match.end();
            String excerpt = text.substring(start, end);
            if (!excerpt.contains(match.source()) || !excerpt.contains(match.target())) continue;
            var chunk = chunks.stream().filter(c -> c.start() <= start && c.end() >= end
                    && c.text().regionMatches(start-c.start(),excerpt,0,excerpt.length())).findFirst();
            if (chunk.isEmpty()) continue;
            addFact(facts,base,document,version,title,chunk.get(),start,end,excerpt,
                    entity("["+match.sourceKind()+"]"+match.source()),entity("["+match.targetKind()+"]"+match.target()),
                    match.relation(),MesManualRelationRules.METHOD);
        }
    }

    private void addFact(List<Fact> facts,long base,long document,int version,String title,Chunk chunk,int start,int end,
                         String excerpt,Entity from,Entity to,String relation,String method) {
        String section=chunk.heading()+(chunk.page()==null?"":" · 第"+chunk.page()+"页")+" · 第"+chunk.id()+"片段";
        String id="doc-rel:"+document+":"+hash(version+"\n"+start+"\n"+end+"\n"+from.id()+relation+to.id());
        facts.add(new Fact(from.id(),from.name(),from.kind(),to.id(),to.name(),to.kind(),relation,id,
                base,document,version,chunk.id(),chunk.hash(),chunk.page(),start,end,title,section,excerpt,method));
        if(facts.size()>1000)throw new IllegalArgumentException("单文档最多建立1000条关系，请拆分文档");
    }
    /** Three-column CSV (quoted fields supported) or Markdown relationship table. */
    static List<String> cells(String line,char delimiter){
        if(delimiter=='|'){
            if(!line.startsWith("|")||!line.endsWith("|"))return List.of();
            return Arrays.stream(line.substring(1,line.length()-1).split("\\|",-1)).map(String::strip).toList();
        }
        if(!line.contains(","))return List.of();
        List<String> cells=new ArrayList<>();StringBuilder cell=new StringBuilder();boolean quoted=false;
        for(int i=0;i<line.length();i++){char c=line.charAt(i);
            if(c=='"'){if(quoted&&i+1<line.length()&&line.charAt(i+1)=='"'){cell.append('"');i++;}else quoted=!quoted;}
            else if(c==delimiter&&!quoted){cells.add(cell.toString().strip());cell.setLength(0);}else cell.append(c);
        }
        if(quoted)return List.of();cells.add(cell.toString().strip());return cells;
    }
}
