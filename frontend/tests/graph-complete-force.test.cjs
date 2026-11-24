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
    const landed = hubs.map(m => engine.introLandings.get(m.key))
    const radius = Math.max(116, Math.min(view, height) * 0.19)
    assert.ok(landed.every(p => Math.hypot(p.x,p.y) * zoom >= radius - 0.001))
    if (view >= 2 * radius + 30) assert.ok(maxOverlap(m => engine.introLandings.get(m.key)) < 0.1)
    for (let i = 0; i < landed.length; i++)
      for (const p of landed.slice(i + 1)) assert.ok(pointDistance(p,landed[i]) * zoom > 20)
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
      const parent = scene.marks.get(m.parent), mark = scene.marks.get(m.key)
      const anchor = engine.introLandings.get(m.parent)
      assert.ok(Math.abs((p.x-anchor.x)-(mark.x-parent.x))<1e-7)
      assert.ok(Math.abs((p.y-anchor.y)-(mark.y-parent.y))<1e-7)
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
      const w = m.thumbnail ? m.thumbnail.width + 1 : m.role === 'hub' ? 11 : 4.2
      const h = m.thumbnail ? m.thumbnail.height + 1 : w
      return { x: m.screen.x-w/2, y:m.screen.y-h/2, w, h }
    })
    rects.push(...engine.targets.filter(target => !target.dot).map(target => target.box))
    const left = Math.min(...rects.map(r => r.x)), right = Math.max(...rects.map(r => r.x + r.w))
    const top = Math.min(...rects.map(r => r.y)), bottom = Math.max(...rects.map(r => r.y + r.h))
    const x = (right-left)/avail, y = (bottom-top)/height
    assert.ok(left >= 0 && right <= avail && top >= 0 && bottom <= height)
    assert.ok(x > 0.80 && x <= 1 && y > 0.80 && y <= 1)
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


test('22px background grid pulses stay sparse at every drawer width', () => {
  const { BlueParticles, AMBIENT_BLUE } = load(path.join(root, 'views/mes/graph/blueParticles.ts'))
  const field = new BlueParticles(), control = new BlueParticles()
  const w = 1396, h = 648
  const coord = p => p.x + '/' + p.y
  function sample(renderer, time, still = false, width = w, height = h, visibleWidth = width) {
    const dots = new Map()
    const ctx = { fillRect(x, y, size) {
      const dot = { x: x + size / 2, y: y + size / 2, size, color: this.fillStyle, a: this.globalAlpha }
      assert.ok(dot.color === AMBIENT_BLUE && dot.size >= 1.4 && dot.size <= 1.8)
      assert.ok(dot.x % 22 === 0 && dot.y % 22 === 0)
      assert.ok(!dots.has(coord(dot)), 'one paint per lattice point')
      dots.set(coord(dot), dot)
    } }
    renderer.draw(ctx, time, width, height, still, visibleWidth)
    return dots
  }
  assert.equal(AMBIENT_BLUE, '#4A80FF')
  sample(field, 0)
  const grid = field.lattice
  assert.equal(grid.dots.length, Math.ceil(w / 22) * Math.ceil(h / 22))
  const eligible = new Set(grid.bands.flatMap(band => band.members.map(i => coord(grid.dots[i]))))
  assert.ok(eligible.size / grid.dots.length > 0.06 && eligible.size / grid.dots.length < 0.10)
  assert.ok(grid.bands.every(band => band.period >= 6000 && band.period <= 13000))
  const peaks = new Map()
  for (let t = 0; t <= 13500; t += 50) {
    const idle = sample(control, t)
    assert.ok(idle.size >= 12 && idle.size <= 22, 'visible idle points: ' + idle.size)
    for (const [key, p] of idle) {
      assert.ok(eligible.has(key))
      assert.ok(p.a > 0 && p.a <= 0.56)
      peaks.set(key, Math.max(peaks.get(key) || 0, p.a))
    }
  }
  assert.equal(peaks.size, eligible.size)
  assert.ok([...peaks.values()].every(peak => peak > 0.41))

  const wideIdle = sample(field, 53000, false, 2560, 1440)
  assert.ok(wideIdle.size >= 12 && wideIdle.size <= 22)
  const narrow = new BlueParticles()
  for (let ms = 0; ms <= 13000; ms += 100) {
    const frame = sample(narrow, ms, false, 561, 660, 304)
    assert.ok(frame.size >= 12 && frame.size <= 22)
    assert.ok([...frame.values()].every(dot => dot.x < 304))
  }
  const settledLattice = narrow.lattice
  sample(narrow, 14000, false, 561, 660, 561)
  assert.equal(narrow.lattice, settledLattice)
})

test('mouse travel leaves fixed microstars and sparse four-point glints that disappear in 520ms', () => {
  const { BlueParticles, AMBIENT_BLUE } = load(path.join(root, 'views/mes/graph/blueParticles.ts'))
  const field = new BlueParticles(), control = new BlueParticles()
  function paint(renderer, now, still = false, visibleWidth = 680) {
    const ambient = [], dots = [], arms = []
    let arc = null
    const grad = () => ({addColorStop(){}})
    const ctx = new Proxy({
      globalAlpha:1, createRadialGradient:grad,createLinearGradient:grad,
      beginPath(){arc = null},
      arc(x,y,r){arc={x,y,r}},
      fill(){if(arc) dots.push({...arc,tint:this.fillStyle,alpha:this.globalAlpha}); else arms.push(this.globalAlpha)},
      fillRect(x,y,w,h){if(this.fillStyle===AMBIENT_BLUE) ambient.push([x,y,w,h,this.globalAlpha])}
    },{get:(o,k)=>o[k]??(()=>{})})
    renderer.draw(ctx,now,680,390,still,visibleWidth)
    return {ambient,dots,arms}
  }
  const start = 1000
  for (const dx of [0,3,6,11,84]) field.trace({x:100+dx,y:120},start+dx)
  assert.equal(field.trail.length,16)
  for (let i=0;i<8;i++) {
    for (const star of field.trail.slice(i*2,i*2+2)) {
      assert.equal(star.born,start+i*12)
      assert.ok(Math.hypot(star.x-(100+i*12),star.y-120)<17.01)
    }
  }
  const a=paint(field,1110),b=paint(field,1280)
  assert.deepEqual(a.ambient,paint(control,1110).ambient)
  assert.deepEqual(a.dots.map(p=>[p.x,p.y]),b.dots.map(p=>[p.x,p.y]))
  assert.equal(a.dots.filter(p=>p.tint==='#FFFFFF').length,2)
  assert.equal(a.arms.length,8)
  assert.ok(a.dots.every((p,i)=>p.alpha>b.dots[i].alpha && ['#EAF3FF','#9AC4FF','#FFF0D2','#FFFFFF'].includes(p.tint)))
  assert.ok(paint(field,1200,false,150).dots.every(p=>p.x<150))
  assert.deepEqual(paint(field,1250,true),paint(control,8500,true))
  field.trace({x:184,y:120},1720)
  assert.deepEqual(paint(field,1720),paint(control,1720))
  field.trace(null,1800);field.trace({x:420,y:160},1820)
  assert.equal(field.trail.length,2)
  assert.ok(field.trail.every(s=>s.x>400))
  field.trace({x:8000,y:160},1830)
  assert.ok(field.trail.length<=160)
})

test('overview paints a thin ambient layer, reveals cool-grey leaf paths, and clears stale labels', () => {
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
  let arc, start, end, insideCard
  function gradient(x, y, x2, y2) {
    return { x, y, x2, y2, stops: [], addColorStop(i, color) { this.stops.push([i, color]) } }
  }
  const ctx = new Proxy({
    createLinearGradient: gradient, createRadialGradient: gradient,
    translate() { insideCard = true }, restore() { insideCard = false },
    beginPath() { arc = null; start = null; end = null },
    moveTo(x, y) { start = { x, y } },
    arc(x, y, r) { arc = { x, y, r } },
    lineTo(x, y) { end = { x, y } },
    fill() { if (arc) fills.push({ ...arc, color: this.fillStyle, alpha: this.globalAlpha }) },
    fillRect(x, y, w, h) { fills.push({ x: x + w / 2, y: y + h / 2, w, h, color: this.fillStyle, insideCard }) },
    strokeRect() { strokes.push({ border: !!insideCard, ink: this.strokeStyle, width: this.lineWidth }) },
    stroke() { strokes.push({ start, end, arc, ink: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, insideCard }) },
    measureText: word => ({ width: word.length * 8 }),
    fillText(word) { captions.push({ word, font: this.font, color: this.fillStyle }) }
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

  const channels = css => {
    if (css.startsWith('#')) {
      const rgb = [1, 3, 5].map(i => parseInt(css.slice(i, i + 2), 16))
      return [...rgb, css.length > 7 ? parseInt(css.slice(7, 9), 16) / 255 : 1]
    }
    return css.slice(5, -1).split(',').map(Number)
  }
  function tone(css, expected) {
    const actual = channels(css)
    assert.deepEqual(actual.slice(0, 3), expected.slice(0, 3))
    assert.ok(Math.abs(actual[3] - expected[3]) <= 1 / 255)
  }
  const stop = (stroke, offset) => stroke.ink.stops.find(([t]) => t === offset)[1]
  const ring = () => strokes.find(f => f.arc && Math.abs(f.arc.r - 5.5) < 1e-6)

  frame(1501)
  const styles = ['设备','部件','故障','工艺','措施','手册','原因','规则库'].map(liveTheme)
  assert.equal(new Set(styles.map(t => t.hub)).size, 1)
  assert.equal(new Set(styles.map(t => t.dot)).size, 1)
  assert.equal(styles.filter(t => t.wave[0][1] === 218).length, 3)
  assert.equal(styles.filter(t => t.wave[0][2] === 255).length, 5)
  assert.equal(hub('A').color, '#4372FF')
  assert.equal(hub('B').color, '#4372FF')
  close(dot('one').r, 2.1)
  assert.equal(dot('one').color, '#4D86FF')
  close(dot('one').alpha, 1)
  const blueSpoke = strokes.find(f => near(f.start, at('B')) && near(f.end, at('three')))
  for (const [ray, colors] of [
    [spoke(), [[28,218,178,.84], [28,154,190,.56], [50,96,220,.38]]],
    [blueSpoke, [[46,158,255,.86], [44,110,240,.58], [52,86,212,.38]]]
  ]) {
    for (const [i, t] of [0, .48, 1].entries()) tone(stop(ray, t), colors[i])
    close(ray.width, .95)
    close(ray.alpha, 1)
  }
  tone(stop(trunk(), 0), [54,102,230,.36])
  tone(stop(trunk(), 1), [76,138,255,.62])
  close(trunk().width, .95)
  tone(ring().ink, [112,148,228,.36])
  close(ring().width, .9)
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
  const waves = strokes.filter(f => f.ink?.stops?.length > 3)
  assert.equal(waves.length, 4, 'four visible spokes each submit exactly one full gradient stroke')
  assert.ok(waves.every(f => f.width === 0.95 && f.alpha === 1))
  for (const ray of waves) {
    const blue = near(ray.end, at('three'))
    const colors = ray.ink.stops.map(([, css]) => channels(css))
    const peak = blue ? [106,198,255,.88] : [70,245,202,.84]
    assert.ok(colors.some(color => color.every((value, i) => value === peak[i])))
    assert.ok(colors.every(([r,g,b,a]) => r <= 106 && g <= 245 && b <= 255 && a >= .38 && a <= .88))
  }
  e.still = true
  frame(1510)

  e.move({ ...at('A') })
  frame(1520)
  const leaf = e.marks.get('one')
  close(leaf.targetDist / leaf.naturalDist, 1 - (0.24 + leaf.distNorm * 0.11))
  close(dot('one').r, 3.3); close(dot('two').r, 3.3); close(dot('three').r, 2.1)
  assert.equal(dot('one').color, '#020518')
  assert.equal(hub('A').color, '#34F5A4')
  const glow = fills.find(f => near(f, at('A')) && f.color?.stops)
  close(glow.w / 2, 2.6 * hub('A').w)
  tone(glow.color.stops[0][1], [52, 245, 164, .52])
  tone(glow.color.stops.at(-1)[1], [52, 245, 164, 0])
  tone(ring().ink, [110,215,185,.52])
  close(ring().width, .9)
  for (const line of [spoke(), trunk()]) {
    tone(stop(line, 0), [56,248,174,.90])
    tone(stop(line, 1), [38,190,134,.52])
  }
  const familyRim = strokes.find(f => near(f.arc, at('one')))
  close(familyRim.width, 0.9)
  tone(familyRim.ink, [196,224,236,.72])
  close(spoke().width, 0.95); close(trunk().width, 0.95)
  close(cross.alpha, 0)
  close(e.marks.get('B').light, 0.64)
  assert.ok(captions.find(c => c.word === 'A').font.includes('21px'))

  e.move({ ...at('one') })
  frame(1600)
  close(dot('one').r, 3.8)
  close(dot('two').r, 2.1); close(dot('three').r, 2.1)
  const rim = strokes.find(f => near(f.arc, at('one')))
  close(rim.width, 0.9)
  tone(rim.ink, [196,224,236,.72])
  assert.equal(dot('three').color, '#FFFFFF')
  tone(spoke().ink, [208,224,248,.56])
  close(spoke().width, 0.85)
  const revealed = () => strokes.find(f => f.ink !== 'rgba(66, 108, 218, 0.12)' && near(f.end, at('three')) && near(f.start, at('one')))
  close(revealed().width, 0.85)
  tone(revealed().ink, [208,224,248,.56])
  const neighborCaption = captions.find(c => c.word === 'three')
  assert.match(neighborCaption.font, /^400 11px /)
  tone(neighborCaption.color, [242,247,255,.92])
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
  assert.ok(e.beginNodeDrag({ key: 'one', role: 'leaf' }, at('one')))
  e.moveNodeDrag({ x: -100, y: at('one').y })
  frame(2200)
  assert.ok(at('one').x < 0, 'the captured leaf is outside the visible canvas')
  assert.ok(captions.every(c => c.word !== 'one'))
  e.endNodeDrag(false)
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
  for (const [key, x, parent] of [['A', -200, ''], ['item', -85, 'A'], ['B', 155, '']]) {
    marks.set(key, {
      key, role: parent ? 'leaf' : 'hub', x, y: -172, parent, count: 1, order: 0, seed: 0.21,
      color: '#509AFF', entity: { id: key, name: parent ? 'part-123' : key, kind: '部件' }
    })
  }
  const wires = new Map([['A/item', { key: 'A/item', a: 'A', b: 'item', kind: 'spoke', label: '' }]])
  graph.setScene({ marks, wires, overview: true }, 0)
  graph.draw(ctx, 100, 1)
  const other = graph.marks.get('B')
  assert.equal(graph.hit(other.screen).id, 'B')
  graph.move({ ...graph.marks.get('item').screen })
  graph.draw(ctx, 120, 1)
  const { box } = graph.targets.find(t => !t.dot && t.hit.id === 'item')
  const under = { x:box.x + box.w/2, y:box.y + box.h/2 }
  other.position = { x:under.x-350, y:under.y-225 }
  graph.draw(ctx, 130, 1)
  assert.ok(pointDistance(other.screen,under)<1e-6)
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
  // Give the hub a repeatable outgoing velocity, independent of the center-clear layout.
  engine.marks.get(hub.key).velocity.x = 12
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

test('a 44% cosine-squared highlight travels smoothly in both directions over each radial gradient', () => {
  const { makeFlow, waveInk, liveTheme } = load(path.join(root, 'views/mes/graph/starInk.ts'))
  const from = { x: 0, y: 10 }, to = { x: 100, y: 10 }
  const ctx = { createLinearGradient(x, y, x2, y2) {
    assert.deepEqual([x, y, x2, y2], [0, 10, 100, 10])
    return { stops: [], addColorStop(t, ink) { this.stops.push([t, ink]) } }
  } }
  const clock = { phase: 0, speed: .125 }
  const close = (a,b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' vs ' + b)
  const channels = css => css.slice(5, -1).split(',').map(Number)
  for (const [kind, rootTone, middle, tip, crest] of [
    ['部件', [28,218,178,.84], [28,154,190,.56], [50,96,220,.38], [70,245,202,.84]],
    ['故障', [46,158,255,.86], [44,110,240,.58], [52,86,212,.38], [106,198,255,.88]]
  ]) {
    const brush = (time, layer = 'spoke', family = 0, single = 0, still = false) =>
      waveInk(ctx, clock, from, to, time, liveTheme(kind), layer, family, single, still)
    const sample = (gradient, t) => channels(gradient.stops.find(([p]) => Math.abs(p - t) < 1e-8)[1])
    const midpoint = brush(2)
    const blend = (a,b,w) => a.map((value,i) => value + w * (b[i] - value))
    function base(t) {
      return t < .48 ? blend(rootTone, middle, t / .48) : blend(middle, tip, (t - .48) / .52)
    }
    for (const t of [0, .28, .335, .39, .445, .48, .5, .555, .61, .665, .72, 1]) {
      const distance = Math.abs(t - .5) / .22
      const strength = distance < 1 ? Math.cos(Math.PI / 2 * distance) ** 2 : 0
      const expected = blend(base(t), crest, strength)
      for (const [i, channel] of sample(midpoint, t).entries()) {
        assert.ok(Math.abs(channel - expected[i]) <= (i === 3 ? .00051 : .501))
      }
    }
    for (const [i, t] of [0,2,4,6,8].entries()) {
      const peak = brush(t).stops.find(([,ink]) => channels(ink).every((v,k) => v === crest[k]))
      close(peak[0], [0,.5,1,.5,0][i])
    }
    assert.deepEqual(sample(brush(2, 'trunk', 1), .5), [83,249,181,.92])
    assert.deepEqual(channels(brush(2, 'relation', 0, 1)), [208,224,248,.56])
    for (const [i, t] of [0,.48,1].entries()) {
      assert.deepEqual(sample(brush(2, 'spoke', 0, 0, true), t), [rootTone,middle,tip][i])
    }
  }
  const flows = Array.from({length: 100}, (_, i) => makeFlow('edge/' + i))
  assert.ok(flows.every(f => f.speed >= .12 && f.speed <= .16))
  assert.ok(new Set(flows.map(f => f.phase)).size > 90)
  assert.deepEqual(makeFlow('edge/12'), flows[12])
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
  const frame = { step: 1, seconds: 2.1, zoom: 1, bounds: { left: -900, right: 900, top: -600, bottom: 600 },
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

test('a captured canopy follows the 07–12 tether on acceleration, a turn, and a sudden stop', () => {
  const { cacheCanopies, stepOverview }=load(path.join(root,'views/mes/graph/starFluid.ts'))
  const sample=independentHubs(true)
  const hub={...structuredClone(sample.hub),x:-360,y:-140,position:{x:-360,y:-140},velocity:{x:0,y:0},focusT:1}
  const leaf={...structuredClone(sample.engine.marks.get('far')),x:-280,y:-140,
    position:{x:-299.2,y:-140},velocity:{x:0,y:0},bearing:0}
  const groups=cacheCanopies(new Map([[hub.key,hub],[leaf.key,leaf]]))
  const frame={step:1,seconds:0,zoom:1,mouse:null,pointerFlow:{x:0,y:0},hotKey:hub.key,
    held:hub,dragGoal:{...hub.position},still:true,bounds:{left:-900,right:900,top:-600,bottom:600}}
  // Recorded in the 07–12 version, away from a wall. Each sample includes both world coordinates.
  const samples=[
    [10,0,-293.8775510,-140],[10,0,-285.4577259,-140],
    [0,9,-281.3174575,-139.6550635],[-7,4,-283.0207377,-138.4813369],
    [0,0,-284.1926475,-137.6286640],[0,0,-284.9992655,-137.0079404]
  ]
  for(const [dx,dy,x,y] of samples){
    frame.seconds+=1/60
    frame.dragGoal={x:hub.position.x+dx,y:hub.position.y+dy}
    stepOverview(groups,frame)
    assert.ok(Math.hypot(leaf.position.x-x,leaf.position.y-y)<1e-6)
  }
  const stopped={...leaf.position}
  frame.seconds+=1/60
  stepOverview(groups,{...frame,held:undefined,hotKey:null,dragGoal:null,still:false})
  assert.ok(leaf.position.x<stopped.x && leaf.position.y>stopped.y,'release retains outgoing motion')
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
    }
    engine.endNodeDrag()
    engine.move(null)
    frame(180)
    const gap = pointDistance(a.screen, b.screen)
    assert.ok(gap > Math.min(200, viewWidth / 3))
    const migrated = hubs.filter(hub => hub !== a && pointDistance(hub.screen, initial.get(hub.key)) > 30)
    assert.ok(migrated.includes(b), 'the impacted cluster keeps its new position after release')
    for (const hub of hubs) {
      assert.ok(hub.screen.x >= 0 && hub.screen.x <= viewWidth)
      assert.ok(hub.screen.y >= 0 && hub.screen.y <= height)
    }
    if (viewWidth === 900) {
      // Follow a route through three known clusters instead of assuming the opening puts them on a line.
      assert.ok(engine.beginNodeDrag(a, {...a.screen}))
      for (const kind of ['process', 'equipment', 'manual']) {
        const neighbor = engine.marks.get('category:' + kind)
        const from = {...a.screen}, to = {...neighbor.screen}
        for (let i=1; i<=45; i++) {
          engine.moveNodeDrag({x:from.x+(to.x-from.x)*i/45, y:from.y+(to.y-from.y)*i/45})
          frame(1,true)
        }
        assert.ok(pointDistance(neighbor.screen,to) > 30, kind + ' moves when crossed')
      }
      engine.endNodeDrag()
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
    const hub = { ...view.hub, x: -320, y: 360, position: { x: -320, y: 360 }, velocity: { x: 0, y: 0 } }
    const leaf = { ...view.engine.marks.get('far'), x: 330, y: 360,
      position: { x: 330, y: 360 }, velocity: { x: 0, y: 0 } }
    const groups = cacheCanopies(new Map([[hub.key, hub], [leaf.key, leaf]]))
    stepOverview(groups, {
      seconds: 2, step: 1, zoom, mouse: mouse && { x: mouse.x - 320, y: mouse.y + 360 }, pointerFlow: { x: 16, y: 4 }, hotKey: null,
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
  engine.moveNodeDrag({ x: down.x - 75, y: down.y + 40 })
  engine.endNodeDrag()
  frame()
  const saved = { ...hub.position }
  assert.ok(pointDistance(saved, { x: down.x - (engine.width-engine.sidebarInset)/2 - 75, y: down.y - engine.height/2 + 40 }) < 1e-8)
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

test('dragging to an edge keeps the same free leaf and card bearings as dragging in open space', () => {
  const {cacheCanopies,stepOverview}=load(path.join(root,'views/mes/graph/starFluid.ts'))
  const sample=independentHubs(true)
  const directions=[[1,0],[0,1],[-1,0],[0,-1]]
  function pose(x,y) {
    const hub={...structuredClone(sample.hub),x,y,position:{x,y},velocity:{x:0,y:0},focusT:1}
    const leaves=directions.map(([dx,dy],i)=>{
      const lx=x+dx*60,ly=y+dy*60
      return {...structuredClone(sample.engine.marks.get('far')),key:'node'+i,x:lx,y:ly,
        role:'leaf',parent:hub.key,position:{x:lx,y:ly},velocity:{x:0,y:0},
        thumbnail:i%2?undefined:{width:22,height:15}}
    })
    const groups=cacheCanopies(new Map([hub,...leaves].map(m=>[m.key,m])))
    const f={step:1,zoom:1,mouse:null,pointerFlow:{x:0,y:0},held:hub,dragGoal:{x,y},still:true,
      hotKey:hub.key,bounds:{left:-400,right:400,top:-300,bottom:300}}
    for(let i=0;i<50;i++) stepOverview(groups,{...f,seconds:i/60})
    assert.deepEqual(hub.position,{x,y})
    return leaves.map(m=>[m.position.x-x,m.position.y-y])
  }
  const open=pose(160,0)
  for(const [x,y] of [[-418,0],[418,0],[0,-318],[0,318]]) {
    const atEdge=pose(x,y)
    atEdge.forEach(([dx,dy],i)=>{
      assert.ok(Math.hypot(dx-open[i][0],dy-open[i][1])<1e-7)
      assert.ok(dx*directions[i][0]+dy*directions[i][1]>35)
    })
  }
})

test('a dragged hub can leave the visible canvas and release still clears the middle', () => {
  const {engine,frame}=fittedOverview(920,620,260)
  frame(30)
  const hub=engine.marks.get('category:part')
  engine.beginNodeDrag(hub,{...hub.screen})
  for (const point of [{x:-50,y:280},{x:970,y:280},{x:535,y:-50},{x:535,y:680},{x:460,y:310}]) {
    engine.moveNodeDrag(point)
    frame(1,true)
    assert.ok(pointDistance(hub.screen,point)<1e-6)
    for(const m of engine.marks.values()) {
      if (m.role==='hub' && m!==hub) assert.ok(Math.hypot(m.screen.x-460,m.screen.y-310)>=.92*620*.19-1e-6)
    }
  }
  engine.endNodeDrag()
  frame()
  assert.ok(Math.hypot(hub.screen.x-460,hub.screen.y-310)>=.92*620*.19-1e-7)
})

test('zooming out on a narrow canvas keeps the central opening in screen pixels', () => {
  for (const [width,height] of [[230,530],[450,240],[160,260]]) {
    const {engine,frame}=fittedOverview(width,height,180)
    engine.still=true
    for (const zoom of [1,.55,.35,1]) {
      engine.pose.zoom=engine.goal.zoom=zoom
      frame(3)
      for (const m of engine.marks.values()) {
        if (m.live && m.role==='hub')
          assert.ok(Math.hypot(m.screen.x-width/2,m.screen.y-height/2)>=.92*Math.max(116,Math.min(width,height)*.19)-1e-6)
      }
    }
  }
})

test('leaf hover keeps the original outline on the live dot without pinning its family', () => {
  const {engine, frame} = fittedOverview()
  frame(40)
  const leaf = [...engine.marks.values()].find(m => m.role === 'leaf' && !m.thumbnail && engine.hit(m.screen)?.key === m.key)
  const hub = engine.marks.get(leaf.parent)
  let arc, ring, clock = engine.last
  const gradient = () => ({addColorStop(){}})
  const ctx = new Proxy({
    measureText:s=>({width:s.length*8}), createLinearGradient:gradient, createRadialGradient:gradient,
    beginPath(){arc=null}, arc(x,y,r){arc={x,y,r}},
    stroke(){if(arc && this.strokeStyle==='rgba(196, 224, 236, 0.72)' && pointDistance(arc,leaf.screen)<1e-5) ring=arc.r}
  }, {get:(obj,key)=>obj[key]??(()=>{})})
  for (let i=0; i<50; i++) {
    engine.move({...leaf.screen})
    assert.equal(engine.hover,leaf.key)
    ring=undefined
    engine.draw(ctx,clock+=1000/60,1)
    assert.equal(leaf.pin,undefined)
    assert.equal(hub.pin,undefined)
    const familyRadius = 2.1 + 1.2 * hub.focusT
    const expected = familyRadius + (3.8 - familyRadius) * leaf.leafFocusT
    assert.ok(Math.abs(ring-expected)<1e-8)
  }
})

test('fixed dust and four-point stars twinkle independently below the graph and freeze under reduced motion', () => {
  const {Starfield}=load(path.join(root,'views/mes/graph/blueParticles.ts'))
  const sky=new Starfield()
  function render(t,visible=960,still=false) {
    const dots=[],wings=[]
    let arc=null
    const gradient=()=>({addColorStop(){}})
    const ctx=new Proxy({
      createLinearGradient:gradient,createRadialGradient:gradient,
      beginPath(){arc=null},arc(x,y,r){arc={x,y,r}},
      fill(){if(arc)dots.push({...arc,ink:this.fillStyle,alpha:this.globalAlpha}); else wings.push(this.globalAlpha)}
    },{get:(o,k)=>o[k]??(()=>{})})
    sky.draw(ctx,t,1200,680,visible,still)
    return {dust:dots.filter(p=>p.ink!=='#FFFFFF'),flares:dots.filter(p=>p.ink==='#FFFFFF'),wings}
  }
  const base=render(0), later=render(734), coord=p=>p.x+','+p.y
  assert.equal(base.dust.length,100)
  assert.equal(base.flares.length,20)
  assert.deepEqual(base.dust.map(coord),later.dust.map(coord))
  assert.deepEqual(base.flares.map(coord),later.flares.map(coord))
  assert.ok(base.dust.every(p=>p.r*2>=.85&&p.r*2<=1.6&&p.alpha>=.08&&p.alpha<=.72))
  assert.deepEqual(['#EAF3FF','#9AC4FF','#FFF0D2'].map(c=>base.dust.filter(p=>p.ink===c).length),[60,30,10])
  assert.ok(base.dust.filter((p,i)=>Math.abs(p.alpha-later.dust[i].alpha)>.04).length>30)
  const bright=[]
  for(let s=0;s<60;s++) {
    const {flares,wings}=render(s*1000)
    bright.push(flares.filter(p=>p.alpha>.28).length)
    assert.equal(wings.length%4,0)
  }
  assert.ok(bright.filter(n=>n>=3&&n<=6).length>=45)
  assert.deepEqual(render(500,960,true),render(7500,960,true))
  const narrow=render(900,220)
  const present=new Set(narrow.dust.map(coord))
  assert.ok(base.dust.filter(p=>p.x<220).every(p=>present.has(coord(p))))
})
