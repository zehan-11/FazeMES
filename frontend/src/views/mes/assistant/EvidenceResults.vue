<template>
  <section class="evidence-results" aria-live="polite">
    <h3>{{ labels[result.mode] }} · {{ result.query }}</h3>
    <p>以下为检索证据，可点击来源核对原文。</p>
    <template v-if="result.graph">
      <h4>定位实体</h4>
      <div class="evidence-entities">
        <el-tag v-for="match in result.graph.matchedEntities" :key="match.entity.id">
          {{ match.entity.name }} · {{ match.entity.kind }}
          {{ match.matchMethod === 'name_fragment' ? '（名称部分匹配）' : '' }}
        </el-tag>
      </div>
      <el-empty
        v-if="!result.graph.matchedEntities.length"
        description="未定位到可见实体，请在问题中写出具体设备、部件或故障名称，或切换文档检索。"
        :image-size="50"
      />
      <template v-else>
        <h4>关系路径 · 最多 {{ result.graph.hops }} 跳</h4>
        <p>箭头保留原关系方向；不同文件的关系各自保留来源。</p>
        <el-empty
          v-if="!result.graph.paths.length"
          description="已找到实体，但当前范围内没有带来源的关联关系。"
          :image-size="50"
        />
        <ol class="evidence-paths">
          <li v-for="(path, index) in result.graph.paths" :key="index">
            <span>{{ nodeName(path.nodeIds[0]) }}</span>
            <template v-for="(edgeId, step) in path.relationIds" :key="edgeId">
              <button type="button" @click="openEvidence(relation(edgeId)!.evidence)">
                {{ relation(edgeId)?.source === path.nodeIds[step] ? '—' : '←' }}
                {{ relation(edgeId)?.type }}
                {{ relation(edgeId)?.source === path.nodeIds[step] ? '→' : '—' }}
              </button>
              <span>{{ nodeName(path.nodeIds[step + 1]) }}</span>
            </template>
          </li>
        </ol>
        <el-alert
          v-if="result.graph.hasMore"
          title="关联结果较多，当前最多展示8个匹配实体、60条关系及80条路径。请缩小知识库范围或使用更具体的实体名称。"
          type="info"
          :closable="false"
        />
      </template>
    </template>
    <h4>来源证据 · {{ result.items.length }} 条</h4>
    <p v-if="result.eligibleChunkCount !== undefined"
      >在 {{ result.eligibleChunkCount }} 个可访问的已发布片段中检索文档。</p
    >
    <el-empty
      v-if="!result.items.length"
      description="未找到匹配证据，请调整问题、知识库范围，或检查文件是否已发布并完成建图。"
      :image-size="50"
    />
    <button
      v-for="(item, index) in result.items"
      :key="item.evidenceId"
      type="button"
      class="evidence-card"
      @click="openEvidence(item)"
    >
      <b>[{{ index + 1 }}] {{ item.title || '图谱来源' }}</b>
      <small
        >{{ item.sourceType === 'DOCUMENT' ? '文档' : '图谱关系' }} · {{ item.section
        }}{{ item.documentVersion ? ` · v${item.documentVersion}` : ''
        }}{{ item.pageNumber ? ` · 第${item.pageNumber}页` : '' }}</small
      >
      <span>{{ item.text }}</span>
    </button>
    <p v-if="result.hasMore">当前展示部分候选证据，可缩小范围进一步核对。</p>
    <el-dialog v-model="sourceVisible" title="检索证据与来源" width="min(820px, 92vw)">
      <template v-if="active">
        <h3>{{ active.title }}</h3>
        <p
          >{{ active.section
          }}{{ active.documentVersion ? ` · v${active.documentVersion}` : '' }}</p
        >
        <pre class="evidence-source">{{ active.text }}</pre>
        <p v-if="active.chunkId"
          >片段 #{{ active.chunkId }} · 字符位置 {{ active.startOffset }}—{{ active.endOffset }}</p
        >
        <p v-if="active.chunkHash" class="evidence-hash">SHA-256 {{ active.chunkHash }}</p>
        <el-button v-if="active.documentId" :loading="loading" @click="loadOriginal"
          >查看当前授权原文</el-button
        >
        <el-alert v-if="sourceError" :title="sourceError" type="error" :closable="false" />
        <pre v-if="original" class="evidence-source">{{ original }}</pre>
      </template>
    </el-dialog>
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { AssistantApi } from '@/api/mes/assistant'
import type { EvidenceSearchResult, RetrievalEvidence } from '@/api/mes/assistant/evidence'
const props = defineProps<{ result: EvidenceSearchResult }>()
const labels = { DOCUMENT: '文档检索', GRAPH: '图谱检索', HYBRID: '混合检索' }
const nodes = computed(() => new Map(props.result.graph?.nodes.map((n) => [n.id, n])))
const edges = computed(() => new Map(props.result.graph?.relations.map((r) => [r.id, r])))
const nodeName = (id: string) => nodes.value.get(id)?.name || id
const relation = (id: string) => edges.value.get(id)
const sourceVisible = ref(false)
const active = ref<RetrievalEvidence>()
const original = ref('')
const sourceError = ref('')
const loading = ref(false)
let sourceRequest = 0
function openEvidence(item: RetrievalEvidence) {
  ++sourceRequest
  active.value = item
  original.value = ''
  sourceError.value = ''
  loading.value = false
  sourceVisible.value = true
}
async function loadOriginal() {
  const item = active.value
  if (!item?.documentId || loading.value) return
  const request = ++sourceRequest
  loading.value = true
  sourceError.value = ''
  try {
    const doc = await AssistantApi.document(item.documentId, item.documentVersion || undefined)
    if (request === sourceRequest) original.value = doc.contentText
  } catch (error) {
    if (request === sourceRequest)
      sourceError.value =
        error instanceof Error
          ? error.message
          : '原文不可访问，请重新检索以确认当前权限和文件版本。'
  } finally {
    if (request === sourceRequest) loading.value = false
  }
}
</script>
<style scoped>
.evidence-results {
  min-width: 0;
}

.evidence-results p,
.evidence-card small {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.evidence-entities,
.evidence-paths li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.evidence-paths {
  padding-left: 20px;
}

.evidence-paths li {
  margin: 12px 0;
}

.evidence-paths button {
  min-height: 36px;
  padding: 6px 10px;
  color: var(--el-color-primary);
  cursor: pointer;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 6px;
}

.evidence-card {
  display: flex;
  width: 100%;
  padding: 14px;
  margin: 10px 0;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  flex-direction: column;
  gap: 8px;
}

.evidence-card:hover {
  border-color: var(--el-color-primary);
}

.evidence-card span,
.evidence-source {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.evidence-source {
  max-height: 400px;
  overflow: auto;
  line-height: 1.7;
}

.evidence-hash {
  overflow-wrap: anywhere;
}
</style>
