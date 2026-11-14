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

// Synthetic teaching examples, not extracted from a document or a connected database.
export const demoGraph: KnowledgeGraph = {
  nodes: [
    {
      id: 'fan',
      name: '电风扇',
      kind: '设备',
      description: '教学场景中的整机，用于演示部件、故障与处理方法的关系。'
    },
    { id: 'motor', name: '电机', kind: '部件', description: '驱动叶片旋转的部件。' },
    { id: 'blade', name: '叶片', kind: '部件', description: '产生气流的部件。' },
    { id: 'base', name: '底座', kind: '部件', description: '支撑整机的部件。' },
    { id: 'bearing', name: '轴承', kind: '部件', description: '与电机转动相关的部件。' },
    { id: 'bolt', name: '固定螺栓', kind: '部件', description: '部件装配连接的紧固件。' },
    {
      id: 'vibration',
      name: '异常振动',
      kind: '故障',
      description: '演示故障现象，不代表已经对真实设备作出诊断。'
    },
    {
      id: 'heat',
      name: '电机温升异常',
      kind: '故障',
      description: '演示故障现象，实际判断需遵循设备手册。'
    },
    { id: 'noise', name: '运行异响', kind: '故障', description: '用于展示故障与部件之间的关联。' },
    { id: 'loose', name: '螺栓松动', kind: '原因', description: '异常振动的一种教学示例原因。' },
    { id: 'wear', name: '轴承磨损', kind: '原因', description: '运行异响的一种教学示例原因。' },
    { id: 'block', name: '通风受阻', kind: '原因', description: '温升异常的一种教学示例原因。' },
    {
      id: 'tighten',
      name: '检查紧固状态',
      kind: '措施',
      description: '示例检查项，实际操作需执行安全规程。'
    },
    {
      id: 'inspect',
      name: '检查轴承状态',
      kind: '措施',
      description: '示例检查项，不构成自动维修指令。'
    },
    {
      id: 'vent',
      name: '检查通风条件',
      kind: '措施',
      description: '示例检查项，应以真实维护文件为准。'
    }
  ],
  relations: []
}
const facts: [string, string, string][] = [
  ['fan', 'motor', '包含部件'],
  ['fan', 'blade', '包含部件'],
  ['fan', 'base', '包含部件'],
  ['motor', 'bearing', '包含部件'],
  ['base', 'bolt', '装配连接'],
  ['motor', 'vibration', '关联现象'],
  ['motor', 'heat', '关联现象'],
  ['bearing', 'noise', '关联现象'],
  ['vibration', 'loose', '可能原因'],
  ['noise', 'wear', '可能原因'],
  ['heat', 'block', '可能原因'],
  ['loose', 'bolt', '涉及部件'],
  ['wear', 'bearing', '涉及部件'],
  ['loose', 'tighten', '建议检查'],
  ['wear', 'inspect', '建议检查'],
  ['block', 'vent', '建议检查']
]
demoGraph.relations = facts.map(([source, target, type], i) => ({
  id: `demo-relation-${i + 1}`,
  source,
  target,
  type,
  sourceEvidence: {
    title: '电风扇维护关系示例（人工编写）',
    section: `演示条目 ${i + 1}`,
    excerpt: `${demoGraph.nodes.find((n) => n.id === source)!.name} —${type}→ ${demoGraph.nodes.find((n) => n.id === target)!.name}。此关系为界面演示数据，未从实际手册中抽取。`
  }
}))
export const kindColors: Record<string, string> = {
  设备: '#f6ce78',
  部件: '#79bbff',
  故障: '#fa91b1',
  原因: '#ba9aff',
  措施: '#73e4c6'
}
