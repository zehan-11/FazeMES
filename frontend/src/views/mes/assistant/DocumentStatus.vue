<script setup lang="ts">
import SuccessMark from '@/components/SuccessMark.vue'
import type { KnowledgeDocument } from '@/api/mes/assistant'

const props = defineProps<{ doc: KnowledgeDocument; kind: 'vector' | 'graph' }>()
const justIndexed = ref(false)
let pulse: ReturnType<typeof setTimeout> | undefined
// A background refresh can replace the row. Only signal a newly usable version of the same document.
watch(
  [() => props.doc.id, () => props.doc.version, () => props.doc.vectorUsable],
  ([id, version, usable], [lastId, lastVersion, wasUsable]) => {
    clearTimeout(pulse)
    justIndexed.value =
      props.kind === 'vector' && id === lastId && usable && (!wasUsable || lastVersion !== version)
    if (justIndexed.value)
      pulse = setTimeout(() => {
        justIndexed.value = false
      }, 1600)
  }
)
onBeforeUnmount(() => clearTimeout(pulse))
const vectorLabels = {
  NOT_INDEXED: '未索引',
  READY: '待发布',
  PENDING: '等待入库',
  PROCESSING: '处理中',
  INDEXED: '已入库',
  ERROR: '入库失败',
  WAITING_CONFIG: '待配置',
  CONFIG_CHANGED: '配置已变更',
  STALE: '版本已变更',
  REMOVED: '已移除'
}
const graphLabels = {
  NOT_INDEXED: '未建图',
  READY: '待发布',
  EMPTY: '未识别关系',
  PENDING: '等待同步',
  SYNCED: '已建图',
  ERROR: '同步失败',
  INVALID: '格式待检查',
  REMOVED: '已移除'
}
const state = computed(() => {
  const d = props.doc
  if (props.kind === 'graph') {
    const label = graphLabels[d.graphStatus] || '未建图'
    return {
      text: '图谱' + label,
      tone:
        d.graphStatus === 'SYNCED'
          ? 'ready'
          : ['ERROR', 'INVALID'].includes(d.graphStatus)
            ? 'warn'
            : '',
      details: [
        label,
        d.graphEntityCount + ' 个实体 · ' + d.graphRelationCount + ' 条关系',
        d.graphError
      ]
    }
  }
  const removing = d.vectorAction === 'REMOVE'
  const progress = (d.vectorCompletedChunks ?? 0) + '/' + (d.vectorChunkCount ?? 0)
  const label = removing
    ? d.vectorStatus === 'ERROR'
      ? '清理失败'
      : d.vectorStatus === 'REMOVED'
        ? '已移除'
        : '清理旧向量'
    : vectorLabels[d.vectorStatus] || '未索引'
  const showProgress =
    !removing &&
    d.vectorChunkCount > 0 &&
    (d.vectorUsable || ['PENDING', 'PROCESSING'].includes(d.vectorStatus))
  return {
    text: '向量 ' + (showProgress ? progress : label),
    tone: d.vectorUsable
      ? 'ready'
      : ['ERROR', 'CONFIG_CHANGED', 'STALE'].includes(d.vectorStatus)
        ? 'warn'
        : '',
    details: [
      label + (d.vectorUsable && d.vectorIndexedVersion ? ' · v' + d.vectorIndexedVersion : ''),
      d.vectorChunkCount ? progress + ' 个向量切片' : undefined,
      [d.vectorModel, d.vectorDimensions ? d.vectorDimensions + ' 维' : undefined]
        .filter(Boolean)
        .join(' · '),
      d.vectorError
    ]
  }
})
</script>

<template>
  <el-tooltip placement="top" :trigger="['hover', 'focus', 'click']" :show-after="120">
    <template #content>
      <div v-for="detail in state.details.filter(Boolean)" :key="detail" class="status-detail">{{
        detail
      }}</div>
    </template>
    <button type="button" class="status-pill" :class="state.tone">
      <SuccessMark v-if="justIndexed" />
      <i v-else-if="state.tone === 'ready'" class="fm-live-dot" aria-hidden="true"></i
      >{{ state.text }}
    </button>
  </el-tooltip>
</template>

<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
  border-radius: 999px;
  color: var(--fm-muted);
  background: color-mix(in srgb, currentColor 7%, transparent);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  cursor: help;
  white-space: nowrap;
}
.status-pill:not(.ready)::before {
  content: '';
  inline-size: 5px;
  block-size: 5px;
  border-radius: 50%;
  background: currentColor;
}
.status-pill.ready {
  color: var(--fm-tone-success);
}
.status-pill.warn {
  color: var(--fm-tone-warning);
}
.status-detail {
  max-width: min(360px, 82vw);
  overflow-wrap: anywhere;
  line-height: 1.7;
}
</style>
