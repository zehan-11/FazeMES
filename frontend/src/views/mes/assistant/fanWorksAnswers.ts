import type { AssistantApi } from '@/api/mes/assistant'
import {
  searchEvidence,
  type DocumentStrategy,
  type RetrievalMode
} from '@/api/mes/assistant/evidence'
import { PortalAdminApi, CustomerPortalApi, type PortalProduct } from '@/api/mes/portal'
import { CostApi } from '@/api/mes/cost'
import { formatQuantity } from '@/utils/mesQuantity'
import { ProWorkOrderApi, type ProWorkOrderVO } from '@/api/mes/pro/workorder'
import { ProTaskApi, type ProTaskVO } from '@/api/mes/pro/task'
import type { BusinessAnswer } from '@/api/mes/insight/business'
import type { WorksRun, WorksStep } from './fanWorksRecords'
import { fanProduct, priceCandidates } from './fanWorksQuestions'

export type KnowledgeResponse = Awaited<ReturnType<typeof AssistantApi.send>>
export interface KnowledgeScope {
  knowledgeBaseIds: number[]
  mode: RetrievalMode
  hops: 1 | 2
  documentStrategy: DocumentStrategy
}
export const allKnowledge: KnowledgeScope = {
  knowledgeBaseIds: [],
  mode: 'DOCUMENT',
  hops: 2,
  documentStrategy: 'COMBINED'
}
export type AnswerView = Pick<
  WorksRun,
  'answer' | 'source' | 'display' | 'showFan' | 'steps' | 'stage'
>
const modeNames = { DOCUMENT: '文档', GRAPH: '图谱', HYBRID: '混合' }
export async function knowledgeView(
  question: string,
  scope: KnowledgeScope,
  send?: (q: string, mode: RetrievalMode) => Promise<KnowledgeResponse>
): Promise<AnswerView> {
  let answer: string, stage: string, steps: WorksStep[]
  if (send) {
    const r = await send(question, scope.mode)
    answer = r.answer || r.message || '本轮暂无答复。'
    stage =
      (
        {
          ANSWERED: '已答复',
          NO_EVIDENCE: '证据不足',
          MODEL_NOT_CONFIGURED: '仅返回检索结果',
          MODEL_ERROR: '模型暂不可用',
          EVIDENCE_RESTRICTED: '引用受限'
        } as Record<string, string>
      )[r.status] || '已返回'
    steps = (r.citations || []).map((c, i) => ({
      agent: 'evidence',
      title: '[' + (i + 1) + '] ' + c.title,
      detail: [
        c.sourceType === 'GRAPH' ? '图谱关系' : '文档原文',
        c.heading,
        c.pageNumber ? '第 ' + c.pageNumber + ' 页' : '',
        c.version ? 'v' + c.version : '',
        c.relation ? [c.relation.source, c.relation.type, c.relation.target].join(' → ') : '',
        c.content || c.evidence?.text
      ]
        .filter(Boolean)
        .join('\n')
    }))
  } else {
    if (question.length > 1000)
      throw new Error('独立证据检索最多支持 1000 字，请缩短问题或使用知识问答。')
    const r = await searchEvidence({
      ...scope,
      query: question,
      limit: 6,
      documentStrategy: scope.mode === 'GRAPH' ? 'LEXICAL' : scope.documentStrategy
    })
    steps = r.items.map((e, i) => ({
      agent: 'evidence',
      title: '[' + (i + 1) + '] ' + e.title,
      detail: [e.section, e.pageNumber ? '第 ' + e.pageNumber + ' 页' : '', e.text]
        .filter(Boolean)
        .join('\n')
    }))
    answer = steps.length
      ? '已按当前知识库范围检索到 ' + steps.length + ' 条依据。选择引用可查看原文。'
      : '所选知识库未找到足够依据。可以补充具体名称或换一种问法。'
    stage = steps.length ? '已返回依据' : '证据不足'
  }
  return {
    answer,
    stage,
    steps,
    source: '知识助手 · ' + modeNames[scope.mode] + '检索',
    showFan: false,
    display: {
      kind: 'knowledge',
      title: '知识问答',
      value: stage,
      caption: steps.length + ' 条引用'
    }
  }
}

// A second search keeps the same library, mode and strategy. Only shorten the user's wording.
export function evidenceFollowup(question: string) {
  const terms = question
    .trim()
    .split(/[，,。；;？！!?\n]/)
    .map((clause) =>
      clause
        .trim()
        .replace(
          /^(?:请问|麻烦|请帮我|请|帮我)?(?:查一下|查找|介绍一下|解释一下|告诉我|什么是|如何理解)?/,
          ''
        )
        .replace(
          /(?:的?(?:定义|原理|流程|具体步骤|注意事项))?(?:是什么|有哪些|是怎样的|怎么理解|怎么处理|如何操作|怎么办|是什么意思)$/,
          ''
        )
        .trim()
    )
    .filter((term) => term.length >= 2 && term.length <= 1000)
  const subject = terms.sort((a, b) => b.length - a.length)[0]
  return subject && subject !== question.trim().replace(/[。？！!?]+$/, '') ? subject : undefined
}

export async function priceView(
  question: string,
  customer: boolean,
  canReadCost: boolean,
  previous?: number,
  chosen?: number
): Promise<{ result: AnswerView; product?: PortalProduct }> {
  const rows = customer ? await CustomerPortalApi.catalog() : await PortalAdminApi.catalog()
  const listed = new Set(
    rows.filter((p) => p.enabled == null || Boolean(Number(p.enabled))).map((p) => p.productId)
  )
  let products = rows.filter((p) => listed.has(p.productId))
  if (!customer && canReadCost) {
    const master = await PortalAdminApi.products()
    const published = new Map(products.map((p) => [p.productId, p]))
    products = master.map(
      (p) =>
        published.get(p.id) || {
          productId: p.id,
          productCode: p.code,
          productName: p.name,
          specification: p.specification,
          description: ''
        }
    )
  }
  const matches =
    chosen != null
      ? products.filter((p) => p.productId === chosen)
      : priceCandidates(products, question, previous)
  const source = customer ? '客户产品目录' : '产品档案与发布目录'
  if (matches.length !== 1) {
    const answer = matches.length
      ? '有多个匹配型号，请选择要查看的产品。'
      : '当前可见目录没有匹配的型号。请核对产品编码或联系供应方询价。'
    return {
      result: {
        source,
        answer,
        steps: [],
        showFan: false,
        display: {
          kind: 'price',
          title: '产品参考售价',
          value: matches.length ? '选择型号' : '需询价',
          caption: matches.length > 16 ? '输入更完整的型号可进一步筛选。' : undefined,
          choices: matches.slice(0, 16).map((p) => ({
            label: p.productName + ' · ' + p.productCode,
            value: 'product:' + p.productId
          }))
        }
      }
    }
  }
  const product = matches[0]
  let price: number | string | null | undefined = product.referenceSalePrice,
    unit = product.unitName
  if (!customer && canReadCost) {
    const info = await CostApi.getProduct(product.productId)
    price = info.salePrice
    unit = info.unitMeasureName || unit
  }
  const amount =
    price != null && String(price).trim() && /^\d+(?:\.\d+)?$/.test(String(price))
      ? String(price).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
      : undefined
  const publicPrice = customer || listed.has(product.productId)
  const label = publicPrice ? '产品参考售价' : '内部参考售价'
  const value = amount == null ? '需询价' : '¥' + amount + (unit ? ' / ' + unit : '')
  const basis = publicPrice
    ? '人民币 · 未税，商务条件由供应方确认。'
    : '人民币 · 未税。该型号尚未在客户目录上架，对客报价需询价。'
  const answer = [
    product.productName + '（' + product.productCode + '）',
    amount != null
      ? label + ' ' + value + '。'
      : canReadCost || customer
        ? '暂无参考售价，请向供应方询价。'
        : '当前账号可核对型号，查询参考售价需使用客户目录或具备售价查询权限。',
    basis
  ].join('\n')
  return {
    product,
    result: {
      source,
      answer,
      showFan: fanProduct(product),
      steps: [
        {
          agent: 'evidence',
          title: product.productName + ' · ' + label,
          detail: [product.productCode, product.specification, value, basis]
            .filter(Boolean)
            .join('\n')
        }
      ],
      display: {
        kind: 'price',
        title: product.productName,
        value,
        caption: [label, product.specification, '未税'].filter(Boolean).join(' · ')
      }
    }
  }
}

export async function orderProgressView(id: number, canReadTasks: boolean): Promise<AnswerView> {
  const [order, taskPage]: [ProWorkOrderVO, { list: ProTaskVO[]; total: number } | undefined] =
    await Promise.all([
      ProWorkOrderApi.getWorkOrder(id),
      canReadTasks
        ? ProTaskApi.getTaskPage({ workOrderId: id, pageNo: 1, pageSize: 50 })
        : undefined
    ])
  const unit = order.unitMeasureName || ''
  const quantity = (n: number | string | undefined | null) =>
    n == null ? '待核对' : formatQuantity(n) + unit
  const text = '已生产 ' + quantity(order.quantityProduced) + ' / 计划 ' + quantity(order.quantity)
  const tasks = (taskPage?.list || []).filter((t) => t.workOrderId === id)
  const steps: WorksStep[] = [
    {
      agent: 'evidence',
      title: order.code + ' · ' + order.productName,
      detail: text + '，已排产 ' + quantity(order.quantityScheduled) + '。'
    }
  ]
  for (const t of tasks)
    steps.push({
      agent: 'evidence',
      title: t.processName + ' · ' + t.code,
      detail:
        '已生产 ' +
        quantity(t.producedQuantity) +
        ' / 排产 ' +
        quantity(t.quantity) +
        '。' +
        (t.workstationName ? '工作站 · ' + t.workstationName : '')
    })
  const caption = taskPage
    ? taskPage.total > tasks.length
      ? '已列出前 ' + tasks.length + ' 条任务，共 ' + taskPage.total + ' 条。'
      : tasks.length + ' 条工序任务。'
    : '工单记录'
  return {
    source: '生产工单与任务',
    answer: order.code + ' · ' + order.productName + '\n' + text + '。' + caption,
    showFan: false,
    steps,
    display: { kind: 'business', title: '工单生产进度', value: text, caption }
  }
}

export function businessView(r: BusinessAnswer): AnswerView {
  const steps: WorksStep[] = []
  const evidence = r.evidence as Record<string, unknown>
  const column: Record<string, string> = {
    code: '编码',
    name: '名称',
    workOrderCode: '工单',
    orderCode: '工单',
    productName: '产品',
    itemName: '物料',
    processName: '工序',
    statusName: '状态',
    statusLabel: '状态',
    status: '状态',
    quantity: '数量',
    quantityProduced: '已生产',
    producedQuantity: '已生产',
    completionRate: '完成率',
    riskLevel: '风险',
    reason: '原因',
    unitName: '单位',
    closingQuantity: '期末数量',
    openCount: '待处理',
    level: '级别',
    recordCode: '记录编码',
    title: '标题',
    count: '数量'
  }
  for (const key of ['list', 'items', 'orders', 'groups', 'stations', 'cases', 'rows', 'devices']) {
    const rows = evidence?.[key]
    if (!Array.isArray(rows)) continue
    for (const row of rows.slice(0, 15)) {
      if (!row || typeof row !== 'object') continue
      const fields = Object.entries(column).filter(
        ([k]) => row[k] != null && ['string', 'number', 'boolean'].includes(typeof row[k])
      )
      const title =
        row.code ||
        row.orderCode ||
        row.workOrderCode ||
        row.itemName ||
        row.name ||
        row.item?.name ||
        row.title
      if (fields.length || title)
        steps.push({
          agent: 'evidence',
          title: String(title || '业务记录 ' + (steps.length + 1)),
          detail: fields.map(([k, label]) => label + ' · ' + row[k]).join('\n') || String(title)
        })
    }
  }
  if (!steps.length && r.answer)
    steps.push({ agent: 'evidence', title: '业务工具返回', detail: r.answer })
  if (r.proposal)
    steps.push({
      agent: 'assess',
      title: '操作预览',
      detail: '如需执行，请在业务 Agent 中核对操作预览并确认。'
    })
  const clarification = r.clarification
  return {
    source: 'FazeMES 业务 Agent',
    answer: r.answer || clarification?.prompt || '',
    steps,
    showFan: false,
    stage: clarification ? '等待补充' : '已答复',
    display: {
      kind: 'business',
      title: clarification ? '补充查询条件' : '业务查询',
      value: clarification?.prompt || '查询结果',
      caption: clarification ? undefined : steps.length + ' 条业务依据',
      choices: clarification?.choices.map((c) => ({ label: c.label, value: 'business:' + c.id }))
    }
  }
}
