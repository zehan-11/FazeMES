package cn.iocoder.yudao.module.mes.service.assistant;

import java.util.*;

/** Shared local evidence contract. No credentials or caller-provided authorization claims. */
public record MesRetrievalEvidence(String evidenceId,String sourceType,String retrievalMethod,String libraryType,
    Long knowledgeBaseId,Long documentId,Integer documentVersion,Long chunkId,String chunkHash,
    String title,String section,String text,Integer pageNumber,Integer startOffset,Integer endOffset,
    Double score,List<String> nodeIds,List<String> relationIds) {
    public static Long number(Map<String,Object> row,String key){return row.get(key) instanceof Number n?n.longValue():null;}
    public static Integer integer(Map<String,Object> row,String key){return row.get(key) instanceof Number n?n.intValue():null;}
    public static String text(Map<String,Object> row,String key){return Objects.toString(row.get(key),"");}
    public static MesRetrievalEvidence document(Map<String,Object> row){
        return new MesRetrievalEvidence("document:"+row.get("documentId")+":"+row.get("version")+":"+row.get("chunkId"),"DOCUMENT","lexical_bm25",text(row,"libraryType"),number(row,"knowledgeBaseId"),number(row,"documentId"),integer(row,"version"),number(row,"chunkId"),text(row,"contentHash"),text(row,"title"),text(row,"heading"),text(row,"content"),integer(row,"pageNumber"),integer(row,"startOffset"),integer(row,"endOffset"),row.get("score") instanceof Number n?n.doubleValue():null,List.of(),List.of());
    }
}
