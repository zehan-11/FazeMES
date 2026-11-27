<script setup lang="ts">
import type { KnowledgeDocument } from '@/api/mes/assistant'
import GlassSkeleton from '@/components/GlassSkeleton.vue'
import { Document, Search } from '@element-plus/icons-vue'
import DocumentMenu, { type DocumentAction } from './DocumentMenu.vue'
import DocumentStatus from './DocumentStatus.vue'
import { formatAssistantTime } from './assistantTime'

// The list endpoint includes updateTime; older deployments only return createTime.
type ListedDocument = KnowledgeDocument & { updateTime?: string | number }
const props = defineProps<{
  documents: ListedDocument[]
  view: 'cards' | 'list'
  manage: boolean
  loading: boolean
  submitting: Set<number>
}>()
const filterText = ref('')
const visibleDocuments = computed(() => {
  const term = filterText.value.trim().toLocaleLowerCase()
  return term
    ? props.documents.filter((doc) =>
        [doc.title, doc.fileName].some((name) => name.toLocaleLowerCase().includes(term))
      )
    : props.documents
})
const emit = defineEmits<{
  preview: [id: number]
  action: [command: DocumentAction, doc: KnowledgeDocument]
}>()
const format = (doc: KnowledgeDocument) =>
  (doc.fileName.split('.').pop() || doc.fileType).toUpperCase()
const timestamp = (doc: ListedDocument) =>
  (doc.updateTime ? '更新于 ' : '创建于 ') + formatAssistantTime(doc.updateTime || doc.createTime)
</script>

<template>
  <section
    v-loading="loading && documents.length > 0"
    class="document-collection"
    aria-label="知识文档"
    :aria-busy="loading"
  >
    <el-input
      v-if="documents.length || filterText"
      v-model="filterText"
      class="document-filter"
      aria-label="筛选当前库文档"
      placeholder="按标题或文件名筛选"
      :prefix-icon="Search"
      clearable
    />
    <GlassSkeleton
      v-if="loading && !documents.length"
      :variant="view === 'cards' ? 'cards' : 'list'"
      label="正在加载文档"
    />
    <el-empty
      v-else-if="!visibleDocuments.length"
      :description="filterText.trim() ? '没有匹配的文档' : '当前知识库没有可见文档'"
      :image-size="65"
    />
    <TransitionGroup v-if="view === 'cards'" tag="div" name="card-grid" class="document-grid">
      <div v-for="(doc, i) in visibleDocuments" :key="doc.id" class="document-slot">
        <article
          v-tech-card
          class="document-card fm-hud fm-stagger"
          :style="{ '--i': Math.min(i, 7) }"
        >
          <header>
            <span class="format-badge"
              ><el-icon><Document /></el-icon>{{ format(doc) }}</span
            >
            <span class="version">v{{ doc.version }}</span>
            <DocumentMenu
              :doc="doc"
              :manage="manage"
              :submitting="submitting.has(doc.id)"
              @action="emit('action', $event, doc)"
            />
          </header>
          <button
            class="doc-title"
            type="button"
            :title="doc.title"
            @click="emit('preview', doc.id)"
            >{{ doc.title }}</button
          >
          <small class="filename" :title="doc.fileName">{{ doc.fileName }}</small>
          <div class="metadata"
            ><span>{{ doc.status === 'PUBLISHED' ? '已发布' : '草稿' }}</span
            ><time>{{ timestamp(doc) }}</time></div
          >
          <footer
            ><DocumentStatus :doc="doc" kind="vector" /><DocumentStatus :doc="doc" kind="graph"
          /></footer>
        </article>
      </div>
    </TransitionGroup>
    <el-table
      v-else-if="visibleDocuments.length"
      :data="visibleDocuments"
      row-key="id"
      class="document-list"
    >
      <el-table-column prop="title" label="文档" min-width="180" show-overflow-tooltip />
      <el-table-column label="格式" width="78"
        ><template #default="{ row }">{{ format(row) }}</template></el-table-column
      >
      <el-table-column label="版本" width="64"
        ><template #default="{ row }">v{{ row.version }}</template></el-table-column
      >
      <el-table-column label="发布状态" width="92"
        ><template #default="{ row }">{{
          row.status === 'PUBLISHED' ? '已发布' : '草稿'
        }}</template></el-table-column
      >
      <el-table-column prop="chunkCount" label="切片" width="64" />
      <el-table-column label="文档向量" min-width="125"
        ><template #default="{ row }"><DocumentStatus :doc="row" kind="vector" /></template
      ></el-table-column>
      <el-table-column label="知识图谱" min-width="128"
        ><template #default="{ row }"><DocumentStatus :doc="row" kind="graph" /></template
      ></el-table-column>
      <el-table-column label="文档时间" min-width="185"
        ><template #default="{ row }">{{ timestamp(row) }}</template></el-table-column
      >
      <el-table-column label="操作" width="130" fixed="right"
        ><template #default="{ row }">
          <div class="list-actions"
            ><el-button link type="primary" @click="emit('preview', row.id)">预览溯源</el-button>
            <DocumentMenu
              :doc="row"
              :manage="manage"
              :submitting="submitting.has(row.id)"
              @action="emit('action', $event, row)"
            />
          </div> </template
      ></el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.document-filter {
  display: flex;
  width: min(100%, 260px);
  margin: 0 0 12px auto;
}
.document-slot {
  min-width: 0;
  display: grid;
}
.card-grid-move {
  transition: transform 0.32s var(--fm-ease);
}
.card-grid-enter-active {
  transition:
    opacity 0.2s,
    transform 0.28s var(--fm-ease);
}
.card-grid-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
/* Hide removed documents immediately while their neighbours settle. */
.card-grid-leave-active {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  .card-grid-move,
  .card-grid-enter-active {
    transition: none;
  }
  .card-grid-enter-from {
    opacity: 1;
    transform: none;
  }
}

.document-collection {
  container-type: inline-size;
  min-width: 0;
  min-height: 90px;
}
.document-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.document-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 17px 15px 13px;
  background: var(--fm-card-glass);
  backdrop-filter: var(--fm-card-filter);
  border: 1px solid var(--fm-line);
  border-radius: var(--fm-panel-radius);
  box-shadow:
    inset 0 1px var(--fm-highlight),
    var(--fm-shadow);
  transition:
    border-color var(--fm-motion),
    transform var(--fm-motion);
}
.document-card:hover,
.document-card:focus-within {
  border-color: var(--fm-strong-line);
}
.document-card header,
.document-card footer,
.metadata,
.list-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.document-card header {
  margin-bottom: 18px;
}
.document-card header > :last-child {
  margin-left: auto;
}
.format-badge,
.version {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font:
    600 11px/18px ui-monospace,
    monospace;
}
.format-badge {
  padding: 2px 7px;
  background: var(--fm-hover);
  color: var(--fm-blue-ink);
  border-radius: 5px;
}
.version {
  padding: 0 6px;
  color: var(--fm-muted);
  border: 1px solid var(--fm-line);
  border-radius: 20px;
}
.doc-title {
  display: -webkit-box;
  overflow: hidden;
  padding: 0;
  color: var(--fm-text);
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 16px;
  font-weight: 650;
  line-height: 1.48;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}
.doc-title:hover {
  color: var(--fm-blue-ink);
}
.filename,
.metadata {
  margin-top: 5px;
  color: var(--fm-muted);
  font-size: 12px;
}
.filename {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.metadata {
  flex-wrap: wrap;
  justify-content: space-between;
  margin-block: auto 0;
  padding-block: 14px 10px;
}
.document-card footer {
  padding-top: 10px;
  border-top: 1px solid var(--fm-divider);
  flex-wrap: wrap;
}
.document-list :deep(td.el-table__cell) {
  padding-block: 13px;
}
@container (max-width: 895px) {
  .document-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@container (max-width: 665px) {
  .document-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 435px) {
  .document-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .document-card:hover,
  .document-card:focus-within {
    transform: none;
  }
}
</style>
