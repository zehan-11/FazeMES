const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(
  path.join(__dirname, '../src/layout/components/ambientField.ts'),
  'utf8'
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
})

function field() {
  const sprites = []
  const frames = []
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    document: {
      createElement() {
        const stops = []
        sprites.push(stops)
        return {
          getContext: () => ({
            createRadialGradient: () => ({ addColorStop: (at, color) => stops.push([at, color]) }),
            fillRect() {}
          })
        }
      }
    }
  })
  const ctx = {
    clearRect() { frames.length = 0 },
    drawImage(_, x, y, w, h) {
      frames.push({ x: x + w / 2, y: y + h / 2, alpha: this.globalAlpha })
    }
  }
  const model = exports.createAmbientField(ctx)
  const draw = (dt = 0) => {
    model.draw(960, 600, dt)
    return frames.slice()
  }
  return { ...model, sprites, draw }
}

test('66 ice lights reuse two white-core sprites and rise with more lights at the edges', () => {
  const f = field()
  const start = f.draw()
  assert.equal(start.length, 66)
  assert.equal(start.filter(p => p.x < 960 * 0.24 || p.x > 960 * 0.76).length, 44)
  assert.equal(f.sprites.length, 2)
  for (const stops of f.sprites) {
    assert.equal(stops[0][1], '#f5fdff')
    assert.equal(stops[1][1], '#defaff')
    assert.match(stops.at(-1)[1], /,0\)$/)
  }
  assert.notDeepEqual(f.sprites[0], f.sprites[1])
  for (let i = 0; i < 60; i++) f.draw(1 / 60)
  const risen = f.draw()
  assert.ok(Math.abs(start[0].y - risen[0].y - 19) < 0.001)
  assert.equal(f.sprites.length, 2)
})

test('pointer proximity brightens and accelerates only nearby lights and clears on release', () => {
  const hover = field()
  const idle = field()
  const [center] = hover.draw()
  hover.point(center.x, center.y)
  const active = hover.draw(1 / 60)
  const baseline = idle.draw(1 / 60)
  assert.ok(active[0].alpha > baseline[0].alpha)
  assert.equal(active[1].alpha, baseline[1].alpha)
  hover.release()
  const released = hover.draw()
  const quiet = idle.draw()
  assert.ok(released[0].y < quiet[0].y)
  assert.equal(released[0].alpha, quiet[0].alpha)
  assert.deepEqual(released[1], quiet[1])
})

test('lights fade at the upper edge and reappear from below', () => {
  const f = field()
  const start = f.draw()[0]
  let last = start
  let wrapped = false
  for (let i = 0; i < 1000; i++) {
    const next = f.draw(1 / 60)[0]
    if (next.y > last.y) {
      assert.ok(last.alpha < 0.02)
      assert.equal(next.y, 600)
      assert.equal(next.alpha, 0)
      wrapped = true
      break
    }
    last = next
  }
  assert.ok(wrapped)
  assert.ok(f.draw(1 / 60)[0].alpha > 0)
})
