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
const { seedPositions, FORCE_PARAMS } = load(path.join(root,'views/mes/graph/forceLayout.ts'))
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
