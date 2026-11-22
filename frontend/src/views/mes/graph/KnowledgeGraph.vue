<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GalaxyCanvas, { type CameraPose2D } from './GalaxyCanvas.vue'
import {
  buildDeviceOverview,
  mergeKnowledgeGraph,
  type KnowledgeGraph,
  type GraphEntity,
  type GraphRelation
} from './graphData'
import { GraphApi } from '@/api/mes/graph'
import { loadCompleteGraph } from './loadCompleteGraph'

const emptyGraph: KnowledgeGraph = { nodes: [], relations: [] }
const graph = ref<KnowledgeGraph>(emptyGraph)
const overview = ref<KnowledgeGraph>(emptyGraph)
const mode = ref<'overview' | 'full'>('overview')
const overviewEntries = ref<string[]>([])

const KIND_PALETTE: Record<string, string> = {
  设备: '#5B8CFF',
  部件: '#38BDF8',
  工艺: '#818CF8',
  故障: '#F472B6',
  原因: '#FBBF24',
  措施: '#34D399'
}
const colorOf = (kind: string) => KIND_PALETTE[kind] ?? '#7AA2FF'

const query = ref('')
const selectedId = ref<string | null>(null)
const trail = ref<string[]>([])
const loading = ref(false)
const loadProgress = ref('')
const searching = ref(false)
const expanding = ref(false)
const error = ref('')
const searchResults = ref<GraphEntity[]>([])
const searchMore = ref(false)
const neighborMore = ref(false)
const neighborLimit = ref(30)
const selectedRelations = ref<GraphRelation[] | null>(null)

// 右侧克莱因蓝信息栏交互状态
const sidebarCollapsed = ref(false)
const hoveredKind = ref<string | null>(null)
const activeKindFilter = ref<string | null>(null)
const sidebarHoverId = ref<string | null>(null)

const canvas = ref<InstanceType<typeof GalaxyCanvas>>()
let viewRequest: AbortController | undefined
let selectionRequest: AbortController | undefined
let overviewPose: CameraPose2D | undefined
let fullPose: CameraPose2D | undefined

const byId = computed(() => new Map(graph.value.nodes.map((node) => [node.id, node])))
const selected = computed(() => (selectedId.value ? byId.value.get(selectedId.value) : undefined))

const kindStats = computed(() => {
  const counts = new Map<string, number>()
  for (const node of graph.value.nodes) {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
  }
  const order = Object.keys(KIND_PALETTE)
  return [...counts.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map(([kind, count]) => ({ kind, count, color: colorOf(kind) }))
})

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  let base: GraphEntity[]
  if (!text) {
    base =
      mode.value === 'overview'
        ? overviewEntries.value.flatMap((id) => {
            const node = byId.value.get(id)
            return node ? [node] : []
          })
        : graph.value.nodes
  } else if (mode.value === 'overview') {
    base = searchResults.value
  } else {
    base = graph.value.nodes.filter(
      (node) => node.name.toLowerCase().includes(text) || node.kind.toLowerCase().includes(text)
    )
  }
  if (!text && activeKindFilter.value) {
    return graph.value.nodes.filter((n) => n.kind === activeKindFilter.value)
  }
  return base
})

const groups = computed(() => {
  const grouped = new Map<string, GraphRelation[]>()
  const id = selectedId.value
  const relations =
    selectedRelations.value ??
    graph.value.relations.filter((edge) => edge.source === id || edge.target === id)
  for (const relation of relations) {
    const group = grouped.get(relation.type) ?? []
    group.push(relation)
    grouped.set(relation.type, group)
  }
  return grouped
})

const nameOf = (id: string) => byId.value.get(id)?.name ?? id
const messageOf = (value: unknown, fallback: string) =>
  value instanceof Error ? value.message : fallback

function clearSelection() {
  selectionRequest?.abort()
  expanding.value = false
  trail.value = []
  selectedId.value = null
  selectedRelations.value = null
  neighborMore.value = false
  neighborLimit.value = 30
  sidebarHoverId.value = null
}

function toggleKindFilter(kind: string) {
  activeKindFilter.value = activeKindFilter.value === kind ? null : kind
}

async function loadView(target: 'overview' | 'full') {
  viewRequest?.abort()
  selectionRequest?.abort()
  expanding.value = false
  const request = new AbortController()
  viewRequest = request
  const { signal } = request
  loading.value = true
  loadProgress.value = target === 'overview' ? '正在读取设备总览…' : '正在读取全量图谱…'
  error.value = ''
  try {
    let result: KnowledgeGraph
    let entryIds: string[] = []
    if (target === 'overview') {
      const { items } = await GraphApi.search('设备', signal)
      const devices = items.filter((node) => node.kind === '设备').slice(0, 6)
      const entries = devices.length ? devices : (await GraphApi.overview(6, signal)).nodes
      entryIds = entries.map((node) => node.id)
      const neighborhoods = await Promise.all(
        entryIds.map((id) => GraphApi.neighbors(id, 24, signal))
      )
      result = buildDeviceOverview(entries, neighborhoods)
    } else {
      result = await loadCompleteGraph(
        {
          nodes: (cursor) => GraphApi.nodesPage(cursor, signal),
          relations: (cursor) => GraphApi.relationsPage(cursor, signal)
        },
        () => !signal.aborted,
        (nodes, relations) => {
          if (!signal.aborted) loadProgress.value = `已读取 ${nodes} 个实体、${relations} 条关系`
        }
      )
    }
    if (signal.aborted) return
    const merged = mergeKnowledgeGraph(emptyGraph, result)
    clearSelection()
    activeKindFilter.value = null
    query.value = ''
    mode.value = target
    fullPose = undefined
    if (target === 'overview') {
      overview.value = merged
      overviewEntries.value = entryIds
      overviewPose = undefined
    }
    graph.value = merged
  } catch (e) {
    if (!signal.aborted) error.value = messageOf(e, '图谱加载失败，请重试。')
  } finally {
    if (viewRequest === request) loading.value = false
  }
}

async function showOverview() {
  if (mode.value === 'full' || !overview.value.nodes.length) {
    await loadView('overview')
    return
  }
  clearSelection()
  activeKindFilter.value = null
  query.value = ''
  error.value = ''
  graph.value = overview.value
  await nextTick()
  if (overviewPose) canvas.value?.restorePose(overviewPose)
  else canvas.value?.reset()
  overviewPose = undefined
}

async function clearFullFocus() {
  const saved = fullPose
  fullPose = undefined
  clearSelection()
  query.value = ''
  await nextTick()
  if (saved) canvas.value?.restorePose(saved)
  else canvas.value?.reset()
}

async function choose(id: string, path = [...trail.value, id], limit = 30) {
  if (loading.value || (id === selectedId.value && expanding.value)) return
  sidebarCollapsed.value = false
  sidebarHoverId.value = null
  if (mode.value === 'full') {
    if (!byId.value.has(id)) return
    if (!selectedId.value) fullPose = canvas.value?.getPose()
    selectedId.value = id
    trail.value = path
    query.value = ''
    return
  }
  selectionRequest?.abort()
  const request = new AbortController()
  selectionRequest = request
  const { signal } = request
  if (mode.value === 'overview' && !trail.value.length) overviewPose = canvas.value?.getPose()
  const sameNode = selectedId.value === id
  if (!sameNode) {
    selectedRelations.value = null
    neighborMore.value = false
    neighborLimit.value = 30
  }
  if (byId.value.has(id)) {
    selectedId.value = id
    trail.value = path
  }
  expanding.value = true
  error.value = ''
  try {
    const result = await GraphApi.neighbors(id, limit, signal)
    if (signal.aborted) return
    const merged = mergeKnowledgeGraph(graph.value, result)
    if (!merged.nodes.some((node) => node.id === id))
      throw new Error('画布容量已满，请返回总览后继续探索。')
    graph.value = merged
    selectedId.value = id
    trail.value = path
    query.value = ''
    const ids = new Set(merged.nodes.map((node) => node.id))
    selectedRelations.value = result.relations.filter(
      (edge) =>
        (edge.source === id || edge.target === id) && ids.has(edge.source) && ids.has(edge.target)
    )
    neighborLimit.value = limit
    neighborMore.value = result.hasMore || merged.hasMore
  } catch (e) {
    if (!signal.aborted) error.value = messageOf(e, '关系加载失败，点击节点可重试。')
  } finally {
    if (selectionRequest === request) expanding.value = false
  }
}

function pick(id: string) {
  const index = trail.value.lastIndexOf(id)
  const path = index < 0 ? [...trail.value, id] : trail.value.slice(0, index + 1)
  void choose(id, path)
}

function goBack() {
  if (trail.value.length < 2) {
    if (mode.value === 'full') void clearFullFocus()
    else void showOverview()
    return
  }
  const path = trail.value.slice(0, -1)
  void choose(path[path.length - 1], path)
}

function onCanvasClear() {
  if (mode.value === 'full') void clearFullFocus()
  else void showOverview()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && selectedId.value) goBack()
}

watch(query, (value, _, onCleanup) => {
  const text = value.trim()
  searchResults.value = []
  searchMore.value = false
  searching.value = Boolean(text) && mode.value === 'overview'
  if (!searching.value) return
  const request = new AbortController()
  const { signal } = request
  const timer = setTimeout(async () => {
    try {
      const result = await GraphApi.search(text, signal)
      if (signal.aborted) return
      searchResults.value = result.items
      searchMore.value = result.hasMore
    } catch (e) {
      if (!signal.aborted) error.value = messageOf(e, '搜索失败，请重试。')
    } finally {
      if (!signal.aborted) searching.value = false
    }
  }, 300)
  onCleanup(() => {
    clearTimeout(timer)
    request.abort()
  })
})

onMounted(() => {
  void loadView('overview')
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  viewRequest?.abort()
  selectionRequest?.abort()
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <section class="knowledge-graph" aria-label="知识图谱">
    <header class="graph-topbar">
      <div class="graph-brand">
        <span class="brand-tag">KNOWLEDGE GRAPH</span>
        <h3>设备知识图谱</h3>
        <span v-if="mode === 'full' && graph.nodes.length" class="brand-summary">
          全量图谱 · {{ graph.nodes.length }} 实体 · {{ graph.relations.length }} 关系
        </span>
        <span v-else-if="mode === 'overview' && overviewEntries.length" class="brand-summary">
          <template v-if="selected">放射聚焦 · {{ selected.name }}</template>
          <template v-else>
            设备总览 · {{ overviewEntries.length }} 入口 · {{ overview.relations.length }} 关系
          </template>
        </span>
      </div>

      <div class="graph-actions">
        <button type="button" class="top-btn" :disabled="loading" @click="canvas?.reset()">
          重置视角
        </button>
        <button
          v-if="mode === 'full' && selected"
          type="button"
          class="top-btn"
          :disabled="loading"
          @click="clearFullFocus"
        >
          返回全图
        </button>
        <button
          v-else-if="mode === 'full'"
          type="button"
          class="top-btn"
          :disabled="loading"
          @click="loadView('overview')"
        >
          设备总览
        </button>
        <button
          v-else-if="trail.length"
          type="button"
          class="top-btn"
          :disabled="loading"
          @click="showOverview"
        >
          返回设备总览
        </button>
        <button
          v-if="mode === 'overview'"
          type="button"
          class="top-btn is-primary"
          :disabled="loading"
          @click="loadView('full')"
        >
          查看全量图谱
        </button>
      </div>
    </header>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="mb-10px" />

    <div class="graph-shell">
      <!-- 左侧 2D 极简星图主画布 -->
      <div class="graph-viewport" :aria-busy="loading">
        <GalaxyCanvas
          v-if="graph.nodes.length"
          ref="canvas"
          :graph="graph"
          :selected="selectedId"
          :trail="trail"
          :explore="mode === 'overview'"
          :entry-ids="overviewEntries"
          :highlight-kind="hoveredKind"
          :active-kind-filter="activeKindFilter"
          :external-hover-id="sidebarHoverId"
          @select="(id) => id && pick(id)"
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

        <div v-if="loading && graph.nodes.length" class="graph-progress" role="status">
          {{ loadProgress }}
        </div>

        <button
          v-if="sidebarCollapsed"
          type="button"
          class="expand-inspector-btn"
          @click="sidebarCollapsed = false"
        >
          展开节点面板
        </button>
      </div>

      <!-- 右侧克莱因蓝信息与节点详情面板 -->
      <aside class="klein-sidebar" :class="{ 'is-collapsed': sidebarCollapsed }">
        <div class="sidebar-head">
          <div>
            <span class="sidebar-eyebrow">{{ selected ? selected.kind : 'ENTITY INDEX' }}</span>
            <h4 class="sidebar-heading">
              {{ selected ? selected.name : '索引与节点信息' }}
            </h4>
          </div>
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
            placeholder="搜索设备、部件或故障名称..."
            :disabled="loading"
            maxlength="100"
          />
          <button v-if="query" type="button" class="clear-search-btn" @click="query = ''">
            清除
          </button>
        </div>

        <!-- 状态 A：搜索中或未选中节点 -> 编号分类目录 + 实体入口列表 + 统计卡片 -->
        <div v-if="query.trim() || !selected" class="sidebar-scroll" aria-label="实体列表">
          <div v-if="!query.trim() && kindStats.length" class="kind-directory">
            <div class="sub-label">实体分类目录（悬停透视 / 点击筛选）</div>
            <button
              v-for="(item, idx) in kindStats"
              :key="item.kind"
              type="button"
              class="kind-row"
              :class="{ 'is-active': activeKindFilter === item.kind }"
              @mouseenter="hoveredKind = item.kind"
              @mouseleave="hoveredKind = null"
              @click="toggleKindFilter(item.kind)"
            >
              <span class="kind-num">{{ String(idx + 1).padStart(2, '0') }}</span>
              <i class="kind-dot" :style="{ background: item.color }"></i>
              <span class="kind-name">{{ item.kind }}</span>
              <span class="kind-count">{{ item.count }}</span>
            </button>
          </div>

          <div class="sub-label mt-14px">
            <template v-if="query.trim()">
              {{ searching ? '正在搜索…' : `匹配实体 (${filtered.length})` }}
            </template>
            <template v-else-if="activeKindFilter">
              筛选：{{ activeKindFilter }}（{{ filtered.length }}）
            </template>
            <template v-else-if="mode === 'overview'">
              {{ filtered.every((node) => node.kind === '设备') ? '设备入口' : '知识入口' }}
            </template>
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

          <p v-if="!searching && query.trim() && !filtered.length" class="empty-tip">
            没有匹配实体。
          </p>
          <p v-if="searchMore" class="empty-tip">结果较多，请缩小搜索范围。</p>

          <div v-if="!query.trim()" class="sidebar-metrics">
            <div class="metric-box">
              <strong>{{ graph.nodes.length }}</strong>
              <span>图谱实体数</span>
            </div>
            <div class="metric-box">
              <strong>{{ graph.relations.length }}</strong>
              <span>关系连线数</span>
            </div>
          </div>
        </div>

        <!-- 状态 B：已选中节点 -> 节点简介、分组关系（点击继续下钻）与原文来源溯源 -->
        <div v-else class="sidebar-scroll">
          <div class="detail-top">
            <button type="button" class="back-link" @click="goBack">
              {{
                trail.length > 1 ? '← 返回上一层' : mode === 'full' ? '← 返回全图' : '← 返回入口列表'
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
          </div>

          <p v-if="expanding" class="empty-tip" role="status">正在展开关联…</p>
          <p v-else-if="!groups.size" class="empty-tip">当前视图暂无关联关系。</p>

          <div v-for="[type, relations] in groups" :key="type" class="rel-group">
            <div class="sub-label">{{ type }}（{{ relations.length }}）</div>
            <article v-for="edge in relations" :key="edge.id" class="rel-card">
              <div class="rel-path">
                <button
                  v-if="edge.source !== selectedId"
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
                  v-if="edge.target !== selectedId"
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

          <button
            v-if="neighborMore && neighborLimit < 100"
            type="button"
            class="load-more-btn"
            :disabled="expanding"
            @click="choose(selected.id, trail, 100)"
          >
            {{ expanding ? '加载中…' : '查看更多关联' }}
          </button>
          <p v-else-if="neighborMore" class="empty-tip">
            已达到单次展开上限，可通过搜索继续查看。
          </p>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.knowledge-graph {
  background: #020618;
  color: #ffffff;
  border: 1px solid rgba(130, 168, 255, 0.22);
  overflow: hidden;
}

.graph-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 18px;
  background: #050c26;
  border-bottom: 1px solid rgba(130, 168, 255, 0.2);
}

.graph-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.brand-tag {
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #ffffff;
  background: #0022cc;
}

.graph-brand h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.brand-summary {
  font-size: 12px;
  color: rgba(200, 218, 255, 0.72);
}

.graph-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.top-btn {
  padding: 6px 12px;
  font-size: 12px;
  color: #e6efff;
  cursor: pointer;
  background: rgba(130, 168, 255, 0.1);
  border: 1px solid rgba(130, 168, 255, 0.3);
  transition: background-color 150ms ease, border-color 150ms ease;
}

.top-btn:hover:not(:disabled) {
  background: rgba(0, 51, 255, 0.55);
  border-color: #6ea0ff;
}

.top-btn.is-primary {
  background: #0022cc;
  border-color: #3d64ff;
}

.top-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.graph-shell {
  display: flex;
  align-items: stretch;
  min-height: 620px;
}

.graph-viewport {
  position: relative;
  flex: 1;
  min-width: 0;
}

.graph-placeholder {
  display: grid;
  height: 620px;
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

.expand-inspector-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #ffffff;
  cursor: pointer;
  background: #0022cc;
  border: 1px solid rgba(255, 255, 255, 0.32);
}

/* 右侧克莱因蓝信息栏 */
.klein-sidebar {
  display: flex;
  flex-direction: column;
  width: 332px;
  height: 620px;
  flex-shrink: 0;
  color: #ffffff;
  background: #0022cc;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
  transition: width 200ms ease, opacity 180ms ease;
  overflow: hidden;
}

.klein-sidebar.is-collapsed {
  width: 0;
  border-left-width: 0;
  opacity: 0;
}

.sidebar-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
}

.sidebar-eyebrow {
  display: block;
  margin-bottom: 3px;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.72);
}

.sidebar-heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
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
  background: rgba(2, 6, 24, 0.3);
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
  transition: background-color 140ms ease, padding-left 140ms ease;
}

.kind-row:hover,
.kind-row.is-active {
  padding-left: 10px;
  background: rgba(255, 255, 255, 0.16);
}

.kind-num {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.62);
}

.kind-name {
  flex: 1;
  text-align: left;
}

.kind-count {
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
  background: rgba(2, 6, 24, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.14);
  transition: background-color 140ms ease, border-color 140ms ease;
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
  padding: 10px 12px;
  background: rgba(2, 6, 24, 0.24);
}

.metric-box strong {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
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
  background: rgba(2, 6, 24, 0.3);
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
  background: rgba(2, 6, 24, 0.26);
  border: 1px solid rgba(255, 255, 255, 0.14);
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
  background: rgba(255, 255, 255, 0.12);
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

@media (width <= 1000px) {
  .graph-shell {
    flex-direction: column;
  }

  .klein-sidebar {
    width: 100%;
    height: auto;
    max-height: 420px;
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
  }
}
</style>