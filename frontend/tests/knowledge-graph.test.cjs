const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/views/mes/graph/graphData.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const moduleObject = { exports: {} }
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports, Map, Set, Error })
const { toGalaxyData, mergeKnowledgeGraph } = moduleObject.exports
const demoGraph = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database/graph/fan-knowledge.json'), 'utf8'))
const node = id => ({ id, name: id, kind: '部件', description: '' })
const edge = (id, source, target) => ({ id, source, target, type: '关联', sourceEvidence: {} })

test('maps stable entity IDs after backend node order changes and preserves edge direction', () => {
  const data = toGalaxyData({ nodes: [node('b'), node('a'), node('孤立')], relations: [edge('r', 'a', 'b')] })
  assert.equal(data.links[0].source, 1)
  assert.equal(data.links[0].target, 0)
  assert.equal(data.nodes[0].inDegree, 1)
  assert.equal(data.nodes[1].outDegree, 1)
  assert.equal(data.nodes[2].degree, 0)
})
test('keeps parallel relationships without losing their incidence count', () => {
  const data = toGalaxyData({ nodes: [node('a'), node('b')], relations: [edge('r1','a','b'), edge('r2','a','b')] })
  assert.equal(data.links.length, 2)
  assert.equal(data.nodes[0].outDegree, 2)
})
test('rejects ambiguous IDs and dangling relationships at the renderer boundary', () => {
  assert.throws(() => toGalaxyData({nodes:[node('a'),node('a')],relations:[]}), /重复/)
  assert.throws(() => toGalaxyData({nodes:[node('')],relations:[]}), /为空/)
  assert.throws(() => toGalaxyData({nodes:[node('a')],relations:[edge('r','a','missing')]}), /不存在/)
  assert.throws(() => toGalaxyData({nodes:[node('a')],relations:[edge('r','a','a'),edge('r','a','a')]}), /重复/)
})
test('seed graph is internally valid and all relationships retain their source', () => {
  const data = toGalaxyData(demoGraph)
  assert.equal(data.nodes.length, 15)
  assert.equal(data.links.length, 16)
  for (const relation of demoGraph.relations) assert.ok(relation.sourceEvidence.title && relation.sourceEvidence.excerpt)
  assert.equal(toGalaxyData({nodes:[],relations:[]}).links.length, 0)
})

test('neighbor merging is idempotent, preserves parallel relations, and never mutates prior data', () => {
  const current = {nodes:[node('a')], relations:[]}
  const incoming = {nodes:[node('a'),node('b')], relations:[edge('r1','a','b'),edge('r2','a','b')]}
  const result = mergeKnowledgeGraph(current,incoming)
  const repeated = mergeKnowledgeGraph(result,incoming)
  assert.equal(result.nodes.length,2); assert.equal(repeated.nodes.length,2); assert.equal(repeated.relations.length,2)
  assert.equal(current.nodes.length,1)
})
test('merged graph enforces node and relation caps without dangling edges', () => {
  const nodes = Array.from({length:205},(_,i)=>node(String(i)))
  const result = mergeKnowledgeGraph({nodes:[],relations:[]},{nodes,relations:[edge('r','0','204')]})
  assert.equal(result.nodes.length,200); assert.equal(result.relations.length,0); assert.equal(result.hasMore,true)
})
