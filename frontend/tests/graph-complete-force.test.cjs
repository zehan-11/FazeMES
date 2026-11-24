const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname,'../src')
const cache = new Map()
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file,mod)
  const compiled = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(compiled,{ module:mod,exports:mod.exports,Float32Array,Map,Set,Error,Math,structuredClone,
    require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file),name+'.ts')) : name.startsWith('@/') ? load(path.join(root,name.slice(2)+'.ts')) : require(name)
  },{filename:file})
  return mod.exports
}
const { loadCompleteGraph } = load(path.join(root,'views/mes/graph/loadCompleteGraph.ts'))
const { MainThreadForceLayout } = load(path.join(root,'vendor/galaxy-view/layout/MainThreadForceLayout.ts'))
const { deviceOverviewPositions, placeExplorationNodes, seedPositions, FORCE_PARAMS } = load(path.join(root,'views/mes/graph/forceLayout.ts'))
const { buildDeviceOverview, toGalaxyData } = load(path.join(root, 'views/mes/graph/graphData.ts'))
const { indexNeighborhoods, GalaxyMotion, repulsionScale } = load(path.join(root, 'views/mes/graph/galaxyMotion.ts'))
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,'../../database/graph/fan-knowledge.json'),'utf8'))
function stream(items,size,calls) {
  const sorted = [...items].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
  return async cursor => { calls.push(cursor);const remaining = sorted.filter(x=>x.id>cursor);return {items:remaining.slice(0,size),nextCursor:remaining.length>size?remaining[size-1].id:null} }
}
test('complete loading exhausts node and relation pages, including relationships beyond the first page',async()=>{
  const nodeCalls=[],edgeCalls=[]
  const graph=await loadCompleteGraph({nodes:stream(fixture.nodes,4,nodeCalls),relations:stream(fixture.relations,5,edgeCalls)})
  assert.equal(graph.nodes.length,15);assert.equal(graph.relations.length,16)
  assert.equal(nodeCalls.length,4);assert.equal(edgeCalls.length,4)
})
test('failed or cancelled full loads never return a partial graph',async()=>{
  await assert.rejects(loadCompleteGraph({nodes:async()=>{throw new Error('offline')},relations:async()=>({items:[]})}),/offline/)
  let active=true
  await assert.rejects(loadCompleteGraph({nodes:async()=>{active=false;return {items:fixture.nodes}},relations:async()=>({items:[]})},()=>active),/取消/)
})
test('cursor loops and over-cap graphs report explicit errors instead of claiming completion',async()=>{
  await assert.rejects(loadCompleteGraph({nodes:async()=>({items:[fixture.nodes[0]],nextCursor:'a'}),relations:async()=>({items:[]})}),/分页/)
  await assert.rejects(loadCompleteGraph({nodes:async()=>({items:Array.from({length:2001},(_,i)=>({...fixture.nodes[0],id:String(i)}))}),relations:async()=>({items:[]})}),/上限/)
})
function graph(linked) {
 const nodes=Array.from({length:12},(_,i)=>({id:String(i),name:String(i),degree:linked?1:0,inDegree:0,outDegree:0,folderTop:'',fileSize:0,tags:[],unresolved:false,tag:false}))
 return {nodes,links:linked?Array.from({length:6},(_,i)=>({source:i*2,target:i*2+1})):[]}
}
function simulate(data) {
 const layout = new MainThreadForceLayout(), positions=seedPositions(data)
 layout.init(data,positions,FORCE_PARAMS)
 for(let i=0;i<310&&!layout.isSettled();i++)layout.step()
 assert.equal(layout.isSettled(),true)
 assert.ok([...positions].every(Number.isFinite))
 layout.dispose();const ticks=layout.ticks;assert.equal(layout.step(),false);assert.equal(layout.ticks,ticks)
 return positions
}
const distance=(p,a,b)=>Math.hypot(...[0,1,2].map(i=>p[a*3+i]-p[b*3+i]))
test('force layout depends on topology, brings connected pairs together, and settles with finite coordinates',()=>{
 const data=graph(true),positions=simulate(data),unlinked=simulate(graph(false))
 const connected=data.links.reduce((sum,e)=>sum+distance(positions,e.source,e.target),0)/6
 const apart=[0,2,4,6,8,10].reduce((sum,i)=>sum+distance(positions,i,(i+2)%12),0)/6
 assert.ok(connected<apart,`connected ${connected} should be closer than unrelated ${apart}`)
 assert.ok([...positions].some((v,i)=>Math.abs(v-unlinked[i])>1))
 assert.deepEqual([...seedPositions(data)],[...seedPositions(data)])
})

const { CameraFlight, interpolateCamera } = load(path.join(root,'views/mes/graph/cameraFlight.ts'))
const { STYLE_PRESETS, presetPhysics, presetColors } = load(path.join(root,'views/mes/graph/visualPresets.ts'))
test('camera flight eases between endpoints, clamps, reaches its destination and can be interrupted',()=>{
 const from={position:[0,20,100],target:[0,0,0]},to={position:[100,80,40],target:[20,10,0]}
 assert.equal(interpolateCamera(from,to,-1).position[0],0)
 assert.equal(interpolateCamera(from,to,2).position[0],100)
 assert.equal(interpolateCamera(from,to,0.5).position[0],50)
 const camera=new CameraFlight();camera.begin(from,to,0.8)
 const first=camera.step(0.05);assert.ok(first.position[0]>0&&first.position[0]<100)
 let last=first;for(let i=0;i<30&&camera.active;i++)last=camera.step(0.05)
 assert.equal(camera.active,false);assert.equal(last.position[0],100)
 camera.begin(from,to);camera.cancel();assert.equal(camera.step(0.05),undefined)
})
test('all upstream style presets have valid physics/colors and settle to finite coordinates',()=>{
 assert.equal(STYLE_PRESETS.length,8)
 for(const preset of STYLE_PRESETS){
  const data=graph(true),layout=new MainThreadForceLayout(),positions=seedPositions(data)
  layout.init(data,positions,presetPhysics(preset.id))
  for(let i=0;i<310&&!layout.isSettled();i++)layout.step()
  assert.ok([...positions].every(Number.isFinite),preset.id)
  assert.ok(layout.isSettled(),preset.id);layout.dispose()
  assert.ok(presetColors(preset.id)['工艺'])
 }
})
test('equipment catalog is connected, has source-backed relations and does not contain duplicate IDs',()=>{
 const graph=JSON.parse(fs.readFileSync(path.join(__dirname,'../../database/graph/equipment-knowledge.json'),'utf8'))
 assert.ok(graph.nodes.length>=100);assert.ok(graph.relations.length>=250)
 const ids=new Set(graph.nodes.map(n=>n.id));assert.equal(ids.size,graph.nodes.length)
 assert.equal(new Set(graph.relations.map(r=>r.id)).size,graph.relations.length)
 const visited=new Set([graph.nodes[0].id])
 for(let i=0;i<graph.nodes.length;i++)for(const r of graph.relations){assert.ok(ids.has(r.source)&&ids.has(r.target));if(visited.has(r.source)||visited.has(r.target)){visited.add(r.source);visited.add(r.target)}}
 assert.equal(visited.size,ids.size)
 const source=fs.readFileSync(path.join(__dirname,'../../database/graph/equipment-knowledge.md'),'utf8')
 for(const r of graph.relations)if(r.sourceEvidence.title==='设备维护与工艺关系'){assert.ok(source.includes(r.sourceEvidence.section));assert.ok(source.includes(r.sourceEvidence.excerpt))}
})

test('exploration preserves existing world positions by ID across expansion and return', () => {
  const overview = graph(false)
  overview.nodes = overview.nodes.slice(0, 6)
  const original = placeExplorationNodes(overview)
  const anchor = overview.nodes[2]
  const incoming = { ...anchor, id: 'neighbor' }
  const expanded = { nodes: [incoming, ...overview.nodes.toReversed()], links: [] }
  const coordinates = placeExplorationNodes(expanded, overview, original, anchor.id)
  for (const [index, node] of overview.nodes.entries()) {
    const offset = expanded.nodes.findIndex((item) => item.id === node.id) * 3
    assert.deepEqual([...coordinates.slice(offset, offset + 3)], [...original.slice(index * 3, index * 3 + 3)])
  }
  const anchorIndex = expanded.nodes.findIndex((item) => item.id === anchor.id)
  assert.ok(distance(coordinates, 0, anchorIndex) >= 26)
  assert.ok(distance(coordinates, 0, anchorIndex) <= 85)
  assert.deepEqual([...placeExplorationNodes(overview, expanded, coordinates)], [...original])
})

test('device overview samples connected, sourced neighbors for all six entries', () => {
  const full = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database/graph/equipment-knowledge.json'), 'utf8'))
  const entries = full.nodes.filter((node) => node.kind === '设备').sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6)
  const neighborhoods = entries.map(({ id }) => ({
    nodes: full.nodes,
    relations: full.relations.filter((edge) => edge.source === id || edge.target === id)
  }))
  const overview = buildDeviceOverview(entries, neighborhoods)
  assert.deepEqual(overview.nodes.slice(0, 6).map((node) => node.id).join(','), entries.map((node) => node.id).join(','))
  assert.ok(overview.nodes.length > entries.length)
  assert.ok(overview.relations.length <= 48)
  const fullRelations = new Map(full.relations.map((edge) => [edge.id, edge]))
  for (const edge of overview.relations) assert.equal(edge, fullRelations.get(edge.id))
  const data = toGalaxyData(overview)
  const index = indexNeighborhoods(data)
  assert.ok(index.slice(0, 6).every((branch) => branch.nodes.size > 1 && branch.links.length > 1))
  const left = deviceOverviewPositions(data, entries.map((node) => node.id), 1.6)
  const narrow = deviceOverviewPositions(data, entries.map((node) => node.id), 0.9)
  assert.ok([...left, ...narrow].every(Number.isFinite))
  assert.notDeepEqual([...left], [...narrow])
  const anchors = new Set(entries.map((_, i) => [...left.subarray(i * 3, i * 3 + 3)].join(',')))
  assert.equal(anchors.size, 6)
})

test('cursor repulsion is local and click layout keeps the root centered with reduced motion', () => {
  const { PerspectiveCamera } = require('three')
  const scene = graph(false)
  scene.nodes = scene.nodes.slice(0, 4)
  scene.links = [{ source: 0, target: 1 }, { source: 0, target: 2 }]
  const neighbors = indexNeighborhoods(scene)
  assert.deepEqual([...neighbors[0].nodes], [0, 1, 2])
  assert.deepEqual([...neighbors[0].links], [0, 1])
  assert.ok(repulsionScale(24, 92, 37) > repulsionScale(66, 92, 37))
  assert.equal(repulsionScale(120, 92, 37), 0)
  assert.equal(repulsionScale(0, 92, 37), 0)

  const base = new Float32Array([0, 0, 0, 20, 0, 0, 0, 30, 0, 200, 0, 0])
  const camera = new PerspectiveCamera(60, 800 / 600, 0.5, 1000)
  camera.position.z = 240
  camera.updateMatrixWorld()
  const drift = new GalaxyMotion(scene, new Set([0]))
  const pushed = new GalaxyMotion(scene, new Set([0]))
  const frame = { base, camera, width: 800, height: 600, delta: 0.03, still: false, hover: 0, halo: undefined }
  for (let t = 0; t < 14; t++) {
    drift.step({ ...frame, pointer: null })
    pushed.step({ ...frame, pointer: { x: 424, y: 300 } })
  }
  assert.ok(pushed.offsets[3] > drift.offsets[3] + 3)
  assert.equal(pushed.offsets[9], drift.offsets[9])
  pushed.centerOn(0, neighbors[0].nodes, camera)
  pushed.step({ ...frame, still: true, pointer: { x: 424, y: 300 } })
  assert.deepEqual([...pushed.offsets.subarray(0, 3)], [0, 0, 0])
  assert.ok(Math.hypot(...pushed.offsets.subarray(3, 6)) > 35)
  assert.deepEqual([...pushed.offsets.subarray(9)], [0, 0, 0])
  pushed.centerOn(-1, undefined, camera)
  pushed.step({ ...frame, still: true, pointer: null })
  assert.ok([...pushed.offsets].every((value) => value === 0))
})


test('category overview uses real totals and published source documents', () => {
  const { buildCategoryGraph, categoryScene, isMemberLink, isCategoryLink } = load(path.join(root, 'views/mes/graph/categoryGraph.ts'))
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database/graph/equipment-knowledge.json'), 'utf8'))
  const cited = { ...base.relations[0], sourceEvidence: { ...base.relations[0].sourceEvidence, documentId: 12, documentVersion: 2 } }
  const full = { nodes: base.nodes, relations: [cited, ...base.relations.slice(1)] }
  const documents = [
    { id: 12, title: '建图资料', fileName: 'source.md', version: 2, status: 'PUBLISHED', libraryType: 'PERSONAL' },
    { id: 15, title: '设备操作手册', fileName: 'operation.pdf', version: 1, status: 'PUBLISHED', libraryType: 'PERSONAL' },
    { id: 13, title: '保养规范', fileName: 'rules.md', version: 1, status: 'PUBLISHED', libraryType: 'RULES' },
    { id: 14, title: '待发布规则', fileName: 'rules-draft.md', version: 1, status: 'DRAFT', libraryType: 'RULES' }
  ]
  const model = buildCategoryGraph(full, documents)
  assert.equal(model.categories.size, 8)
  const equipment = model.categories.get('category:equipment')
  assert.equal(equipment.members.length, full.nodes.filter((node) => node.kind === '设备').length)
  assert.equal(model.categories.get('category:manual').members.length, 2)
  assert.equal(model.categories.get('category:rules').members.length, 1)
  assert.ok(!model.items.has('source:document:14'))
  assert.ok(model.overview.relations.every(isCategoryLink))
  const branch = categoryScene(model, equipment.root.id)
  assert.equal(branch.relations.filter((edge) => edge.source === equipment.root.id && isMemberLink(edge)).length, equipment.members.length)
  const article = categoryScene(model, 'source:document:12', 'category:manual')
  assert.ok(article.relations.some((edge) => edge.source === 'source:document:12' && edge.sourceEvidence.excerpt === cited.sourceEvidence.excerpt))
  const entity = categoryScene(model, cited.source, 'category:equipment')
  assert.ok(entity.relations.includes(cited))
})

test('star scenes retain real leaves, complete one-hop wheels and independently pickable upstream copies', () => {
  const { buildCategoryGraph } = load(path.join(root,'views/mes/graph/categoryGraph.ts'))
  const { graphIndex, buildScene } = load(path.join(root,'views/mes/graph/starScene.ts'))
  const full=JSON.parse(fs.readFileSync(path.join(__dirname,'../../database/graph/equipment-knowledge.json'),'utf8'))
  const model=buildCategoryGraph(full,[])
  const index=graphIndex(model,full,true)
  const overview=buildScene(index,null,undefined,980,620)
  assert.equal(overview.marks.size,full.nodes.length+8)
  assert.equal(overview.marks.get('category:rules').count,0)
  assert.ok(full.nodes.every(n=>overview.marks.get(n.id).entity===n))
  const first=full.relations.find(r=>r.source!==r.target)
  const wheel=buildScene(index,first.source,undefined,980,620)
  const deep=buildScene(index,first.target,first.source,980,620)
  assert.equal(wheel.marks.get(first.source).y,15)
  assert.equal(deep.marks.get(first.target).y,36)
  assert.equal(deep.marks.get('up:'+first.source).role,'upstream')
  for(const neighbor of index.neighbors.get(first.source).keys()){
    assert.equal(wheel.marks.get(neighbor).role,'neighbor')
    assert.equal(deep.marks.get('up:'+neighbor).entity.id,neighbor)
  }
  assert.equal(deep.marks.get('up:'+first.target).role,'mini')
  assert.ok([...deep.wires.values()].some(w=>w.kind==='guide'))

})

test('ambient cross edges are real, deterministic, and limited per node, pair, and overview', () => {
  const { graphIndex, buildScene } = load(path.join(root, 'views/mes/graph/starScene.ts'))
  const { buildCategoryGraph } = load(path.join(root, 'views/mes/graph/categoryGraph.ts'))
  const full = require('../../database/graph/equipment-knowledge.json')
  const source = full.relations[0]
  const cited = {
    ...source,
    sourceEvidence: { ...source.sourceEvidence, documentId: 12, documentVersion: 2 }
  }
  const duplicates = [
    { ...source, id: 'reverse-first', source: source.target, target: source.source },
    { ...source, id: 'synthetic-aggregate', source: 'category:rules', presentation: 'category-link' }
  ]
  const documents = [
    { id: 12, title: '建图资料', fileName: 'source.md', version: 2, status: 'PUBLISHED', libraryType: 'PERSONAL' },
    { id: 15, title: '设备操作手册', fileName: 'operation.pdf', version: 1, status: 'PUBLISHED', libraryType: 'PERSONAL' }
  ]
  const data = { ...full, relations: [cited, ...full.relations.slice(1), ...duplicates] }
  const model = buildCategoryGraph(data, documents)
  const index = graphIndex(model, data, true)
  const scene = buildScene(index, null, undefined, 980, 620)
  const key = (a, b) => JSON.stringify([a, b].sort())
  const authorized = new Set([
    ...full.relations,
    ...(model.neighbors.get('source:document:12') ?? [])
  ].map(edge => key(edge.source, edge.target)))
  const edges = scene.ambientCrossEdges
  assert.equal(edges.length, 36)
  assert.equal(new Set(edges.map(edge => edge.key)).size, edges.length)
  const usage = new Map()
  const clusterPairs = new Map()
  const covered = new Set()
  for (const edge of edges) {
    assert.equal(edge.kind, 'relation')
    assert.ok(scene.wires.has(edge.key) && authorized.has(edge.key))
    assert.ok(edge.a !== 'source:document:15' && edge.b !== 'source:document:15')
    const a = scene.marks.get(edge.a).parent
    const b = scene.marks.get(edge.b).parent
    assert.notEqual(a, b)
    covered.add(a); covered.add(b)
    const pair = key(a, b)
    clusterPairs.set(pair, (clusterPairs.get(pair) ?? 0) + 1)
    for (const node of [edge.a, edge.b]) usage.set(node, (usage.get(node) ?? 0) + 1)
  }
  assert.ok(Math.max(...usage.values()) <= 2)
  assert.ok(Math.max(...clusterPairs.values()) <= 4)
  assert.ok(covered.has('category:manual') && covered.has('category:equipment') &&
    covered.has('category:solution') && covered.has('category:cause') && !covered.has('category:rules'))
  const reordered = { ...data, relations: [...data.relations].reverse() }
  const rebuilt = graphIndex(buildCategoryGraph(reordered, documents), reordered, true)
  assert.deepEqual(rebuilt.ambientCrossEdges.map(edge => edge.key), edges.map(edge => edge.key))
})

test('wheel zoom scales all overview positions around the visible center with either drawer width', () => {
  const { StarCanvas } = load(path.join(root,'views/mes/graph/starCanvas.ts'))
  const engine = Object.assign(new StarCanvas(), { width: 980, height: 620, still: true })
  const hub = { key: 'hub', role: 'hub', parent: '', x: 95, y: -62, order: 0, count: 1, seed: 0.3,
    color: '#4372FF', entity: { id: 'hub', kind: '设备', name: '设备' } }
  engine.setScene({ overview: true, marks: new Map([[hub.key,hub]]), wires: new Map() }, 0)
  const grad = () => ({ addColorStop() {} })
  const ctx = new Proxy({ measureText: s => ({ width: s.length * 8 }),
    createRadialGradient: grad, createLinearGradient: grad }, { get: (o,k) => o[k] ?? (() => {}) })
  let time = 100
  for (const inset of [272, 0]) {
    engine.sidebarInset = inset
    engine.reset(true)
    for (const factor of [1.12, 1.12, 0.89, 50, 0.001]) {
      const prior = engine.goal.zoom
      engine.zoomBy(factor)
      assert.equal(engine.goal.zoom, Math.min(4, Math.max(0.35, prior * factor)))
      assert.equal(engine.goal.x, 0)
      assert.equal(engine.goal.y, 0)
      engine.draw(ctx, time += 17, 1)
      const { screen, position } = engine.marks.get(hub.key)
      assert.ok(Math.abs(screen.x - (980 - inset) / 2 - position.x * engine.goal.zoom) < 1e-9)
      assert.ok(Math.abs(screen.y - 310 - position.y * engine.goal.zoom) < 1e-9)
    }
  }
})

test('dense focus pages cover every authorized neighbor once and filters preserve degree priority',()=>{
  const {graphIndex,focusWindow,buildScene}=load(path.join(root,'views/mes/graph/starScene.ts'))
  const full=JSON.parse(fs.readFileSync(path.join(__dirname,'../../database/graph/equipment-knowledge.json'),'utf8'))
  const {buildCategoryGraph}=load(path.join(root,'views/mes/graph/categoryGraph.ts'))
  const edges=full.relations.map(edge=>({...edge,sourceEvidence:{...edge.sourceEvidence,documentId:12,documentVersion:1}}))
  const data={...full,relations:edges}
  const model=buildCategoryGraph(data,[{id:12,title:'equipment-knowledge.md',fileName:'equipment-knowledge.md',status:'PUBLISHED',version:1,libraryType:'PERSONAL'}])
  const index=graphIndex(model,data,true), id='source:document:12'
  assert.ok(index.ambientCrossEdges.filter(edge => edge.a === id || edge.b === id).length <= 2)
  const first=focusWindow(index,id)
  assert.ok(first.total>80);assert.equal(first.rows.length,18)
  const visited=new Set()
  for(let page=0;page<first.pages;page++)for(const [key] of focusWindow(index,id,'',page).rows){assert.ok(!visited.has(key));visited.add(key)}
  assert.equal(visited.size,first.total)
  assert.ok(focusWindow(index,id,'设备').rows.every(([key])=>index.entities.get(key).kind==='设备'))
  assert.equal(focusWindow(index,id,'',0,true).rows.length,first.total)
  assert.equal([...buildScene(index,id,undefined,980,620).marks.values()].filter(n=>n.role==='neighbor').length,18)
  const {StarCanvas}=load(path.join(root,'views/mes/graph/starCanvas.ts'))
  const engine=new StarCanvas(), baseline=new StarCanvas()
  const ctx=new Proxy({measureText:s=>({width:s.length*8}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]??(()=>{})})
  for(const e of [engine,baseline]){e.width=980;e.height=620;e.setScene(buildScene(index,null,undefined,980,620),0)}
  const hub=engine.marks.get('category:equipment'), initial={...hub.position}
  for(let i=1;i<=300;i++)for(const e of [engine,baseline])e.draw(ctx,i*16.67,1)
  assert.ok(Math.hypot(hub.position.x-initial.x,hub.position.y-initial.y)>5)
  const doc=engine.marks.get(id)
  for(let i=301;i<=311;i++){
    engine.move({x:doc.screen.x+(i-306)*18,y:doc.screen.y+12})
    engine.draw(ctx,i*16.67,1);baseline.draw(ctx,i*16.67,1)
  }
  assert.ok(Math.hypot(doc.position.x-baseline.marks.get(id).position.x,doc.position.y-baseline.marks.get(id).position.y)>1)
  engine.move(null);engine.draw(ctx,312*16.67,1)
  for(let i=313;i<=334;i++){engine.move({...doc.screen});engine.draw(ctx,i*16.67,1)
    const lit=[...engine.wires.values()].filter(w=>w.kind==='relation'&&w.emphasis>.001)
    if(i===313)assert.ok(lit.every(w=>w.emphasis<.15))
    if(i===334){assert.equal(lit.length,14);assert.ok(lit.every(w=>w.emphasis===1))}
  }
})

test('captured hub and leaf keep their actual hover presentation until the release hit test', () => {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const graph = new StarCanvas()
  Object.assign(graph, { width: 900, height: 600, still: true })
  const marks = new Map(), wires = new Map()
  for (const [key, parent, x, y] of [
    ['A', '', -170, 0], ['B', '', 170, 0], ['C', '', 0, -160],
    ['a', 'A', -170, 100], ['b', 'B', 170, 100], ['c', 'C', 0, -210]
  ]) {
    marks.set(key, { key, parent, x, y, role: parent ? 'leaf' : 'hub', seed: 0.25, order: 0,
      count: 1, entity: { id: key, name: key, kind: '设备' }, color: '#588AFF' })
  }
  for (const [a, b, kind] of [['A','a','spoke'], ['B','b','spoke'], ['C','c','spoke'], ['a','b','relation']])
    wires.set(a+b, { key: a+b, a, b, kind, label: '' })
  let time = 3000
  graph.setScene({ overview: true, marks, wires }, time)
  const gradient = () => ({ addColorStop() {} })
  const labels = new Map(), ctx = new Proxy({
    measureText: text => ({ width: text.length * 8 }),
    createLinearGradient: gradient, createRadialGradient: gradient,
    fillText(text, x, y) { labels.set(text, { x, y }) }
  }, { get: (o, k) => o[k] ?? (() => {}) })
  const draw = () => { labels.clear(); graph.draw(ctx, time += 16.67, 1) }
  const mark = key => graph.marks.get(key)
  draw()
  for (const key of ['A', 'a']) {
    const m = mark(key)
    graph.move({ ...m.screen }); draw()
    assert.equal(graph.hit(m.screen).key, key)
    assert.ok(graph.beginNodeDrag(m, { ...m.screen }))
    graph.external = 'C'
    for (let i = 0; i < 3; i++) {
      // The pointer can cross another marker or its sidebar row while captured.
      graph.move({ ...mark('C').screen })
      graph.moveNodeDrag({ x: m.screen.x + 16, y: m.screen.y + 4 })
      draw()
      assert.equal(m.emphasis, 1)
      assert.ok(Math.abs(mark('c').light - (key === 'A' ? 0.64 : 0.44)) < 1e-6)
      if (key === 'A') {
        assert.equal(m.hubFocusT, 1)
        assert.equal(mark('a').light, 1)
      } else {
        assert.equal(m.leafFocusT, 1)
        assert.equal(graph.wires.get('ab').leafWeight, 1)
        assert.equal(mark('b').nameAlpha, 1)
        assert.ok(Math.abs(labels.get('a').x - m.screen.x) < 25)
      }
    }
    graph.external = null
    graph.endNodeDrag()
    graph.move({ ...m.screen })
    assert.equal(graph.hover, key)
    draw()
    graph.move({ x: 10, y: 10 }); draw()
    assert.equal(graph.hover, null)
    assert.equal(m.emphasis, 0)
  }
})

test('intro orbits clockwise on the live particles and hands off to the overview simulation', (t) => {
  const { buildCategoryGraph } = load(path.join(root, 'views/mes/graph/categoryGraph.ts'))
  const { graphIndex, buildScene, shot, leafGrowth, globalSwirl, easeBloom, DOCK_MS, DOCK_DURATION, ORBIT_MS, LAUNCH_MS } = load(path.join(root, 'views/mes/graph/starScene.ts'))
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const full = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database/graph/equipment-knowledge.json'), 'utf8'))
  const model = buildCategoryGraph(full, [])
  const engine = new StarCanvas()
  engine.width = 975
  engine.height = 620
  engine.setScene(buildScene(graphIndex(model, full, true), null, undefined, 975, 620), 0)
  engine.beginIntro(0)
  const ctx = new Proxy({
    measureText: s => ({ width: s.length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    rotate() { assert.fail('glyph rotation during intro') }
  }, { get: (o, key) => o[key] ?? (() => {}) })
  const hubs = [...engine.marks.values()].filter(m => m.role === 'hub').sort((a, b) => a.order - b.order)
  const first = hubs[0]
  const cut = engine.bloomMs
  const angleOf = m => Math.atan2(m.screen.y - engine.height / 2, m.screen.x - engine.width / 2)
  const deg = r => r * 180 / Math.PI
  assert.deepEqual([DOCK_MS, DOCK_DURATION, ORBIT_MS, LAUNCH_MS], [2050, 620, 2100, 2750])
  assert.equal(globalSwirl(0), -1.75)
  assert.equal(globalSwirl(cut / 2, cut), -1.75 * (1 - (0.45 * 0.5 + 0.55 * 0.875)))
  engine.draw(ctx, 141, 1)
  const launchAngle = angleOf(first)
  const travel = (first.orbitAngle - launchAngle + 2 * Math.PI) % (2 * Math.PI)
  assert.ok(deg(travel) > 94 && deg(travel) < 105)
  let lastAngle = launchAngle
  for (let ms = 157; ms < cut * 0.7; ms += 16) {
    engine.draw(ctx, ms, 1)
    const angle = angleOf(first)
    assert.ok((angle - lastAngle + 2 * Math.PI) % (2 * Math.PI) < 0.2)
    lastAngle = angle
  }
  const marks = [...engine.marks.values()]
  const landing = m => engine.introLandings.get(m.key)
  assert.ok(hubs.some(m => pointDistance(m, landing(m)) > 10))
  assert.ok(marks.every(m => pointDistance(m.position, landing(m)) === 0))
  const mid = cut * 0.85
  for (let ms = cut * 0.7; ms < mid; ms += 16) engine.draw(ctx, ms, 1)
  engine.draw(ctx, mid, 1)
  const state = shot(mid, first.order, hubs.length)
  const theta = first.orbitAngle + globalSwirl(mid, cut) + state.localSwirl
  const radius = first.orbitRadius * state.travel
  const paintedOffset = { x: first.screen.x - engine.width / 2 - radius * Math.cos(theta),
    y: first.screen.y - engine.height / 2 - radius * Math.sin(theta) }
  assert.ok(pointDistance(first.position, landing(first)) > 0.05)
  assert.ok(Math.abs(paintedOffset.x - 0.5 * (first.position.x - landing(first).x)) < 1e-8)
  assert.ok(Math.abs(paintedOffset.y - 0.5 * (first.position.y - landing(first).y)) < 1e-8)
  for (let ms = mid + 16; ms < cut - 0.01; ms += 16) engine.draw(ctx, ms, 1)
  engine.draw(ctx, cut - 0.01, 1)
  const before = marks.map(m => ({ screen: { ...m.screen }, v: { ...m.velocity } }))
  assert.equal(engine.draw(ctx, cut, 1), true)
  assert.equal(engine.started, null)
  assert.ok(cut < DOCK_MS + DOCK_DURATION)
  assert.ok(marks.every((m, i) => engine.marks.get(m.key) === m &&
    pointDistance(m.screen, before[i].screen) < 0.01 && pointDistance(m.velocity, before[i].v) < 0.001))
  assert.ok(hubs.some(m => Math.hypot(m.velocity.x, m.velocity.y) > 0.02))
  assert.ok(marks.some(m => m.role === 'leaf' && Math.hypot(m.velocity.x, m.velocity.y) > 0.02))
  assert.equal(engine.physicsWarmup, 0)
  engine.draw(ctx, cut + 60, 1)
  assert.equal(engine.physicsWarmup, 0.75)
  engine.draw(ctx, cut + 120, 1)
  assert.equal(engine.physicsWarmup, 1)
  t.diagnostic('Final bloom and interactive handoff at ' + cut + 'ms')
  const n = hubs.length
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10)
  for (const hub of hubs) {
    const start = shot(0, hub.order, n).bloomStart
    near(shot(start, hub.order, n).shrink, 0)
    const launch = start - 440
    if (hub.order) {
      const interval = start - shot(0, hub.order - 1, n).bloomStart
      assert.ok(interval >= 80 && interval <= 105)
    }
    near(shot(launch, hub.order, n).travel, 0)
    near(shot(launch + 410, hub.order, n).travel, easeBloom(0.5))
    near(shot(launch + 820, hub.order, n).travel, 1)
    near(shot(start + 450, hub.order, n).shrink, easeBloom(0.5))
    near(shot(start + 900, hub.order, n).shrink, 1)
    assert.ok(leafGrowth(start + 100, start, 0) > leafGrowth(start + 100, start, 1))
    assert.ok(leafGrowth(start + 500, start, 1) > 0 && leafGrowth(start + 500, start, 1) < 1)
    near(leafGrowth(start + 950, start, 1), 1)
    assert.ok(start + 950 <= 2100)
  }
})

test('opening landings use the final drawer bounds and avoid a catch-up frame on desktop and narrow screens', (t) => {
  const { StarCanvas, fitOverview } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const { graphIndex, buildScene, DOCK_MS, DOCK_DURATION, easeBloom } = load(path.join(root, 'views/mes/graph/starScene.ts'))
  const { overviewBounds } = load(path.join(root, 'views/mes/graph/starFluid.ts'))
  const { buildCategoryGraph } = load(path.join(root, 'views/mes/graph/categoryGraph.ts'))
  const full = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database/graph/equipment-knowledge.json'), 'utf8'))
  const index = graphIndex(buildCategoryGraph(full, []), full, true)
  const gradient = () => ({ addColorStop() {} })
  const ctx = new Proxy({
    measureText: s => ({ width: s.length * 8 }),
    createLinearGradient: gradient,
    createRadialGradient: gradient
  }, { get: (object, key) => object[key] ?? (() => {}) })

  for (const [width, height, inset] of [[1396, 626, 272], [395, 660, 182]]) {
    const view = width - inset
    const scene = buildScene(index, null, undefined, view, height)
    const zoom = fitOverview(scene, ctx, view, height)
    const engine = Object.assign(new StarCanvas(), { width, height })
    engine.setScene(scene, 0, false, zoom, view)
    engine.beginIntro(0)
    const marks = [...engine.marks.values()]
    const hubs = marks.filter(m => m.role === 'hub')
    const bounds = overviewBounds(view, height, zoom)
    const room = Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top)
    const area = hubs.reduce((sum, m) => sum + Math.PI * (m.collideR + 9) ** 2, 0)
    const scale = Math.min(1, Math.sqrt(0.64 * (bounds.right - bounds.left) * (bounds.bottom - bounds.top) / area),
      room / (2 * Math.max(...hubs.map(m => m.collideR + 9))))
    const maxOverlap = point => Math.max(0, ...hubs.flatMap((a, i) =>
      hubs.slice(i + 1).map(b => (a.collideR + b.collideR + 18) * scale - pointDistance(point(a), point(b)))))
    assert.ok(maxOverlap(m => m) > 30)
    assert.ok(maxOverlap(m => engine.introLandings.get(m.key)) < 0.1)
    const cut = engine.bloomMs
    function draw(ms) {
      engine.sidebarInset = inset * easeBloom((ms - DOCK_MS) / DOCK_DURATION)
      return engine.draw(ctx, ms, 1)
    }
    const centered = m => ({ x: m.screen.x - (width - engine.sidebarInset) / 2, y: m.screen.y - height / 2 })
    for (let ms = 16; ms < cut - 0.01; ms += 16) draw(ms)
    draw(cut - 0.01)
    const before = marks.map(centered)
    assert.equal(draw(cut), true)
    assert.ok(engine.sidebarInset < inset, 'the drawer can still be sliding at handoff')
    assert.ok(marks.every((m,i) => pointDistance(centered(m), before[i]) < 0.01))
    for (const { position: p } of hubs) {
      assert.ok(p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.top && p.y <= bounds.bottom)
    }
    for (const m of marks.filter(m => m.role === 'leaf')) {
      const p = engine.introLandings.get(m.key)
      const halfWidth = m.thumbnail ? m.thumbnail.width / 2 + 0.5 : 2
      const halfHeight = m.thumbnail ? m.thumbnail.height / 2 + 0.5 : 2
      assert.ok(Math.abs(p.x * zoom) + halfWidth <= view / 2)
      assert.ok(Math.abs(p.y * zoom) + halfHeight <= height / 2)
    }
    let last = marks.map(centered), largestStep = 0, smallestStep = Infinity
    for (let ms = cut + 1000 / 60; ms <= 4050; ms += 1000 / 60) {
      draw(ms)
      const next = marks.map(centered)
      const moved = Math.max(...next.map((p, i) => pointDistance(p, last[i])))
      largestStep = Math.max(largestStep, moved)
      smallestStep = Math.min(smallestStep, moved)
      last = next
    }
    assert.equal(engine.physicsWarmup, 1)
    assert.ok(largestStep < 3 && smallestStep > 0.005, 'continuous frame motion: ' + smallestStep + '..' + largestStep)
    t.diagnostic(view + 'px usable width, continuous motion, max ' + largestStep.toFixed(2) + 'px/frame')
  }
})

test('the hub paints one opaque square throughout its 900 ms flower shrink and after handoff', () => {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const { easeBloom } = load(path.join(root, 'views/mes/graph/starScene.ts'))
  const entity = { id: 'test-hub', name: '部件', kind: '部件' }
  const hub = { key: entity.id, entity, role: 'hub', parent: '', x: 160, y: -92, order: 0, count: 35, seed: 0.4, color: '#5EA8FF' }
  const engine = new StarCanvas()
  engine.width = 900
  engine.height = 600
  engine.setScene({ marks: new Map([[hub.key, hub]]), wires: new Map(), overview: true }, 0)
  engine.beginIntro(0)
  const squares = [], arcs = []
  const ctx = new Proxy({
    measureText: text => ({ width: text.length * 8 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect(x, y, w, h) {
      if (typeof this.fillStyle === 'string' && w === h && w >= 7.5) {
        squares.push({ side: w, alpha: this.globalAlpha, color: this.fillStyle })
      }
    },
    arc(x, y) { arcs.push({ x, y }) }
  }, { get: (o, k) => o[k] ?? (() => {}) })
  for (const ms of [220, 400, 580, 660, 900, 1080, 1290, 1480, 2050, 2450, 2670, 2749, 2751]) {
    squares.length = arcs.length = 0
    engine.draw(ctx, ms, 1)
    const p = engine.marks.get(hub.key).screen
    assert.ok(arcs.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 1))
    assert.equal(squares.length, 1)
    const square = squares[0]
    const shrink = easeBloom((ms - 580) / 900)
    assert.ok(Math.abs(square.side - (42 - (42 - 10.5) * shrink)) < 1e-9)
    assert.equal(square.alpha, 1)
    if (ms <= 580) assert.equal(square.color, '#6272FF')
    if (ms >= 1480) assert.equal(square.color, '#4372FF')
  }
})

test('the launch clock uses one panel transform: dock at 2050, finish sliding at 2670, unlock at 2750', async () => {
  const file = path.join(root, 'views/mes/graph/useGraphLaunch.ts')
  const hooks = [], animations = [], fades = [], module = { exports: {} }
  const start = 1234.5
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    module, exports: module.exports, DOMException,
    document: { timeline: { currentTime: start } },
    window: { matchMedia: () => ({ matches: false }) },
    require: name => name === 'vue'
      ? { onBeforeUnmount: fn => hooks.push(fn), onDeactivated: fn => hooks.push(fn) }
      : load(path.join(root, 'views/mes/graph/starScene.ts'))
  })
  const panel = { value: { animate(frames, options) {
    let resolve, reject, progress = 0
    const finished = new Promise((yes, no) => { resolve = yes; reject = no })
    const anim = {
      frames, options, finished, resolve,
      cancel: () => reject(new DOMException('Cancelled', 'AbortError')),
      effect: { getComputedTiming: () => ({ progress }) },
      tick: p => { progress = p }
    }
    animations.push(anim)
    return anim
  } } }
  const skip = { value: { animate(frames, options) {
    const fade = { frames, options, canceled: false, cancel() { this.canceled = true } }
    fades.push(fade)
    return fade
  } } }
  const { play, slide, visibleFraction } = module.exports.useGraphLaunch(panel, false, skip)
  let unlocked = false
  const running = play(t => assert.equal(t, start)).then(() => { unlocked = true })
  const [anim] = animations
  const { delay, duration, endDelay, easing } = anim.options
  assert.equal(anim.startTime, start)
  assert.deepEqual([delay, duration, endDelay], [2050, 620, 80])
  const [fade] = fades
  assert.equal(fade.startTime, start)
  assert.equal(fade.options.delay, 1870)
  assert.equal(fade.options.duration, 180)
  assert.equal(fade.options.delay + fade.options.duration, delay)
  assert.equal(fade.frames[0].opacity, 1)
  assert.equal(fade.frames[1].opacity, 0)
  assert.equal(fade.frames[1].visibility, 'hidden')
  assert.equal(easing, 'cubic-bezier(0.22, 1, 0.36, 1)')
  assert.equal(anim.frames[0].transform, 'translateX(100%)')
  assert.equal(anim.frames[1].transform, 'translateX(0%)')
  for (const p of [0, 0.36, 0.97, 1]) {
    anim.tick(p)
    assert.equal(visibleFraction(), p)
  }
  assert.equal(unlocked, false)
  anim.resolve()
  await running
  assert.equal(unlocked, true)
  assert.equal(fade.canceled, true)
  assert.equal(visibleFraction(), 1)
  const replay = play(t => assert.equal(t, start))
  hooks[1]()
  await replay
  assert.equal(fades.at(-1).canceled, true)
  assert.equal(visibleFraction(), 1)
  const close = slide(false)
  assert.equal(animations.at(-1).options.duration, 520)
  assert.equal(animations.at(-1).options.endDelay, 0)
  animations.at(-1).resolve()
  await close
})

test('overview fits the visible region with fixed-size marks and measured text in both drawer states', (t) => {
  const { graphIndex, buildScene } = load(path.join(root, 'views/mes/graph/starScene.ts'))
  const { buildCategoryGraph } = load(path.join(root, 'views/mes/graph/categoryGraph.ts'))
  const { StarCanvas, fitOverview } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const full = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database/graph/equipment-knowledge.json'), 'utf8'))
  const index = graphIndex(buildCategoryGraph(full, []), full, true)
  const ctx = new Proxy({
    measureText: text => ({ width: text.length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (o, k) => o[k] ?? (() => {}) })
  for (const [width, height, inset] of [[1396,626,272], [1396,626,0], [395,660,182], [1600,900,272]]) {
    const avail = width - inset
    const scene = buildScene(index, null, undefined, avail, height)
    const zoom = fitOverview(scene, ctx, avail, height)
    const engine = new StarCanvas()
    Object.assign(engine, { width, height, sidebarInset: inset, still: true })
    engine.setScene(scene, 0, false, zoom)
    engine.draw(ctx, 1501, 1)
    const rects = [...engine.marks.values()].map(m => {
      const r = m.role === 'hub' ? 2.4 * (7.5 + 3.5 * Math.sqrt(m.count / engine.largestHub)) : 4
      return { x: m.screen.x - r, y: m.screen.y - r, w: 2 * r, h: 2 * r }
    })
    rects.push(...engine.targets.filter(target => !target.dot).map(target => target.box))
    const left = Math.min(...rects.map(r => r.x)), right = Math.max(...rects.map(r => r.x + r.w))
    const top = Math.min(...rects.map(r => r.y)), bottom = Math.max(...rects.map(r => r.y + r.h))
    const x = (right-left)/avail, y = (bottom-top)/height
    assert.ok(left >= 0 && right <= avail && top >= 0 && bottom <= height)
    assert.ok(x > 0.86 && x < 0.925 && y > 0.86 && y < 0.925)
    t.diagnostic(avail + 'x' + height + ' projected bounds: ' + (x*100).toFixed(1) + '% x ' + (y*100).toFixed(1) + '%')
  }
})


test('a drawer refit retains the live particle, active hover and partially lit edge', () => {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const { buildScene, graphIndex } = load(path.join(root, 'views/mes/graph/starScene.ts'))
  const { buildCategoryGraph } = load(path.join(root, 'views/mes/graph/categoryGraph.ts'))
  const full = JSON.parse(fs.readFileSync(path.join(__dirname, '../../database/graph/equipment-knowledge.json'), 'utf8'))
  const index = graphIndex(buildCategoryGraph(full, []), full, true)
  const engine = new StarCanvas()
  engine.setScene(buildScene(index, null, undefined, 1124, 626), 0)
  const node = [...engine.marks.values()].find(m => m.role === 'hub')
  const wire = [...engine.wires.values()].find(w => w.kind === 'spoke')
  const anchor = node.x
  engine.hover = node.key
  node.velocity.x = 0.72
  wire.emphasis = 0.58
  engine.setScene(buildScene(index, null, undefined, 1396, 626), 2000, true)
  assert.equal(engine.marks.get(node.key), node)
  assert.equal(engine.wires.get(wire.key), wire)
  assert.notEqual(node.x, anchor)
  assert.equal(engine.hover, node.key)
  assert.equal(node.velocity.x, 0.72)
  assert.equal(wire.emphasis, 0.58)
})


test('a 52px blue wake reveals dormant points on the fixed lattice, then expires after 550ms', () => {
  const { BlueParticles, AMBIENT_BLUE } = load(path.join(root, 'views/mes/graph/blueParticles.ts'))
  const field = new BlueParticles(), control = new BlueParticles()
  const origin = { x: 0, y: 0 }
  function sample(renderer, time, overview = true, offset = origin, still = false) {
    const dots = []
    const ctx = { fillRect(x, y, size) {
      dots.push({ x: x + size / 2, y: y + size / 2, size, color: this.fillStyle, a: this.globalAlpha })
    } }
    renderer.draw(ctx, time, 960, 600, offset, offset, still, overview)
    return dots
  }
  const geometry = dots => dots.map(({ a, ...fixed }) => fixed)
  const idle = sample(field, 0)
  const grid = field.lattice
  assert.ok(grid.dots.length >= 650 && grid.dots.length <= 800)
  assert.ok(Math.abs(idle.length - grid.dots.length * 0.2) <= 1)
  assert.ok(idle.every(p => p.color === AMBIENT_BLUE && p.color === '#5288FF' && p.size >= 1.4 && p.size <= 2.1))
  assert.equal(idle.length, grid.dots.filter(p => p.isAmbientTwinkle).length)
  const peaks = idle.map(() => 0)
  for (let t = 0; t <= 7500; t += 80) {
    const frame = sample(control, t, true, { x: 140, y: -83 })
    assert.deepEqual(geometry(frame), geometry(idle))
    frame.forEach((p,i) => { peaks[i] = Math.max(peaks[i], p.a) })
  }
  assert.ok(peaks.every(a => a >= 0.419 && a <= 0.52))

  const target = grid.dots.find(p => !p.isAmbientTwinkle && p.x > 200 && p.y > 200)
  const same = (a,b) => pointDistance(a,b) < 1e-7
  field.trace(target, 8000)
  const peakFrame = sample(field, 8024)
  const lit = peakFrame.find(p => same(p, target))
  assert.ok(lit && lit.a >= 0.78 && lit.a <= 0.88 && lit.size >= 2 && lit.size <= 2.4)
  assert.ok(peakFrame.length > idle.length)
  assert.ok(peakFrame.every(p => p.color === '#5288FF'))
  for (const t of [8024, 8170, 8380, 8549, 8550]) {
    const frame = sample(field, t), clean = sample(control, t)
    for (const dot of frame) {
      const outside = pointDistance(dot, target) >= 52
      assert.ok(grid.dots.some(p => same(p, dot)))
      if (outside || t >= 8550) assert.deepEqual(dot, clean.find(p => same(p, dot)))
    }
    if (t >= 8550) assert.deepEqual(frame, clean)
  }
  field.trace(null, 8600)
  field.trace({ x: 100, y: 300 }, 9000)
  for (const dx of [3, 6, 11, 80]) field.trace({ x: 100 + dx, y: 300 }, 9000 + dx)
  assert.deepEqual(Array.from(field.trail, p => p.x), Array.from({ length: 11 }, (_,i) => 100 + 8*i))
  assert.ok(field.trail.every((p,i) => p.born === 9000 + i * 8))
  assert.deepEqual(sample(field, 9631), sample(control, 9631))
  assert.deepEqual(sample(field, 9900, true, origin, true), sample(control, 9990, true, origin, true))
  assert.equal(sample(field, 10000, false).length, 156)
})

test('overview paints a thin ambient layer, reveals white leaf paths, and clears stale labels', () => {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const { liveTheme } = load(path.join(root, 'views/mes/graph/starInk.ts'))
  const e = new StarCanvas()
  Object.assign(e, { width: 900, height: 640, still: true })
  const marks = new Map(), wires = new Map()
  function mark(id, parent, x, y, kind, seed = 0.31) {
    marks.set(id, { key: id, role: parent ? 'leaf' : 'hub', x, y, parent, count: 3, seed,
      entity: { id, name: id, kind }, order: 0, color: '#5EA8FF' })
  }
  function wire(a, b, kind) {
    const key = a + '/' + b
    wires.set(key, { key, a, b, kind, label: '' })
  }
  mark('A', '', -150, 0, '部件')
  mark('one', 'A', -160, -95, '部件')
  mark('two', 'A', -160, 95, '部件')
  mark('card', 'A', -225, 50, '部件', 0.86)
  mark('B', '', 170, 0, '设备')
  mark('three', 'B', 190, -95, '设备')
  wire('A', 'one', 'spoke')
  wire('A', 'two', 'spoke')
  wire('A', 'card', 'spoke')
  wire('B', 'three', 'spoke')
  wire('one', 'three', 'relation')
  wire('A', 'B', 'aggregate')
  e.setScene({ marks, wires, overview: true, ambientCrossEdges: [wires.get('one/three')] }, 0)

  const fills = [], strokes = [], captions = []
  let arc, end, insideCard
  function gradient(x, y, x2, y2) {
    return { x, y, x2, y2, stops: [], addColorStop(i, color) { this.stops.push(color) } }
  }
  const ctx = new Proxy({
    createLinearGradient: gradient, createRadialGradient: gradient,
    translate() { insideCard = true }, restore() { insideCard = false },
    beginPath() { arc = null; end = null },
    arc(x, y, r) { arc = { x, y, r } },
    lineTo(x, y) { end = { x, y } },
    fill() { if (arc) fills.push({ ...arc, color: this.fillStyle, alpha: this.globalAlpha }) },
    fillRect(x, y, w, h) { fills.push({ x: x + w / 2, y: y + h / 2, w, h, color: this.fillStyle, insideCard }) },
    strokeRect() { strokes.push({ border: !!insideCard, ink: this.strokeStyle, width: this.lineWidth }) },
    stroke() { strokes.push({ end, arc, ink: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, insideCard }) },
    measureText: word => ({ width: word.length * 8 }),
    fillText(word) { captions.push({ word, font: this.font }) }
  }, { get: (o, k) => o[k] ?? (() => {}) })
  function frame(time) {
    fills.length = strokes.length = captions.length = 0
    e.draw(ctx, time, 1)
  }
  const at = id => e.marks.get(id).screen
  const near = (a, b) => a && Math.hypot(a.x - b.x, a.y - b.y) < 0.8
  const dot = id => fills.find(f => f.r && near(f, at(id)))
  const hub = id => fills.find(f => f.w > 7 && f.w < 16 && near(f, at(id)) && typeof f.color === 'string')
  const spoke = () => strokes.find(f => near(f.end, at('one')))
  const trunk = () => strokes.find(f => near(f.end, at('A')))
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' vs ' + b)

  frame(1501)
  const styles = ['设备','部件','故障','工艺','措施','手册','原因','规则库'].map(liveTheme)
  assert.equal(new Set(styles.map(t => t.hub)).size, 1)
  assert.equal(new Set(styles.map(t => t.dot)).size, 1)
  assert.equal(styles.filter(t => t.wave[2][1] === 238).length, 3)
  assert.equal(styles.filter(t => t.wave[2][2] === 255).length, 5)
  assert.equal(hub('A').color, '#4372FF')
  assert.equal(hub('B').color, '#4372FF')
  close(dot('one').r, 2)
  assert.equal(dot('one').color, '#3E72F2')
  close(dot('one').alpha, 0.88)
  assert.deepEqual(spoke().ink.stops, Array(11).fill('rgba(22,108,148,0.340)'))
  assert.equal(trunk().ink, 'rgba(58,98,212,0.180)')
  close(spoke().width, 0.95)
  close(trunk().width, 0.85)
  const ring = strokes.find(f => f.ink === 'rgba(110, 146, 228, 0.34)')
  close(ring.width, 0.9)
  close(ring.arc.r, 6)
  const cross = e.wires.get('one/three')
  close(cross.alpha, 0)
  close(e.wires.get('A/B').alpha, 0)
  const ambient = () => strokes.filter(f => f.ink === 'rgba(66, 108, 218, 0.12)')
  assert.equal(ambient().length, 1)
  assert.ok(near(ambient()[0].end, at('three')))
  close(ambient()[0].width, 0.75)
  assert.equal(e.lineTargets.length, 0)
  assert.equal(strokes.filter(f => near(f.end, at('three'))).length, 2)
  e.still = false
  frame(1508)
  const waves = strokes.filter(f => f.ink?.stops?.length === 11)
  assert.equal(waves.length, 4, 'four visible spokes each submit exactly one full gradient stroke')
  assert.ok(waves.every(f => f.width === 0.95 && f.alpha === 1))
  const channels = css => css.slice(5, -1).split(',').map(Number)
  const stops = stroke => stroke.ink.stops.map(channels)
  assert.ok(waves.filter(f => !near(f.end, at('three'))).every(f =>
    stops(f).every(([r,g,b,a]) => r >= 22 && r <= 38 && g >= 108 && g <= 238 && b >= 148 && b <= 184 && a >= 0.34 && a <= 0.88)))
  assert.ok(stops(waves.find(f => near(f.end, at('three')))).every(([r,g,b,a]) =>
    r >= 40 && r <= 72 && g >= 84 && g <= 178 && b >= 206 && b <= 255 && a >= 0.34 && a <= 0.90))
  e.still = true
  frame(1510)

  e.move({ ...at('A') })
  frame(1520)
  const leaf = e.marks.get('one')
  close(leaf.targetDist / leaf.naturalDist, 1 - (0.24 + leaf.distNorm * 0.11))
  close(dot('one').r, 3.5); close(dot('two').r, 3.5); close(dot('three').r, 2)
  assert.equal(hub('A').color, '#4372FF')
  for (const line of [spoke(), trunk()]) {
    assert.equal(line.ink.stops.length, 11)
    assert.ok(stops(line).every(([r,g,b,a]) => r <= 76 && g >= 198 && b <= 192 && a >= 0.45 && a <= 0.96))
  }
  close(spoke().width, 0.95); close(trunk().width, 0.95)
  close(cross.alpha, 0)
  close(e.marks.get('B').light, 0.64)
  assert.ok(captions.find(c => c.word === 'A').font.includes('21px'))

  e.move({ ...at('one') })
  frame(1600)
  close(dot('one').r, 3.8)
  close(dot('two').r, 2); close(dot('three').r, 2)
  const rim = strokes.find(f => near(f.arc, at('one')))
  close(rim.width, 1.1)
  assert.equal(rim.ink.toUpperCase(), '#FFFFFF')
  assert.equal(dot('three').color, '#FFFFFF')
  assert.ok(stops(spoke()).every(([r,g,b,a]) => r >= 242 && g >= 247 && b === 255 && a >= 0.88))
  const revealed = () => strokes.find(f => near(f.end, at('three')) && near(f.ink, at('one')))
  assert.equal(revealed().width, 0.95)
  close(e.marks.get('three').nameAlpha, 1)
  close(cross.alpha, 1)
  close(e.marks.get('two').light, 0.44)

  e.move(null); frame(1680)
  e.move({ x: at('one').x + 30, y: at('one').y }); frame(1690)
  close(leaf.whiteT, 1 - pointDistance(leaf.screen, e.pointer) / 110)
  e.move({ ...at('B') }); frame(1695)
  close(e.marks.get('one').light, 0.64)
  e.still = false
  e.move({ ...at('one') }); frame(1700)
  close(cross.alpha, 0)
  frame(1810); close(cross.alpha, 0.5)
  frame(1920); close(cross.alpha, 1)
  close(revealed().alpha, 1)
  e.move(null); frame(1930)
  assert.ok(captions.every(c => c.word !== 'one' && c.word !== 'three'))
  assert.equal(leaf.nameAlpha, 0)
  frame(2060); close(cross.alpha, 0.5)
  frame(2190); close(cross.alpha, 0)
  assert.equal(revealed(), undefined)
  e.external = 'one'
  leaf.position.x = -1200
  frame(2200)
  assert.ok(captions.every(c => c.word !== 'one'))
})

test('the painted overview leaf pill receives the click when it covers a different hub', () => {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const graph = new StarCanvas()
  Object.assign(graph, { width: 700, height: 450, still: true })
  const gradient = () => ({ addColorStop() {} })
  const ctx = new Proxy({
    measureText: s => ({ width: s.length * 8 }),
    createLinearGradient: gradient, createRadialGradient: gradient
  }, { get: (o,k) => o[k] ?? (() => {}) })
  const marks = new Map()
  for (const [key, x, parent] of [['A', -130, ''], ['item', -10, 'A'], ['B', 38, '']]) {
    marks.set(key, {
      key, role: parent ? 'leaf' : 'hub', x, y: 0, parent, count: 1, order: 0, seed: 0.21,
      color: '#509AFF', entity: { id: key, name: parent ? 'part-123' : key, kind: '部件' }
    })
  }
  const wires = new Map([['A/item', { key: 'A/item', a: 'A', b: 'item', kind: 'spoke', label: '' }]])
  graph.setScene({ marks, wires, overview: true }, 0)
  graph.draw(ctx, 100, 1)
  const under = { ...graph.marks.get('B').screen }
  assert.equal(graph.hit(under).id, 'B')
  graph.move({ ...graph.marks.get('item').screen })
  graph.draw(ctx, 120, 1)
  const { box } = graph.targets.find(t => !t.dot && t.hit.id === 'item')
  assert.ok(under.x > box.x && under.x < box.x + box.w && under.y > box.y && under.y < box.y + box.h)
  graph.move(under)
  assert.equal(graph.hover, 'item')
  assert.equal(graph.hit(under).id, 'item')
  graph.move(null)
  graph.draw(ctx, 140, 1)
  assert.equal(graph.hit(under).id, 'B')
})

test('a stationary pointer tracks the final painted hit as an unheld category drifts away', () => {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const engine = new StarCanvas()
  Object.assign(engine, { width: 900, height: 600 })
  const hub = { key: 'landmark', role: 'hub', parent: '', x: 220, y: -100,
    entity: { id: 'landmark', kind: '部件', name: '部件' }, count: 3, order: 0, seed: 0.31, color: '#509AFF' }
  const gradient = () => ({ addColorStop() {} })
  const ctx = new Proxy({ measureText: s => ({ width: s.length * 8 }),
    createLinearGradient: gradient, createRadialGradient: gradient }, { get: (o,k) => o[k] ?? (() => {}) })
  engine.setScene({ overview: true, marks: new Map([[hub.key, hub]]), wires: new Map() }, 0)
  let time = 0
  const draw = (held = false) => engine.draw(ctx, time += 1000/60, 1, held)
  for (let i = 0; i < 60; i++) draw()
  const p = { ...engine.marks.get(hub.key).screen }
  engine.move(p)
  assert.equal(engine.hover, hub.key)
  for (let i = 0; i < 200; i++) draw(true)
  assert.equal(engine.hover, hub.key, 'a pending physical press preserves the target until release')
  assert.equal(engine.hit(p), null, 'the painted hub has drifted beyond the cursor')
  let changes = 0
  for (let i = 0; i < 90; i++) {
    const previous = engine.hover
    draw()
    if (previous !== engine.hover) changes++
    assert.equal(engine.hover, engine.hit(p)?.key ?? null)
  }
  assert.equal(changes, 1, 'stationary hover clears once as the hub leaves')
})

test('one 11-stop gradient carries two oppositely travelling cosine-squared lobes per spoke', () => {
  const { makeFlow, waveInk, liveTheme } = load(path.join(root, 'views/mes/graph/starInk.ts'))
  const from = { x: 0, y: 10 }, to = { x: 100, y: 10 }
  const ctx = { createLinearGradient(x, y, x2, y2) {
    assert.deepEqual([x, y, x2, y2], [0, 10, 100, 10])
    return { stops: [], addColorStop(p, ink) { this.stops.push([p, ink]) } }
  } }
  for (const [kind, base, peak] of [
    ['部件', 'rgba(22,108,148,0.340)', 'rgba(38,238,184,0.880)'],
    ['设备', 'rgba(40,84,206,0.340)', 'rgba(72,178,255,0.900)']
  ]) {
    const theme = liveTheme(kind), flow = makeFlow(kind)
    assert.ok(flow.span >= 0.32 && flow.span <= 0.40)
    const initialOffset = (flow.inward - flow.outward + 1) % 1
    assert.ok(initialOffset >= 0.35 && initialOffset <= 0.65)
    flow.outward = 0; flow.inward = 0.5
    const stops = waveInk(ctx, flow, from, to, 0, theme, 'spoke', 0, 0, false).stops
    assert.deepEqual(stops.map(s => s[0]), Array.from({length: 11}, (_, i) => i / 10))
    assert.equal(stops[0][1], peak)
    assert.equal(stops[5][1], peak)
    assert.equal(stops[2][1], base)
    assert.equal(stops[10][1], stops[0][1])
    assert.ok(![base, peak].includes(stops[1][1]), 'a soft shoulder joins the peak to the base')
    waveInk(ctx, flow, from, to, 1, theme, 'spoke', 0, 0, false)
    assert.ok(flow.outward >= 0.18 && flow.outward <= 0.24)
    assert.ok(0.5-flow.inward >= 0.14 && 0.5-flow.inward <= 0.19)
    flow.outward = 0; flow.inward = 0.5
    const green = waveInk(ctx, flow, from, to, 0, theme, 'trunk', 1, 0, false).stops
    assert.equal(green[0][1], 'rgba(76,255,192,0.960)')
    assert.equal(green[2][1], 'rgba(34,198,138,0.450)')
    waveInk(ctx, flow, from, to, 1, theme, 'trunk', 1, 0, false)
    assert.ok(Math.abs(flow.outward - 0.26) < 1e-12 && Math.abs(flow.inward - 0.24) < 1e-12)
  }
})

function independentHubs(still = false) {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const grad = () => ({ addColorStop() {} })
  const ctx = new Proxy({
    measureText: s => ({ width: s.length * 8 }),
    createRadialGradient: grad, createLinearGradient: grad
  }, { get: (obj, key) => obj[key] ?? (() => {}) })
  const engine = new StarCanvas()
  Object.assign(engine, { width: 1100, height: 650, sidebarInset: 180, still })
  const marks = new Map()
  for (const [key, parent, x, y] of [
    ['hub', '', -160, 0], ['near', 'hub', -160, -25],
    ['far', 'hub', -160, -105], ['neighbor', '', 175, 0], ['remote', '', -260, 170]
  ]) {
    marks.set(key, { key, entity: { id: key, name: key, kind: '部件' }, role: parent ? 'leaf' : 'hub',
      x, y, parent, order: 0, count: 2, seed: 0.31, color: '#5EA8FF' })
  }
  const scene = { overview: true, marks, wires: new Map() }
  engine.setScene(scene, 0)
  let time = 0
  const frame = () => engine.draw(ctx, (time += 16.67), 1)
  frame()
  return { engine, frame, scene, hub: engine.marks.get('hub') }
}

test('the 120ms ramp scales contacts alone while each free hub and leaf keeps swimming', () => {
  const { stepOverview } = load(path.join(root, 'views/mes/graph/starFluid.ts'))
  const { engine } = independentHubs()
  const frame = { step: 1, seconds: 2.1, zoom: 1, bounds: { left: -169, right: 520, top: -320, bottom: 320 },
    mouse: null, pointerFlow: { x: 0, y: 0 }, hotKey: null, dragGoal: null, still: false }
  const free = warmup => {
    const group = structuredClone(engine.canopies[0])
    for (const m of [group.hub, ...group.leaves]) m.velocity = { x: 0, y: 0 }
    stepOverview([group], { ...frame, warmup })
    return [group.hub, ...group.leaves].map(m => [m.position, m.velocity])
  }
  const water = free(0)
  assert.deepEqual(water, free(1))
  assert.ok(water.every(([,v]) => Math.hypot(v.x, v.y) > 0))
  const gap = warmup => {
    const groups = structuredClone(engine.canopies.slice(0,2))
    groups[1].hub.position = { x: groups[0].hub.position.x + 10, y: groups[0].hub.position.y }
    stepOverview(groups, { ...frame, warmup })
    return pointDistance(groups[0].hub.position, groups[1].hub.position)
  }
  assert.ok(gap(1) > gap(0) + 5)
})

function flowerPhysics() {
  const { StarCanvas } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const engine = new StarCanvas()
  Object.assign(engine, { width: 1200, height: 900, sidebarInset: 160 })
  const grad = () => ({ addColorStop() {} })
  const ctx = new Proxy({ measureText: text => ({ width: text.length * 8 }),
    createLinearGradient: grad, createRadialGradient: grad }, { get: (a,k) => a[k] ?? (() => {}) })
  const marks=new Map(),wires=new Map()
  function mark(key,x,y,parent='',seed=0.426){
    marks.set(key,{key,parent,x,y,seed,order:0,count:parent?0:12,color:'#506bff',
      entity:{id:key,kind:'设备',name:key},role:parent?'leaf':'hub'})
  }
  mark('a',0,0)
  for(let i=0;i<12;i++){
    const angle=i*Math.PI/6, radius=55+13*(i%4)
    mark('l'+i,Math.cos(angle)*radius,Math.sin(angle)*radius,'a',(i+.73)/12)
  }
  mark('c',310,0)
  mark('b',-380,110);mark('other',-320,130,'b')
  mark('x',-450,-320)
  wires.set('semantic',{key:'semantic',kind:'relation',a:'l1',b:'other',label:'部件'})
  const scene={overview:true,marks,wires}
  engine.setScene(scene,0)
  let ms=0
  const frame = (held = false) => engine.draw(ctx, ms += 16.67, 1, held)
  frame()
  return { engine,frame,hub:engine.marks.get('a'), leaves:Array.from({length:12},(_,i)=>engine.marks.get('l'+i)) }
}
const bearing=(m,h)=>Math.atan2(m.position.y-h.position.y,m.position.x-h.position.x)
const pointDistance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)

function fittedOverview(viewWidth = 1124, height = 626, sidebarInset = 272) {
  const { graphIndex, buildScene } = load(path.join(root, 'views/mes/graph/starScene.ts'))
  const { StarCanvas, fitOverview } = load(path.join(root, 'views/mes/graph/starCanvas.ts'))
  const { buildCategoryGraph } = load(path.join(root, 'views/mes/graph/categoryGraph.ts'))
  const full = require('../../database/graph/equipment-knowledge.json')
  const index = graphIndex(buildCategoryGraph(full, []), full, true)
  const gradient = () => ({ addColorStop() {} })
  const ctx = new Proxy({
    measureText: s => ({ width: s.length * 8 }),
    createLinearGradient: gradient,
    createRadialGradient: gradient
  }, { get: (o, k) => o[k] ?? (() => {}) })
  const engine = new StarCanvas()
  Object.assign(engine, { width: viewWidth + sidebarInset, height, sidebarInset })
  const unfitted = buildScene(index, null, undefined, viewWidth, height)
  const scene = buildScene(index, null, undefined, viewWidth, height)
  const zoom = fitOverview(scene, ctx, viewWidth, height)
  engine.setScene(scene, 0, false, zoom)
  let now = 0
  const frame = (count = 1, held = false) => {
    for (let i = 0; i < count; i++) engine.draw(ctx, now += 1000 / 60, 1, held)
  }
  return { engine, unfitted, frame, zoom }
}

const ownerLeaves = (marks, hub) => [...marks.values()].filter(m => m.parent === hub.key)
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
function angularGaps(hub, leaves) {
  const angles = leaves.map(m => Math.atan2(m.y - hub.y, m.x - hub.x)).sort((a, b) => a - b)
  const turn = 2 * Math.PI
  return angles.map((a, i) => (angles[(i + 1) % angles.length] - a + turn) % turn)
}

test('starbursts are deterministic with varied angles, continuous radius bands, and scattered cards', () => {
  const { unfitted } = fittedOverview()
  const second = fittedOverview().unfitted
  const part = unfitted.marks.get('category:part')
  const leaves = ownerLeaves(unfitted.marks, part)
  const radii = leaves.map(leaf => pointDistance(leaf, part))
  assert.equal(leaves.length, 35)
  assert.equal(new Set(radii.map(r => r.toFixed(5))).size, 35)
  const base = Math.min(1124 * 0.112, 626 * 0.155) * 1.06 * 1.36
  const bands = [[0.42, 0.65], [0.68, 1.12], [1.15, 1.48]]
  const band = r => bands.findIndex(([lo, hi]) => r / base >= lo && r / base <= hi)
  assert.deepEqual(bands.map((_, i) => radii.filter(r => band(r) === i).length), [9, 17, 9])
  assert.equal(new Set(leaves.filter(m => m.seed >= 0.75).map(m => band(pointDistance(m, part)))).size, 3)
  const gaps = angularGaps(part, leaves)
  assert.ok(Math.max(...gaps) / Math.min(...gaps) > 4)
  const equipment = unfitted.marks.get('category:equipment')
  assert.ok(mean(ownerLeaves(unfitted.marks, equipment).map(m => pointDistance(equipment, m))) < mean(radii))
  assert.deepEqual(leaves.map(m => [m.x, m.y]), leaves.map(m => {
    const other = second.marks.get(m.key)
    return [other.x, other.y]
  }))
})

test('part and fault reach a moderate contraction quickly and expand on pointer leave', (t) => {
  for (const key of ['category:part', 'category:fault']) {
    const { engine, frame } = fittedOverview()
    frame(90)
    const hub = engine.marks.get(key)
    const leaves = ownerLeaves(engine.marks, hub)
    const average = () => mean(leaves.map(leaf => pointDistance(leaf.position, hub.position) / leaf.naturalDist))
    engine.move({ ...hub.screen })
    frame(8)
    assert.ok(hub.focusT > 0.9 && hub.focusT < 0.93)
    assert.ok(average() < 0.85)
    frame(8)
    assert.ok(average() > 0.69 && average() < 0.77)
    frame(38)
    const contracted = average()
    assert.equal(engine.hover, key)
    assert.ok(contracted > 0.68 && contracted < 0.74)
    const targets = leaves.map(leaf => leaf.targetDist / leaf.naturalDist)
    assert.ok(Math.abs(Math.min(...targets) - 0.65) < 1e-5)
    assert.ok(Math.abs(Math.max(...targets) - 0.76) < 1e-5)
    engine.move(null)
    frame(8)
    assert.ok(hub.focusT > 0.26 && hub.focusT < 0.30, 'expansion has its own rate')
    frame(52)
    assert.ok(hub.focusT < 0.005 && average() > 0.96 && average() < 1.08)
    t.diagnostic(key + ' average length on hover: ' + (100 * contracted).toFixed(1) + '%')
  }
})

test('a captured canopy stays compact through a rapid drag, a turn, and a held stop', (t) => {
  const { engine, frame } = fittedOverview()
  frame(100)
  const hub = engine.marks.get('category:part')
  const leaves = ownerLeaves(engine.marks, hub)
  const average = () => mean(leaves.map(leaf => pointDistance(leaf.position, hub.position) / leaf.naturalDist))
  engine.move({ ...hub.screen })
  frame(48)
  const down = { ...hub.screen }
  assert.ok(engine.beginNodeDrag(hub, down))
  let cursor
  const follow = (point) => {
    cursor = point
    engine.moveNodeDrag(cursor)
    frame(1, true)
    assert.ok(pointDistance(hub.screen, cursor) < 1e-6)
    assert.equal(engine.candidate, hub.key)
    assert.ok(average() < 0.9)
    for (const leaf of leaves) {
      const goal = leaf.naturalDist * (1 - (0.24 + leaf.distNorm * 0.11) * hub.focusT)
      assert.ok(Math.abs(leaf.targetDist - goal) < 1e-9)
      assert.ok(Math.hypot(leaf.velocity.x, leaf.velocity.y) <= 52 + 1e-6)
    }
  }
  for (let i = 1; i <= 17; i++) follow({ x: down.x - 29 * i, y: down.y })
  const draggedRatio = average()
  const slack = Math.max(...leaves.map(leaf =>
    pointDistance(leaf.position, hub.position) - (leaf.targetDist * 1.22 + 8)))
  assert.ok(draggedRatio < 0.85 && slack < 9)
  const center = { x: hub.screen.x + 115, y: hub.screen.y }
  for (let i = 1; i <= 36; i++) {
    const angle = Math.PI + i * 0.17
    follow({ x: center.x + Math.cos(angle) * 115, y: center.y + Math.sin(angle) * 115 })
  }
  frame(30, true)
  assert.ok(hub.focusT > 0.99 && average() > 0.66 && average() < 0.76)
  engine.endNodeDrag()
  engine.move(cursor)
  frame(8)
  assert.equal(engine.hover, hub.key)
  assert.ok(hub.focusT > 0.99)
  engine.move(null)
  frame(180)
  const gap = Math.max(...angularGaps(hub.position, leaves.map(leaf => leaf.position)))
  assert.ok(gap < 1.2 && average() > 0.95)
  t.diagnostic('average ray length at 29px/frame: ' + (100 * draggedRatio).toFixed(1) + '%')
})

test('sparse pointer samples leave the short target unchanged while the hub stays captured', () => {
  const { engine, frame, hub } = independentHubs(true)
  const start = { ...hub.screen }
  engine.beginNodeDrag(hub, start)
  const leaf = engine.marks.get('far')
  for (let i = 1; i <= 12; i++) {
    engine.moveNodeDrag({ x: start.x + 16 * i, y: start.y })
    for (let j = 0; j < 4; j++) frame()
    assert.equal(hub.focusT, 1)
    assert.ok(Math.abs(leaf.targetDist / leaf.naturalDist - 0.65) < 1e-10)
  }
  for (let i = 0; i < 45; i++) frame()
  assert.equal(hub.focusT, 1)
  assert.ok(Math.abs(leaf.targetDist / leaf.naturalDist - 0.65) < 1e-10)
})

test('a soft tether settles stretched leaves without ringing or resetting their bearing', () => {
  const { cacheCanopies, stepOverview } = load(path.join(root, 'views/mes/graph/starFluid.ts'))
  const view = independentHubs(true)
  const hub = view.hub
  const leaf = view.engine.marks.get('far')
  hub.position = { x: 0, y: 0 }
  const groups = cacheCanopies(new Map([[hub.key, hub], [leaf.key, leaf]]))
  const frame = {
    seconds: 0, step: 1, zoom: 1, mouse: null, pointerFlow: { x: 0, y: 0 }, hotKey: null,
    dragGoal: null, still: true, bounds: { left: -900, right: 900, top: -900, bottom: 900 }
  }
  for (const [ratio, speed] of [[1.9, 0], [1.06, -20], [0.97, 16]]) {
    leaf.position = { x: leaf.naturalDist * ratio, y: 0 }
    leaf.velocity = { x: speed, y: 0 }
    for (let i = 0; i < 120; i++) {
      const error = leaf.position.x - leaf.naturalDist
      stepOverview(groups, { ...frame, step: [0.5, 1, 1.5][i % 3] })
      const updated = leaf.position.x - leaf.naturalDist
      assert.ok(Math.abs(updated) <= Math.abs(error) + 1e-9 && updated * error >= -1e-9)
    }
    assert.ok(Math.abs(leaf.position.x - leaf.naturalDist) < 1e-5)
  }
  const contracted = 0.76 * leaf.naturalDist
  leaf.position = { x: contracted + 35, y: 0 }
  leaf.velocity = { x: -22, y: 0 }
  for (let i = 0; i < 45; i++) {
    const before = leaf.position.x
    stepOverview(groups, { ...frame, hotKey: hub.key })
    assert.ok(leaf.position.x >= contracted - 1e-9 && leaf.position.x <= before + 1e-9)
  }
  assert.ok(Math.abs(leaf.position.x - contracted) < 0.01)
  leaf.position = { x: 0, y: leaf.naturalDist }
  leaf.velocity = { x: -3, y: 0 }
  for (let i = 0; i < 160; i++) stepOverview(groups, frame)
  assert.ok(bearing(leaf, hub) > Math.PI / 2 + 0.04)
  assert.ok(bearing(leaf, hub) < Math.PI / 2 + 0.2)
})

test('clusters make way across the real graph in both drawer sizes', (t) => {
  for (const [viewWidth, height, inset] of [[900, 620, 200], [230, 530, 250]]) {
    const { engine, frame, zoom } = fittedOverview(viewWidth, height, inset)
    frame(130)
    const a = engine.marks.get('category:part'), b = engine.marks.get('category:fault')
    const hubs = [...engine.marks.values()].filter(m => m.role === 'hub')
    const initial = new Map(hubs.map(hub => [hub.key, { ...hub.screen }]))
    const p = initial.get(a.key), q = initial.get(b.key)
    assert.ok(engine.beginNodeDrag(a, p))
    let minimumClearance = Infinity
    for (let i = 1; i <= 60; i++) {
      const cursor = { x: p.x + (q.x - p.x) * i / 60, y: p.y + (q.y - p.y) * i / 60 }
      engine.moveNodeDrag(cursor)
      frame(1, true)
      assert.ok(pointDistance(a.screen, cursor) < 1e-6)
      for (const other of hubs.filter(hub => hub !== a)) {
        minimumClearance = Math.min(minimumClearance,
          pointDistance(a.screen, other.screen) - (a.collideR + other.collideR) * zoom)
      }
    }
    const movement = pointDistance(b.screen, q)
    assert.ok(movement > Math.min(65, viewWidth / 9))
    if (viewWidth === 900) {
      assert.ok(minimumClearance > -1, 'ordinary viewport keeps the raw envelopes clear')
      assert.ok(hubs.filter(hub => hub !== a && pointDistance(hub.screen, initial.get(hub.key)) > 30).length >= 3)
    }
    engine.endNodeDrag()
    engine.move(null)
    frame(180)
    const gap = pointDistance(a.screen, b.screen)
    assert.ok(gap > Math.min(200, viewWidth / 3))
    const migrated = hubs.filter(hub => hub !== a && pointDistance(hub.screen, initial.get(hub.key)) > 30)
    assert.ok(migrated.length >= 2, 'clusters settle into new placements after the drop')
    for (const hub of hubs) {
      assert.ok(hub.screen.x >= 0 && hub.screen.x <= viewWidth)
      assert.ok(hub.screen.y >= 0 && hub.screen.y <= height)
    }
    t.diagnostic(viewWidth + 'px usable width: fault moved ' + movement.toFixed(1) +
      'px on impact, final center spacing ' + gap.toFixed(1) + 'px')
  }
})

test('a fast single sample sweeps intermediate centers before committing the release', () => {
  const { engine, frame, hub } = independentHubs(true)
  const neighbor = engine.marks.get('neighbor')
  const start = { ...hub.screen }
  const old = { ...neighbor.position }
  engine.beginNodeDrag(hub, start)
  engine.moveNodeDrag({ x: start.x + 500, y: start.y })
  engine.endNodeDrag()
  assert.ok(Math.abs(hub.position.x - (hub.x + 500)) < 1e-8)
  assert.ok(pointDistance(neighbor.position, old) > 45)
  frame()
  assert.ok(pointDistance(hub.position, neighbor.position) > 85)
})

test('an unpressed pointer influences nearby hubs and leaves without moving distant hubs', () => {
  const wind = flowerPhysics(), calm = flowerPhysics(), pressed = flowerPhysics()
  const center = { ...wind.hub.screen }
  for (let i = 0; i < 21; i++) {
    const cursor = { x: center.x - 115 + i * 10, y: center.y + 50 }
    wind.engine.pointer = cursor
    pressed.engine.pointer = cursor
    wind.frame()
    calm.frame()
    pressed.frame(true)
  }
  assert.ok(wind.hub.position.x - calm.hub.position.x > 10)
  assert.ok(wind.leaves.some((m, i) => pointDistance(m.position, calm.leaves[i].position) > 2))
  assert.deepEqual(pressed.hub.position, calm.hub.position)
  assert.deepEqual({ ...pressed.engine.mouseFlow }, { x: 0, y: 0 })
  assert.deepEqual(wind.engine.marks.get('x').position, calm.engine.marks.get('x').position)
  const speed = wind.engine.mouseFlow.x
  for (let i = 0; i < 60; i++) wind.frame()
  assert.ok(Math.abs(wind.engine.mouseFlow.x) < speed / 1000)
})

test('hub and leaf mouse forces fall to exactly zero at their screen-space cutoffs', () => {
  const { cacheCanopies, stepOverview } = load(path.join(root, 'views/mes/graph/starFluid.ts'))
  const view = independentHubs(true)
  function velocity(zoom, mouse) {
    const hub = { ...view.hub, x: 0, y: 0, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }
    const leaf = { ...view.engine.marks.get('far'), x: 650, y: 0,
      position: { x: 650, y: 0 }, velocity: { x: 0, y: 0 } }
    const groups = cacheCanopies(new Map([[hub.key, hub], [leaf.key, leaf]]))
    stepOverview(groups, {
      seconds: 2, step: 1, zoom, mouse, pointerFlow: { x: 16, y: 4 }, hotKey: null,
      dragGoal: null, still: false, bounds: { left: -900, right: 900, top: -900, bottom: 900 }
    })
    return [hub.velocity, leaf.velocity]
  }
  for (const zoom of [0.75, 1, 2]) {
    const calm = velocity(zoom, null)
    assert.deepEqual(velocity(zoom, { x: -240 / zoom, y: 0 }), calm)
    assert.deepEqual(velocity(zoom, { x: 650 + 170 / zoom, y: 0 }), calm)
    assert.deepEqual(velocity(zoom, { x: 380, y: 0 }), calm)
    const hubNear = velocity(zoom, { x: -40 / zoom, y: 0 })[0]
    const hubFar = velocity(zoom, { x: -160 / zoom, y: 0 })[0]
    const leafNear = velocity(zoom, { x: 650 + 40 / zoom, y: 0 })[1]
    const leafFar = velocity(zoom, { x: 650 + 130 / zoom, y: 0 })[1]
    assert.ok(hubNear.x - calm[0].x > 5 * (hubFar.x - calm[0].x))
    assert.ok(leafNear.x - calm[1].x > 5 * (leafFar.x - calm[1].x))
  }
})

test('a captured leaf stays at the cursor, towing its hub and moving neighbors on contact', () => {
  const view = flowerPhysics()
  view.engine.still = true
  const leaf = view.leaves[1], down = { ...leaf.screen }
  const neighbor = view.engine.marks.get('c'), before = { ...neighbor.position }
  const goal = { x: down.x + 295, y: down.y }
  assert.ok(view.engine.beginNodeDrag(leaf, down))
  view.engine.moveNodeDrag(goal)
  for (let i = 0; i < 100; i++) {
    view.frame(true)
    assert.ok(pointDistance(leaf.screen, goal) < 1e-6)
  }
  assert.ok(view.hub.position.x > 150)
  assert.ok(pointDistance(neighbor.position, before) > 25)
})

test('drilldown restores live overview positions and a refit retains the particles', () => {
  const { engine, frame, scene, hub } = independentHubs(true)
  const down = { ...hub.screen }
  engine.beginNodeDrag(hub, down)
  engine.moveNodeDrag({ x: down.x + 120, y: down.y + 40 })
  engine.endNodeDrag()
  frame()
  const saved = { ...hub.position }
  assert.ok(pointDistance(saved, { x: hub.x + 120, y: hub.y + 40 }) < 1e-8)
  engine.setScene({ overview: false, marks: new Map(), wires: new Map() }, 100)
  engine.setScene(scene, 200)
  frame()
  const restored = engine.marks.get('hub')
  assert.deepEqual({ ...restored.position }, saved)
  for (const mark of scene.marks.values()) mark.x *= 1.5
  engine.width = 1560
  engine.setScene(scene, 300, true)
  frame()
  assert.equal(engine.marks.get('hub'), restored)
  assert.deepEqual({ ...restored.position }, saved)
})
