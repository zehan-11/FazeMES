import type { DifyRun } from '@/api/mes/assistant/dify'
import type { AssistantMessage } from '@/api/mes/assistant'
import type { EvidenceSearchResult } from '@/api/mes/assistant/evidence'

export interface JourneySource {
  title: string
  text: string
  page?: number | null
  doc?: number | null
  version?: number | null
}

export interface Journey {
  origin: '示例数据' | '检索记录' | '会话记录' | 'Dify 运行记录'
  trace?: DifyRun
  question: string
  scope: string
  sources: JourneySource[]
  branch: string
  result: string
}

export const exampleJourney: Journey = {
  origin: '示例数据',
  question: '巡检发现设备异响，应该怎样记录？',
  scope: '设备点检手册 · 示例知识库',
  sources: [
    {
      title: '设备点检手册',
      page: 6,
      text: '发现异响时，在点检单中填写设备编号、发生时间、运行状态和异常位置。'
    },
    {
      title: '异常记录规范',
      page: 2,
      text: '将观察到的现象与原因判断分开记录，提交当班负责人复核。'
    }
  ],
  branch: '已找到参考片段',
  result:
    '在点检单中填写设备编号、发生时间、运行状态和异常位置 [1]。单独记录观察到的现象，交由当班负责人复核 [2]。'
}

export function difyJourney(trace: DifyRun): Journey {
  return {
    origin: 'Dify 运行记录',
    question: trace.question,
    scope: 'Dify 设备点检示例手册',
    sources: trace.sources,
    branch: '',
    result: trace.answer,
    trace
  }
}

const modes = { DOCUMENT: '文档检索', GRAPH: '图谱检索', HYBRID: '混合检索' }
const strategies = { LEXICAL: '关键词', SEMANTIC: '语义', COMBINED: '综合' }

export function searchJourney(result: EvidenceSearchResult): Journey {
  const strategy = result.documentRetrieval?.effectiveStrategy
  return {
    origin: '检索记录',
    question: result.query,
    scope: [
      modes[result.mode],
      strategy && strategies[strategy],
      ...(result.documentRetrieval?.warnings || [])
    ]
      .filter(Boolean)
      .join(' · '),
    sources: result.items.map((item) => ({
      title: item.title,
      text: item.text,
      doc: item.documentId,
      version: item.documentVersion,
      page: item.pageNumber
    })),
    branch: result.items.length ? '已找到参考片段' : '本次检索无命中',
    result: '本次只执行了证据检索。'
  }
}

const outcomes: Record<AssistantMessage['status'], string> = {
  ANSWERED: '已返回答复',
  PROCESSING: '请求处理中',
  MODEL_NOT_CONFIGURED: '模型尚未配置',
  MODEL_ERROR: '模型服务出错',
  NO_EVIDENCE: '当前证据不足',
  EVIDENCE_RESTRICTED: '历史来源访问受限'
}

export function messageJourney(question: string, message: AssistantMessage): Journey {
  const restricted = message.status === 'EVIDENCE_RESTRICTED'
  return {
    origin: '会话记录',
    question,
    scope: modes[message.retrievalMode || 'DOCUMENT'],
    sources: restricted
      ? []
      : (message.citations || []).map((item) => ({
          title: item.title,
          text: item.content,
          doc: item.documentId,
          version: item.version,
          page: item.pageNumber
        })),
    branch: outcomes[message.status],
    result: !restricted && message.role === 'assistant' ? message.content : outcomes[message.status]
  }
}
