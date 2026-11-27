<template>
  <section>
    <FanWorksFrame v-if="visible !== false" :run="run" :access="access" @command="command" />
    <ProWorkOrderSelectDialog v-if="canQuery" ref="picker" :multiple="false" @selected="choose" />
  </section>
</template>
<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef
} from 'vue'
import type { BusinessAnswer } from '@/api/mes/insight/business'
import { InsightApi } from '@/api/mes/insight'
import { CustomerPortalApi } from '@/api/mes/portal'
import type { RetrievalMode } from '@/api/mes/assistant/evidence'
import {
  allKnowledge,
  businessView,
  evidenceFollowup,
  orderProgressView,
  knowledgeView,
  priceView,
  type AnswerView,
  type KnowledgeScope,
  type KnowledgeResponse
} from './fanWorksAnswers'
import {
  assemblyGuide,
  faultGuide,
  intentOf,
  isSelectedProgress,
  matchSymptom,
  namedParts,
  refersToFan,
  symptomChoices,
  type Guide
} from './fanWorksQuestions'
import { KittingApi } from '@/api/mes/pro/kitting'
import type { ProWorkOrderVO } from '@/api/mes/pro/workorder'
import { searchEvidence } from '@/api/mes/assistant/evidence'
import { runDify } from '@/api/mes/assistant/dify'
import { checkPermi } from '@/utils/permission'
import ProWorkOrderSelectDialog from '@/views/mes/pro/workorder/components/ProWorkOrderSelectDialog.vue'
import FanWorksFrame from './FanWorksFrame.vue'
import {
  journeyRun,
  isFanProduct,
  kittingRun,
  type DisplayKind,
  type SceneCommand,
  type WorksRun,
  type WorksCue,
  type WorksStep
} from './fanWorksRecords'
import { difyJourney } from './workflowJourney'

const props = defineProps<{
  visible?: boolean
  preferKnowledge?: boolean
  customer?: boolean
  askKnowledge?: (question: string, mode: RetrievalMode) => Promise<KnowledgeResponse>
  knowledgeScope?: KnowledgeScope
}>()
const emit = defineEmits<{ knowledgeSettings: [] }>()
const customer = props.customer === true
const canBusiness =
  !customer && checkPermi(['mes:insight:query']) && checkPermi(['mes:insight:chat'])
const canPrice = customer || checkPermi(['mes:portal:query'])
const canReadCost = !customer && checkPermi(['mes:cost:query'])
const canQuery =
  !customer && checkPermi(['mes:kitting:query']) && checkPermi(['mes:pro-work-order:query'])
const canKnowledge = !customer && checkPermi(['mes:assistant:knowledge'])
const canKnowledgeChat = canKnowledge && checkPermi(['mes:assistant:chat'])
const canDify = canKnowledgeChat
const picker = ref<InstanceType<typeof ProWorkOrderSelectDialog>>()
const order = shallowRef<ProWorkOrderVO>()
const run = shallowRef<WorksRun>()
const access = computed(() => ({
  canQuery,
  canKnowledge,
  canDify,
  preferKnowledge: props.preferKnowledge,
  canBusiness,
  canPrice,
  customer,
  orderCode: order.value?.code || ''
}))
const defaultQuestion = '这张工单缺哪些物料？为什么仓库有货仍会缺料？'
const manualQuestion = '为什么账面有货还是提示缺料？开工前怎样核对工单预占与可用库存？'
let generation = 0
let pending: SceneCommand | undefined
let stock: WorksRun | undefined
let supplemental = ''
let refreshing = false
let lastKittingRequest: SceneCommand | undefined
let timer: number | undefined
function reset() {
  generation++
  run.value = undefined
  stock = undefined
  supplemental = ''
  pending = undefined
  refreshing = false
  lastKittingRequest = undefined
}
function patch(update: Partial<WorksRun>) {
  if (run.value) run.value = { ...run.value, ...update }
}
function append(...steps: WorksStep[]) {
  if (run.value && steps.length) patch({ steps: [...run.value.steps, ...steps] })
}
function cue(role: WorksCue['role'], title: string, code: string) {
  if (run.value) patch({ trace: [...(run.value.trace || []), { role, title, code }] })
}
function beginTrace(question: string, title: string, fromChoice = false) {
  cue(
    'dispatch',
    fromChoice ? '接收所选操作' : '接收本轮提问',
    [
      fromChoice ? 'choice(request)' : 'ask(request)',
      'const question = ' +
        JSON.stringify(question.length > 100 ? question.slice(0, 100) + '…' : question),
      '// ' + title
    ].join('\n')
  )
  cue(
    'parse',
    title,
    [
      ...(fromChoice
        ? ['const value = request.choice', 'const [group, key, step] = value.split(":")']
        : [
            'const reference = request.reference',
            'const fanContext = current?.showFan ?? true',
            'const route = intentOf(question, reference, fanContext)'
          ]),
      '// ' + title
    ].join('\n')
  )
}
function closeTrace() {
  const current = run.value
  if (!current || current.trace?.at(-1)?.role === 'report') return
  cue(
    'report',
    '编制本轮报告',
    [
      'const { question, answer, source, steps } = run',
      'const refs = steps.filter(step => step.agent === "evidence")',
      '// ' + (current.source || current.stage || '本轮执行记录'),
      '// 答复 ' +
        current.answer.length +
        ' 字 · ' +
        current.steps.filter((s) => s.agent === 'evidence').length +
        ' 条依据'
    ].join('\n')
  )
  patch({ agents: { ...current.agents, report: '完成' } })
}
function choose(rows: ProWorkOrderVO[]) {
  if (!rows[0]) return
  const requested = pending
  reset()
  order.value = rows[0]
  if (requested) void ask(requested)
}
function report() {
  if (!stock || !run.value || run.value.busy) return
  const lines = (stock.materials || [])
    .filter((m) => m.state === 'short')
    .map((m) => m.name + '（' + m.code + '） · ' + m.label)
  const text = [
    stock.orderCode + ' · 缺料报告',
    stock.source,
    ...(lines.length ? lines : [stock.answer]),
    supplemental
  ]
    .filter(Boolean)
    .join('\n')
  patch({ report: text, stage: '报告已生成', agents: { ...run.value.agents, report: '完成' } })
  append({
    agent: 'report',
    title: '缺料报告已生成',
    detail: '采用本轮工单快照和已返回的规程资料。'
  })
}
async function references(source: SceneCommand['reference'], query = manualQuestion) {
  if (source === 'dify' && canDify) {
    const trace = await runDify(query)
    const record = journeyRun(difyJourney(trace))
    return {
      text: record.answer,
      ok: trace.status === 'succeeded',
      steps: record.steps.map((s) => ({ ...s, agent: 'evidence' as const }))
    }
  }
  if (source === 'knowledge' && canKnowledge) {
    const result = await searchEvidence({
      query,
      mode: 'DOCUMENT',
      documentStrategy: 'LEXICAL',
      limit: 3
    })
    const detail =
      result.items
        .map(
          (i, n) =>
            '[' +
            (n + 1) +
            '] ' +
            i.title +
            (i.pageNumber ? ' · 第 ' + i.pageNumber + ' 页' : '') +
            '\n' +
            i.text
        )
        .join('\n\n') || '当前可访问的规程没有命中相关片段。'
    return {
      text: detail,
      ok: true,
      steps: [{ title: '已发布规程', detail, agent: 'evidence' as const }]
    }
  }
  return { text: '', ok: true, steps: [] }
}
function startView(
  question: string,
  kind: DisplayKind,
  title: string,
  showFan = false,
  fromChoice = false
) {
  reset()
  run.value = {
    id: 'view-' + generation,
    question,
    answer: '',
    source: '',
    stage: title,
    busy: true,
    showFan,
    display: { kind, title },
    agents: { parse: '完成', evidence: '运行中' },
    steps: [{ agent: 'parse', title, detail: question }]
  }
  beginTrace(question, title, fromChoice)
  return generation
}
function finishView(token: number, result: AnswerView) {
  if (generation !== token || !run.value) return
  cue(
    'assess',
    result.stage || '核对本轮结果',
    'const { answer, steps, source } = result\n' +
      'const evidence = steps.filter(step => step.agent === "evidence")\n' +
      '// ' +
      [
        result.display?.value || result.stage || result.source,
        result.steps.some((s) => s.agent === 'evidence')
          ? result.steps.filter((s) => s.agent === 'evidence').length + ' 条依据'
          : ''
      ]
        .filter(Boolean)
        .join(' · ')
  )
  patch({
    ...result,
    busy: false,
    stage: result.stage || '已答复',
    steps: [...run.value.steps.filter((s) => s.agent === 'parse'), ...result.steps],
    agents: {
      parse: '完成',
      evidence: result.stage === '手册查询失败' ? '失败' : '完成',
      assess: result.stage === '证据不足' || result.stage === '手册查询失败' ? '待命' : '完成'
    }
  })
  closeTrace()
}
function finishGuide(token: number, guide: Guide) {
  const display = { ...guide.display }
  if (canKnowledge && (display.kind === 'assembly' || display.focusParts?.length)) {
    display.choices = [...(display.choices || []), { label: '查手册依据', value: 'manual' }]
  }
  finishView(token, { ...guide, display, source: 'FazeMES 风扇教学模型', showFan: true })
}
let previousBusiness: BusinessAnswer | undefined
let productId: number | undefined
let guideKey: string | undefined

async function otherQuestion(
  question: string,
  route: ReturnType<typeof intentOf>,
  request: SceneCommand,
  chosen?: number,
  clarificationId?: string
) {
  const specificFan = refersToFan(question, run.value?.showFan ?? true)
  const priorBusiness = previousBusiness
  const token = startView(
    question,
    route === 'dify' ? 'knowledge' : route === 'kitting' ? 'business' : route,
    {
      price: '查询型号售价',
      fault: '定位观察现象',
      lifetime: '核对运行依据',
      assembly: '定位装配步骤',
      knowledge: '检索知识库',
      business: '查询业务记录',
      dify: '读取 Dify 项目手册',
      kitting: '查询工单'
    }[route],
    route === 'fault' || route === 'assembly' || (route === 'lifetime' && specificFan),
    request.action === 'choice'
  )
  if (route !== 'business') previousBusiness = undefined
  try {
    if (route === 'price') {
      if (!canPrice) throw new Error('当前账号没有产品目录查询权限。')
      const modelQuestion =
        order.value && /这张工单|本工单|本单产品/.test(question)
          ? order.value.productCode
          : question
      cue(
        'evidence',
        '读取型号与参考价',
        [
          'const modelQuestion = ' + JSON.stringify(modelQuestion.slice(0, 88)),
          'const reply = await priceView(',
          '  modelQuestion, customer, canReadCost, productId, chosen',
          ')'
        ].join('\n')
      )
      const reply = await priceView(modelQuestion, customer, canReadCost, productId, chosen)
      if (generation !== token) return
      if (reply.product) productId = reply.product.productId
      finishView(token, reply.result)
      return
    }
    if (route === 'fault') {
      cue(
        'evidence',
        '读取对应的排查指引',
        'const symptom = matchSymptom(question)\nfaultGuide(symptom)'
      )
      guideKey = matchSymptom(question)
      finishGuide(token, faultGuide(guideKey))
      return
    }
    if (route === 'assembly') {
      cue('evidence', '定位模型与装配步骤', 'assemblyGuide(namedParts(question)[0] ?? 0)')
      finishGuide(token, assemblyGuide(namedParts(question)[0] ?? 0))
      return
    }
    if (route === 'lifetime') {
      cue(
        'evidence',
        '核对可用运行依据',
        'const specificFan = refersToFan(question, fanContext)\n// 当前入口没有单机寿命记录'
      )
      finishView(token, {
        source: '单机运行记录',
        showFan: specificFan,
        steps: [
          {
            agent: 'assess',
            title: '故障时间评估依据',
            detail: '本场景没有与这台风扇序列号关联的运行趋势和已验证的寿命评估结果。'
          }
        ],
        answer: specificFan
          ? '目前无法估计这台风扇何时会坏。最近有异响、晃动或风量变化吗？可以从已观察到的现象开始。'
          : '缺少这台设备的运行趋势和已验证的寿命评估，暂时无法估计故障时间。请提供设备型号、已观察到的异常和记录。',
        display: {
          kind: 'lifetime',
          title: '故障时间评估',
          value: '单机数据不足',
          caption: specificFan ? '可按实际现象继续排查' : '需要单机运行依据',
          choices: specificFan ? symptomChoices : []
        }
      })
      return
    }
    if (route === 'business' && customer) {
      if (!/订单|工单|生产|进度|交期/.test(question))
        throw new Error('客户入口可查询当前账号的订单进度。')
      cue('evidence', '读取客户订单', 'await CustomerPortalApi.orders()')
      const rows = await CustomerPortalApi.orders()
      const code = question.match(/[a-z0-9]+(?:[-_][a-z0-9]+)+/i)?.[0]
      const list = code ? rows.filter((o) => o.code.toLowerCase() === code.toLowerCase()) : rows
      const steps: WorksStep[] = list.map((o) => ({
        agent: 'evidence',
        title: o.code + ' · ' + o.productName,
        detail:
          '已生产 ' +
          o.quantityProduced +
          ' / ' +
          o.quantity +
          (o.requestDate ? ' · 要求交期 ' + o.requestDate : '')
      }))
      finishView(token, {
        answer: steps.length
          ? steps.map((s) => s.title + '，' + s.detail).join('\n')
          : '当前客户账号没有匹配的订单。',
        source: '客户订单',
        showFan: false,
        steps,
        display: { kind: 'business', title: '我的订单进度', value: steps.length + ' 张订单' }
      })
      return
    }
    if (
      route === 'business' &&
      !clarificationId &&
      canQuery &&
      order.value &&
      isSelectedProgress(question, order.value.code)
    ) {
      cue('evidence', '读取所选工单及进度', 'await orderProgressView(order.id, canReadTasks)')
      finishView(token, await orderProgressView(order.value.id, checkPermi(['mes:pro-task:query'])))
      return
    }
    if (route === 'business' && canBusiness) {
      cue('evidence', '查询 MES 业务工具', 'await InsightApi.ask({ question, useModel: false })')
      const r = await InsightApi.ask({
        question: clarificationId ? '' : question,
        useModel: false,
        ...(priorBusiness
          ? { conversationId: priorBusiness.conversationId, version: priorBusiness.version }
          : {}),
        ...(clarificationId && priorBusiness?.clarification
          ? {
              clarification: { token: priorBusiness.clarification.token, choiceId: clarificationId }
            }
          : {})
      })
      if (generation !== token) return
      if (r.status !== 'OUT_OF_SCOPE' || !canKnowledge || request.reference === 'business') {
        previousBusiness = r
        finishView(token, businessView(r))
        return
      }
      previousBusiness = undefined
      cue('assess', '业务工具未覆盖，转查知识', 'r.status === "OUT_OF_SCOPE"\n// 转交当前知识库')
      append({
        agent: 'parse',
        title: '转交知识助手',
        detail: '业务工具没有覆盖此问法，继续检索当前账号可访问的知识库。'
      })
    }
    if (route === 'dify' && canDify) {
      cue('evidence', '调用 Dify 手册工作流', 'await runDify(question)')
      const r = await references('dify', question)
      finishView(token, {
        answer: r.text,
        source: 'Dify 项目手册',
        stage: r.ok ? '已答复' : '手册查询失败',
        showFan: false,
        steps: r.steps,
        display: {
          kind: 'knowledge',
          title: 'Dify 手册问答',
          value: r.ok ? '工作流已返回' : '查询失败'
        }
      })
      return
    }
    if (!canKnowledge)
      throw new Error(
        customer
          ? '客户入口可查询产品售价、订单进度和风扇使用问题。该问题需要已授权的项目知识库。'
          : '当前账号没有知识库查询权限。'
      )
    const scope = props.knowledgeScope || allKnowledge
    const mode =
      request.reference === 'graph'
        ? 'GRAPH'
        : request.reference === 'hybrid'
          ? 'HYBRID'
          : scope.mode
    const send =
      canKnowledgeChat && request.reference !== 'evidence' ? props.askKnowledge : undefined
    const selectedScope = { ...scope, knowledgeBaseIds: [...scope.knowledgeBaseIds], mode }
    cue(
      'evidence',
      send ? '调用知识助手' : '检索可访问的证据',
      [
        'const mode = ' + JSON.stringify(mode),
        'const selectedScope = { ...scope, mode }',
        send
          ? 'await sendKnowledgeQuestion(question, mode)'
          : 'await searchEvidence({ ...selectedScope, query: question, limit: 6 })',
        '// ' +
          (mode === 'GRAPH' ? 'LEXICAL' : scope.documentStrategy) +
          ' · ' +
          (selectedScope.knowledgeBaseIds.length
            ? selectedScope.knowledgeBaseIds.length + ' 个已选知识库'
            : '全部可访问的已发布知识库')
      ].join('\n')
    )
    let reply = await knowledgeView(question, selectedScope, send)
    if (generation !== token) return
    const subject = reply.stage === '证据不足' ? evidenceFollowup(question) : undefined
    if (subject) {
      cue(
        'assess',
        '首轮证据不足，退回补查',
        'result.stage === "证据不足"\nevidenceFollowup(question)'
      )
      cue(
        'evidence',
        '按问题中的主题补查',
        'await searchEvidence({ ...scope, query, limit: 6 })\n' +
          '// ' +
          JSON.stringify(subject.slice(0, 80))
      )
      try {
        const supplement = await knowledgeView(subject, selectedScope)
        if (generation !== token) return
        if (supplement.steps.length) {
          reply = {
            ...supplement,
            stage: '已返回补充依据',
            answer:
              reply.answer +
              '\n\n按「' +
              subject +
              '」补查到 ' +
              supplement.steps.length +
              ' 条相关原文，可在报告中逐条核对。',
            display: { ...supplement.display!, value: '已返回补充依据' }
          }
        } else reply = { ...reply, answer: reply.answer + '\n同一知识范围内补查后仍未找到依据。' }
      } catch {
        if (generation !== token) return
        reply = { ...reply, answer: reply.answer + '\n补查暂未取得结果。' }
      }
    }
    finishView(token, reply)
  } catch (error) {
    if (generation === token) {
      const message = error instanceof Error ? error.message : '查询暂未完成，请稍后重试。'
      cue('assess', '核对查询状态', '// ' + message)
      patch({
        busy: false,
        stage: '暂未取得结果',
        answer: message,
        agents: { parse: '完成', evidence: '失败' }
      })
      closeTrace()
    }
  }
}
function choice(request: SceneCommand) {
  const view = run.value,
    value = request.choice
  if (
    !view ||
    view.busy ||
    request.runId !== view.id ||
    !value ||
    !view.display?.choices?.some((c) => c.value === value)
  )
    return
  const [group, key, step] = value.split(':')
  if (group === 'manual') {
    const topic = view.display.kind === 'assembly' ? view.display.value : view.display.title
    void otherQuestion('电风扇' + topic + '有哪些手册依据和注意事项？', 'knowledge', {
      action: 'choice',
      reference: 'knowledge'
    })
    return
  }
  if (group === 'product') {
    void otherQuestion(view.question, 'price', request, Number(key))
    return
  }
  if (group === 'business') {
    void otherQuestion(view.question, 'business', request, undefined, key)
    return
  }
  const label = view.display.choices?.find((c) => c.value === value)?.label || view.question
  if (group === 'assembly') {
    const token = startView(label, 'assembly', '定位装配步骤', true, true)
    cue('evidence', '读取装配指引', 'assemblyGuide(part)')
    finishGuide(token, assemblyGuide(Number(key)))
    return
  }
  if (group === 'symptom' || group === 'guide' || group === 'symptoms') {
    guideKey = key
    const token = startView(label, 'fault', '继续排查现象', true, true)
    cue('evidence', '读取下一步排查指引', 'faultGuide(symptom, step)')
    finishGuide(token, faultGuide(key, step))
  }
}
async function ask(request: SceneCommand) {
  if (run.value?.busy) return
  const question = (request.question?.trim() || (order.value ? defaultQuestion : '')).slice(0, 4000)
  if (!question) return
  const current = run.value
  const selectedChoice = current?.display?.choices?.find((c) => c.label === question)
  if (selectedChoice) {
    choice({ ...request, runId: current?.id, choice: selectedChoice.value })
    return
  }
  const fanContext = current?.showFan ?? true
  let route = intentOf(question, request.reference, fanContext)
  if (
    current?.display?.kind === 'price' &&
    (!request.reference || request.reference === 'auto') &&
    route === 'knowledge' &&
    /^(?:那|换|再看)|(?:款|型号|[-_][a-z0-9]+)呢?[？?]?$/i.test(question)
  )
    route = 'price'
  if (
    current?.display?.kind === 'fault' &&
    (!request.reference || request.reference === 'auto') &&
    guideKey &&
    /^(?:已经好了|还是(?:响|不转|一样|有异常)|仍然(?:有|响)|好了|没了|还有(?:异响|噪音)|消失了|仍有异常)[。！!？?]?$/.test(
      question
    )
  ) {
    const token = startView(question, 'fault', '核对观察反馈', true)
    cue('evidence', '读取排查反馈指引', 'faultGuide(symptom, step)')
    finishGuide(
      token,
      faultGuide(guideKey, /消失|好了|没了/.test(question) ? 'resolved' : 'service')
    )
    return
  }
  if (
    route === 'knowledge' &&
    (!request.reference || request.reference === 'auto' || request.reference === 'business') &&
    previousBusiness?.clarification?.acceptsFreeText &&
    /^(?:\d{1,4}[年月日]|本月|上月|全部|仓库)/.test(question)
  )
    route = 'business'
  if (
    stock &&
    request.action !== 'refresh' &&
    /^(?:生成|查看|导出|给我)?(?:这张工单的?)?(?:缺料)?(?:报告|汇总)[。！!？?]?$/.test(question)
  ) {
    report()
    return
  }
  if (route !== 'kitting' || !canQuery) {
    await otherQuestion(
      question,
      route === 'kitting' ? (customer ? 'business' : 'knowledge') : route,
      request
    )
    return
  }
  previousBusiness = undefined
  if (!order.value) {
    pending = request
    picker.value?.open([])
    return
  }
  const selected = order.value
  reset()
  lastKittingRequest = { action: 'refresh', question, reference: request.reference }
  const token = generation
  const source =
    request.reference === 'dify' && canDify
      ? 'dify'
      : request.reference === 'kitting-doc' && canKnowledge
        ? 'knowledge'
        : 'business'
  const tool = source === 'dify' ? 'Dify 项目手册' : '已发布规程'
  run.value = {
    id: 'ask-' + token,
    orderCode: selected.code,
    source: '本轮实时查询',
    question,
    answer: '',
    busy: true,
    stage: '调取工单证据',
    showFan: isFanProduct(selected.productName, selected.productCode),
    agents: { parse: '完成', evidence: '运行中' },
    steps: [
      { agent: 'parse', title: '已定位工单', detail: selected.code + ' · ' + selected.name },
      {
        agent: 'evidence',
        title: '查询工单齐套数据',
        detail: '读取 BOM、净领料、可用库存及其他工单预占。'
      }
    ]
  }
  beginTrace(question, '定位工单与物料')
  cue(
    'evidence',
    '读取齐套与可用库存',
    'const orderId = ' +
      selected.id +
      '\nconst data = await KittingApi.analyze(orderId)\n// ' +
      selected.code +
      (source === 'dify'
        ? '\nawait runDify(query)'
        : source === 'knowledge'
          ? '\nawait searchEvidence({ query, mode: "DOCUMENT", limit: 3 })'
          : '')
  )
  if (source !== 'business')
    append({ agent: 'evidence', title: '查询' + tool, detail: '等待' + tool + '返回。' })
  let manualOK = true
  const facts = KittingApi.analyze(selected.id)
    .then((data) => {
      if (token !== generation) return
      stock = kittingRun(data, selected.productName, selected.productCode)
      patch({
        source: stock.source,
        materials: stock.materials,
        shortageParts: stock.shortageParts,
        showFan: stock.showFan,
        stockOK: true,
        answer: stock.answer,
        stage: '已核对物料，正在汇合证据',
        agents: { parse: '完成', evidence: '运行中', assess: '完成' }
      })
      append(
        {
          agent: 'evidence',
          title: '齐套数据已返回',
          detail: data.materials.length + ' 种物料 · ' + data.shortageItemCount + ' 种缺料'
        },
        { agent: 'assess', title: '已核对物料缺口', detail: stock.answer }
      )
    })
    .catch(() => {
      if (token !== generation) return
      patch({ answer: '本次未能取得齐套数据。请重新核对工单。', stockOK: false })
      append({
        agent: 'evidence',
        title: '齐套查询失败',
        detail: '本次没有可用于判断缺口的库存快照。'
      })
    })
  const docs = references(source)
    .then((result) => {
      if (token !== generation) return
      manualOK = result.ok
      supplemental = result.text
      append(...result.steps)
    })
    .catch(() => {
      if (token !== generation) return
      manualOK = false
      supplemental = tool + '暂未返回。'
      append({ agent: 'evidence', title: tool + '查询失败', detail: supplemental })
    })
  await Promise.all([facts, docs])
  if (token !== generation || !run.value) return
  patch({
    busy: false,
    stage: stock ? '已答复' : '齐套查询失败',
    answer: [stock?.answer || run.value.answer, supplemental].filter(Boolean).join('\n\n'),
    agents: {
      parse: '完成',
      evidence: stock ? (manualOK ? '完成' : '部分完成') : '失败',
      assess: stock ? '完成' : '待命'
    }
  })
  cue(
    'assess',
    stock ? '核对物料缺口和预占' : '核对查询状态',
    (stock
      ? 'const stock = kittingRun(data, productName, productCode)\nconst short = stock.materials.filter(m => m.state === "short")'
      : '// 未取得齐套数据') +
      '\n// ' +
      (stock?.materials?.length || 0) +
      ' 种物料有记录'
  )
  if (stock && /报告|汇总/.test(question)) report()
  closeTrace()
}
async function refresh() {
  if (!order.value || !run.value?.orderCode || run.value.busy || document.hidden) return
  const token = generation,
    selected = order.value
  if (refreshing) return
  refreshing = true
  try {
    const data = await KittingApi.analyze(selected.id)
    if (token !== generation || !run.value) return
    const latest = kittingRun(data, selected.productName, selected.productCode)
    const changed =
      JSON.stringify(latest.materials) !== JSON.stringify(stock?.materials) ||
      latest.answer !== stock?.answer
    stock = latest
    patch({
      source: latest.source,
      stockOK: true,
      materials: latest.materials,
      shortageParts: latest.shortageParts,
      showFan: latest.showFan,
      answer: [latest.answer, supplemental].filter(Boolean).join('\n\n'),
      stage: '已复核',
      report: changed ? undefined : run.value.report,
      agents: {
        ...run.value.agents,
        evidence: run.value.agents?.evidence === '部分完成' ? '部分完成' : '完成',
        assess: '完成',
        report: changed ? '待命' : run.value.agents?.report
      }
    })
    if (changed)
      append({
        agent: 'assess',
        title: '已重新核对工单',
        detail: latest.answer
      })
  } catch {
    if (token === generation && run.value)
      patch({ stage: stock ? '复核失败 · 保留上次快照' : '齐套查询失败' })
  } finally {
    if (token === generation) refreshing = false
  }
}
function command(request: SceneCommand) {
  if (request.action === 'choice') {
    choice(request)
    return
  }
  if (request.action === 'settings' && canKnowledge) {
    emit('knowledgeSettings')
    return
  }
  if (request.action === 'reset') {
    previousBusiness = undefined
    productId = undefined
    guideKey = undefined
    reset()
    return
  }
  if (request.action === 'ask') {
    void ask(request)
    return
  }
  if (!canQuery) return
  if (request.action === 'choose') {
    pending = undefined
    picker.value?.open(order.value ? [order.value.id] : [])
    return
  }
  if (request.action === 'report') report()
  else if (request.action === 'refresh' && lastKittingRequest) void ask(lastKittingRequest)
}
function start() {
  if (!timer)
    timer = window.setInterval(() => {
      if (props.visible !== false) void refresh()
    }, 15000)
}
function stop() {
  window.clearInterval(timer)
  timer = undefined
  reset()
}
onMounted(start)
onActivated(start)
onBeforeUnmount(stop)
onDeactivated(stop)
</script>
