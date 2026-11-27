import type { KittingAnalysis } from '@/api/mes/pro/kitting'
import type { BusinessTurn } from '@/api/mes/insight/business'
import type { Journey } from './workflowJourney'
import { formatQuantity, quantityUnits } from '@/utils/mesQuantity'
import { formatAssistantTime } from './assistantTime'
import { stepStatus } from './workflowRunway'

export interface WorksStep {
  title: string
  detail: string
  part?: number
}
export interface WorksRun {
  source: string
  question: string
  answer: string
  steps: WorksStep[]
  shortageParts?: number[]
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

export function kittingRun(data: KittingAnalysis): WorksRun {
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
    const name = item.itemName.trim().replace(/^(?:台式)?电?风扇/, '')
    const part = fanPartNames.findIndex((pattern) => pattern.test(name))
    if (part >= 0 && (quantityUnits(item.shortageQuantity) ?? 0n) > 0n) shortageParts.add(part)
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
    shortageParts: [...shortageParts]
  }
}
