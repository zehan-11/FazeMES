<script setup lang="ts">
import { computed, ref } from 'vue'
import GalaxyCanvas from './GalaxyCanvas.vue'
import { demoGraph, kindColors } from './graphData'
const query = ref('')
const selectedId = ref<string | null>('motor')
const rotating = ref(false)
const canvas = ref<InstanceType<typeof GalaxyCanvas>>()
const selected = computed(() => demoGraph.nodes.find((node) => node.id === selectedId.value))
const filtered = computed(() =>
  demoGraph.nodes.filter((node) => `${node.name} ${node.kind}`.includes(query.value.trim()))
)
const relations = computed(() =>
  demoGraph.relations.filter(
    (edge) => edge.source === selectedId.value || edge.target === selectedId.value
  )
)
const nameOf = (id: string) => demoGraph.nodes.find((node) => node.id === id)?.name || id
function choose(id: string) {
  selectedId.value = id
  canvas.value?.focusNode(id)
}
</script>
<template>
  <section class="knowledge-graph" aria-label="知识图谱原型">
    <div class="graph-heading">
      <div><h3>知识星系</h3><p>从设备出发，探索部件、故障与处理方法之间的联系。</p></div>
      <el-tag type="warning" effect="plain">演示数据 · 未连接 Neo4j</el-tag>
    </div>
    <el-alert
      title="当前为人工编写的渲染原型，关系与来源仅用于界面演示，尚未接入文件自动建图或 GraphRAG 问答。"
      type="info"
      :closable="false"
      show-icon
    />
    <div class="graph-toolbar">
      <div class="graph-legend"
        ><span v-for="(color, kind) in kindColors" :key="kind"
          ><i :style="{ background: color }"></i>{{ kind }}</span
        ></div
      >
      <div class="graph-actions">
        <el-button :aria-pressed="rotating" @click="rotating = !rotating">{{
          rotating ? '暂停旋转' : '自动旋转'
        }}</el-button>
        <el-button @click="canvas?.reset()">重置视角</el-button>
        <el-button @click="selectedId = null">显示全部关系</el-button>
      </div>
    </div>
    <div class="graph-layout">
      <div class="graph-viewport"
        ><GalaxyCanvas
          ref="canvas"
          :graph="demoGraph"
          :selected="selectedId"
          :rotating="rotating"
          @select="selectedId = $event"
      /></div>
      <aside class="graph-sidebar">
        <label for="graph-search">搜索实体</label>
        <el-input
          id="graph-search"
          v-model="query"
          placeholder="输入名称或类型，如电机、故障"
          clearable
        />
        <p class="graph-count"
          >{{ demoGraph.nodes.length }} 个实体 · {{ demoGraph.relations.length }} 条关系</p
        >
        <div class="entity-list" aria-label="实体列表">
          <button
            v-for="node in filtered"
            :key="node.id"
            :aria-pressed="node.id === selectedId"
            @click="choose(node.id)"
          >
            <span>{{ node.name }}</span
            ><small :style="{ color: kindColors[node.kind] }">{{ node.kind }}</small>
          </button>
          <p v-if="!filtered.length" class="empty-state">没有匹配实体，请调整关键词。</p>
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
            ><blockquote>{{ edge.sourceEvidence.excerpt }}</blockquote></details
          >
        </article>
        <p v-if="selected && !relations.length" class="empty-state">此实体暂无关联关系。</p>
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
