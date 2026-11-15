package cn.iocoder.yudao.module.mes.service.graph;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class MesEntityAlignmentTest {
    Map<String,Object> node(String id,String name,String kind){return Map.of("id",id,"name",name,"kind",kind);}
    Map<String,Object> fact(String name,String kind){return new LinkedHashMap<>(Map.of("sourceName",name,"sourceKind",kind,"targetName","轴承","targetKind","部件","relation","关联","relationId","doc-edge-1","documentId",8L,"documentVersion",3,"chunkHash","unchanged","sourceExcerpt","原始资料"));}
    @Test void untypedExactNameReusesOriginalTypeAndIdAndPreservesSourceData(){
        var raw=fact("电机","实体");var aligned=MesEntityAlignment.align(List.of(raw),List.of(node("motor","电机","部件"),node("bearing","轴承","部件"))).get(0);
        assertEquals("motor",aligned.get("sourceId"));assertEquals("部件",aligned.get("sourceKind"));assertEquals("bearing",aligned.get("targetId"));assertEquals("catalog",aligned.get("sourceTypingMethod"));assertEquals("exact_name_type",aligned.get("sourceAlignmentMethod"));assertEquals("实体",aligned.get("sourceOriginalKind"));
        for(String field:List.of("relationId","documentId","documentVersion","chunkHash","sourceExcerpt"))assertEquals(raw.get(field),aligned.get(field));assertFalse(raw.containsKey("sourceId"));
    }
    @Test void normalizesWidthCaseWhitespaceAndTypeNamesAndAcceptsOnlyCuratedAliases(){
        var catalog=List.of(Map.<String,Object>of("id","m1","name","Motor A","kind","部件","aliases",List.of("马达A")));
        assertEquals("m1",MesEntityAlignment.align(List.of(fact("ＭＯＴＯＲ  Ａ","component")),catalog).get(0).get("sourceId"));
        var alias=MesEntityAlignment.align(List.of(fact("马达A","实体")),catalog).get(0);assertEquals("m1",alias.get("sourceId"));assertEquals("curated_alias_type",alias.get("sourceAlignmentMethod"));
        assertNotEquals("m1",MesEntityAlignment.align(List.of(fact("Motor B","部件")),catalog).get(0).get("sourceId"));
    }
    @Test void exactNamesWinOverAliasCollisionsAndOriginalNodeWinsOverDocumentDuplicate(){
        var catalog=List.of(node("motor","电机","部件"),Map.<String,Object>of("id","other","name","另一个电机","kind","设备","aliases",List.of("电机")),Map.<String,Object>of("id","duplicate","name","电机","kind","部件","origin","DOCUMENT"));
        assertEquals("motor",MesEntityAlignment.align(List.of(fact("电机","实体")),catalog).get(0).get("sourceId"));
    }
    @Test void neverMergesSubstringMatchesOrIncompatibleTypes(){
        var catalog=List.of(node("motor","电机","部件"));
        assertNotEquals("motor",MesEntityAlignment.align(List.of(fact("伺服电机","部件")),catalog).get(0).get("sourceId"));
        assertNotEquals("motor",MesEntityAlignment.align(List.of(fact("电机","设备")),catalog).get(0).get("sourceId"));
    }
    @Test void ambiguityAndUnresolvedMentionsRemainSeparateAcrossDocuments(){
        var ambiguous=List.of(node("m1","电机","部件"),node("m2","电机","部件"));
        var first=MesEntityAlignment.align(List.of(fact("电机","部件")),ambiguous).get(0);assertEquals("ambiguous",first.get("sourceAlignmentMethod"));assertFalse(Set.of("m1","m2").contains(first.get("sourceId")));
        var other=fact("电机","部件");other.put("documentId",9L);assertNotEquals(first.get("sourceId"),MesEntityAlignment.align(List.of(other),ambiguous).get(0).get("sourceId"));
        var sameNameOtherTypes=List.of(node("m1","电机","部件"),node("m2","电机","设备"));
        assertEquals("实体",MesEntityAlignment.align(List.of(fact("电机","实体")),sameNameOtherTypes).get(0).get("sourceKind"));
    }
    @Test void localTypeDeclarationsAndUnambiguousRelationHintsPropagateWithinDocument(){
        var a=fact("电机","组件");var b=fact("电机","实体");var typed=MesEntityAlignment.align(List.of(a,b),List.of());assertEquals(typed.get(0).get("sourceId"),typed.get(1).get("sourceId"));assertEquals("document_declaration",typed.get(1).get("sourceTypingMethod"));
        var parent=fact("未知整机","实体");parent.put("targetName","新驱动部件");parent.put("targetKind","实体");parent.put("relation","包含部件");var again=fact("新驱动部件","实体");
        var facts=MesEntityAlignment.align(List.of(parent,again),List.of());assertEquals("部件",facts.get(1).get("sourceKind"));assertEquals(facts.get(0).get("targetId"),facts.get(1).get("sourceId"));
    }
    @Test void unrelatedDocumentsDoNotGainInventedConnectionsOrSharedUnknownEndpoints(){
        var a=fact("独立研究甲","实体");a.put("targetName","独立研究乙");a.put("targetKind","实体");var b=new LinkedHashMap<>(a);b.put("documentId",9L);
        var first=MesEntityAlignment.align(List.of(a),List.of(node("motor","电机","部件")));var second=MesEntityAlignment.align(List.of(b),List.of());
        assertEquals(1,first.size());assertNotEquals(first.get(0).get("sourceId"),second.get(0).get("sourceId"));assertEquals("实体",first.get(0).get("sourceKind"));assertEquals("关联",first.get(0).get("relation"));
    }
}
