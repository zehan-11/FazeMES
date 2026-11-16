import {
  GRAPH_NODE_LIMIT,
  GRAPH_RELATION_LIMIT,
  toGalaxyData,
  type GraphEntity,
  type GraphRelation,
  type KnowledgeGraph
} from './graphData'
export interface GraphPage<T> {
  items: T[]
  nextCursor?: string | null
}
export interface CompleteGraphSource {
  nodes: (cursor: string) => Promise<GraphPage<GraphEntity>>
  relations: (cursor: string) => Promise<GraphPage<GraphRelation>>
}
/** Exhaust both scoped cursor streams before publishing a graph; never call a truncated result complete. */
export async function loadCompleteGraph(
  source: CompleteGraphSource,
  active: () => boolean = () => true,
  progress: (nodes: number, relations: number) => void = () => {}
): Promise<KnowledgeGraph> {
  async function collect<T extends { id: string }>(
    fetch: (cursor: string) => Promise<GraphPage<T>>,
    max: number,
    done: (count: number) => void
  ) {
    const result = new Map<string, T>(),
      seen = new Set<string>()
    let cursor = ''
    while (true) {
      if (!active()) throw new Error('图谱加载已取消')
      const page = await fetch(cursor)
      if (!active()) throw new Error('图谱加载已取消')
      page.items.forEach((item) => result.set(item.id, item))
      if (result.size > max)
        throw new Error(
          `完整图谱超出浏览器显示上限（${GRAPH_NODE_LIMIT} 个实体、${GRAPH_RELATION_LIMIT} 条关系），请使用搜索与邻居展开查看局部图谱。`
        )
      done(result.size)
      const next = page.nextCursor
      if (!next) break
      if (next <= cursor || seen.has(next) || !page.items.length)
        throw new Error('图谱分页未正常推进，请刷新重试')
      seen.add(next)
      cursor = next
    }
    return [...result.values()]
  }
  const nodes = await collect(source.nodes, GRAPH_NODE_LIMIT, (n) => progress(n, 0))
  const relations = await collect(source.relations, GRAPH_RELATION_LIMIT, (n) =>
    progress(nodes.length, n)
  )
  const graph = { nodes, relations }
  toGalaxyData(graph)
  return graph
}
