import type { GraphData } from '@/vendor/galaxy-view/types'

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
}
export interface GraphRelation {
  id: string
  source: string
  target: string
  type: string
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

export const kindColors: Record<string, string> = {
  设备: '#f6ce78',
  部件: '#79bbff',
  故障: '#fa91b1',
  原因: '#ba9aff',
  措施: '#73e4c6'
}

/** Merge by stable IDs. Keep the existing graph unchanged and bound rendering work. */
export function mergeKnowledgeGraph(current: KnowledgeGraph, incoming: KnowledgeGraph) {
  toGalaxyData(incoming)
  const nodes = [...new Map([...current.nodes, ...incoming.nodes].map((n) => [n.id, n])).values()]
  const retained = nodes.slice(0, 200)
  const ids = new Set(retained.map((n) => n.id))
  const edges = [
    ...new Map([...current.relations, ...incoming.relations].map((e) => [e.id, e])).values()
  ].filter((e) => ids.has(e.source) && ids.has(e.target))
  return {
    nodes: retained,
    relations: edges.slice(0, 500),
    hasMore: nodes.length > 200 || edges.length > 500
  }
}
