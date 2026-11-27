<template>
  <el-select
    v-model="selectedBases"
    multiple
    collapse-tags
    collapse-tags-tooltip
    placeholder="全部可访问的已发布知识库"
    aria-label="检索知识库范围"
    class="assistant-base-select"
  >
    <el-option v-for="base in bases" :key="base.id" :label="base.name" :value="base.id" />
  </el-select>
  <label class="assistant-method"
    >检索模式
    <el-select
      v-model="retrievalMode"
      aria-label="检索模式"
      class="assistant-mode-select"
      :disabled="sending"
    >
      <el-option label="文档检索" value="DOCUMENT" />
      <el-option label="图谱检索" value="GRAPH" />
      <el-option label="混合检索" value="HYBRID" />
    </el-select>
  </label>
  <label v-if="retrievalMode !== 'GRAPH'" class="assistant-method">
    文档策略
    <el-select
      v-model="documentStrategy"
      aria-label="文档检索策略"
      class="assistant-mode-select"
      :disabled="sending"
    >
      <el-option label="综合（关键词＋语义）" value="COMBINED" />
      <el-option label="语义检索" value="SEMANTIC" />
      <el-option label="关键词检索" value="LEXICAL" />
    </el-select>
  </label>
  <label v-if="retrievalMode !== 'DOCUMENT'" class="assistant-method"
    >关联范围
    <el-select v-model="retrievalHops" aria-label="图谱检索跳数" class="assistant-hop-select">
      <el-option label="一跳关系" :value="1" />
      <el-option label="两跳关系" :value="2" />
    </el-select>
  </label>
</template>

<script setup lang="ts">
import type { KnowledgeBase } from '@/api/mes/assistant'
import type { DocumentStrategy, RetrievalMode } from '@/api/mes/assistant/evidence'
defineProps<{ bases: KnowledgeBase[]; sending: boolean }>()
const selectedBases = defineModel<number[]>('selectedBases', { required: true })
const retrievalMode = defineModel<RetrievalMode>('retrievalMode', { required: true })
const documentStrategy = defineModel<DocumentStrategy>('documentStrategy', { required: true })
const retrievalHops = defineModel<1 | 2>('retrievalHops', { required: true })
</script>

<style scoped>
.assistant-method {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.assistant-mode-select {
  width: 140px;
}
.assistant-hop-select {
  width: 125px;
}
.assistant-base-select {
  width: min(280px, 100%);
}
</style>
