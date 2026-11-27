<template>
  <section class="business-assistant" :class="{ compact }">
    <div class="conversation-controls">
      <el-select
        :model-value="conversation?.id"
        placeholder="选择我的业务会话"
        :loading="listLoading"
        @change="openConversation"
      >
        <el-option
          v-for="item in conversations"
          :key="item.id"
          :value="item.id"
          :label="item.title"
        />
      </el-select>
      <el-button :disabled="!canChat || creating" @click="newConversation">新建会话</el-button>
      <el-button :disabled="!canChat || listLoading" @click="refresh">刷新会话</el-button>
      <el-button
        v-if="conversation"
        type="danger"
        plain
        :disabled="sending || historyLoading"
        @click="deleteCurrent"
        >删除本会话</el-button
      >
    </div>
    <div class="business-stream">
      <el-pagination
        v-if="conversationTotal > 20"
        small
        layout="prev, pager, next"
        :total="conversationTotal"
        :page-size="20"
        :current-page="conversationPage"
        :disabled="listLoading"
        @current-change="loadList"
      />
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <el-button v-if="recoverId" :disabled="historyLoading" @click="openConversation(recoverId)">
        重新载入会话后继续
      </el-button>
      <div v-if="conversation" class="note">
        {{ conversation.title }} · {{ conversation.turnCount }} 轮
        <span v-if="historyLoading"> · 正在载入</span>
      </div>
      <el-button v-if="hasMore" :loading="olderLoading" @click="loadOlder">加载更早记录</el-button>
      <div v-if="!turns.length && !historyLoading" class="business-welcome">
        <h3>今天想了解哪项生产业务？</h3>
        <p>从工单、设备或库存开始。涉及业务变更时，可以先核对预览再确认执行。</p>
        <PromptGrid
          :items="presets.slice(0, 6)"
          :disabled="sending || !canChat"
          @pick="askPreset"
        />
      </div>
      <article v-for="turn in turns" :key="turn.id" class="turn">
        <p class="question">{{ turn.question || '已选择澄清选项' }}</p>
        <el-tag size="small" :type="turn.answer.status === 'CLARIFY' ? 'warning' : 'info'">
          {{
            turn.answer.status === 'CLARIFY'
              ? '需要澄清'
              : turn.answer.status === 'OUT_OF_SCOPE'
                ? '查询范围说明'
                : turn.answer.mode === 'MODEL'
                  ? '模型分析 · 请核对依据'
                  : '业务规则答复'
          }}
        </el-tag>
        <MarkdownView
          class="answer-text"
          :content="
            turn.answer.executionReceipt ? turn.answer.executionReceipt.message : turn.answer.answer
          "
        />
        <p v-if="turn.answer.modelWarning" class="note">{{ turn.answer.modelWarning }}</p>
        <small class="note">查询时间 {{ formatTime(turn.answer.generatedAt) }}</small>
        <FanWorksReplay :record="turn" />
        <div v-if="turn.answer.status === 'CLARIFY'" class="clarification">
          <p>{{ turn.answer.clarification?.prompt }}</p>
          <el-button
            v-for="choice in turn.answer.clarification?.choices || []"
            :key="choice.id"
            :disabled="sending || !isActiveClarification(turn)"
            @click="choose(turn, choice.id)"
            >{{ choice.label }}</el-button
          >
          <small class="note">
            {{
              isActiveClarification(turn)
                ? '也可以在下方补充年份或筛选条件。'
                : '此轮选项已失效，请查看最新答复。'
            }}
          </small>
        </div>
        <AgentResult
          v-if="turn.answer.topic === 'agent_data' || turn.answer.topic === 'agent_action'"
          :answer="turn.answer"
          @failure="handleFailure"
          @executed="turn.answer.executionReceipt = $event"
        />
        <InventoryEvidence
          v-else-if="isStockEvidence(turn.answer.evidence)"
          :turn-id="turn.id"
          :evidence="turn.answer.evidence"
          @failure="handleFailure"
        />
        <LegacyBusinessEvidence
          v-else-if="turn.answer.status === 'ANSWERED'"
          :answer="turn.answer"
          @draft="emit('draft', $event)"
          @navigate="emit('navigate', $event)"
        />
      </article>
    </div>
    <div class="business-composer">
      <el-input
        v-model="question"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 5 }"
        @keydown.ctrl.enter.prevent="send()"
        maxlength="1000"
        show-word-limit
        :disabled="!canChat || sending || historyLoading || olderLoading || !!recoverId"
        placeholder="输入工单号、设备编码或业务问题，Ctrl + Enter 发送"
      />
      <div class="conversation-controls">
        <el-dropdown trigger="click" @command="askPreset">
          <el-button size="small" round :disabled="sending || !canChat">快捷提问 ⌄</el-button>
          <template #dropdown
            ><el-dropdown-menu>
              <el-dropdown-item
                v-for="preset in presets"
                :key="preset.question"
                :command="preset.question"
                >{{ preset.title }}</el-dropdown-item
              >
            </el-dropdown-menu></template
          >
        </el-dropdown>
        <el-checkbox v-model="useModel" :disabled="!canModel || sending">
          模型理解问题
        </el-checkbox>
        <el-button type="primary" :loading="sending" :disabled="!canSend" @click="send()"
          >发送给业务 Agent</el-button
        >
      </div>
    </div>
    <el-button
      v-if="!compact && $route.path !== '/mes/assistant'"
      text
      size="small"
      @click="router.push('/mes/assistant')"
      >知识库与模型配置</el-button
    >
  </section>
</template>

<script setup lang="ts">
import { InsightApi, type Draft } from '@/api/mes/insight'
import {
  isStockEvidence,
  type BusinessAskInput,
  type BusinessConversation,
  type BusinessTurn
} from '@/api/mes/insight/business'
import { checkPermi } from '@/utils/permission'
import InventoryEvidence from './InventoryEvidence.vue'
import LegacyBusinessEvidence from './LegacyBusinessEvidence.vue'
import AgentResult from './AgentResult.vue'
import { defineAsyncComponent } from 'vue'
import PromptGrid from '@/views/mes/assistant/PromptGrid.vue'
import MarkdownView from '@/components/MarkdownView/index.vue'

const FanWorksReplay = defineAsyncComponent(
  () => import('@/views/mes/assistant/FanWorksReplay.vue')
)
const props = defineProps<{ active: boolean; compact?: boolean; initialId?: number }>()
const emit = defineEmits<{
  draft: [value: Draft]
  navigate: [topic: string]
  conversation: [id?: number]
}>()
const router = useRouter()
const conversation = ref<BusinessConversation>()
const conversations = ref<BusinessConversation[]>([])
const conversationTotal = ref(0)
const conversationPage = ref(1)
watch(
  () => conversation.value?.id,
  (id) => emit('conversation', id)
)
const turns = ref<BusinessTurn[]>([])
const hasMore = ref(false)
const beforeTurnId = ref<number | null>(null)
const recoverId = ref<number | null>(null)
const question = ref('')
const useModel = ref(false)
const error = ref('')
const sending = ref(false)
const historyLoading = ref(false)
const olderLoading = ref(false)
const listLoading = ref(false)
const creating = ref(false)
let contextEpoch = 0
let listEpoch = 0
const canChat = computed(
  () => checkPermi(['mes:insight:query']) && checkPermi(['mes:insight:chat'])
)
const canModel = computed(() => checkPermi(['mes:assistant:chat']))
const canSend = computed(
  () =>
    canChat.value &&
    !!question.value.trim() &&
    !sending.value &&
    !historyLoading.value &&
    !olderLoading.value &&
    !creating.value &&
    !recoverId.value
)
const presets = computed(() =>
  [
    {
      title: '工单进度到哪了？',
      detail: '查看生产工单的执行状态',
      question: '查询全部工单进度',
      permission: 'mes:pro-work-order:query'
    },
    {
      title: '哪些工单有交付风险？',
      detail: '查看今天的交付风险',
      question: '今天哪些工单有交付风险？'
    },
    {
      title: '现场设备状态如何？',
      detail: '查询设备当前运行状态',
      question: '查询设备状态',
      permission: 'mes:dv-machinery:query'
    },
    {
      title: '上月原料进出了多少？',
      detail: '按批次核对收发存',
      question: '查上个月原材料收发存，按批次',
      permission: 'mes:wm-material-stock:query'
    },
    { title: '还有哪些待处理异常？', detail: '查看需要跟进的异常', question: '有哪些待处理异常？' },
    {
      title: '导出未完工单报表',
      detail: '生成本月工单 Excel 报表',
      question: '生成本月未完成工单报表',
      permission: 'mes:pro-work-order:export'
    },
    {
      title: '跟进一个供应异常',
      detail: '预览异常处理请求',
      question: '新建异常：物料供应需要跟进',
      permission: 'mes:insight:manage'
    },
    {
      title: '查询物料标准成本',
      detail: '核对 BOM 成本依据',
      question: 'BROKY-FG-V2 的 BOM 标准成本是多少？',
      permission: 'mes:cost:query'
    }
  ].filter((item) => !item.permission || checkPermi([item.permission]))
)
const formatTime = (value: string) => value.replace('T', ' ').replace(/([+-]\d\d:\d\d|Z)$/, '')

function resetContext() {
  contextEpoch++
  conversation.value = undefined
  turns.value = []
  hasMore.value = false
  beforeTurnId.value = null
  recoverId.value = null
  error.value = ''
  question.value = ''
  sending.value = false
  historyLoading.value = false
  olderLoading.value = false
  creating.value = false
  return contextEpoch
}
function handleFailure(_cause?: unknown) {
  const id = conversation.value?.id || recoverId.value
  resetContext()
  recoverId.value = id || null
  listEpoch++
  conversations.value = []
  conversationTotal.value = 0
  listLoading.value = false
  error.value = '查询失败或会话、权限已变更。请重新载入会话；也可以新建会话。'
}
async function loadList(page = conversationPage.value) {
  if (!canChat.value) return handleFailure()
  const request = ++listEpoch
  listLoading.value = true
  try {
    const data = await InsightApi.conversationPage(page, 20)
    if (request !== listEpoch) return
    if (!canChat.value) return handleFailure()
    conversations.value = data.list
    conversationTotal.value = data.total
    conversationPage.value = page
    const updated = data.list.find((item) => item.id === conversation.value?.id)
    if (updated && updated.version === conversation.value?.version) conversation.value = updated
  } catch (cause) {
    if (request === listEpoch) handleFailure(cause)
  } finally {
    if (request === listEpoch) listLoading.value = false
  }
}
async function openConversation(id: number) {
  if (!canChat.value || !Number.isSafeInteger(id) || id <= 0) return
  const epoch = resetContext()
  recoverId.value = id
  historyLoading.value = true
  try {
    const data = await InsightApi.conversation(id)
    if (epoch !== contextEpoch) return
    if (!canChat.value) return handleFailure()
    conversation.value = data.conversation
    turns.value = data.turns
    hasMore.value = data.hasMore
    beforeTurnId.value = data.nextBeforeTurnId
    recoverId.value = null
  } catch (cause) {
    if (epoch === contextEpoch) handleFailure(cause)
  } finally {
    if (epoch === contextEpoch) historyLoading.value = false
  }
}
async function newConversation() {
  if (!canChat.value || creating.value) return
  const epoch = resetContext()
  creating.value = true
  try {
    const data = await InsightApi.createConversation()
    if (epoch !== contextEpoch) return
    if (!canChat.value) return handleFailure()
    conversation.value = data
    void loadList(1)
  } catch (cause) {
    if (epoch === contextEpoch) handleFailure(cause)
  } finally {
    if (epoch === contextEpoch) creating.value = false
  }
}
async function deleteCurrent() {
  const current = conversation.value
  if (!current || sending.value || historyLoading.value || !canChat.value) return
  const epoch = contextEpoch
  historyLoading.value = true
  try {
    await InsightApi.deleteConversation(current.id, current.version)
    if (epoch !== contextEpoch) return
    resetContext()
    void loadList(1)
  } catch (cause) {
    if (epoch === contextEpoch) handleFailure(cause)
  } finally {
    if (epoch === contextEpoch) historyLoading.value = false
  }
}
async function loadOlder() {
  const current = conversation.value
  if (!current || !beforeTurnId.value || olderLoading.value || sending.value || !canChat.value)
    return
  const epoch = contextEpoch
  olderLoading.value = true
  try {
    const data = await InsightApi.conversation(current.id, beforeTurnId.value)
    if (epoch !== contextEpoch) return
    if (data.conversation.version !== current.version) return openConversation(current.id)
    const known = new Set(turns.value.map((item) => item.id))
    turns.value = [...data.turns.filter((item) => !known.has(item.id)), ...turns.value]
    hasMore.value = data.hasMore
    beforeTurnId.value = data.nextBeforeTurnId
  } catch (cause) {
    if (epoch === contextEpoch) handleFailure(cause)
  } finally {
    if (epoch === contextEpoch) olderLoading.value = false
  }
}
function isActiveClarification(turn: BusinessTurn) {
  return (
    !!conversation.value &&
    turn.version === conversation.value.version &&
    turns.value.at(-1)?.id === turn.id &&
    !!turn.answer.clarification &&
    Date.parse(turn.answer.clarification.expiresAt) > Date.now() &&
    !recoverId.value
  )
}
async function choose(turn: BusinessTurn, choiceId: string) {
  if (
    !isActiveClarification(turn) ||
    !turn.answer.clarification?.choices.some((choice) => choice.id === choiceId)
  )
    return
  await send({ token: turn.answer.clarification.token, choiceId })
}
async function send(clarification?: BusinessAskInput['clarification']) {
  if (
    !canChat.value ||
    sending.value ||
    historyLoading.value ||
    olderLoading.value ||
    creating.value ||
    recoverId.value
  )
    return
  if (!clarification && !question.value.trim()) return
  const epoch = contextEpoch
  const previous = conversation.value
  const text = clarification ? '' : question.value.trim()
  const data: BusinessAskInput = { question: text, useModel: useModel.value && canModel.value }
  if (previous) {
    data.conversationId = previous.id
    data.version = previous.version
  }
  if (clarification) data.clarification = clarification
  sending.value = true
  error.value = ''
  try {
    const answer = await InsightApi.ask(data)
    if (epoch !== contextEpoch) return
    if (!canChat.value) return handleFailure()
    if (
      previous &&
      (answer.conversationId !== previous.id || answer.version !== previous.version + 1)
    ) {
      return handleFailure()
    }
    conversation.value = {
      id: answer.conversationId,
      title: previous?.title || text.slice(0, 160) || '业务会话',
      version: answer.version,
      turnCount: (previous?.turnCount || 0) + 1,
      createdAt: previous?.createdAt || answer.generatedAt,
      updatedAt: answer.generatedAt
    }
    turns.value = [
      ...turns.value,
      {
        id: answer.turnId,
        question: text,
        createdAt: answer.generatedAt,
        version: answer.version,
        answer
      }
    ]
    question.value = ''
    void loadList(1)
  } catch (cause) {
    if (epoch === contextEpoch) handleFailure(cause)
  } finally {
    if (epoch === contextEpoch) sending.value = false
  }
}
function askPreset(value: string) {
  if (sending.value || historyLoading.value || recoverId.value) return
  question.value = value
  void send()
}
async function refresh() {
  if (conversation.value && !sending.value && !historyLoading.value)
    await openConversation(conversation.value.id)
  await loadList()
}
let initialOpened = false
watch(
  () => props.active,
  (active) => {
    if (!active) return
    if (props.initialId && !initialOpened) {
      initialOpened = true
      void loadList()
      void openConversation(props.initialId)
    } else void refresh()
  },
  { immediate: true }
)
watch(
  () => [
    canChat.value,
    checkPermi(['mes:wm-material-stock:query']),
    checkPermi(['mes:cost:query']),
    checkPermi(['mes:cost:update']),
    checkPermi(['mes:cost:settle']),
    checkPermi(['mes:pro-work-order:query']),
    checkPermi(['mes:pro-work-order:update']),
    checkPermi(['mes:dv-machinery:query']),
    checkPermi(['mes:dv-machinery:update']),
    checkPermi(['mes:insight:manage'])
  ],
  (next, previous) => {
    if (previous?.some((allowed, index) => allowed && !next[index])) handleFailure()
  }
)
defineExpose({ refresh })
</script>

<style scoped>
.business-assistant {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conversation-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.conversation-controls .el-select {
  width: min(340px, 100%);
}

.clarification .el-button {
  margin-left: 0;
}

.turn {
  padding: 18px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.question {
  font-weight: 600;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.business-stream {
  color: var(--fm-text);
}
.answer-text.markdown-view,
.answer-text :deep(:is(h1, h2, h3, h4, h5, h6, ul, ol, li)) {
  color: var(--fm-text);
}
.answer-text {
  white-space: normal;
  overflow-wrap: anywhere;
}

.note {
  font-size: 13px;
  line-height: 1.8;
  color: var(--fm-secondary);
}

.clarification {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-block: 12px;
}

.clarification p,
.clarification small {
  width: 100%;
}
.business-assistant {
  min-width: 0;
}
.business-stream {
  min-height: 0;
  max-height: 62vh;
  overflow: auto;
  scrollbar-gutter: stable;
}
.business-welcome {
  padding: 18px 3px 14px;
}
.business-welcome h3 {
  margin: 0 0 7px;
  font-size: 21px;
  color: var(--fm-text);
}
.business-welcome p {
  margin: 0 0 16px;
  color: var(--fm-secondary);
  line-height: 1.6;
}
.turn {
  margin-bottom: 10px;
  border-color: var(--fm-line);
  border-radius: 12px;
  background: var(--fm-card);
}
.business-composer {
  padding: 10px 12px;
  border: 1px solid var(--fm-strong-line);
  border-radius: 16px;
  background: var(--fm-overlay);
  box-shadow: var(--fm-shadow);
  backdrop-filter: blur(14px);
}
.business-composer :deep(.el-textarea__inner) {
  background: transparent;
  box-shadow: none;
}
.business-composer > .conversation-controls {
  margin-top: 8px;
}
.business-composer .el-button--primary {
  margin-left: auto;
}
.compact .conversation-controls {
  gap: 5px;
}
.compact .conversation-controls .el-select {
  width: 160px;
}
.compact .business-welcome {
  padding: 8px 0;
}
.compact .business-stream {
  max-height: 36dvh;
}
@media (max-width: 600px) {
  .conversation-controls .el-select {
    width: 100%;
  }
}
</style>
