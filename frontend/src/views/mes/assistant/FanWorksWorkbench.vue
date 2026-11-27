<template>
  <section class="works-workbench">
    <div class="works-toolbar">
      <el-button v-if="run" @click="run = undefined">返回电风扇装配演示</el-button>
      <el-button v-if="canQuery" :type="run ? 'default' : 'primary'" plain @click="dialog = true">
        {{ run ? '查看或更换工单问答' : '问一张工单为什么缺料' }}
      </el-button>
    </div>
    <FanWorksFrame :run="run" />
    <el-dialog
      v-model="dialog"
      title="工单缺料问答"
      width="min(640px, 95vw)"
      append-to-body
      @close="invalidate"
    >
      <el-form label-position="top">
        <el-form-item label="选择需要核对的工单">
          <ProWorkOrderSelect v-model="orderId" :disabled="busy" @change="resetAnswer" />
        </el-form-item>
        <el-form-item v-if="canKnowledge" label="参考资料">
          <el-radio-group v-model="source" :disabled="busy" @change="resetAnswer">
            <el-radio-button value="business">工单数据</el-radio-button>
            <el-radio-button value="knowledge">工单与已发布规程</el-radio-button>
            <el-radio-button v-if="canDify" value="dify">工单与 Dify 教学手册</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <article v-if="answer" class="works-answer">
        <h3>{{ answer.question }}</h3
        ><p>{{ answer.answer }}</p>
      </article>
      <template #footer>
        <el-button :loading="busy" :disabled="!orderId" @click="ask">查询缺料</el-button>
        <el-button v-if="answer" type="primary" @click="openRun">查看本轮织造回放</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref, shallowRef } from 'vue'
import { KittingApi } from '@/api/mes/pro/kitting'
import { searchEvidence } from '@/api/mes/assistant/evidence'
import { runDify } from '@/api/mes/assistant/dify'
import { checkPermi } from '@/utils/permission'
import ProWorkOrderSelect from '@/views/mes/pro/workorder/components/ProWorkOrderSelect.vue'
import FanWorksFrame from './FanWorksFrame.vue'
import { journeyRun, kittingRun, type WorksRun, type WorksStep } from './fanWorksRecords'
import { difyJourney } from './workflowJourney'
import { stepStatus } from './workflowRunway'

const canQuery = checkPermi(['mes:kitting:query']) && checkPermi(['mes:pro-work-order:query'])
const canKnowledge = checkPermi(['mes:assistant:knowledge', 'mes:assistant:manage'])
const canDify = checkPermi(['mes:assistant:knowledge']) && checkPermi(['mes:assistant:chat'])
const run = shallowRef<WorksRun>()
const answer = shallowRef<WorksRun>()
const source = ref<'business' | 'knowledge' | 'dify'>('business')
const orderId = ref<number>()
const busy = ref(false)
const dialog = ref(false)
const error = ref('')
let sequence = 0
const manualQuestion = '为什么账面有货还是提示缺料？开工前怎样核对工单预占与可用库存？'

function invalidate() {
  ++sequence
  busy.value = false
}
function resetAnswer() {
  invalidate()
  answer.value = undefined
  error.value = ''
}
onBeforeUnmount(invalidate)
onDeactivated(() => {
  dialog.value = false
  invalidate()
})

async function references(
  which: typeof source.value
): Promise<{ steps: WorksStep[]; summary: string }> {
  if (which === 'business') return { steps: [], summary: '' }
  if (which === 'dify') {
    const data = await runDify(manualQuestion)
    const record = journeyRun(difyJourney(data))
    return {
      steps: [
        { title: 'Dify 项目教学手册', detail: `运行 ${data.runId} · ${stepStatus(data.status)}` },
        ...record.steps
      ],
      summary: `Dify 项目教学手册（${stepStatus(data.status)}）\n${data.answer || '本次运行未返回手册答复。'}`
    }
  }
  const result = await searchEvidence({
    query: manualQuestion,
    mode: 'DOCUMENT',
    documentStrategy: 'LEXICAL',
    limit: 3
  })
  const detail =
    result.items
      .map(
        (item, index) =>
          `[${index + 1}] ${item.title}${item.documentVersion ? ' · v' + item.documentVersion : ''}\n${item.text}`
      )
      .join('\n\n') || '当前可访问的已发布文档中没有命中参考片段。'
  return { steps: [{ title: '已发布规程', detail }], summary: `已发布规程\n${detail}` }
}

async function ask() {
  if (!orderId.value || busy.value || !canQuery) return
  const current = ++sequence
  busy.value = true
  error.value = ''
  answer.value = undefined
  try {
    const [business, manual] = await Promise.allSettled([
      KittingApi.analyze(orderId.value),
      references(source.value)
    ])
    if (sequence !== current) return
    if (business.status === 'rejected') throw business.reason
    const result = kittingRun(business.value)
    const unavailable = '所选手册服务未返回可用结果。'
    const evidence =
      manual.status === 'fulfilled'
        ? manual.value
        : {
            steps: [{ title: '参考资料未返回', detail: unavailable }],
            summary: unavailable
          }
    result.steps.splice(result.steps.length - 1, 0, ...evidence.steps)
    if (evidence.summary) result.answer += '\n\n' + evidence.summary
    answer.value = result
  } catch (cause) {
    if (sequence === current)
      error.value = cause instanceof Error ? cause.message : String(cause || '工单查询失败')
  } finally {
    if (sequence === current) busy.value = false
  }
}
function openRun() {
  if (answer.value) {
    run.value = answer.value
    dialog.value = false
  }
}
</script>

<style scoped>
.works-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.works-toolbar:empty {
  display: none;
}
.works-answer {
  margin-top: 16px;
}
.works-answer h3 {
  font-size: 16px;
}
.works-answer p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
</style>
