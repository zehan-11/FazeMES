import request from '@/config/axios'

export interface RetrievalEvidence {
  evidenceId: string
  sourceType: 'DOCUMENT' | 'GRAPH'
  retrievalMethod: 'lexical_bm25' | 'graph_query'
  libraryType: 'PERSONAL' | 'RULES' | 'LEGACY_PRIVATE'
  knowledgeBaseId: number | null
  documentId: number | null
  documentVersion: number | null
  chunkId: number | null
  chunkHash: string | null
  title: string
  section: string
  text: string
  pageNumber: number | null
  startOffset: number | null
  endOffset: number | null
  score: number | null
  nodeIds: string[]
  relationIds: string[]
}
export const searchEvidence = (data: {
  query: string
  knowledgeBaseIds?: number[]
  sources?: ('DOCUMENT' | 'GRAPH')[]
  limit?: number
}) =>
  request.post<{
    schemaVersion: number
    query: string
    items: RetrievalEvidence[]
    hasMore: boolean
  }>({ url: '/mes/assistant/evidence/search', data })
