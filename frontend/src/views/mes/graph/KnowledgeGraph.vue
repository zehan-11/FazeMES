<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GalaxyCanvas from './GalaxyCanvas.vue'
import { mergeKnowledgeGraph, type KnowledgeGraph, type GraphEntity } from './graphData'
import { GraphApi } from '@/api/mes/graph'
import { loadCompleteGraph } from './loadCompleteGraph'
import { STYLE_PRESETS, getVisualPreset, presetColors } from './visualPresets'
const graph = ref<KnowledgeGraph>({ nodes: [], relations: [] })
const presetId = ref('galaxy')
const nebula = ref(getVisualPreset('galaxy').space.nebula)
const bloom = ref(getVisualPreset('galaxy').bloom.strength)
const palette = computed(() => presetColors(presetId.value))
function restorePreset() {
  const preset = getVisualPreset(presetId.value)
  nebula.value = preset.space.nebula
  bloom.value = preset.bloom.strength
}
watch(presetId, restorePreset)
const query = ref('')
const selectedId = ref<string | null>(null)
const rotating = ref(false)
const loading = ref(false)
const loadProgress = ref('')
const layoutPaused = ref(false)
const layoutSettled = ref(false)
const searching = ref(false)
const expanding = ref(false)
const connected = ref(false)
const error = ref('')
const searchResults = ref<GraphEntity[]>([])
const hasMore = ref(false)
const searchMore = ref(false)
const canvas = ref<InstanceType<typeof GalaxyCanvas>>()
let generation = 0,
  searchGeneration = 0,
  selectionGeneration = 0,
  timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let fullRequest: AbortController | undefined
const selected = computed(() => graph.value.nodes.find((node) => node.id === selectedId.value))
const filtered = computed(() => (query.value.trim() ? searchResults.value : graph.value.nodes))
const relations = computed(() =>
  graph.value.relations.filter(
    (edge) => edge.source === selectedId.value || edge.target === selectedId.value
  )
)
const nameOf = (id: string) => graph.value.nodes.find((node) => node.id === id)?.name || id
function fail(e: unknown) {
  error.value = e instanceof Error ? e.message : '图谱加载失败，请检查服务连接后重试'
  connected.value = false
  graph.value = { nodes: [], relations: [] }
  selectedId.value = null
  searchResults.value = []
}
async function refresh() {
  fullRequest?.abort()
  fullRequest = new AbortController()
  const signal = fullRequest.signal
  const request = ++generation
  ++searchGeneration
  ++selectionGeneration
  loading.value = true
  loadProgress.value = '正在读取完整图谱…'
  layoutPaused.value = false
  expanding.value = false
  searching.value = false
  error.value = ''
  connected.value = false
  graph.value = { nodes: [], relations: [] }
  selectedId.value = null
  query.value = ''
  hasMore.value = false
  try {
    const result = await loadCompleteGraph(
      {
        nodes: (cursor) => GraphApi.nodesPage(cursor, signal),
        relations: (cursor) => GraphApi.relationsPage(cursor, signal)
      },
      () => !disposed && request === generation,
      (nodes, relations) => {
        if (!disposed && request === generation)
          loadProgress.value = `已读取 ${nodes} 个实体、${relations} 条关系`
      }
    )
    if (disposed || request !== generation) return
    const merged = mergeKnowledgeGraph({ nodes: [], relations: [] }, result)
    graph.value = merged
    hasMore.value = merged.hasMore
    connected.value = true
  } catch (e) {
    if (!disposed && request === generation) fail(e)
  } finally {
    if (!disposed && request === generation) loading.value = false
  }
}
async function search() {
  const request = ++searchGeneration,
    scope = generation,
    text = query.value.trim()
  searchResults.value = []
  searchMore.value = false
  if (!text) {
    searching.value = false
    return
  }
  searching.value = true
  try {
    const result = await GraphApi.search(text)
    if (
      disposed ||
      scope !== generation ||
      request !== searchGeneration ||
      text !== query.value.trim()
    )
      return
    searchResults.value = result.items
    searchMore.value = result.hasMore
  } catch (e) {
    if (!disposed && scope === generation && request === searchGeneration) fail(e)
  } finally {
    if (!disposed && request === searchGeneration) searching.value = false
  }
}
async function expand(id: string) {
  const request = ++selectionGeneration,
    scope = generation
  expanding.value = true
  error.value = ''
  try {
    const result = await GraphApi.neighbors(id)
    if (disposed || scope !== generation || request !== selectionGeneration) return
    const merged = mergeKnowledgeGraph(graph.value, result)
    graph.value = merged
    selectedId.value = id
    hasMore.value = hasMore.value || result.hasMore || merged.hasMore
    connected.value = true
    await nextTick()
    canvas.value?.focusNode(id)
  } catch (e) {
    if (!disposed && scope === generation && request === selectionGeneration) fail(e)
  } finally {
    if (!disposed && request === selectionGeneration) expanding.value = false
  }
}
function selectLocal(id: string | null) {
  ++selectionGeneration
  expanding.value = false
  selectedId.value = id
}
async function choose(id: string) {
  if (!graph.value.nodes.some((node) => node.id === id)) {
    await expand(id)
    return
  }
  selectLocal(id)
  canvas.value?.focusNode(id)
}
watch(query, () => {
  ++searchGeneration
  searchResults.value = []
  searching.value = !!query.value.trim()
  clearTimeout(timer)
  timer = setTimeout(() => void search(), 300)
})
onMounted(refresh)
onBeforeUnmount(() => {
  disposed = true
  fullRequest?.abort()
  ++generation
  ++searchGeneration
  ++selectionGeneration
  clearTimeout(timer)
})
</script>
<template>
  <section class="knowledge-graph" aria-label="知识图谱">
    <div class="graph-heading">
      <div><h3>知识星系</h3><p>从设备出发，探索部件、故障与处理方法之间的联系。</p></div>
      <el-tag :type="connected ? 'success' : 'info'" effect="plain">{{
        connected ? 'Neo4j 已连接' : 'Neo4j 未连接'
      }}</el-tag>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert
      v-if="hasMore && connected"
      title="当前显示部分图谱，可搜索实体并展开邻居；单次画布最多显示 2000 个实体、10000 条关系。"
      type="info"
      :closable="false"
    />
    <div class="graph-toolbar">
      <div class="graph-legend"
        ><span v-for="(color, kind) in palette" :key="kind"
          ><i :style="{ background: color }"></i>{{ kind }}</span
        ></div
      >
      <div class="graph-actions">
        <el-button :loading="loading" :disabled="expanding" @click="refresh"
          >加载全部图谱</el-button
        >
        <el-button
          type="primary"
          :loading="expanding"
          :disabled="!selected || loading"
          @click="selectedId && expand(selectedId)"
          >展开邻居</el-button
        >
        <el-button :aria-pressed="rotating" @click="rotating = !rotating">{{
          rotating ? '暂停旋转' : '自动旋转'
        }}</el-button>
        <el-button @click="canvas?.reset()">重置视角</el-button>
        <el-button :disabled="loading || !connected" @click="selectLocal(null)">取消高亮</el-button>
        <el-button :disabled="!connected || layoutSettled" @click="layoutPaused = !layoutPaused">{{
          layoutSettled ? '布局已稳定' : layoutPaused ? '继续布局' : '暂停布局'
        }}</el-button>
      </div>
    </div>
    <div class="graph-visual-controls">
      <div
        ><label for="graph-preset">星系风格</label
        ><el-select id="graph-preset" v-model="presetId" aria-label="星系风格"
          ><el-option
            v-for="preset in STYLE_PRESETS"
            :key="preset.id"
            :label="preset.name"
            :value="preset.id" /></el-select
      ></div>
      <div
        ><label id="graph-nebula-label">星云浓度</label
        ><el-slider
          v-model="nebula"
          :min="0"
          :max="1"
          :step="0.05"
          aria-labelledby="graph-nebula-label"
      /></div>
      <div
        ><label id="graph-bloom-label">辉光强度</label
        ><el-slider
          v-model="bloom"
          :min="0"
          :max="1.5"
          :step="0.05"
          aria-labelledby="graph-bloom-label"
      /></div>
      <el-button @click="restorePreset">恢复预设</el-button>
    </div>
    <div class="graph-layout">
      <div class="graph-viewport" :aria-busy="loading"
        ><GalaxyCanvas
          v-if="connected && graph.nodes.length"
          ref="canvas"
          :graph="graph"
          :selected="selectedId"
          :rotating="rotating"
          :layout-paused="layoutPaused"
          :preset-id="presetId"
          :nebula="nebula"
          :bloom="bloom"
          @layout-settled="layoutSettled = $event"
          @select="selectLocal($event)"
        />
        <div v-else class="graph-placeholder" role="status">{{
          loading
            ? loadProgress
            : error
              ? '图谱未加载，请检查服务连接后点击加载全部图谱。'
              : '当前账号暂无图谱数据'
        }}</div>
      </div>
      <aside class="graph-sidebar">
        <label for="graph-search">搜索实体</label>
        <el-input
          id="graph-search"
          v-model="query"
          placeholder="输入名称或类型，如电机、故障"
          :disabled="loading"
          maxlength="100"
          clearable
        />
        <p class="graph-count"
          >{{ graph.nodes.length }} 个实体 · {{ graph.relations.length }} 条关系</p
        >
        <div class="entity-list" aria-label="实体列表">
          <button
            v-for="node in filtered"
            :key="node.id"
            :aria-pressed="node.id === selectedId"
            @click="choose(node.id)"
          >
            <span>{{ node.name }}</span
            ><small :style="{ color: palette[node.kind] }">{{ node.kind }}</small>
          </button>
          <p v-if="searching" class="empty-state" role="status">正在搜索…</p>
          <p v-else-if="!filtered.length" class="empty-state">{{
            query ? '没有匹配实体，请调整关键词。' : '暂无实体'
          }}</p>
          <p v-if="searchMore" class="empty-state">结果较多，请缩小搜索范围。</p>
        </div>
      </aside>
    </div>
    <div class="graph-details" aria-live="polite">
      <div v-if="selected" class="entity-summary"
        ><el-tag>{{ selected.kind }}</el-tag
        ><h3>{{ selected.name }}</h3
        ><p>{{ selected.description }}</p
        ><span>关联关系 {{ relations.length }} 条</span></div
      >
      <div v-else class="entity-summary"
        ><h3>选择一个实体</h3><p>点击星系中的节点或实体列表，查看有方向的关系与资料来源。</p></div
      >
      <div class="relation-list">
        <article v-for="edge in relations" :key="edge.id" class="relation-card">
          <div class="relation-path"
            ><button @click="choose(edge.source)">{{ nameOf(edge.source) }}</button
            ><span>— {{ edge.type }} →</span
            ><button @click="choose(edge.target)">{{ nameOf(edge.target) }}</button></div
          >
          <details
            ><summary>查看来源 · {{ edge.sourceEvidence.section }}</summary
            ><p>{{ edge.sourceEvidence.title }}</p
            ><p v-if="edge.sourceEvidence.documentId"
              >文档 #{{ edge.sourceEvidence.documentId }} · 版本
              {{ edge.sourceEvidence.documentVersion }} · 片段 #{{ edge.sourceEvidence.chunkId
              }}<span v-if="edge.sourceEvidence.pageNumber">
                · 第 {{ edge.sourceEvidence.pageNumber }} 页</span
              ></p
            >
            <blockquote>{{ edge.sourceEvidence.excerpt }}</blockquote></details
          >
        </article>
        <p v-if="selected && !relations.length" class="empty-state"
          >当前视图暂无关联关系，可点击“展开邻居”查询。</p
        >
      </div>
    </div>
    <footer class="graph-credit"
      >星系渲染改编自
      <a
        href="https://github.com/Longwind1984/galaxy-view"
        target="_blank"
        rel="noopener noreferrer"
        >Galaxy View</a
      >
      · © 2026 Rick ·
      <a href="/licenses/galaxy-view/LICENSE.txt" target="_blank" rel="noopener noreferrer"
        >MIT 许可证</a
      ></footer
    >
  </section>
</template>
<style scoped>
.graph-visual-controls {
  display: grid;
  padding: 16px 20px;
  margin-bottom: 18px;
  background: #111d32;
  border: 1px solid var(--graph-border);
  border-radius: 10px;
  grid-template-columns: minmax(130px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) auto;
  gap: 24px;
  align-items: center;
}

.graph-visual-controls label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--graph-muted);
}

@media (width <= 900px) {
  .graph-visual-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 24px;
  }
}

.graph-placeholder {
  display: grid;
  min-height: 430px;
  padding: 24px;
  color: #acbcd6;
  place-items: center;
  text-align: center;
}

.knowledge-graph {
  --graph-border: #263550;
  --graph-text: #e5edff;
  --graph-muted: #acbcd6;

  padding: 22px;
  color: var(--graph-text);
  background: #0a1222;
  border-radius: 14px;
}

.graph-heading,
.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.graph-heading {
  margin-bottom: 18px;
}

h3 {
  margin: 0 0 8px;
  font-size: 20px;
}

p {
  line-height: 1.7;
}

.graph-heading p {
  margin: 0;
  color: var(--graph-muted);
}

.graph-toolbar {
  margin: 20px 0 16px;
}

.graph-legend,
.graph-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
}

.graph-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.graph-actions :deep(.el-button) {
  min-height: 36px;
  margin: 0;
}

.graph-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 235px;
  gap: 16px;
}

.graph-viewport {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--graph-border);
  border-radius: 12px;
}

.graph-sidebar {
  padding: 16px;
  background: #111d32;
  border: 1px solid var(--graph-border);
  border-radius: 12px;
}

.graph-sidebar label {
  display: block;
  margin-bottom: 10px;
  font-weight: 600;
}

.graph-count,
.empty-state {
  font-size: 13px;
  color: var(--graph-muted);
}

.entity-list {
  max-height: 470px;
  overflow-y: auto;
}

.entity-list button {
  display: flex;
  width: 100%;
  min-height: 42px;
  padding: 10px;
  color: var(--graph-text);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.entity-list button:hover,
.entity-list button[aria-pressed='true'] {
  background: #1e3353;
  border-color: #496b9c;
}

button:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 2px solid #a2caff;
  outline-offset: 3px;
}

.graph-details {
  display: grid;
  padding-top: 20px;
  margin-top: 20px;
  border-top: 1px solid var(--graph-border);
  grid-template-columns: 235px minmax(0, 1fr);
  gap: 20px;
}

.entity-summary h3 {
  margin-top: 12px;
}

.entity-summary p,
.entity-summary > span {
  font-size: 14px;
  color: var(--graph-muted);
}

.relation-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-items: start;
}

.relation-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--graph-border);
  border-radius: 8px;
}

.relation-path {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.relation-path button {
  padding: 4px 0;
  font-size: 14px;
  color: #acd0ff;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.relation-path span {
  font-size: 12px;
  color: var(--graph-muted);
}

summary {
  margin-top: 12px;
  font-size: 12px;
  color: var(--graph-muted);
  cursor: pointer;
}

details p,
blockquote {
  font-size: 13px;
  color: var(--graph-muted);
  overflow-wrap: anywhere;
}

blockquote {
  padding-left: 10px;
  margin: 8px 0;
  line-height: 1.7;
  border-left: 2px solid #6688b5;
}

.graph-credit {
  margin-top: 20px;
  font-size: 12px;
  color: var(--graph-muted);
}

.graph-credit a {
  color: #a7caff;
}

@media (width <= 1000px) {
  .graph-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .entity-list {
    display: flex;
    flex-wrap: wrap;
    max-height: 160px;
    gap: 4px;
    margin-top: 8px;
  }

  .entity-list button {
    width: auto;
    gap: 12px;
  }

  .graph-details {
    grid-template-columns: 1fr;
  }
}

@media (width <= 600px) {
  .knowledge-graph {
    padding: 12px;
  }

  .relation-list {
    grid-template-columns: 1fr;
  }

  .graph-actions {
    gap: 8px;
  }
}
</style>
