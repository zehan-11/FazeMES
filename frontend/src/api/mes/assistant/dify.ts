import request from '@/config/axios'

export interface DifyStep {
  id: string
  type: string
  title: string
  status: string
  seconds: number | null
  detail: string
}

export interface DifyRun {
  runId: string
  status: string
  question: string
  answer: string
  sources: { title: string; text: string }[]
  steps: DifyStep[]
}

export function runDify(question: string) {
  return request.post<DifyRun>({
    url: '/mes/assistant/dify/run',
    data: { question },
    timeout: 200000
  })
}
