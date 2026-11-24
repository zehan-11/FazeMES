import { seed, smoothstep, type Point } from './starScene'

export const AMBIENT_BLUE = '#4A80FF'
const GRID_STEP = 22
const sampleSpacing = 12
const lifetime = 520
const attackMs = 24

type PointerSample = Point & { born: number }
interface TrailStar extends PointerSample {
  tint: string
  size: number
  peak: number
  flare: boolean
}
const maxTrailStars = 160

function makeLattice(width: number, height: number) {
  const columns = Math.ceil(width / GRID_STEP)
  const rows = Math.ceil(height / GRID_STEP)
  const dots = Array.from({ length: columns * rows }, (_, i) => {
    const col = i % columns
    const row = Math.floor(i / columns)
    const x = col * GRID_STEP
    const y = row * GRID_STEP
    const id = 'grid/' + col + '/' + row
    const rank = seed(id)
    return {
      x,
      y,
      rank,
      size: 1.4 + 0.4 * seed(id + '/size'),
      peak: 0.42 + 0.14 * seed(id + '/ambient')
    }
  })
  // Deal candidates from left to right so even the narrow area beside an open drawer
  // gets an independent pulse in each band. Opening the drawer never moves or rebuilds a dot.
  const bands = Array.from({ length: 20 }, (_, index) => ({
    members: [] as number[],
    period: 6000 + 7000 * seed('stars/period/' + index),
    phase: seed('stars/phase/' + index)
  }))
  let dealt = 0
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < rows; row++) {
      const i = row * columns + col
      if (dots[i].rank < 0.08) bands[dealt++ % bands.length].members.push(i)
    }
  }
  return {
    width,
    height,
    columns,
    rows,
    dots,
    bands: bands.filter((b) => b.members.length),
    alpha: new Float32Array(dots.length)
  }
}

type Lattice = ReturnType<typeof makeLattice>

export class BlueParticles {
  private trail: TrailStar[] = []
  private last: PointerSample | null = null
  private emitted = 0
  private remainder = 0
  private lattice?: Lattice

  private stamp(x: number, y: number, born: number) {
    const serial = this.emitted++
    for (let i = 0; i < 2; i++) {
      const id = 'pointer-star/' + serial + '/' + i
      const angle = seed(id + '/angle') * Math.PI * 2
      const distance = i ? 5 + 12 * seed(id + '/spread') : 4 * seed(id + '/spread')
      const roll = seed(id + '/tint')
      const flare = i === 0 && serial % 5 === 0
      this.trail.push({
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        born,
        flare,
        tint: dustTints[roll < 0.6 ? 0 : roll < 0.9 ? 1 : 2],
        size: flare ? 4.8 + 2.2 * seed(id + '/size') : 0.55 + 0.45 * seed(id + '/size'),
        peak: 0.54 + 0.28 * seed(id + '/alpha')
      })
    }
  }

  trace(point: Point | null, now: number) {
    if (!point) {
      this.last = null
      this.remainder = 0
      return
    }
    this.expire(now)
    const previous = this.last
    if (previous && (now < previous.born || (point.x === previous.x && point.y === previous.y)))
      return
    if (!previous || now - previous.born >= lifetime) {
      this.stamp(point.x, point.y, now)
      this.remainder = 0
    } else {
      const dx = point.x - previous.x,
        dy = point.y - previous.y
      const distance = Math.hypot(dx, dy)
      const first = sampleSpacing - this.remainder
      const count = Math.max(0, Math.floor((distance - first) / sampleSpacing) + 1)
      const skipped = Math.max(0, count - maxTrailStars / 2)
      this.emitted += skipped
      for (let i = skipped; i < count; i++) {
        const t = (first + i * sampleSpacing) / distance
        this.stamp(
          previous.x + dx * t,
          previous.y + dy * t,
          previous.born + (now - previous.born) * t
        )
      }
      this.remainder = (this.remainder + distance) % sampleSpacing
    }
    this.last = { ...point, born: now }
    if (this.trail.length > maxTrailStars) this.trail.splice(0, this.trail.length - maxTrailStars)
  }

  private expire(now: number) {
    let n = 0
    while (n < this.trail.length && now - this.trail[n].born >= lifetime) n++
    if (n) this.trail.splice(0, n)
  }

  draw(
    ctx: CanvasRenderingContext2D,
    now: number,
    width: number,
    height: number,
    still: boolean,
    visibleWidth = width
  ) {
    if (width <= 0 || height <= 0) return
    if (this.lattice?.width !== width || this.lattice.height !== height) {
      this.lattice = makeLattice(width, height)
    }
    const grid = this.lattice
    const time = still ? 0 : now
    grid.alpha.fill(0)
    for (const { members, period, phase } of grid.bands) {
      let count = members.length
      while (count && grid.dots[members[count - 1]].x >= visibleWidth) count--
      if (!count) continue
      const turn = (time / period + phase) * count
      const whole = Math.floor(turn)
      const i = members[whole % count]
      const pulse = Math.sin(Math.PI * (turn - whole)) ** 2
      grid.alpha[i] = grid.dots[i].peak * pulse
    }

    ctx.fillStyle = AMBIENT_BLUE
    for (let i = 0; i < grid.dots.length; i++) {
      if (grid.alpha[i] < 1 / 255 || grid.dots[i].x >= visibleWidth) continue
      const { x, y, size } = grid.dots[i]
      ctx.globalAlpha = grid.alpha[i]
      ctx.fillRect(x - size / 2, y - size / 2, size, size)
    }
    this.expire(now)
    if (!still) {
      for (const star of this.trail) {
        if (star.x < 0 || star.x >= visibleWidth || star.y < 0 || star.y >= height) continue
        const age = now - star.born
        if (age <= 0) continue
        const light =
          age < attackMs
            ? smoothstep(age / attackMs)
            : smoothstep((lifetime - age) / (lifetime - attackMs))
        if (star.flare) {
          glint(ctx, star.x, star.y, star.size, light, light * star.peak)
        } else {
          ctx.fillStyle = star.tint
          ctx.globalAlpha = light * star.peak
          ctx.beginPath()
          ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.globalAlpha = 1
  }
}

// Points keep their screen coordinates under zoom and drawer movement. Uncover more
// deterministic candidates when the drawer narrows the visible part of the canvas.
const dustTints = ['#EAF3FF', '#9AC4FF', '#FFF0D2'] as const

interface SkyPoint {
  u: number
  v: number
  size: number
  phase: number
  period: number
  tone: number
}

function skyPoint(i: number, flare: boolean): SkyPoint {
  const id = (flare ? 'glint/' : 'dust/') + i
  const roll = seed(id + '/tint')
  return {
    u: ((i + 1) * 0.754877666 + 0.08 * seed(id + '/x')) % 1,
    v: ((i + 1) * 0.569840291 + 0.12 * seed(id + '/y')) % 1,
    size: flare ? 4.5 + 4 * seed(id + '/arm') : 0.85 + 0.75 * seed(id + '/size'),
    phase: seed(id + '/phase') * Math.PI * 2,
    period: 2.6 + 4.2 * seed(id + '/period'),
    tone: roll < 0.6 ? 0 : roll < 0.9 ? 1 : 2
  }
}

function starArm(
  ctx: CanvasRenderingContext2D,
  length: number,
  thickness: number,
  ux: number,
  uy: number
) {
  const dx = length * ux,
    dy = length * uy
  const px = (-uy * thickness) / 2,
    py = (ux * thickness) / 2
  const ink = ctx.createLinearGradient(-dx, -dy, dx, dy)
  ink.addColorStop(0, 'rgba(172,211,255,0)')
  ink.addColorStop(0.5, 'rgba(237,248,255,0.94)')
  ink.addColorStop(1, 'rgba(172,211,255,0)')
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.moveTo(-dx, -dy)
  ctx.lineTo(px, py)
  ctx.lineTo(dx, dy)
  ctx.lineTo(-px, -py)
  ctx.closePath()
  ctx.fill()
}

function glint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  arm: number,
  spark: number,
  opacity = 1
) {
  ctx.fillStyle = '#FFFFFF'
  ctx.globalAlpha = (0.14 + 0.77 * spark) * opacity
  ctx.beginPath()
  ctx.arc(x, y, 0.55 + 0.05 * spark, 0, Math.PI * 2)
  ctx.fill()
  if (spark < 0.035) return
  ctx.save()
  ctx.translate(x, y)
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 7)
  halo.addColorStop(0, 'rgba(192,224,255,0.38)')
  halo.addColorStop(0.45, 'rgba(146,193,255,0.12)')
  halo.addColorStop(1, 'rgba(146,193,255,0)')
  ctx.globalAlpha = spark * opacity
  ctx.fillStyle = halo
  ctx.fillRect(-7, -7, 14, 14)
  const length = arm * spark
  starArm(ctx, length, 0.8, 1, 0)
  starArm(ctx, length, 0.8, 0, 1)
  ctx.globalAlpha = spark * 0.28 * opacity
  starArm(ctx, length * 0.3, 0.44, Math.SQRT1_2, Math.SQRT1_2)
  starArm(ctx, length * 0.3, 0.44, -Math.SQRT1_2, Math.SQRT1_2)
  ctx.restore()
}

export class Starfield {
  private dust: SkyPoint[] = []
  private flares: SkyPoint[] = []

  draw(
    ctx: CanvasRenderingContext2D,
    now: number,
    width: number,
    height: number,
    visibleWidth: number,
    still: boolean
  ) {
    if (width < 2 || height < 2 || visibleWidth < 2) return
    const t = still ? 0 : now / 1000
    const remaining = [60, 30, 10]
    ctx.save()
    for (const flare of [false, true]) {
      const count = flare ? 20 : 100
      const pool = flare ? this.flares : this.dust
      const limit = Math.min(8192, Math.ceil((3 * count * width) / visibleWidth))
      for (let i = 0, shown = 0; shown < count && i < limit; i++) {
        const star = (pool[i] ??= skyPoint(i, flare))
        const x = star.u * width
        if (x >= visibleWidth) continue
        if (flare) {
          // Four staggered quintets keep the simultaneous highlights sparse.
          const group = Math.floor(shown / 5)
          const phase = ((shown % 5) * Math.PI * 2) / 5 + group * 0.47
          const period = 4.6 + group * 1.65 + 0.06 * star.period
          const spark = Math.max(0, Math.sin((t * Math.PI * 2) / period + phase)) ** 8
          glint(ctx, x, star.v * height, star.size, spark)
        } else {
          if (!remaining[star.tone]) continue
          remaining[star.tone]--
          const pulse = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / star.period + star.phase)
          ctx.fillStyle = dustTints[star.tone]
          ctx.globalAlpha = 0.08 + 0.64 * pulse * pulse
          ctx.beginPath()
          ctx.arc(x, star.v * height, star.size / 2, 0, Math.PI * 2)
          ctx.fill()
        }
        shown++
      }
    }
    ctx.restore()
  }
}
