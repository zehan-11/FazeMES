<script setup lang="ts">
import { ArrowRight, Connection, Files, View } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/modules/user'
import { FaceApi } from '@/api/mes/face'
import { AssistantApi } from '@/api/mes/assistant'
import { GraphApi } from '@/api/mes/graph'
import { checkPermi } from '@/utils/permission'

const router = useRouter()
const user = useUserStore()
const assigned = (path: string) => router.getRoutes().some((route) => route.path === path)
const hasLibrary = computed(
  () =>
    assigned('/mes/assistant') && checkPermi(['mes:assistant:knowledge', 'mes:assistant:manage'])
)
const hasFace = computed(() => assigned('/mes/face') && checkPermi(['mes:face:enroll']))
const cards = computed(() =>
  [
    {
      key: 'face',
      title: '人脸安全认证',
      icon: View,
      path: '/mes/face',
      read: faceMetric,
      allowed: hasFace.value
    },
    {
      key: 'library',
      title: '私有知识库 RAG',
      icon: Files,
      path: '/mes/assistant?tab=knowledge',
      read: libraryMetric,
      allowed: hasLibrary.value
    },
    {
      key: 'graph',
      title: '设备知识图谱 GraphRAG',
      icon: Connection,
      path: '/mes/assistant?tab=graph',
      read: graphMetric,
      allowed: hasLibrary.value
    }
  ].filter((card) => card.allowed)
)

type Metric = { value: string; detail: string }
async function faceMetric(): Promise<Metric> {
  const face = await FaceApi.status()
  return {
    value: face.enrolled ? '已录入 · 已开启' : '未录入',
    detail: '人脸比对服务' + (face.ready ? '已就绪' : '未就绪')
  }
}
async function libraryMetric(): Promise<Metric> {
  const bases = (await AssistantApi.bases()).filter(
    (base) => base.libraryType === 'PERSONAL' && base.documentCount > 0
  )
  let indexed = 0,
    completed = 0,
    total = 0
  for (let start = 0; start < bases.length; start += 4) {
    const lists = await Promise.all(
      bases.slice(start, start + 4).map((base) => AssistantApi.documents(base.id))
    )
    for (const doc of lists.flat()) {
      if (doc.status !== 'PUBLISHED') continue
      if (doc.vectorUsable) indexed++
      total += doc.chunkCount
      if (
        doc.vectorUsable ||
        (doc.vectorAction === 'INDEX' && doc.vectorTaskVersion === doc.version)
      )
        completed += Math.min(doc.vectorCompletedChunks || 0, doc.chunkCount)
    }
  }
  return {
    value: indexed + ' 份已索引',
    detail: '个人已发布文档 · 向量切片 ' + completed + ' / ' + total
  }
}
async function graphMetric(): Promise<Metric> {
  const graph = await GraphApi.overview(24)
  return {
    value: graph.nodes.length + ' 个实体 · ' + graph.relations.length + ' 条关系',
    detail: graph.hasMore ? '当前预览范围 · 进入图谱查看全部' : '当前账号可见图谱'
  }
}
const metrics = reactive<Record<string, Metric>>({})
let generation = 0
async function refresh() {
  const version = ++generation
  await Promise.all(
    cards.value.map(async (card) => {
      metrics[card.key] = { value: '读取中…', detail: '' }
      try {
        const result = await card.read()
        if (version === generation) metrics[card.key] = result
      } catch {
        if (version === generation)
          metrics[card.key] = { value: '暂时无法读取', detail: '进入模块查看或重试' }
      }
    })
  )
}
watch([() => user.getUser.id, hasFace, hasLibrary], refresh, { immediate: true })
defineExpose({ refresh })
let leftPage = false
onDeactivated(() => {
  leftPage = true
})
onActivated(() => {
  if (leftPage) {
    leftPage = false
    void refresh()
  }
})
onBeforeUnmount(() => {
  generation++
})
</script>

<template>
  <section v-if="cards.length" class="capabilities" aria-label="阶段二能力直达">
    <button
      v-for="card in cards"
      :key="card.key"
      class="capability"
      :class="card.key"
      type="button"
      @click="router.push(card.path)"
    >
      <span class="feature-icon"
        ><el-icon><component :is="card.icon" /></el-icon
      ></span>
      <span class="capability-copy"
        ><span>{{ card.title }}</span
        ><strong>{{ metrics[card.key]?.value }}</strong
        ><small>{{ metrics[card.key]?.detail }}</small></span
      >
      <el-icon class="open-feature"><ArrowRight /></el-icon>
    </button>
  </section>
</template>

<style scoped>
.capabilities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 235px), 1fr));
  gap: 13px;
  margin-bottom: 16px;
}
.capability {
  --accent: var(--fm-blue-ink);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 17px;
  border: 1px solid var(--fm-line);
  border-radius: var(--fm-panel-radius);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 72%),
    var(--fm-card);
  box-shadow:
    inset 0 1px var(--fm-highlight),
    var(--fm-shadow);
  font-family: inherit;
  color: var(--fm-text);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--fm-motion),
    transform var(--fm-motion);
}
.face {
  --accent: var(--fm-tone-success);
}
.capability:hover,
.capability:focus-visible {
  border-color: var(--fm-focus);
  transform: translateY(-1px);
}
.feature-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: var(--accent);
  font-size: 19px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.capability-copy {
  display: grid;
  gap: 5px;
  font-size: 13px;
}
.capability-copy strong {
  font-size: clamp(16px, 1.3vw, 20px);
  font-variant-numeric: tabular-nums;
}
.capability-copy small {
  font-size: 12px;
  color: var(--fm-muted);
}
.open-feature {
  margin-top: 4px;
  color: var(--fm-muted);
}
@media (prefers-reduced-motion: reduce) {
  .capability:hover {
    transform: none;
  }
}
</style>
