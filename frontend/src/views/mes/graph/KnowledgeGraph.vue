<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  onActivated,
  onDeactivated,
  watch
} from 'vue'
import { AssistantApi } from '@/api/mes/assistant'
import { GraphApi } from '@/api/mes/graph'
import GalaxyCanvas, { type CameraPose2D } from './GalaxyCanvas.vue'
import {
  CATEGORY_SPECS,
  buildCategoryGraph,
  categoryScene,
  type CategoryGraph
} from './categoryGraph'
import type { KnowledgeGraph, GraphRelation } from './graphData'
import { loadCompleteGraph } from './loadCompleteGraph'
import { useGraphLaunch } from './useGraphLaunch'

const emit = defineEmits<{ openDocument: [id: number, version: number] }>()
const emptyGraph: KnowledgeGraph = { nodes: [], relations: [] }
const graph = shallowRef<KnowledgeGraph>(emptyGraph)
const complete = shallowRef<KnowledgeGraph>(emptyGraph)
const model = shallowRef<CategoryGraph>()
const mode = ref<'overview' | 'full'>('overview')
const query = ref('')
const selectedId = ref<string | null>(null)
const trail = ref<string[]>([])
const loading = ref(false)
const replaying = ref(false)
const playingIntro = ref(false)
const launchPending = ref(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const loadProgress = ref('')
const error = ref('')

const sidebarCollapsed = ref(false)
const hoveredKind = ref<string | null>(null)
const activeKindFilter = ref<string | null>(null)
const sidebarHoverId = ref<string | null>(null)

const canvas = ref<InstanceType<typeof GalaxyCanvas>>()
const indexSurface = ref<HTMLElement>()
const launchSkip = ref<HTMLElement>()
const {
  play: playLaunch,
  finish: finishLaunch,
  slide,
  visibleFraction
} = useGraphLaunch(indexSurface, !launchPending.value, launchSkip)
watch(sidebarCollapsed, (closed) => {
  if (!replaying.value && !launchPending.value) slide(!closed)
})
let viewRequest: AbortController | undefined
let overviewPose: CameraPose2D | undefined
let fullPose: CameraPose2D | undefined

const kinds = new Map<string, string>(CATEGORY_SPECS.map(({ label, color }) => [label, color]))
const colorOf = (kind: string) => kinds.get(kind) ?? '#7AA2FF'
const byId = computed(() => new Map(graph.value.nodes.map((node) => [node.id, node])))
const inspectedId = computed(() => selectedId.value ?? '')
const selectedCategory = computed(() => model.value?.categories.get(inspectedId.value))
const selected = computed(
  () => selectedCategory.value?.root ?? model.value?.items.get(inspectedId.value)
)
const selectedDocument = computed(() => model.value?.documents.get(inspectedId.value))

const kindStats = computed(() => {
  const current = model.value
  if (!current) return []
  if (mode.value === 'overview') {
    return CATEGORY_SPECS.map(({ id, label, color }) => ({
      id,
      kind: label,
      color,
      count: current.categories.get(id)?.members.length ?? 0
    }))
  }
  const counts = new Map<string, number>()
  for (const node of complete.value.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => ({ id: kind, kind, count, color: colorOf(kind) }))
})

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  const current = model.value
  if (!current) return []
  if (text) {
    const items = mode.value === 'full' ? complete.value.nodes : [...current.items.values()]
    return items.filter(
      (node) => node.name.toLowerCase().includes(text) || node.kind.toLowerCase().includes(text)
    )
  }
  if (mode.value === 'overview') return selectedCategory.value?.members ?? []
  const kind = activeKindFilter.value
  return kind ? complete.value.nodes.filter((node) => node.kind === kind) : complete.value.nodes
})

const groups = computed(() => {
  const grouped = new Map<string, GraphRelation[]>()
  if (!inspectedId.value || selectedCategory.value) return grouped
  for (const relation of model.value?.neighbors.get(inspectedId.value) ?? []) {
    const group = grouped.get(relation.type) ?? []
    group.push(relation)
    grouped.set(relation.type, group)
  }
  return grouped
})

const nameOf = (id: string) => model.value?.items.get(id)?.name ?? byId.value.get(id)?.name ?? id

function clearSelection() {
  trail.value = []
  selectedId.value = null
  sidebarHoverId.value = null
  hoveredKind.value = null
}

function activateView(target: 'overview' | 'full') {
  const current = model.value
  if (!current) return
  clearSelection()
  activeKindFilter.value = null
  query.value = ''
  mode.value = target
  overviewPose = undefined
  fullPose = undefined
  graph.value = target === 'overview' ? current.overview : complete.value
}

async function loadView(target: 'overview' | 'full') {
  if (model.value) {
    activateView(target)
    return
  }
  viewRequest?.abort()
  const request = new AbortController()
  viewRequest = request
  const { signal } = request
  loading.value = true
  loadProgress.value = '正在读取知识图谱…'
  error.value = ''
  try {
    const [full, documents] = await Promise.all([
      loadCompleteGraph(
        {
          nodes: (cursor) => GraphApi.nodesPage(cursor, signal),
          relations: (cursor) => GraphApi.relationsPage(cursor, signal)
        },
        () => !signal.aborted,
        (nodes, relations) => {
          if (!signal.aborted) loadProgress.value = `已读取 ${nodes} 个实体、${relations} 条关系`
        }
      ),
      AssistantApi.bases()
        .then((bases) =>
          Promise.all(
            bases.map(async (base) =>
              (await AssistantApi.documents(base.id)).map((doc) => ({
                ...doc,
                libraryType: base.libraryType
              }))
            )
          )
        )
        .then((documents) => documents.flat())
    ])
    if (signal.aborted) return
    complete.value = full
    model.value = buildCategoryGraph(full, documents)
    activateView(target)
  } catch (exception) {
    if (!signal.aborted)
      error.value = exception instanceof Error ? exception.message : '图谱加载失败，请重试。'
  } finally {
    if (viewRequest === request) loading.value = false
  }
}

async function showOverview() {
  const saved = overviewPose
  activateView('overview')
  await nextTick()
  if (saved) canvas.value?.restorePose(saved)
  else canvas.value?.reset()
}

async function clearFullFocus() {
  const saved = fullPose
  activateView('full')
  await nextTick()
  if (saved) canvas.value?.restorePose(saved)
  else canvas.value?.reset()
}

function choose(id: string, path: string[]) {
  const current = model.value
  if (loading.value || replaying.value || !current) return
  if (mode.value === 'full') {
    if (!byId.value.has(id)) return
    if (!selectedId.value) fullPose = canvas.value?.getPose()
  } else {
    if (!current.items.has(id) && !current.categories.has(id)) return
    if (!selectedId.value) overviewPose = canvas.value?.getPose()
    graph.value = categoryScene(current, id, path.at(-2))
  }
  selectedId.value = id
  trail.value = path
  sidebarCollapsed.value = false
  sidebarHoverId.value = null
  hoveredKind.value = null
  query.value = ''
}

function pick(id: string) {
  const index = trail.value.lastIndexOf(id)
  choose(id, index < 0 ? [...trail.value, id] : trail.value.slice(0, index + 1))
}

function openKind(id: string) {
  if (mode.value === 'overview') pick(id)
  else activeKindFilter.value = activeKindFilter.value === id ? null : id
}

function onCanvasClear() {
  if (mode.value === 'full') void clearFullFocus()
  else void showOverview()
}

function goBack() {
  if (trail.value.length < 2) {
    onCanvasClear()
    return
  }
  const path = trail.value.slice(0, -1)
  choose(path[path.length - 1], path)
}

async function replayLaunch() {
  if (!model.value || loading.value || replaying.value) return
  replaying.value = true
  finishLaunch()
  activateView('overview')
  sidebarCollapsed.value = false
  await nextTick()
  if (replaying.value) await runIntro()
}

let launchRun = 0
async function runIntro() {
  const run = ++launchRun
  try {
    await playLaunch((start) => {
      playingIntro.value = true
      canvas.value?.playIntro(start)
    })
  } finally {
    if (run === launchRun) skipLaunch()
  }
}

function endBloom() {
  launchRun++
  launchPending.value = false
  replaying.value = false
  playingIntro.value = false
}

function skipLaunch() {
  endBloom()
  finishLaunch(!sidebarCollapsed.value)
  canvas.value?.finishIntro()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (replaying.value || launchPending.value) skipLaunch()
  else if (selectedId.value) goBack()
}

function showDetail() {
  sidebarCollapsed.value = false
  void nextTick(() => {
    indexSurface.value?.querySelector<HTMLElement>('.sidebar-scroll')?.scrollTo({ top: 0 })
    const evidence = indexSurface.value?.querySelector('details')
    if (evidence) evidence.open = true
    indexSurface.value
      ?.querySelector<HTMLElement>('.sidebar-heading')
      ?.focus({ preventScroll: true })
  })
}
onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  await loadView('overview')
  await nextTick()
  if (launchPending.value && model.value) {
    replaying.value = true
    await runIntro()
  } else {
    skipLaunch()
  }
})
onActivated(() => window.addEventListener('keydown', onKeyDown))
onDeactivated(() => {
  sidebarHoverId.value = null
  hoveredKind.value = null
  window.removeEventListener('keydown', onKeyDown)
  skipLaunch()
})
onBeforeUnmount(() => {
  skipLaunch()
  viewRequest?.abort()
  window.removeEventListener('keydown', onKeyDown)
})
defineExpose({ replayLaunch })
</script>

<template>
  <section class="knowledge-graph" aria-label="知识图谱">
    <header class="graph-topbar">
      <button
        v-if="sidebarCollapsed"
        type="button"
        class="top-btn"
        @click="sidebarCollapsed = false"
      >
        展开索引
      </button>
      <button
        type="button"
        class="top-btn"
        :disabled="loading || replaying"
        @click="loadView(mode === 'overview' ? 'full' : 'overview')"
      >
        {{ mode === 'overview' ? '查看全量图谱' : '分类总览' }}
      </button>
    </header>

    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
      class="mb-10px"
    />

    <div
      class="graph-shell"
      :class="{
        'index-closed': sidebarCollapsed,
        'intro-active': replaying || launchPending
      }"
    >
      <button
        v-if="replaying || launchPending"
        ref="launchSkip"
        type="button"
        class="launch-skip"
        @click="skipLaunch"
      >
        跳过
      </button>

      <div class="graph-viewport" :aria-busy="loading" :inert="replaying">
        <GalaxyCanvas
          v-if="graph.nodes.length || launchPending"
          ref="canvas"
          :index-panel="indexSurface"
          :index-open="!sidebarCollapsed"
          :index-reveal="visibleFraction"
          :waiting-for-intro="launchPending && !playingIntro"
          :full="complete"
          :model="model"
          :selected="selectedId"
          :trail="trail"
          :explore="mode === 'overview'"
          :highlight-kind="hoveredKind"
          :active-kind-filter="activeKindFilter"
          :external-hover-id="sidebarHoverId"
          @intro-end="endBloom"
          @select="pick"
          @detail="showDetail"
          @back="goBack"
          @clear="onCanvasClear"
        />
        <div v-else class="graph-placeholder" role="status">
          <span>{{
            loading ? loadProgress : error ? '图谱加载失败' : '当前账号暂无图谱数据'
          }}</span>
          <button v-if="!loading" type="button" class="top-btn is-primary" @click="loadView(mode)">
            重新加载
          </button>
        </div>

        <div
          v-if="loading && graph.nodes.length && !launchPending"
          class="graph-progress"
          role="status"
        >
          {{ loadProgress }}
        </div>
      </div>

      <aside
        ref="indexSurface"
        class="klein-sidebar"
        :class="{ 'is-offscreen': sidebarCollapsed || (launchPending && !playingIntro) }"
        :inert="sidebarCollapsed || replaying || launchPending"
      >
        <div class="sidebar-head">
          <h4 class="sidebar-heading" tabindex="-1" :title="selected?.name">
            {{ selected ? selected.name : '索引与节点信息' }}
          </h4>
          <button
            type="button"
            class="collapse-btn"
            title="收起右侧栏"
            @click="sidebarCollapsed = true"
          >
            ×
          </button>
        </div>

        <div class="sidebar-search">
          <input
            id="graph-search"
            v-model="query"
            type="text"
            class="klein-input"
            placeholder="搜索实体或资料名称"
            :disabled="loading"
            maxlength="100"
          />
          <button v-if="query" type="button" class="clear-search-btn" @click="query = ''">
            清除
          </button>
        </div>

        <div
          v-if="query.trim() || !selected || selectedCategory"
          class="sidebar-scroll"
          aria-label="实体列表"
        >
          <div v-if="selectedCategory && !query.trim()" class="detail-top">
            <button type="button" class="back-link" @click="goBack">{{
              trail.length > 1 ? '← 返回上一层' : '← 返回分类总览'
            }}</button>
            <p v-if="selectedCategory.root.description" class="detail-desc">{{
              selectedCategory.root.description
            }}</p>
            <p v-if="!filtered.length" class="empty-tip">当前账号暂无可见内容。</p>
          </div>
          <div v-if="!selected && !query.trim() && kindStats.length" class="kind-directory">
            <div class="sub-label">分类目录</div>
            <button
              v-for="(item, idx) in kindStats"
              :key="item.kind"
              type="button"
              class="kind-row"
              :class="{ 'is-active': activeKindFilter === item.kind }"
              @focus="hoveredKind = item.kind"
              @blur="hoveredKind = null"
              @mouseenter="hoveredKind = item.kind"
              @mouseleave="hoveredKind = null"
              @click="openKind(item.id)"
            >
              <span class="kind-num">{{ String(idx + 1).padStart(2, '0') }}</span>
              <i class="kind-dot" :style="{ background: item.color }"></i>
              <span class="kind-name">{{ item.kind }}</span>
              <span class="kind-count">{{ item.count }}</span>
            </button>
          </div>

          <div v-if="query.trim() || selectedCategory || mode === 'full'" class="sub-label mt-14px">
            <template v-if="query.trim()">搜索结果（{{ filtered.length }}）</template>
            <template v-else-if="selectedCategory">全部名称（{{ filtered.length }}）</template>
            <template v-else-if="activeKindFilter"
              >筛选：{{ activeKindFilter }}（{{ filtered.length }}）</template
            >
            <template v-else>全部实体</template>
          </div>

          <div class="entity-items">
            <button
              v-for="node in filtered"
              :key="node.id"
              type="button"
              class="entity-row"
              :disabled="loading"
              @mouseenter="sidebarHoverId = node.id"
              @mouseleave="sidebarHoverId = null"
              @click="pick(node.id)"
            >
              <i class="kind-dot" :style="{ background: colorOf(node.kind) }"></i>
              <span class="entity-name">{{ node.name }}</span>
              <small class="entity-kind">{{ node.kind }}</small>
            </button>
          </div>

          <p v-if="query.trim() && !filtered.length" class="empty-tip">没有匹配结果。</p>

          <div v-if="!query.trim() && !selected && model" class="sidebar-metrics">
            <div class="metric-box">
              <strong>{{ complete.nodes.length }}</strong>
              <span>图谱实体数</span>
            </div>
            <div class="metric-box">
              <strong>{{ complete.relations.length }}</strong>
              <span>关系连线数</span>
            </div>
          </div>
        </div>

        <!-- 状态 B：已选中节点 -> 节点简介、分组关系（点击继续下钻）与原文来源溯源 -->
        <div v-else class="sidebar-scroll">
          <div class="detail-top">
            <button type="button" class="back-link" @click="goBack">
              {{
                trail.length > 1
                  ? '← 返回上一层'
                  : mode === 'full'
                    ? '← 返回全图'
                    : '← 返回分类总览'
              }}
            </button>
            <div class="detail-chip-row">
              <span class="detail-chip">
                <i class="kind-dot" :style="{ background: colorOf(selected.kind) }"></i>
                {{ selected.kind }}
              </span>
              <span class="detail-count">{{ groups.size }} 类关系</span>
            </div>
            <p v-if="selected.description" class="detail-desc">{{ selected.description }}</p>
            <button
              v-if="selectedDocument"
              type="button"
              class="back-link"
              @click="emit('openDocument', selectedDocument.id, selectedDocument.version)"
              >查看原文</button
            >
          </div>

          <p v-if="!groups.size" class="empty-tip">当前视图暂无关联关系。</p>

          <div v-for="[type, relations] in groups" :key="type" class="rel-group">
            <div class="sub-label">{{ type }}（{{ relations.length }}）</div>
            <article v-for="edge in relations" :key="edge.id" class="rel-card">
              <div class="rel-path">
                <button
                  v-if="edge.source !== inspectedId"
                  type="button"
                  class="rel-node-btn"
                  @mouseenter="sidebarHoverId = edge.source"
                  @mouseleave="sidebarHoverId = null"
                  @click="pick(edge.source)"
                >
                  {{ nameOf(edge.source) }}
                </button>
                <span v-else class="rel-self">{{ nameOf(edge.source) }}</span>

                <span class="rel-arrow" aria-label="指向">→</span>

                <button
                  v-if="edge.target !== inspectedId"
                  type="button"
                  class="rel-node-btn"
                  @mouseenter="sidebarHoverId = edge.target"
                  @mouseleave="sidebarHoverId = null"
                  @click="pick(edge.target)"
                >
                  {{ nameOf(edge.target) }}
                </button>
                <span v-else class="rel-self">{{ nameOf(edge.target) }}</span>
              </div>

              <details class="evidence-box">
                <summary>
                  查看来源<span v-if="edge.sourceEvidence.section">
                    · {{ edge.sourceEvidence.section }}</span
                  >
                </summary>
                <p class="evidence-title">{{ edge.sourceEvidence.title }}</p>
                <p v-if="edge.sourceEvidence.documentId" class="evidence-meta">
                  文档 #{{ edge.sourceEvidence.documentId }} · 版本
                  {{ edge.sourceEvidence.documentVersion }}
                  <span v-if="edge.sourceEvidence.pageNumber">
                    · 第 {{ edge.sourceEvidence.pageNumber }} 页</span
                  >
                  <span v-if="edge.sourceEvidence.chunkId">
                    · 片段 #{{ edge.sourceEvidence.chunkId }}</span
                  >
                </p>
                <blockquote class="evidence-quote">{{ edge.sourceEvidence.excerpt }}</blockquote>
              </details>
            </article>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.knowledge-graph {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: min(620px, 100%);
  background: #020618;
  color: #fff;
  border: 4px solid #0022cc;
  overflow: hidden;
}
.graph-topbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 36px;
  gap: 8px;
  padding: 0 9px;
  background: #0022cc;
}
.top-btn,
.top-btn.is-primary {
  padding: 5px 13px;
  color: #0022cc;
  font-size: 12px;
  font-weight: 650;
  border: 0;
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  transition: opacity 150ms ease;
}
.top-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.top-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.graph-shell {
  --index-width: min(272px, 46%);
  --hud-inset: var(--index-width);
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.graph-shell.index-closed {
  --hud-inset: 0px;
}
.graph-viewport {
  position: absolute;
  inset: 0;
}
.launch-skip {
  position: absolute;
  z-index: 3;
  top: 16px;
  right: 18px;
  padding: 7px 13px;
  color: #dce7ff;
  cursor: pointer;
  background: #0022cc;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 1px;
}

.graph-placeholder {
  display: grid;
  height: 100%;
  padding: 24px;
  color: rgba(200, 218, 255, 0.78);
  place-content: center;
  justify-items: center;
  gap: 12px;
}

.graph-progress {
  position: absolute;
  top: 52px;
  left: 14px;
  padding: 6px 12px;
  font-size: 12px;
  background: rgba(0, 34, 204, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.klein-sidebar {
  position: absolute;
  z-index: 2;
  inset: 0 0 0 auto;
  box-sizing: border-box;
  width: var(--index-width);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  background: #0022cc;
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  transform: translateX(0);
}
.klein-sidebar.is-offscreen {
  transform: translateX(100%);
}
.sidebar-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
}

.sidebar-heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-btn {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  color: #ffffff;
  cursor: pointer;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.collapse-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.sidebar-search {
  display: flex;
  gap: 6px;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
}

.klein-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  font-size: 12px;
  color: #ffffff;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.28);
  outline: none;
}

.klein-input::placeholder {
  color: rgba(255, 255, 255, 0.62);
}

.klein-input:focus {
  border-color: #ffffff;
}

.clear-search-btn {
  padding: 0 10px;
  font-size: 12px;
  color: #ffffff;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.16);
  border: none;
}

.sidebar-scroll {
  flex: 1;
  min-height: 0;
  padding: 14px 16px 18px;
  overflow-y: auto;
}

.sub-label {
  margin-bottom: 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.72);
}

.mt-14px {
  margin-top: 14px;
}

.mb-10px {
  margin-bottom: 10px;
}

.kind-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
}

.kind-directory {
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  padding-bottom: 8px;
}

.kind-row {
  white-space: nowrap;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  padding: 8px 6px;
  font-size: 13px;
  color: #ffffff;
  cursor: pointer;
  background: transparent;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  transition:
    background-color 140ms ease,
    padding-left 140ms ease;
}

.kind-row:hover,
.kind-row.is-active {
  padding-left: 10px;
  background: rgba(255, 255, 255, 0.14);
}

.kind-num {
  order: 2;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.62);
}

.kind-name {
  flex: 1;
  text-align: left;
}

.kind-count {
  order: 3;
  width: 2em;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.entity-items {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.entity-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  font-size: 13px;
  color: #ffffff;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
  transition:
    background-color 140ms ease,
    border-color 140ms ease;
}

.entity-row:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.45);
}

.entity-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-kind {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
}

.sidebar-metrics {
  white-space: nowrap;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.metric-box {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 0;
  background: transparent;
}

.metric-box strong {
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.metric-box::before {
  content: '';
  width: 27px;
  height: 6px;
  border-left: 1px solid rgba(255, 255, 255, 0.5);
  border-top: 1px solid rgba(255, 255, 255, 0.5);
}
.metric-box span {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
}

/* 节点详情与溯源 */
.detail-top {
  padding-bottom: 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
}

.back-link {
  padding: 0;
  margin-bottom: 10px;
  font-size: 12px;
  color: #dbe8ff;
  cursor: pointer;
  background: transparent;
  border: none;
}

.back-link:hover {
  color: #ffffff;
  text-decoration: underline;
}

.detail-chip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.detail-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  font-size: 12px;
  background: transparent;
}

.detail-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.76);
}

.detail-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.92);
}

.rel-group {
  margin-bottom: 14px;
}

.rel-card {
  padding: 9px 10px;
  margin-bottom: 6px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
}

.rel-path {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 13px;
}

.rel-node-btn {
  padding: 1px 4px;
  font-size: inherit;
  color: #ffffff;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
}

.rel-node-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

.rel-self {
  color: rgba(255, 255, 255, 0.85);
}

.rel-arrow {
  color: rgba(255, 255, 255, 0.65);
}

.evidence-box {
  margin-top: 6px;
}

.evidence-box summary {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.76);
  cursor: pointer;
}

.evidence-title {
  margin: 6px 0 3px;
  font-size: 12px;
  font-weight: 600;
}

.evidence-meta {
  margin: 0 0 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
}

.evidence-quote {
  margin: 6px 0 0;
  padding-left: 9px;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(242, 247, 255, 0.92);
  border-left: 2px solid #8cb2ff;
  overflow-wrap: anywhere;
}

.load-more-btn {
  width: 100%;
  padding: 8px 12px;
  margin-top: 6px;
  font-size: 12px;
  color: #ffffff;
  cursor: pointer;
  background: rgba(2, 6, 24, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.load-more-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.18);
}

.empty-tip {
  margin: 10px 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}

@media (max-width: 640px) {
  .sidebar-head,
  .sidebar-search,
  .sidebar-scroll {
    padding-inline: 8px;
  }
  .sidebar-heading {
    font-size: 14px;
  }
  .kind-row {
    gap: 4px;
  }
  .metric-box strong {
    font-size: 21px;
  }
  .metric-box span {
    font-size: 10px;
  }
}
</style>
