import type { GraphEntity, GraphRelation, KnowledgeGraph } from './graphData'

export const CATEGORY_SPECS = [
  { id: 'category:equipment', label: '设备', color: '#2CF5A0', angle: -82, orbit: 1 },
  { id: 'category:part', label: '部件', color: '#5EA8FF', angle: -38, orbit: 1.08 },
  { id: 'category:process', label: '工艺', color: '#7CE8E8', angle: 10, orbit: 1 },
  { id: 'category:solution', label: '措施', color: '#2CF5A0', angle: 52, orbit: 0.84 },
  { id: 'category:cause', label: '原因', color: '#8B9BFF', angle: 95, orbit: 1.04 },
  { id: 'category:fault', label: '故障', color: '#F4B860', angle: 146, orbit: 1 },
  { id: 'category:manual', label: '手册', color: '#F28BB2', angle: -162, orbit: 1.05 },
  { id: 'category:rules', label: '规则库', color: '#8B9BFF', angle: -124, orbit: 0.81 }
] as const

const CATEGORY_MEMBER = '分类归属'
const CATEGORY_LINK = '分类关联'
const MANUAL = 'category:manual'
const RULES = 'category:rules'
const overviewSize = 14
const categorySize = 42

export interface GraphDocument {
  id: number
  title: string
  fileName: string
  version: number
  status: 'DRAFT' | 'PUBLISHED'
  libraryType: 'PERSONAL' | 'RULES'
}

interface Category {
  root: GraphEntity
  members: GraphEntity[]
}

export interface CategoryGraph {
  overview: KnowledgeGraph
  categories: Map<string, Category>
  items: Map<string, GraphEntity>
  neighbors: Map<string, GraphRelation[]>
  documents: Map<string, GraphDocument>
}

export function isCategoryLink(edge: GraphRelation) {
  return edge.presentation != null
}

export function isMemberLink(edge: GraphRelation) {
  return edge.presentation === 'category-member'
}

const categoryByKind = new Map<string, string>(CATEGORY_SPECS.map((item) => [item.label, item.id]))

function membership(root: string, member: string): GraphRelation {
  return {
    id: `${root}|${member}`,
    source: root,
    target: member,
    type: CATEGORY_MEMBER,
    presentation: 'category-member',
    sourceEvidence: { title: '', section: '', excerpt: '' }
  }
}

export function buildCategoryGraph(
  graph: KnowledgeGraph,
  documents: GraphDocument[]
): CategoryGraph {
  const items = new Map(graph.nodes.map((node) => [node.id, node]))
  const categories = new Map<string, Category>(
    CATEGORY_SPECS.map(({ id, label }) => [
      id,
      {
        root: {
          id,
          name: label,
          kind: label,
          description:
            id === MANUAL
              ? '设备手册与已用于建图的资料'
              : id === RULES
                ? '当前账号可见的已发布规则文档'
                : ''
        },
        members: []
      }
    ])
  )
  const sources = new Map<string, GraphDocument>()
  const byDocument = new Map<string, string>()
  const neighbors = new Map<string, GraphRelation[]>()
  const documentRelations = new Map<string, Map<string, GraphRelation>>()
  const usedDocuments = new Set(
    graph.relations.flatMap(({ sourceEvidence }) =>
      sourceEvidence.documentId == null ? [] : [String(sourceEvidence.documentId)]
    )
  )

  for (const node of graph.nodes) {
    categories.get(categoryByKind.get(node.kind) ?? '')?.members.push(node)
  }
  for (const doc of documents) {
    if (doc.status !== 'PUBLISHED') continue
    const rule = doc.libraryType === 'RULES'
    if (
      !rule &&
      !usedDocuments.has(String(doc.id)) &&
      !/手册|说明书|操作指南|manual|handbook/i.test(doc.title + ' ' + doc.fileName)
    )
      continue
    const category = categories.get(rule ? RULES : MANUAL)!
    const id = `source:document:${doc.id}`
    const node = {
      id,
      name: doc.title || doc.fileName,
      kind: category.root.kind,
      description: `已发布 · 版本 ${doc.version}`
    }
    items.set(id, node)
    category.members.push(node)
    sources.set(id, doc)
    byDocument.set(String(doc.id), id)
    documentRelations.set(id, new Map())
  }

  const degree = new Map<string, Set<string>>()
  const categoryEdges = new Map<string, GraphRelation>()
  function addCategoryEdge(a?: string, b?: string) {
    if (!a || !b || a === b) return
    const [source, target] = [a, b].sort()
    const id = `between:${source}|${target}`
    if (!categoryEdges.has(id)) {
      categoryEdges.set(id, {
        id,
        source,
        target,
        type: CATEGORY_LINK,
        presentation: 'category-link',
        sourceEvidence: { title: '', section: '', excerpt: '' }
      })
    }
  }
  function addNeighbor(id: string, edge: GraphRelation) {
    const list = neighbors.get(id)
    if (list) list.push(edge)
    else neighbors.set(id, [edge])
  }
  for (const edge of graph.relations) {
    const nodePair = edge.source === edge.target ? [edge.source] : [edge.source, edge.target]
    const kinds = nodePair.map((id) => categoryByKind.get(items.get(id)?.kind ?? ''))
    addCategoryEdge(kinds[0], kinds[1])
    nodePair.forEach((id, i) => {
      addNeighbor(id, edge)
      const connected = degree.get(id) ?? new Set()
      if (nodePair.length === 2) connected.add(nodePair[1 - i])
      degree.set(id, connected)
    })
    const docId = byDocument.get(String(edge.sourceEvidence.documentId))
    const doc = docId ? sources.get(docId) : undefined
    if (!docId || !doc || String(edge.sourceEvidence.documentVersion) !== String(doc.version))
      continue
    const docEdges = documentRelations.get(docId)!
    const category = doc.libraryType === 'RULES' ? RULES : MANUAL
    for (const node of nodePair) {
      addCategoryEdge(category, categoryByKind.get(items.get(node)?.kind ?? ''))
      if (!docEdges.has(node)) {
        docEdges.set(node, {
          id: `evidence:${docId}|${node}`,
          source: docId,
          target: node,
          type: '资料涉及实体',
          sourceEvidence: edge.sourceEvidence
        })
      }
    }
  }
  for (const [doc, links] of documentRelations) neighbors.set(doc, [...links.values()])

  const overview: KnowledgeGraph = {
    nodes: [...categories.values()].map(({ root }) => root),
    relations: [...categoryEdges.values()]
  }
  for (const { root, members } of categories.values()) {
    members.sort(
      (a, b) =>
        (degree.get(b.id)?.size ?? 0) - (degree.get(a.id)?.size ?? 0) ||
        a.name.localeCompare(b.name, 'zh-CN')
    )
    const sample = members.slice(0, overviewSize)
    overview.nodes.push(...sample)
    overview.relations.push(...sample.map((node) => membership(root.id, node.id)))
  }
  return { overview, categories, items, neighbors, documents: sources }
}

export function categoryScene(model: CategoryGraph, id: string, previous?: string): KnowledgeGraph {
  const category = model.categories.get(id)
  const active = category?.root ?? model.items.get(id)
  if (!active) return model.overview

  // Keep the original anchors in the scene as the canvas fades to the selected branch.
  const nodes = new Map(model.overview.nodes.map((node) => [node.id, node]))
  nodes.set(id, active)
  const prior = previous ? model.items.get(previous) : undefined
  if (prior) nodes.set(prior.id, prior)
  const relationships = new Map(model.overview.relations.map((edge) => [edge.id, edge]))
  if (category) {
    const chosen = category.members.slice(0, categorySize)
    for (const node of chosen) {
      nodes.set(node.id, node)
      const edge = membership(id, node.id)
      relationships.set(edge.id, edge)
    }
  } else {
    const shown = new Set<string>()
    for (const edge of model.neighbors.get(id) ?? []) {
      const neighborId = edge.source === id ? edge.target : edge.source
      if (!shown.has(neighborId) && shown.size >= categorySize) continue
      const neighbor = model.items.get(neighborId)
      if (!neighbor) continue
      shown.add(neighborId)
      nodes.set(neighborId, neighbor)
      relationships.set(edge.id, edge)
    }
  }
  return { nodes: [...nodes.values()], relations: [...relationships.values()] }
}
