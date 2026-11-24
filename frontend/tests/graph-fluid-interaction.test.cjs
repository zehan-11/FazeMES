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
  class InputProbe {
    width = 900
    height = 600
    hit() { return target }
    tracePointer() {}
    move() {}
    select() {}
    dragEnd() {}
    endNodeDrag() {}
    beginNodeDrag(hit) { calls.push('start ' + hit.role); return true }
    moveNodeDrag() { calls.push('move node') }
    zoomBy(factor) { calls.push(factor) }
    dragStart() { calls.push('start pan') }
    drag() { calls.push('move pan') }
  }
  const props = vue.shallowReactive({ selected, explore: true, trail: [], full })
  const { state, events } = setup(t, 'GalaxyCanvas', props, {
    './starScene': { graphIndex: () => ({}), focusWindow: () => ({ rows: [] }) },
    './starCanvas': { StarCanvas: InputProbe }
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

for (const role of ['hub', 'leaf']) {
  test('five pixels of movement drags only the ' + role + ' and suppresses the release click', (t) => {
    const rig = canvasRig(t, role)
    rig.gesture(0, 5)
    assert.deepEqual(rig.calls, ['start ' + role, 'move node'])
    assert.deepEqual(rig.events, [])
    rig.gesture(200, 4.9)
    assert.deepEqual(rig.events, [['select', 'object']])
  })
}

test('overview blank drag never pans; the radial view retains blank drag and back', (t) => {
  const overview = canvasRig(t, null)
  overview.gesture(0, 18)
  overview.gesture(400, 0)
  assert.deepEqual(overview.calls, [])
  assert.deepEqual(overview.events, [])
  const radial = canvasRig(t, null, 'active')
  radial.gesture(0, 18)
  radial.gesture(400, 0)
  assert.deepEqual(radial.calls, ['start pan', 'move pan'])
  assert.deepEqual(radial.events, [['back']])
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
  state.onKeyDown({ key: 'Escape' })
  assert.equal(state.selectedId.value, 'category:part')
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
