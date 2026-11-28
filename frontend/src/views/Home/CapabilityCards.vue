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

type Metric = { value: string; detail: string; live?: boolean; failed?: boolean }
async function faceMetric(): Promise<Metric> {
  const face = await FaceApi.status()
  return {
    value: face.enrolled ? '已录入 · 已开启' : '未录入',
    live: face.enrolled,
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
  const graph = await GraphApi.overview(24, undefined, true)
  return {
    value: graph.nodes.length + ' 个实体 · ' + graph.relations.length + ' 条关系',
    detail: graph.hasMore ? '当前预览范围 · 进入图谱查看全部' : '当前账号可见图谱'
  }
}
const metrics = reactive<Record<string, Metric>>({})
let generation = 0
async function readCard(card: (typeof cards.value)[number], version: number) {
  metrics[card.key] = { value: '读取中…', detail: '' }
  try {
    const result = await card.read()
    if (version === generation) metrics[card.key] = result
  } catch {
    if (version === generation)
      metrics[card.key] = { value: '读取失败', detail: '进入模块查看', failed: true }
  }
}
async function refresh() {
  const version = ++generation
  await Promise.all(cards.value.map((card) => readCard(card, version)))
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
  <section v-if="cards.length" class="capabilities fm-panel" aria-label="系统能力直达">
    <div v-for="card in cards" :key="card.key" class="capability" :class="card.key">
      <button
        type="button"
        class="feature-link"
        :title="metrics[card.key]?.detail"
        @click="router.push(card.path)"
      >
        <span class="feature-icon"
          ><el-icon><component :is="card.icon" /></el-icon
        ></span>
        <span class="capability-copy">
          <strong>{{ card.title }}</strong>
          <span :class="{ live: metrics[card.key]?.live, failed: metrics[card.key]?.failed }">{{
            metrics[card.key]?.value
          }}</span>
        </span>
        <el-icon class="open-feature"><ArrowRight /></el-icon>
      </button>
      <button
        v-if="metrics[card.key]?.failed"
        type="button"
        class="retry"
        :aria-label="'重试' + card.title"
        @click="readCard(card, generation)"
        >重试</button
      >
    </div>
  </section>
</template>

<style scoped lang="scss">
.capabilities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
  padding: 8px 0;
}

.capability {
  display: flex;
  min-width: 0;
  padding: 0 14px;
  align-items: center;
}

.capability + .capability {
  border-left: 1px solid var(--fm-divider);
}

.feature-link,
.retry {
  font: inherit;
  color: var(--fm-text);
  cursor: pointer;
  background: none;
  border: 0;
}

.feature-link {
  display: flex;
  min-width: 0;
  min-height: 44px;
  padding: 0 3px;
  text-align: left;
  flex: 1;
  align-items: center;
  gap: 10px;
}

.feature-link:hover .capability-copy strong,
.retry:hover {
  text-decoration: underline;
}

.feature-icon {
  display: grid;
  width: 35px;
  height: 35px;
  font-size: 19px;
  color: var(--fm-blue-ink);
  background: var(--fm-card);
  border-radius: 9px;
  flex-shrink: 0;
  place-items: center;
}

.face .feature-icon,
.live {
  color: var(--fm-tone-success);
}

.capability-copy {
  display: grid;
  gap: 2px;
  font-size: 12px;
  color: var(--fm-secondary);
}

.capability-copy strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--fm-text);
}

.open-feature {
  margin-inline-start: auto;
  color: var(--fm-muted);
}

.capability-copy .failed,
.retry {
  color: var(--fm-tone-warning);
}

.retry {
  padding: 4px;
  font-size: 12px;
}

@container (max-width: 700px) {
  .capabilities {
    grid-template-columns: minmax(0, 1fr);
  }

  .capability + .capability {
    border-top: 1px solid var(--fm-divider);
    border-left: 0;
  }
}
</style>
