import request from '@/config/axios'
import type { GraphEntity, KnowledgeGraph } from '@/views/mes/graph/graphData'
export interface GraphPayload extends KnowledgeGraph {
  hasMore: boolean
}
export interface GraphSearch {
  items: GraphEntity[]
  hasMore: boolean
}
const base = '/mes/knowledge-graph'
export const GraphApi = {
  overview: (limit = 8) =>
    request.get<GraphPayload>({ url: `${base}/overview`, params: { limit } }),
  search: (query: string) =>
    request.get<GraphSearch>({ url: `${base}/search`, params: { query, limit: 30 } }),
  node: (id: string) => request.get<GraphEntity>({ url: `${base}/node`, params: { id } }),
  neighbors: (id: string) =>
    request.get<GraphPayload>({ url: `${base}/neighbors`, params: { id, limit: 20 } })
}
