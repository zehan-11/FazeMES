import request from '@/config/axios'

export type DocumentStrategy = 'LEXICAL' | 'SEMANTIC' | 'COMBINED'
export interface DocumentRetrievalInfo {
  requestedStrategy?: DocumentStrategy
  effectiveStrategy?: DocumentStrategy
  degraded?: boolean
  warnings?: string[]
  eligibleChunkCount?: number
  vectorEligibleChunkCount?: number | null
}
export interface RetrievalDetails {
  spaceId?: string
  generation?: number
  lexicalRank?: number
  semanticRank?: number
  lexicalScore?: number
  semanticScore?: number
}

export interface RetrievalEvidence {
  evidenceId: string
  sourceType: 'DOCUMENT' | 'GRAPH'
  retrievalMethod: 'lexical_bm25' | 'vector_cosine' | 'document_rrf' | 'graph_query'
  retrievalDetails?: RetrievalDetails
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
export type RetrievalMode = 'DOCUMENT' | 'GRAPH' | 'HYBRID'
export interface EvidenceEntity {
  id: string
  name: string
  kind: string
  description: string
}
export interface EvidenceRelation {
  id: string
  source: string
  target: string
  type: string
  evidence: RetrievalEvidence
}
export interface GraphEvidenceResult {
  matchedEntities: { entity: EvidenceEntity; matchMethod: 'name_mention' | 'name_fragment' }[]
  nodes: EvidenceEntity[]
  relations: EvidenceRelation[]
  paths: { rootId: string; nodeIds: string[]; relationIds: string[] }[]
  hops: number
  hasMore: boolean
}
export interface EvidenceSearchResult {
  schemaVersion: number
  query: string
  mode: RetrievalMode
  eligibleChunkCount?: number
  documentStrategy?: DocumentStrategy
  documentRetrieval?: DocumentRetrievalInfo
  graph?: GraphEvidenceResult
  items: RetrievalEvidence[]
  hasMore: boolean
}
export const searchEvidence = (data: {
  query: string
  knowledgeBaseIds?: number[]
  mode?: RetrievalMode
  hops?: 1 | 2
  documentStrategy?: DocumentStrategy
  sources?: ('DOCUMENT' | 'GRAPH')[]
  limit?: number
}) =>
  request.post<EvidenceSearchResult>({
    url: '/mes/assistant/evidence/search',
    data,
    timeout: 90000
  })
