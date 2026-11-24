import { clamp, seed, smoothstep, TAU, type Point } from './starScene'

const shades = ['#2458FF', '#3E7BFF', '#1A3FCC']
const ambient = Array.from({ length: 156 }, (_, i) => ({
  x: seed('dust-x' + i),
  y: seed('dust-y' + i),
  size: 1.1 + seed('size' + i) * 1.1,
  period: 4500 + 5500 * seed('period' + i),
  phase: TAU * seed('phase' + i),
  depth: i % 2 ? 0.35 : 1,
  shade: i % 3
}))

// Cache the soft halo once per shade instead of allocating gradients every animation frame.
function createSprites() {
  if (typeof document === 'undefined') return []
  return shades.map((color) => {
    const sprite = document.createElement('canvas')
    sprite.width = sprite.height = 48
    const ctx = sprite.getContext('2d')
    if (ctx) {
      const wash = ctx.createRadialGradient(24, 24, 0, 24, 24, 24)
      wash.addColorStop(0, color + '55')
      wash.addColorStop(0.45, color + '21')
      wash.addColorStop(1, color + '00')
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, 48, 48)
    }
    return sprite
  })
}

const wrap = (p: number, span: number) => ((p % span) + span) % span

// The overview lattice is fixed in CSS pixels, independent of the graph camera.
export const AMBIENT_BLUE = '#5288FF'
const cursorRadius = 52
const sampleSpacing = 8
const lifetime = 550
const attackMs = 24
type WakeSample = Point & { born: number }

function makeLattice(width: number, height: number) {
  const spacing = clamp(Math.sqrt((width * height) / 720), 28, 34)
  const columns = Math.max(1, Math.round(width / spacing))
  const rows = Math.max(1, Math.round(height / spacing))
  const cellW = width / columns,
    cellH = height / rows
  const dots = Array.from({ length: columns * rows }, (_, i) => {
    const col = i % columns,
      row = Math.floor(i / columns)
    const id = 'dust/' + col + '/' + row
    return {
      x: (col + 0.25 + 0.5 * seed(id + '/x')) * cellW,
      y: (row + 0.25 + 0.5 * seed(id + '/y')) * cellH,
      size: 1.4 + 0.7 * seed(id + '/size'),
      awakeSize: 2 + 0.4 * seed(id + '/awake-size'),
      peak: 0.42 + 0.1 * seed(id + '/peak'),
      awake: 0.78 + 0.1 * seed(id + '/awake'),
      omega: TAU / (3200 + 4300 * seed(id + '/period')),
      phase: TAU * seed(id + '/phase'),
      isAmbientTwinkle: i % 5 === Math.floor(seed('twinkle/' + Math.floor(i / 5)) * 5)
    }
  })
  return { width, height, columns, rows, cellW, cellH, dots, wake: new Float32Array(dots.length) }
}

export class BlueParticles {
  private sprites?: HTMLCanvasElement[]
  private trail: WakeSample[] = []
  private last: WakeSample | null = null
  private remainder = 0
  private lattice?: ReturnType<typeof makeLattice>
  private overview?: boolean
  private handoff = -Infinity

  trace(point: Point | null, now: number) {
    if (!point) {
      this.last = null
      this.remainder = 0
      return
    }
    this.expire(now)
    const previous = this.last
    if (!previous || now - previous.born >= lifetime) {
      this.last = { ...point, born: now }
      this.trail.push(this.last)
      this.remainder = 0
      return
    }
    const dx = point.x - previous.x,
      dy = point.y - previous.y
    const distance = Math.hypot(dx, dy)
    if (!distance || now < previous.born) return
    for (let at = sampleSpacing - this.remainder; at <= distance; at += sampleSpacing) {
      const t = at / distance
      this.trail.push({
        x: previous.x + dx * t,
        y: previous.y + dy * t,
        born: previous.born + (now - previous.born) * t
      })
    }
    this.remainder = (this.remainder + distance) % sampleSpacing
    this.last = { ...point, born: now }
  }

  private expire(now: number) {
    let n = 0
    while (n < this.trail.length && now - this.trail[n].born >= lifetime) n++
    if (n) this.trail.splice(0, n)
  }

  private sampleWake(now: number, grid: ReturnType<typeof makeLattice>) {
    const { dots, wake, columns, rows, cellW, cellH } = grid
    wake.fill(0)
    this.expire(now)
    for (const { x, y, born } of this.trail) {
      const age = now - born
      if (age < 0) continue
      const envelope =
        age < attackMs
          ? smoothstep(age / attackMs)
          : smoothstep((lifetime - age) / (lifetime - attackMs))
      const left = Math.max(0, Math.floor((x - cursorRadius) / cellW))
      const right = Math.min(columns - 1, Math.floor((x + cursorRadius) / cellW))
      const top = Math.max(0, Math.floor((y - cursorRadius) / cellH))
      const bottom = Math.min(rows - 1, Math.floor((y + cursorRadius) / cellH))
      for (let row = top; row <= bottom; row++) {
        for (let col = left; col <= right; col++) {
          const i = row * columns + col
          const dx = dots[i].x - x,
            dy = dots[i].y - y
          const proximity = 1 - (dx * dx + dy * dy) / (cursorRadius * cursorRadius)
          if (proximity > 0) wake[i] = Math.max(wake[i], envelope * smoothstep(proximity))
        }
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    now: number,
    width: number,
    height: number,
    parallax: Point,
    camera: Point,
    still: boolean,
    interactiveOverview: boolean
  ) {
    if (interactiveOverview !== this.overview) {
      if (interactiveOverview && this.overview === false) this.handoff = now
      if (!interactiveOverview) {
        this.trace(null, now)
        this.trail.length = 0
      }
      this.overview = interactiveOverview
    }
    const t = still ? 1 : clamp((now - this.handoff) / 200)
    const blend = interactiveOverview ? t * t * (3 - 2 * t) : 0
    if (blend < 1) {
      const sprites = (this.sprites ??= createSprites())
      for (const s of ambient) {
        const x = wrap(s.x * width + (parallax.x + camera.x * 0.035) * s.depth, width)
        const y = wrap(s.y * height + (parallax.y + camera.y * 0.035) * s.depth, height)
        const breath = 0.5 + 0.5 * Math.sin((still ? 0 : (TAU * now) / s.period) + s.phase)
        ctx.globalAlpha = (1 - blend) * (0.02 + 0.32 * breath)
        if (s.size > 1.95 && sprites[s.shade]) ctx.drawImage(sprites[s.shade], x - 4, y - 4, 8, 8)
        ctx.fillStyle = shades[s.shade]
        ctx.fillRect(x - s.size / 2, y - s.size / 2, s.size, s.size)
      }
    }
    if (blend > 0 && width > 0 && height > 0) {
      if (this.lattice?.width !== width || this.lattice.height !== height) {
        this.lattice = makeLattice(width, height)
      }
      const grid = this.lattice
      if (!still) this.sampleWake(now, grid)
      ctx.fillStyle = AMBIENT_BLUE
      const time = still ? 0 : now
      for (let i = 0; i < grid.dots.length; i++) {
        const dot = grid.dots[i]
        const weight = still ? 0 : grid.wake[i]
        if (!dot.isAmbientTwinkle && !weight) continue
        const breath = dot.isAmbientTwinkle ? 0.5 + 0.5 * Math.sin(time * dot.omega + dot.phase) : 0
        const base = dot.isAmbientTwinkle ? 0.03 + (dot.peak - 0.03) * breath ** 3.2 : 0
        const size = dot.size + (Math.max(dot.size, dot.awakeSize) - dot.size) * weight
        ctx.globalAlpha = blend * (base + (dot.awake - base) * weight)
        ctx.fillRect(dot.x - size / 2, dot.y - size / 2, size, size)
      }
    }
    ctx.globalAlpha = 1
  }
}
