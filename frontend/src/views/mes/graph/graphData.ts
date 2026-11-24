import type { GraphData } from '@/vendor/galaxy-view/types'
import type { RetrievalEvidence } from '@/api/mes/assistant/evidence'

export interface GraphEntity {
  id: string
  name: string
  kind: string
  description: string
}
export interface GraphSource {
  title: string
  section: string
  excerpt: string
  knowledgeBaseId?: number | string
  documentId?: number | string
  documentVersion?: number
  chunkId?: number | string
  chunkHash?: string
  pageNumber?: number
  startOffset?: number
  endOffset?: number
  extractionMethod?: string
}
export interface GraphRelation {
  evidence?: RetrievalEvidence
  id: string
  source: string
  target: string
  type: string
  presentation?: 'category-member' | 'category-link'
  sourceEvidence: GraphSource
}
export interface KnowledgeGraph {
  nodes: GraphEntity[]
  relations: GraphRelation[]
}

/** Boundary for the later backend response. Renderer indices never escape this adapter. */
export function toGalaxyData(graph: KnowledgeGraph): GraphData {
  const index = new Map<string, number>()
  graph.nodes.forEach((node, i) => {
    if (!node.id || index.has(node.id)) throw new Error('节点 ID 为空或重复')
    index.set(node.id, i)
  })
  const ids = new Set<string>()
  const incoming = graph.nodes.map(() => 0)
  const outgoing = graph.nodes.map(() => 0)
  const links = graph.relations.map((edge) => {
    if (!edge.id || ids.has(edge.id)) throw new Error('关系 ID 为空或重复')
    ids.add(edge.id)
    const source = index.get(edge.source),
      target = index.get(edge.target)
    if (source === undefined || target === undefined) throw new Error('关系引用了不存在的节点')
    outgoing[source]++
    incoming[target]++
    return { source, target }
  })
  return {
    nodes: graph.nodes.map((node, i) => ({
      id: node.id,
      name: node.name,
      folderTop: node.kind,
      degree: incoming[i] + outgoing[i],
      inDegree: incoming[i],
      outDegree: outgoing[i],
      fileSize: 0,
      tags: [],
      unresolved: false,
      tag: false
    })),
    links
  }
}

/** Sample real one-hop relationships while keeping device entries and their sources intact. */
export function buildDeviceOverview(
  entries: GraphEntity[],
  neighborhoods: KnowledgeGraph[],
  maxNeighbors = 8
): KnowledgeGraph {
  const nodes = new Map(entries.map((node) => [node.id, node]))
  const relations = new Map<string, GraphRelation>()

  const frequency = new Map<string, number>()
  const pools = entries.map((entry, i) => {
    const neighborhood = neighborhoods[i]
    if (!neighborhood) return []
    const related = new Map(neighborhood.nodes.map((node) => [node.id, node]))
    const candidates = new Map<string, { node: GraphEntity; relation: GraphRelation }>()
    for (const relation of neighborhood.relations) {
      const other =
        relation.source === entry.id
          ? relation.target
          : relation.target === entry.id
            ? relation.source
            : undefined
      if (!other || other === entry.id || candidates.has(other)) continue
      const node = related.get(other)
      if (!node) continue
      candidates.set(other, { node, relation })
      frequency.set(other, (frequency.get(other) ?? 0) + 1)
    }

    return [...candidates.values()]
  })

  for (const pool of pools) {
    // Prefer device-specific satellites so shared maintenance concepts do not dominate the overview.
    const local = pool.filter(({ node }) => frequency.get(node.id) === 1 && !nodes.has(node.id))
    const byType = new Map<string, (typeof pool)[number]>()
    for (const item of local) {
      if (!byType.has(item.relation.type)) byType.set(item.relation.type, item)
    }
    const shared = [...pool].sort(
      (a, b) => (frequency.get(a.node.id) ?? 0) - (frequency.get(b.node.id) ?? 0)
    )
    const chosen = new Set([...byType.values(), ...local, ...shared])
    for (const { node, relation } of [...chosen].slice(0, maxNeighbors)) {
      nodes.set(node.id, node)
      relations.set(relation.id, relation)
    }
  }
  return { nodes: [...nodes.values()], relations: [...relations.values()] }
}

export const kindColors: Record<string, string> = {
  设备: '#f6ce78',
  部件: '#79bbff',
  故障: '#fa91b1',
  原因: '#ba9aff',
  措施: '#73e4c6',
  工艺: '#ffb57c'
}

/** Merge by stable IDs. Keep the existing graph unchanged and bound rendering work. */
export const GRAPH_NODE_LIMIT = 2000
export const GRAPH_RELATION_LIMIT = 10000

export function mergeKnowledgeGraph(current: KnowledgeGraph, incoming: KnowledgeGraph) {
  toGalaxyData(incoming)
  const nodes = [...new Map([...current.nodes, ...incoming.nodes].map((n) => [n.id, n])).values()]
  const retained = nodes.slice(0, GRAPH_NODE_LIMIT)
  const ids = new Set(retained.map((n) => n.id))
  const edges = [
    ...new Map([...current.relations, ...incoming.relations].map((e) => [e.id, e])).values()
  ].filter((e) => ids.has(e.source) && ids.has(e.target))
  return {
    nodes: retained,
    relations: edges.slice(0, GRAPH_RELATION_LIMIT),
    hasMore: nodes.length > GRAPH_NODE_LIMIT || edges.length > GRAPH_RELATION_LIMIT
  }
}
