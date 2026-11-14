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
const { toGalaxyData, demoGraph } = moduleObject.exports
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
test('demo graph is internally valid and all relation sources identify synthetic provenance', () => {
  const data = toGalaxyData(demoGraph)
  assert.equal(data.nodes.length, 15)
  assert.equal(data.links.length, 16)
  for (const relation of demoGraph.relations) assert.match(relation.sourceEvidence.excerpt, /演示数据/)
  assert.equal(toGalaxyData({nodes:[],relations:[]}).links.length, 0)
})
