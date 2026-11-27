import type { KittingAnalysis } from '@/api/mes/pro/kitting'
import type { BusinessTurn } from '@/api/mes/insight/business'
import type { Journey } from './workflowJourney'
import { formatQuantity, quantityUnits } from '@/utils/mesQuantity'
import { formatAssistantTime } from './assistantTime'
import { stepStatus } from './workflowRunway'

export type AgentRole = 'parse' | 'evidence' | 'assess' | 'report'
export type AgentState = '运行中' | '完成' | '失败' | '部分完成' | '待命'
export interface WorksMaterial {
  modelLabel?: string
  code: string
  name: string
  part?: number
  state: 'ready' | 'short' | 'unknown'
  label: string
  detail: string
}
export interface WorksStep {
  agent?: AgentRole
  title: string
  detail: string
  part?: number
}
export type DisplayKind = 'price' | 'fault' | 'lifetime' | 'knowledge' | 'business' | 'assembly'
export interface DisplayChoice {
  label: string
  value: string
}
export interface WorksDisplay {
  kind: DisplayKind
  title: string
  value?: string
  caption?: string
  focusParts?: number[]
  assembledParts?: number
  choices?: DisplayChoice[]
}
export interface WorksCue {
  role: AgentRole | 'dispatch'
  title: string
  code: string
}
export interface WorksRun {
  trace?: WorksCue[]
  display?: WorksDisplay
  source: string
  question: string
  answer: string
  steps: WorksStep[]
  shortageParts?: number[]
  id?: string
  stage?: string
  orderCode?: string
  showFan?: boolean
  agents?: Partial<Record<AgentRole, AgentState>>
  materials?: WorksMaterial[]
  report?: string
  busy?: boolean
  stockOK?: boolean
}

export function journeyRun(data: Journey): WorksRun {
  const trace = data.trace
  const sources = data.sources.map((item, i) =>
    [
      `[${i + 1}] ${item.title}`,
      item.version ? `v${item.version}` : '',
      item.page ? `第 ${item.page} 页` : '',
      item.text
    ]
      .filter(Boolean)
      .join(' · ')
  )
  const steps = trace
    ? trace.steps.map((step) => ({
        title: step.title,
        detail: [
          stepStatus(step.status),
          step.seconds != null ? `${step.seconds} 秒` : '',
          step.detail
        ]
          .filter(Boolean)
          .join(' · ')
      }))
    : [{ title: '提问与范围', detail: data.scope }]
  if (sources.length) steps.push({ title: '引用原文', detail: sources.join('\n\n') })
  const answer = data.result || (trace ? stepStatus(trace.status) : data.branch)
  steps.push({
    title: trace ? '工作流结果' : '本轮结果',
    detail: [data.branch, answer].filter(Boolean).join('\n')
  })
  return {
    source: [data.origin, trace?.runId].filter(Boolean).join(' · '),
    question: data.question,
    answer,
    steps
  }
}

export function businessRun(turn: BusinessTurn): WorksRun {
  const { answer } = turn
  const result = answer.executionReceipt?.message || answer.answer
  const steps: WorksStep[] = [{ title: '本轮请求', detail: turn.question || '已选择澄清选项' }]
  steps.push({
    title: answer.mode === 'MODEL' ? '模型答复' : '业务规则答复',
    detail: answer.answer
  })
  if (answer.proposal)
    steps.push({
      title: '操作建议',
      detail:
        answer.proposal.title ||
        answer.proposal.description ||
        '本轮提供业务操作建议。执行状态以回执为准。'
    })
  if (answer.executionReceipt)
    steps.push({
      title: '执行回执',
      detail: [
        answer.executionReceipt.message,
        formatAssistantTime(answer.executionReceipt.executedAt)
      ]
        .filter(Boolean)
        .join('\n')
    })
  return {
    source: [`业务会话 · 回合 ${turn.id}`, formatAssistantTime(answer.generatedAt)]
      .filter(Boolean)
      .join(' · '),
    question: steps[0].detail,
    answer: result,
    steps
  }
}

// Match complete part names. Motor fasteners and blade locknuts have their own identities in a BOM.
const fanPartNames = [
  /^(?:防滑)?底座$/,
  /^(?:立柱|支架|立柱支架)$/,
  /^(?:驱动|交流|直流|无刷)?(?:电机|马达)(?:总成)?$/,
  /^后(?:防护)?网罩$/,
  /^(?:三片弧形|三片|三叶)?(?:扇叶|风叶|叶轮)$/,
  /^(?:扇叶|风叶|叶轮)?锁帽$/,
  /^前(?:防护)?网罩$/
]

// The Broky product and its two subassemblies share the fan drawing. Codes are from their BOMs.
const brokySections: Record<string, number> = {
  'BROKY-SA-H': 2,
  'BROKY-SA-S': 0,
  'BROKY-R01': 3,
  'BROKY-R02': 6,
  'BROKY-R03': 4,
  'BROKY-R04': 5,
  'BROKY-R05': 3,
  'BROKY-R06': 6,
  'BROKY-R16': 2,
  'BROKY-R21': 0,
  'BROKY-R22': 0,
  'BROKY-R23': 0,
  'BROKY-R24': 1,
  'BROKY-R25': 1
}
export function isFanProduct(name = '', code = '') {
  return (
    /风扇|电扇|台扇|循环扇/.test(name) || ['BROKY-FG-V2', 'BROKY-SA-H', 'BROKY-SA-S'].includes(code)
  )
}
export function kittingRun(
  data: KittingAnalysis,
  productName?: string,
  productCode?: string
): WorksRun {
  const question = `工单 ${data.workOrderCode} 缺哪些物料？为什么仓库有货仍会缺料？`
  const analyzedAt = formatAssistantTime(data.analyzedAt)
  const steps: WorksStep[] = [
    {
      title: '定位工单',
      detail: [data.workOrderCode, data.workOrderName, analyzedAt].filter(Boolean).join(' · ')
    }
  ]
  const missing = data.materials.filter((item) => (quantityUnits(item.shortageQuantity) ?? 0n) > 0n)
  const shortageParts = new Set<number>()
  const materials: WorksMaterial[] = []
  const lines = missing.map(
    (item) =>
      `${item.itemName}（${item.itemCode}）缺 ${formatQuantity(item.shortageQuantity)} ${item.unitName || ''}。尚需 ${formatQuantity(item.outstandingQuantity)}，本单可用 ${formatQuantity(item.availableQuantity)}，符合条件的实物库存 ${formatQuantity(item.physicalQuantity)}，其他工单预占 ${formatQuantity(item.otherReservedQuantity)}。`
  )
  const conditions: Record<string, string> = {
    NO_BOM: '工单尚未维护物料清单，当前无法判断齐套情况。',
    ISSUED: '本单物料已领齐。',
    READY: '本次查询显示物料可齐套。',
    CLOSED: '工单已关闭。'
  }
  const answer =
    [conditions[data.status], ...lines].filter(Boolean).join('\n') ||
    (data.ready ? '物料可齐套。' : '请核对工单齐套明细。')
  for (const item of data.materials) {
    const unit = item.unitName || ''
    const q = (value: string | number) => formatQuantity(value) + unit
    const detail = [
      `BOM 需求 ${q(item.requiredQuantity)}，净领料 ${q(item.issuedQuantity)}，尚需 ${q(item.outstandingQuantity)}。`,
      `符合条件的实物库存 ${q(item.physicalQuantity)}，其他工单预占 ${q(item.otherReservedQuantity)}。`,
      `自由库存 ${q(item.freeQuantity)}，本工单可用预占 ${q(item.usableReservedQuantity)}，合计可用 ${q(item.availableQuantity)}，缺口 ${q(item.shortageQuantity)}。`
    ].join('\n')
    const name = item.itemName.trim().replace(/^(?:台式)?(?:电?风扇|电扇)/, '')
    const identified = brokySections[item.itemCode]
    const part = identified ?? fanPartNames.findIndex((pattern) => pattern.test(name))
    const quantity = quantityUnits(item.shortageQuantity)
    const state = quantity == null ? 'unknown' : quantity > 0n ? 'short' : 'ready'
    if (part >= 0 && state === 'short') shortageParts.add(part)
    materials.push({
      name: item.itemName,
      modelLabel: identified != null ? item.itemName.replace(/^Broky/i, '') : undefined,
      code: item.itemCode,
      ...(part >= 0 ? { part } : {}),
      state,
      label:
        state === 'short'
          ? '缺 ' + [formatQuantity(item.shortageQuantity), unit].filter(Boolean).join(' ')
          : state === 'ready'
            ? '已齐套'
            : '待核对',
      detail
    })
    steps.push({
      title: `${item.itemCode} · ${item.itemName}`,
      detail,
      ...(part >= 0 ? { part } : {})
    })
  }
  steps.push({ title: '齐套结论', detail: answer })
  return {
    source: ['工单齐套查询', analyzedAt].filter(Boolean).join(' · '),
    question,
    answer,
    steps,
    shortageParts: [...shortageParts],
    id: 'order-' + data.workOrderId,
    orderCode: data.workOrderCode,
    stockOK: true,
    showFan:
      productName || productCode
        ? isFanProduct(productName, productCode)
        : isFanProduct(data.workOrderName) ||
          data.materials.some(
            (m) => brokySections[m.itemCode] != null || /风扇|台扇/.test(m.itemName)
          ),
    materials,
    agents: { parse: '完成', evidence: '完成', assess: '完成' },
    stage: '已核对'
  }
}

export interface WorkspaceAccess {
  canQuery: boolean
  preferKnowledge?: boolean
  canKnowledge: boolean
  canDify: boolean
  canBusiness?: boolean
  canPrice?: boolean
  customer?: boolean
  orderCode: string
}
export interface SceneCommand {
  action: 'choose' | 'ask' | 'reset' | 'refresh' | 'report' | 'choice' | 'settings'
  choice?: string
  runId?: string
  question?: string
  reference?:
    | 'auto'
    | 'business'
    | 'knowledge'
    | 'graph'
    | 'hybrid'
    | 'dify'
    | 'kitting-doc'
    | 'evidence'
}
