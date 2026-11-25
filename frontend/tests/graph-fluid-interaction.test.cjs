const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { compileScript, compileTemplate, parse } = require('vue/compiler-sfc')

const directory = path.join(__dirname, '../src/views/mes/graph')
const full = require('../../database/graph/equipment-knowledge.json')
const lifecycle = { ...vue, onMounted() {}, onActivated() {}, onDeactivated() {}, onBeforeUnmount() {} }

function evaluate(source, filename, dependencies) {
  const module = { exports: {} }
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(js, {
    module, exports: module.exports, require(name) {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected import: ' + name)
      return dependencies[name]
    }, window: { matchMedia: () => ({ matches: true }) }, Element: class {}
  }, { filename })
  return module.exports
}

function setup(t, name, props, deps) {
  const filename = path.join(directory, name + '.vue')
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, id: name, filename }).errors, [])
  const component = evaluate(compileScript(descriptor, { id: name }).content, filename, {
    vue: lifecycle, ...deps
  }).default
  const scope = vue.effectScope()
  const events = []
  const state = scope.run(() => component.setup(props, {
    expose() {},
    emit(name, ...args) {
      events.push([name, ...args])
    }
  }))
  t.after(() => scope.stop())
  return { state, events }
}

function canvasRig(t, role, selected = null) {
  const calls = []
  const target = role ? { key: 'object', id: 'object', role } : null
  const props = vue.shallowReactive({ selected, explore: true, trail: [], full })
  const { state, events } = setup(t, 'GalaxyCanvas', props, {
    './starScene': { graphIndex: () => ({}) }
  })
  // Use the actual SFC entry points and replace only the engine's input boundary.
  Object.assign(state.engine, {
    width: 900, height: 600, hit: () => target, tracePointer() {}, move() {}, select() {}, endNodeDrag() {},
    beginNodeDrag(hit) { calls.push('start ' + hit.role); return true },
    moveNodeDrag() { calls.push('move node') },
    zoomBy(factor) { calls.push(factor) }
  })
  state.canvasRef.value = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    setPointerCapture() {}, style: {}
  }
  function pointer(x, time) {
    return { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0,
      clientX: x, clientY: 30, timeStamp: time }
  }
  function gesture(time, distance) {
    state.onPointerDown(pointer(40, time))
    state.onPointerMove(pointer(40 + distance, time + 20))
    state.onPointerUp(pointer(40 + distance, time + 40))
  }
  return { gesture, events, calls, state, pointer }
}

test('wheel direction alone sets the zoom factor at opposite canvas corners', t => {
  const { state, calls } = canvasRig(t, null)
  for (const corner of [0, 899]) {
    state.onWheel({ clientX: corner, clientY: corner ? 598 : 0, deltaY: -100, deltaMode: 0 })
    state.onWheel({ clientX: corner, clientY: corner ? 598 : 0, deltaY: 3, deltaMode: 1 })
    state.onWheel({ deltaY: 0 })
  }
  assert.deepEqual(calls, [1.12, 0.89, 1.12, 0.89])
})

for (const role of ['hub', 'leaf', 'neighbor', 'mini']) {
  test('five pixels of movement drags only the ' + role + ' and suppresses the release click', (t) => {
    const rig = canvasRig(t, role, role === 'hub' || role === 'leaf' ? null : 'active')
    rig.gesture(0, 5)
    assert.deepEqual(rig.calls, ['start ' + role, 'move node'])
    assert.deepEqual(rig.events, [])
    rig.gesture(200, 4.9)
    assert.deepEqual(rig.events, [['select', 'object']])
  })
}

test('blank drags hold the focus center and a blank click returns to the panorama', (t) => {
  const overview = canvasRig(t, null)
  overview.gesture(0, 18)
  overview.gesture(400, 0)
  assert.deepEqual(overview.calls, [])
  assert.deepEqual(overview.events, [])
  const radial = canvasRig(t, null, 'active')
  radial.gesture(0, 18)
  radial.gesture(400, 0)
  assert.deepEqual(radial.calls, [])
  assert.deepEqual(radial.events, [['clear']])
  const core = canvasRig(t, 'center', 'active')
  core.gesture(0, 16)
  core.gesture(200, 0)
  assert.deepEqual(core.calls, [])
  assert.deepEqual(core.events, [['detail']])
})

test('a sub-five-pixel out-and-back is a drag when its accumulated path exceeds five', (t) => {
  const { state, pointer, calls, events } = canvasRig(t, 'leaf')
  state.onPointerDown(pointer(40, 10))
  state.onPointerMove(pointer(43, 20))
  state.onPointerUp(pointer(40, 30))
  assert.deepEqual(events, [])
  assert.ok(calls.includes('start leaf'))
})

test('coalesced motion and a cancelled pointer never open an entity', (t) => {
  const { state, pointer, events, calls } = canvasRig(t, 'hub')
  state.onPointerDown(pointer(40, 10))
  state.onPointerMove({ ...pointer(40, 25), getCoalescedEvents: () => [pointer(43, 20)] })
  state.onPointerUp(pointer(40, 30))
  state.onPointerDown(pointer(40, 200))
  state.onPointerCancel(pointer(40, 210))
  state.onPointerUp(pointer(40, 220))
  assert.ok(calls.includes('start hub'))
  assert.deepEqual(events, [])
})

const categoryFile = path.join(directory, 'categoryGraph.ts')
const category = evaluate(fs.readFileSync(categoryFile, 'utf8'), categoryFile, {})
function panelRig(t) {
  const { state } = setup(t, 'KnowledgeGraph', {}, {
    '@/api/mes/assistant': {}, '@/api/mes/graph': {}, './GalaxyCanvas.vue': {},
    './categoryGraph': category, './loadCompleteGraph': {}, './useGraphLaunch': { useGraphLaunch: () => ({}) }
  })
  state.complete.value = full
  state.model.value = category.buildCategoryGraph(full, [])
  state.activateView('overview')
  return state
}

test('select opens a category or a real leaf with all original source evidence', (t) => {
  const state = panelRig(t)
  const overview = state.graph.value
  const members = state.model.value.categories.get('category:part').members
  const leaf = members.find(entity => !state.byId.value.has(entity.id))
  assert.ok(leaf)
  state.pick('category:part')
  assert.equal(state.selectedId.value, 'category:part')
  assert.equal(state.filtered.value, members)
  state.pick(leaf.id)
  assert.equal(state.selected.value.id, leaf.id)
  assert.equal(state.trail.value.length, 2)
  const shownEdges = [...state.groups.value.values()].flat()
  const original = full.relations.filter(edge => edge.source === leaf.id || edge.target === leaf.id)
  assert.ok(original.length > 0)
  assert.deepEqual(new Set(shownEdges), new Set(original))
  assert.ok(shownEdges.every(edge => edge.sourceEvidence.excerpt))
  state.goBack()
  assert.equal(state.selectedId.value, 'category:part')
  state.pick(leaf.id)
  state.onKeyDown({ key: 'Escape' })
  assert.equal(state.selectedId.value, null)
  assert.equal(state.graph.value, overview)
})

test('empty category opens, unknown picks are ignored and switching modes clears the selection', (t) => {
  const state = panelRig(t)
  state.pick('category:rules')
  state.pick('unknown-id')
  assert.equal(state.selectedId.value, 'category:rules')
  assert.equal(state.filtered.value.length, 0)
  state.activateView('full')
  assert.equal(state.selectedId.value, null)
  assert.equal(state.trail.value.length, 0)
})

test('radial layouts share every overview card and fit 65 measured captions in both hover states', t => {
  const file = path.join(directory, 'starScene.ts')
  const scene = evaluate(fs.readFileSync(file, 'utf8'), file, { './categoryGraph': category })
  const graph = { nodes: [...full.nodes], relations: full.relations }
  for (let i = 0; i < 30; i++) graph.nodes.push({
    id: 'layout-part-' + i, name: '传动装置滚动轴承定位组件 ' + i, kind: '部件', description: ''
  })
  const data = scene.graphIndex(category.buildCategoryGraph(graph, []), graph, true)
  const { state } = setup(t, 'GalaxyCanvas', { selected: null, full: graph, explore: true, trail: [] },
    { './starScene': scene })
  const engine = state.engine
  const ctx = { measureText: text => ({ width: [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 11.5 : 6), 0) }) }
  const overview = scene.buildScene(data, null, undefined, 1000, 720)
  engine.prepareAtlas(data, overview)
  engine.setScene(overview, 0, false, 1, 1000)
  const cards = [...engine.marks.values()].filter(m => m.parent === 'category:part' && m.thumbnail)
  assert.ok(cards.length > 0)
  for (const width of [1000, 752, 200]) {
    const route = ['category:part']
    const radial = engine.focusScene(data, route, width, 720, ctx)
    const leaves = [...radial.marks.values()].filter(m => m.role === 'neighbor')
    assert.equal(leaves.length, 65)
    for (const scale of [1, 0.9]) {
      const boxes = leaves.map(m => {
        const c = m.caption
        assert.ok(c.lines.length >= 1 && c.lines.length <= 2)
        return { x: m.x * scale + c.dx, y: m.y * scale + c.dy, w: c.w, h: c.h }
      })
      for (const [i, a] of boxes.entries()) {
        assert.ok(a.x >= -width / 2 && a.x + a.w <= width / 2 && a.y >= -360 && a.y + a.h <= 360)
        assert.ok(boxes.slice(i + 1).every(b => a.x + a.w <= b.x || b.x + b.w <= a.x ||
          a.y + a.h <= b.y || b.y + b.h <= a.y), 'overlap at ' + width + 'px and contraction ' + scale)
      }
    }
    engine.setScene(radial, 50, true, 1, width, route)
    for (const card of cards) assert.equal(engine.marks.get(card.key).thumbnail, card.thumbnail)
  }
  const route = ['category:part', 'compressor-part-2']
  const subgraph = engine.focusScene(data, route, 1000, 720, ctx)
  const parent = subgraph.marks.get(route[0])
  assert.equal(parent.role, 'upstream')
  assert.equal(parent.count, 65)
  assert.equal(parent.x, 0)
  const tips = [...subgraph.marks.values()].filter(m => m.role === 'mini')
  assert.ok(tips.length >= 4)
  for (const tip of tips) {
    const via = subgraph.marks.get(tip.parent)
    assert.equal(via.role, 'satellite')
    assert.ok(data.neighbors.get(route[1]).has(via.entity.id))
    assert.ok(data.neighbors.get(via.entity.id).has(tip.entity.id))
    const arm = Math.hypot(via.x - tip.x, via.y - tip.y)
    assert.ok(arm >= 32 && arm <= 56)
  }
})

function liveFocus(t) {
  const file = path.join(directory, 'starScene.ts')
  const scene = evaluate(fs.readFileSync(file, 'utf8'), file, { './categoryGraph': category })
  const data = scene.graphIndex(category.buildCategoryGraph(full, []), full, true)
  const { state: { engine } } = setup(t, 'GalaxyCanvas', { selected: null, full, explore: true, trail: [] }, { './starScene': scene })
  const words = [], gradient = () => ({ addColorStop() {} })
  const ctx = new Proxy({
    measureText: s => ({ width: [...s].length * 10 }), createLinearGradient: gradient, createRadialGradient: gradient,
    fillText(s) { if (this.globalAlpha > 0) words.push(s) }
  }, { get: (obj, key) => obj[key] ?? (() => {}) })
  engine.width = 1000
  engine.height = 720
  const overview = scene.buildScene(data, null, undefined, 1000, 720)
  engine.prepareAtlas(data, overview)
  function focus(route, time) {
    const next = route.length ? engine.focusScene(data, route, 1000, 720, ctx) : overview
    engine.setScene(next, time, false, 1, 1000, route)
  }
  function frame(time) {
    words.length = 0
    engine.draw(ctx, time, 1)
    return words.length
  }
  focus([], 0)
  frame(100)
  return { engine, focus, frame }
}

test('focus and nested transitions only paint the owned tree, with a text-free opening and a separate exit fade', t => {
  const { engine, focus, frame } = liveFocus(t)
  let start = 200
  function fly(route, kind, duration) {
    focus(route, start)
    assert.equal(engine.navigation.kind, kind)
    assert.equal(engine.navigation.duration, duration)
    if (route.length) {
      const live = [...engine.marks.values()].filter(m => m.live)
      assert.equal(new Set(live.map(m => m.entity.id)).size, live.length)
      assert.equal(engine.wires.size, live.length - 1)
      const edgesByChild = new Map()
      for (const wire of engine.wires.values()) {
        assert.ok(wire.live)
        const from = engine.marks.get(wire.a), to = engine.marks.get(wire.b)
        assert.equal(to.parent, from.key)
        assert.deepEqual([from.role, wire.kind], {
          neighbor: ['center', 'focus'], upstream: ['center', 'guide'],
          satellite: ['center', 'guide'], mini: ['satellite', 'mini']
        }[to.role])
        edgesByChild.set(to.key, (edgesByChild.get(to.key) || 0) + 1)
      }
      for (const m of live) {
        assert.equal(edgesByChild.get(m.key) || 0, m.role === 'center' ? 0 : 1)
        if (m.role === 'satellite') {
          const count = live.filter(tip => tip.parent === m.key).length
          assert.ok(count >= 4 && count <= 7)
        }
      }
    }
    for (let ms = 0; ms <= duration; ms += 10) {
      const drawn = frame(start + ms)
      if (['enter', 'drill', 'branch'].includes(kind) && ms <= duration * 0.45) assert.equal(drawn, 0)
      if (kind === 'exit' && ms >= 85 && ms <= duration - 100) assert.equal(drawn, 0)
      for (const edge of engine.lineTargets) {
        const end = engine.marks.get(edge.wire.b)
        if (end.role === 'upstream') assert.equal(edge.a.x, edge.b.x)
        if (end.role === 'mini') {
          const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y)
          assert.ok(length >= 32 - 1e-6 && length <= 56 + 1e-6)
        }
      }
    }
    assert.equal(engine.navigation, null)
    assert.ok(engine.paintedTitles.length)
    start += duration + 100
  }
  const first = ['category:part'], deep = [...first, 'compressor-part-2']
  fly(first, 'enter', 400)
  fly(deep, 'drill', 420)
  const current = [...engine.marks.values()]
  const mini = current.find(m => m.role === 'mini')
  const leaf = current.find(m => m.role === 'neighbor')
  const illegal = { ...engine.wires.values().next().value, key: 'forbidden', a: mini.parent, b: leaf.key, kind: 'guide' }
  engine.wires.set(illegal.key, illegal)
  frame(start - 50)
  assert.ok(engine.lineTargets.every(e => e.wire.key !== illegal.key))
  engine.select({ key: mini.key, id: mini.entity.id, role: mini.role })
  fly([...deep, mini.entity.id], 'branch', 400)
  fly(deep, 'back', 360)
  fly([], 'exit', 360)
})

test('a long radial drag couples only angular neighbors and glides monotonically at 30, 60 and 120 Hz', t => {
  const { engine, focus, frame } = liveFocus(t)
  const key = 'cabinet-part-1'
  focus(['category:part'], 200)
  frame(700)
  const m = engine.marks.get(key), center = engine.marks.get('category:part')
  const initial = { ...m.position }, fixed = { ...center.position }
  engine.advanceRadial(2700, 1 / 60, 1, 500, 360)
  assert.ok(Math.hypot(initial.x - m.position.x, initial.y - m.position.y) > 0.5)
  assert.equal(center.position.x, fixed.x)
  assert.equal(center.position.y, fixed.y)
  const times = []
  for (const hz of [30, 60, 120]) {
    const dt = 1 / hz, down = { x: 500 + m.position.x, y: 360 + m.position.y }
    m.screen = down
    assert.ok(engine.beginNodeDrag(m, down))
    engine.moveNodeDrag({ x: down.x + 310, y: down.y })
    for (let i = 0; i < hz; i++) engine.advanceRadial(2700, dt, 1, 500, 360)
    const r = m.radial, magnitude = () => Math.hypot(r.offset.x, r.offset.y)
    assert.ok(magnitude() > 205 && magnitude() < 236)
    assert.equal(engine.coupledLeaves.size, 6)
    for (const [key, weight] of engine.coupledLeaves) {
      const neighbor = engine.marks.get(key).radial
      assert.ok(weight >= 0.06 && weight <= 0.14)
      assert.ok(Math.abs(neighbor.offset.x / r.offset.x - weight) < 0.001)
    }
    const release = magnitude()
    engine.endNodeDrag()
    assert.equal(magnitude(), release)
    let last = release, within = 0
    for (let i = 1; i <= hz * 2; i++) {
      engine.advanceRadial(2700 + i * dt * 1000, dt, 1, 500, 360)
      const distance = magnitude()
      assert.ok(distance <= last && last - distance <= 5.5 * dt * 60 + 0.001)
      assert.ok(r.offset.x >= -1e-9)
      if (i === Math.round(hz * 0.3)) assert.ok(distance > 90)
      if (distance < 1 && !within) within = i * dt
      last = distance
    }
    assert.ok(within >= 0.9 && within <= 1.3)
    times.push(within)
    engine.advanceRadial(2700, dt, 1, 500, 360)
  }
  assert.ok(Math.max(...times) - Math.min(...times) < 0.06)
})

test('brushing a spoke is local in screen pixels and the last drag sample retains water resistance', t => {
  const { engine, focus, frame } = liveFocus(t)
  focus(['category:part'], 200)
  frame(700)
  const leaf = engine.marks.get('cabinet-part-1')
  const zoom = 1.8, ox = 500, oy = 360
  engine.advanceRadial(1000, 1 / 60, zoom, ox, oy)
  const { x, y } = leaf.radial.home, length = Math.hypot(x, y)
  const brush = (distance) => {
    const to = { x: ox + x * 0.65 - y / length * distance, y: oy + y * 0.65 + x / length * distance }
    engine.focusWind = { from: { x: to.x - 25, y: to.y }, to, at: 1000 }
    engine.advanceRadial(1000, 1 / 60, zoom, ox, oy)
    return Math.hypot(leaf.radial.offset.x, leaf.radial.offset.y)
  }
  assert.equal(brush(126), 0)
  assert.ok(brush(45) > 0.2)
  engine.focusWind = null
  const first = Math.hypot(leaf.radial.offset.x, leaf.radial.offset.y)
  engine.advanceRadial(1017, 1 / 60, zoom, ox, oy)
  assert.ok(Math.hypot(leaf.radial.offset.x, leaf.radial.offset.y) < first)
  frame(1200)
  const down = { ...leaf.screen }
  assert.ok(engine.beginNodeDrag(leaf, down))
  engine.moveNodeDrag({ x: down.x + 350, y: down.y })
  engine.endNodeDrag(true, 1208)
  const finalSample = Math.hypot(leaf.radial.offset.x, leaf.radial.offset.y)
  assert.ok(finalSample > 5 && finalSample < 80)
})
