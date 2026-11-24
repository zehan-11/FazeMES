const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const graph = path.resolve(__dirname, '../src/views/mes/graph')
function brush() {
  const records = []
  const target = {
    records,
    globalAlpha: 1,
    filter: 'none',
    measureText: (s) => ({ width: s.length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect(...args) {
      records.push(['rect', this.fillStyle, ...args])
    },
    fillText(text, x, y) {
      records.push(['text', text, this.globalAlpha, this.fillStyle, x, y])
    },
    strokeRect(...args) {
      records.push(['border', this.strokeStyle, this.lineWidth, this.globalAlpha, ...args])
    },
    drawImage(...args) {
      records.push(['image', ...args, this.globalAlpha])
    }
  }
  return new Proxy(target, { get: (o, k) => o[k] ?? (() => {}) })
}

function environment() {
  const tiles = [],
    loads = [],
    modules = new Map()
  class Surface {
    constructor(w, h) {
      this.width = w
      this.height = h
      this.ctx = brush()
      tiles.push(this)
    }
    getContext() {
      return this.ctx
    }
  }
  class Picture {
    constructor() {
      this.naturalWidth = 420
      this.naturalHeight = 200
      loads.push(this)
    }
  }
  function load(name) {
    const file = path.join(graph, name + '.ts')
    if (modules.has(file)) return modules.get(file).exports
    const mod = { exports: {} }
    modules.set(file, mod)
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText
    vm.runInNewContext(
      js,
      {
        module: mod,
        exports: mod.exports,
        OffscreenCanvas: Surface,
        Image: Picture,
        require: (local) => load(path.basename(local)),
        performance
      },
      { filename: file }
    )
    return mod.exports
  }
  return { tiles, loads, load }
}
function mark(id, parent, x, y, seed, url) {
  return {
    key: id,
    parent,
    x,
    y,
    seed,
    order: 0,
    count: 1,
    color: '#779AFF',
    role: parent ? 'leaf' : 'hub',
    entity: {
      id,
      name: id,
      kind: parent === 'B' || id === 'B' ? '设备' : '部件',
      thumbnailUrl: url
    }
  }
}

test('thumbnail atlas bakes 20 balanced posters once, reuses a supplied photo and crops it to each 2x format', () => {
  const env = environment()
  const { StarThumbnails } = env.load('starThumbnails')
  const cache = new StarThumbnails()
  const leaves = Array.from({ length: 400 }, (_, i) => mark(String(i), 'ABC'[i % 3], 0, 0, 0.86))
  leaves.push(
    mark('photo-one', 'A', 0, 0, 0.01, '/photo.png'),
    mark('photo-two', 'A', 0, 0, 0.02, '/photo.png')
  )
  const cards = cache.prepare(leaves)
  assert.equal(env.tiles.length, 60)
  for (const [w, h] of [[44, 30], [30, 40], [36, 36]]) {
    assert.equal(env.tiles.filter(s => s.width === w && s.height === h).length, 20)
  }
  const designs = new Set(), count = { paper: 0, solid: 0, night: 0, split: 0 }
  const warm = new Set(['#B83227', '#B45309', '#E03E36', '#E89B2D', '#E46D36'])
  const cool = new Set(['#123CC8', '#0D6E59', '#4C2898', '#2563EB', '#10B981', '#7C3AED'])
  for (const cluster of ['A', 'B', 'C']) {
    const hues = new Set()
    for (const m of leaves.filter(item => item.parent === cluster)) {
      const card = cards.get(m.key)
      assert.equal(card.image.width, 2 * card.width)
      assert.equal(card.image.height, 2 * card.height)
      if (card.photo) continue
      const [family, bg, body] = card.design
      designs.add(card.design)
      count[family]++
      if (family === 'paper') { assert.ok(['#FFFFFF','#F5F7FB'].includes(bg)); hues.add('paper') }
      if (family === 'night') assert.equal(bg, '#090D1A')
      if (warm.has(bg) || warm.has(body)) hues.add('warm')
      if (cool.has(bg) || cool.has(body)) hues.add('cool')
    }
    assert.deepEqual([...hues].sort(), ['cool','paper','warm'])
  }
  assert.deepEqual(count, { paper: 100, solid: 100, night: 120, split: 80 })
  assert.equal(designs.size, 20)
  assert.deepEqual([...new Set([...cards.values()].map((c) => c.width + 'x' + c.height))].sort(), [
    '15x20',
    '18x18',
    '22x15'
  ])
  assert.equal(env.loads.length, 1)
  const first = cards.get('photo-one'),
    second = cards.get('photo-two')
  assert.ok(first.image)
  assert.equal(first.photo, second.photo)
  assert.equal(first.photo.tiles.length, 0)
  env.loads[0].onload()
  assert.deepEqual(
    Array.from(first.photo.tiles, (t) => [t.width, t.height]),
    [
      [44, 30],
      [30, 40],
      [36, 36]
    ]
  )
  for (const t of first.photo.tiles) {
    const imageOp = t.ctx.records.find(([op]) => op === 'image')
    assert.equal(imageOp[1], env.loads[0])
    assert.equal(t.ctx.filter, 'none')
    assert.ok(Math.abs(imageOp[4] / imageOp[5] - t.width / t.height) < 1e-12)
  }
  const again = cache.prepare(leaves.toReversed())
  assert.equal(again.get('0').image, cards.get('0').image)
  assert.equal(again.get('photo-one').photo, first.photo)
  assert.equal(env.tiles.length, 63)
  assert.equal(env.loads.length, 1)
})

test('live cards reuse identical pixels with green family borders and white direct-neighbor borders, and accept corner clicks', () => {
  const env = environment()
  const { StarCanvas } = env.load('starCanvas')
  const engine = new StarCanvas()
  engine.width = 1000
  engine.height = 760
  engine.still = true
  const points = [
    mark('A', '', -180, 0, 0.1),
    mark('B', '', 180, 0, 0.1),
    mark('one', 'A', -140, 100, 0.92),
    mark('other', 'B', 170, -90, 0.94),
    mark('unrelated', 'B', 220, 100, 0.93)
  ]
  points[1].count = 2
  const list = [
    ['A', 'one', 'spoke'],
    ['B', 'other', 'spoke'],
    ['B', 'unrelated', 'spoke'],
    ['one', 'other', 'relation']
  ]
  const wires = new Map(list.map(([a, b, kind]) => [a + b, { a, b, kind, key: a + b, label: '' }]))
  engine.setScene({ marks: new Map(points.map((m) => [m.key, m])), wires, overview: true }, 0)
  const ctx = brush()
  function frame(t) {
    ctx.records.length = 0
    engine.draw(ctx, t, 1)
  }
  function stamp(id) {
    const m = engine.marks.get(id)
    const idx = ctx.records.findIndex(
      ([op, sprite, x, y, w, h]) =>
        op === 'image' &&
        sprite === m.thumbnail.image &&
        Math.hypot(x + w / 2 - m.screen.x, y + h / 2 - m.screen.y) < 1.5
    )
    assert.notEqual(idx, -1, id + ' should blit its cached miniature')
    return { body: ctx.records[idx], rim: ctx.records[idx + 1] }
  }
  function textRecord(name) {
    const draw = ctx.records.find(([op, text]) => op === 'text' && text === name)
    assert.ok(draw, 'expected visible label ' + name)
    return draw
  }
  frame(1600)
  const original = stamp('one').body[1]
  const idle = stamp('one').rim
  assert.deepEqual(idle.slice(1, 4), ['#CDDCF8', 0.85, 0.48])
  assert.equal(stamp('one').body.at(-1), 1)
  const m = engine.marks.get('one')
  const corner = {
    x: m.screen.x + m.thumbnail.width / 2 - 0.1,
    y: m.screen.y + m.thumbnail.height / 2 - 0.1
  }
  assert.equal(engine.hit(corner).id, 'one')
  engine.move({ ...engine.marks.get('A').screen })
  frame(1620)
  assert.equal(stamp('unrelated').body.at(-1), 0.60)
  assert.equal(textRecord('B')[2], 0.82)
  assert.equal(textRecord('B')[3], '#FFFFFF')
  const count = textRecord('2')
  assert.equal(count[3], 'rgba(180,206,255,.72)')
  assert.ok(Math.abs(count[2] * 0.72 - 0.5904) < 1e-9)
  assert.equal(engine.marks.get('B').trunkLight, 1)
  assert.deepEqual(stamp('one').rim.slice(1, 4), ['#2EE89A', 1.05, 1])
  assert.equal(stamp('one').body[1], original)
  engine.move({ ...m.screen })
  frame(1640)
  for (const id of ['one', 'other']) {
    assert.deepEqual(stamp(id).rim.slice(1, 4), ['#FFFFFF', 1.1, 1])
  }
  assert.equal(stamp('one').body[1], original)
  assert.ok(Math.abs(stamp('unrelated').body.at(-1) - 0.44) < 1e-9)
  assert.equal(textRecord('B')[2], 0.56)
  assert.equal(textRecord('other')[2], 1)
  assert.equal(stamp('other').body.at(-1), 1)
  assert.equal(engine.wires.get('Bother').light, 0.44)
  assert.equal(env.tiles.length, 60)
})

test('flower petals unfold with the same cached color preview shown on the interactive canvas', () => {
  const env = environment()
  const { StarCanvas } = env.load('starCanvas')
  const engine = new StarCanvas()
  engine.width = 900
  engine.height = 600
  const hub = mark('A', '', -160, -70, 0.5)
  const card = mark('card-a', 'A', -240, -100, 0.84)
  engine.setScene({ overview: true, marks: new Map([[hub.key, hub], [card.key, card]]), wires: new Map() }, 0)
  engine.beginIntro(0)
  const ctx = brush()
  function previews(t) {
    ctx.records.length = 0
    engine.draw(ctx, t, 1)
    return ctx.records.filter(([kind, image]) => kind === 'image' && env.tiles.includes(image))
  }
  assert.equal(previews(500).length, 0)
  const [petal] = previews(950)
  assert.ok(petal && petal.at(-1) > 0 && petal.at(-1) < 1)
  const [open] = previews(1550)
  const [settled] = previews(2760)
  assert.equal(petal[1], open[1])
  assert.equal(open[1], settled[1])
  assert.equal(settled.at(-1), 1)
})

test('hover retention and shape progress follow the same monotonic clock at 30 and 60 Hz', () => {
  function timeline(hz) {
    const env = environment()
    const engine = new (env.load('starCanvas').StarCanvas)()
    Object.assign(engine, { width: 900, height: 600, still: true })
    const hub = mark('A', '', -180, 0, 0.1), away = mark('B', '', 180, 40, 0.1)
    engine.setScene({ overview: true, marks: new Map([[hub.key, hub], [away.key, away]]), wires: new Map() }, 0)
    const ctx = brush()
    let t = 3000
    engine.draw(ctx, t, 1)
    engine.still = false
    const active = engine.marks.get('A'), other = engine.marks.get('B')
    const result = []
    for (const entering of [true, false]) {
      engine.external = entering ? 'A' : null
      let previous = other.titleLight
      for (let i = 0; i < hz / 2; i++) {
        t += 1000 / hz
        engine.draw(ctx, t, 1)
        assert.ok(entering ? other.titleLight >= 0.82 && other.titleLight <= previous
                           : other.titleLight <= 1 && other.titleLight >= previous)
        previous = other.titleLight
        assert.ok(Math.abs(other.titleLight - (1 - 0.18 * active.hubFocusT)) < 1e-9)
      }
      result.push(other.titleLight)
    }
    return result
  }
  const slow = timeline(30), fast = timeline(60)
  for (let i = 0; i < slow.length; i++) assert.ok(Math.abs(slow[i] - fast[i]) < 1e-9)
  assert.ok(Math.abs(slow[0] - (0.82 + 0.18 * Math.exp(-3))) < 1e-9)
})
