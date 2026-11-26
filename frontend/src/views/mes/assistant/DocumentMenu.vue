<script lang="ts">
export type DocumentAction =
  | 'download'
  | 'update'
  | 'versions'
  | 'publish'
  | 'vector'
  | 'graph'
  | 'delete'
</script>
<script setup lang="ts">
import type { KnowledgeDocument } from '@/api/mes/assistant'
defineProps<{ doc: KnowledgeDocument; manage: boolean; submitting: boolean }>()
const emit = defineEmits<{ action: [command: DocumentAction] }>()
</script>

<template>
  <el-dropdown trigger="click" @command="(command) => emit('action', command)">
    <el-button class="doc-more" size="small" round :aria-label="'更多文档操作，' + doc.title"
      >···</el-button
    >
    <template #dropdown
      ><el-dropdown-menu>
        <el-dropdown-item command="download">下载原文件</el-dropdown-item>
        <template v-if="manage">
          <el-dropdown-item command="update">更新文件</el-dropdown-item>
          <el-dropdown-item command="versions">历史版本</el-dropdown-item>
          <el-dropdown-item command="publish">{{
            doc.status === 'PUBLISHED' ? '撤回发布' : '发布文档'
          }}</el-dropdown-item>
          <el-dropdown-item
            v-if="doc.status === 'PUBLISHED'"
            command="vector"
            divided
            :disabled="submitting || ['PENDING', 'PROCESSING'].includes(doc.vectorStatus)"
            >重建向量索引</el-dropdown-item
          >
          <el-dropdown-item command="graph" :disabled="doc.graphStatus === 'PENDING'"
            >重新建图</el-dropdown-item
          >
          <el-dropdown-item command="delete" divided class="delete-doc">删除文档</el-dropdown-item>
        </template>
      </el-dropdown-menu></template
    >
  </el-dropdown>
</template>

<style scoped>
.doc-more {
  min-width: 32px;
  font-weight: 700;
  letter-spacing: 1px;
}
.delete-doc {
  color: var(--fm-tone-danger);
}
</style>
