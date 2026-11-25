<script lang="ts">
import {
  seed,
  type Point,
  smoothstep,
  type Mark as SceneMark,
  colorOfKind,
  type GraphIndex,
  clamp,
  TAU,
  bloomEnd,
  easeOut,
  easeBloom,
  FLIGHT_MS,
  DOCK_MS,
  DOCK_DURATION,
  clockwiseAngle,
  globalSwirl,
  leafGrowth,
  phase,
  shot,
  type Scene as BaseScene,
  type Wire
} from './starScene'

const NIGHT = '#020618'

type Tone = readonly [number, number, number, number]
type RayRamp = readonly [root: Tone, middle: Tone, tip: Tone, crest: Tone]

const trunkRoot: Tone = [54, 102, 230, 0.36]
const trunkTip: Tone = [76, 138, 255, 0.62]
const relationBlue: Tone = [98, 134, 218, 0.1]
const silver: Tone = [208, 224, 248, 0.56]
const green: RayRamp = [
  [56, 248, 174, 0.9],
  [47, 220, 155, 0.72],
  [38, 190, 134, 0.52],
  [83, 249, 181, 0.92]
]
interface ClusterInk {
  hub: string
  dot: string
  wave: RayRamp
}
const blue = { hub: '#4372FF', dot: '#4D86FF' }
const jade: ClusterInk = {
  ...blue,
  wave: [
    [28, 218, 178, 0.84],
    [28, 154, 190, 0.56],
    [50, 96, 220, 0.38],
    [70, 245, 202, 0.84]
  ]
}
const sky: ClusterInk = {
  ...blue,
  wave: [
    [46, 158, 255, 0.86],
    [44, 110, 240, 0.58],
    [52, 86, 212, 0.38],
    [106, 198, 255, 0.88]
  ]
}
const themes = new Map([
  ['部件', jade],
  ['措施', jade],
  ['工艺', sky],
  ['手册', jade],
  ['设备', sky],
  ['故障', sky],
  ['原因', sky],
  ['规则库', sky]
])
function liveTheme(kind: string): ClusterInk {
  return themes.get(kind) ?? (seed(kind) < 0.5 ? sky : jade)
}

function blendInk(from: string, to: string, weight: number) {
  if (weight <= 0) return from
  if (weight >= 1) return to
  const a = parseInt(from.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const channel = (shift: number) => {
    const lo = (a >> shift) & 255
    return Math.round(lo + (((b >> shift) & 255) - lo) * weight)
  }
  return '#' + ((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')
}

function makeFlow(id: string) {
  return { phase: seed(id + '/travel'), speed: 0.12 + 0.04 * seed(id + '/speed') }
}

type LineFlow = ReturnType<typeof makeFlow>

function mixTone(a: Tone, b: Tone, t: number): Tone {
  if (t <= 0) return a
  if (t >= 1) return b
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t
  ]
}

function color(t: Tone) {
  return (
    'rgba(' +
    [Math.round(t[0]), Math.round(t[1]), Math.round(t[2]), t[3].toFixed(3)].join(',') +
    ')'
  )
}

function waveInk(
  ctx: CanvasRenderingContext2D,
  flow: LineFlow,
  from: Point,
  to: Point,
  seconds: number,
  theme: ClusterInk,
  kind: 'spoke' | 'trunk' | 'relation',
  hubFocus: number,
  leafFocus: number,
  still: boolean,
  radial = false,
  sampleOnLine = false
) {
  if (kind === 'relation') return color(mixTone(relationBlue, silver, leafFocus))
  if (radial && leafFocus >= 0.999) return '#FFFFFF'
  if (!radial && leafFocus === 1) return color(silver)
  if (kind === 'trunk' && hubFocus === 0) {
    if (sampleOnLine) return (t: number) => mixTone(trunkRoot, trunkTip, t)
    const ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
    ink.addColorStop(0, color(trunkRoot))
    ink.addColorStop(1, color(trunkTip))
    return ink
  }

  const jadeRay = theme === jade
  // Both views use the same wall-clock phase, gradient stops and cosine-squared wave.
  const core: Tone = radial
    ? jadeRay
      ? [26, 217, 164, 0.98]
      : [61, 123, 255, 0.98]
    : theme.wave[0]
  const rim: Tone = radial ? [22, 54, 138, 0.88] : theme.wave[2]
  const mint: Tone = [34, 229, 155, 0.97]
  const root = mixTone(kind === 'trunk' ? trunkRoot : core, radial ? mint : green[0], hubFocus)
  const tip = mixTone(kind === 'trunk' ? trunkTip : rim, radial ? mint : green[2], hubFocus)
  const middle =
    kind === 'trunk' || radial
      ? mixTone(root, tip, 0.48)
      : mixTone(theme.wave[1], green[1], hubFocus)
  const beam: Tone = radial ? (jadeRay ? [24, 224, 168, 1] : [78, 180, 255, 1]) : theme.wave[3]
  const crest = mixTone(beam, radial ? [155, 255, 218, 1] : green[3], hubFocus)
  const center = (1 - Math.cos(2 * Math.PI * (flow.phase + seconds * flow.speed))) / 2
  const halfWidth = 0.22
  const strength = still ? 0 : kind === 'trunk' ? hubFocus : 1

  function toneAt(t: number): Tone {
    const base =
      t < 0.48 ? mixTone(root, middle, t / 0.48) : mixTone(middle, tip, (t - 0.48) / 0.52)
    const distance = Math.abs(t - center) / halfWidth
    const weight = distance < 1 ? strength * Math.cos((Math.PI / 2) * distance) ** 2 : 0
    const strong: Tone = radial ? [255, 255, 255, 1] : silver
    return mixTone(mixTone(base, crest, weight), strong, leafFocus)
  }
  if (sampleOnLine) return toneAt
  const ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
  const stop = (t: number) => ink.addColorStop(t, color(toneAt(t)))

  stop(0)
  stop(0.48)
  stop(1)
  // Canvas sorts stops by offset. Sampling relative to the crest keeps its peak sharp
  // in time while the cosine-squared shoulders blend into the underlying radial tint.
  if (strength > 0.001) {
    for (let i = -4; i <= 4; i++) {
      const t = center + (halfWidth * i) / 4
      if (t > 0 && t < 1) stop(t)
    }
  }
  return ink
}

function paintWaterDot(
  ctx: CanvasRenderingContext2D,
  at: Point,
  dotInk: string,
  whiteT: number,
  family: number,
  single: number
) {
  const familyRadius = 2.1 + 1.2 * family
  const radius = familyRadius + (3.8 - familyRadius) * single
  const focus = Math.max(family, single)
  ctx.beginPath()
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2)
  ctx.fillStyle = blendInk(blendInk(dotInk, '#FFFFFF', whiteT), NIGHT, focus)
  ctx.fill()
  if (focus > 0.002) {
    const alpha = ctx.globalAlpha
    ctx.globalAlpha = alpha * focus
    ctx.strokeStyle = 'rgba(196, 224, 236, 0.72)'
    ctx.lineWidth = 0.9
    ctx.stroke()
    ctx.globalAlpha = alpha
  }
}

const AMBIENT_BLUE = '#4A80FF'
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

class BlueParticles {
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

class Starfield {
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

const formats = [
  [22, 15],
  [15, 20],
  [18, 18]
] as const
type Surface = OffscreenCanvas | HTMLCanvasElement
type Brush = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type Rect = readonly [x: number, y: number, width: number, height: number]
interface Layout {
  solid: readonly Rect[]
  detail: readonly Rect[]
  accent: Rect
  trace?: readonly (readonly [number, number])[]
}

// Each miniature has a distinct layout on a shared 22 × 20 grid. Fine rules and gutters
// survive rasterization at 2× in all three aspect ratios.
const layouts = {
  article: {
    solid: [
      [0, 0, 22, 2],
      [3, 5, 11, 1.5]
    ],
    detail: [
      [3, 9, 5, 7],
      [10, 9, 9, 0.8],
      [10, 11, 7, 0.8],
      [10, 13, 8, 0.8],
      [10, 15, 5, 0.8]
    ],
    accent: [16, 5, 3, 1.5]
  },
  catalog: {
    solid: [
      [2, 3, 10, 1.5],
      [2, 14, 7, 1],
      [12, 14, 8, 1]
    ],
    detail: [
      [2, 7, 8, 5.5],
      [12, 7, 8, 5.5],
      [2, 16.5, 5, 0.8],
      [12, 16.5, 6, 0.8]
    ],
    accent: [16, 3, 4, 1.5]
  },
  invoice: {
    solid: [
      [3, 3, 8, 1.6],
      [14, 15.5, 5, 1.4]
    ],
    detail: [
      [3, 7, 16, 0.8],
      [3, 10, 9, 0.8],
      [15, 10, 4, 0.8],
      [3, 12.5, 6, 0.8],
      [15, 12.5, 4, 0.8]
    ],
    accent: [16, 3, 3, 2]
  },
  handbook: {
    solid: [
      [0, 0, 22, 2],
      [9, 5, 9, 1.3],
      [9, 11.5, 7, 1.1]
    ],
    detail: [
      [2, 5, 4.5, 12],
      [9, 8, 10.5, 0.8],
      [9, 14, 10, 0.8],
      [9, 16, 8, 0.8]
    ],
    accent: [2, 6, 4.5, 1.3]
  },
  brief: {
    solid: [
      [2.5, 3, 10, 1.5],
      [2.5, 6, 6, 1.2]
    ],
    detail: [
      [13, 6, 6.5, 7],
      [2.5, 10, 8, 0.8],
      [2.5, 12, 6.5, 0.8],
      [2.5, 15.5, 17, 0.8],
      [2.5, 17.5, 12, 0.8]
    ],
    accent: [13, 11.5, 6.5, 1.5]
  },
  schedule: {
    solid: [
      [2, 3, 10, 1.5],
      [2, 7, 18, 0.8]
    ],
    detail: [
      [3, 10, 3, 1],
      [8, 10, 10, 1.4],
      [3, 13, 3, 1],
      [3, 16, 3, 1],
      [8, 16, 8, 1.4]
    ],
    accent: [8, 13, 6, 1.5]
  },
  windows: {
    solid: [
      [3, 4, 9, 7],
      [10, 11, 9, 5]
    ],
    detail: [
      [3, 12.5, 5, 0.9],
      [14, 6, 5, 1.1],
      [10, 17.5, 6, 0.7]
    ],
    accent: [3, 4, 9, 1.8]
  },
  ticker: {
    solid: [
      [2, 3, 8, 2],
      [2, 8, 2, 2],
      [2, 12, 2, 2],
      [2, 16, 2, 2]
    ],
    detail: [
      [6, 8.5, 10, 1],
      [6, 12.5, 7, 1],
      [6, 16.5, 12, 1]
    ],
    accent: [16, 3, 4, 1.6]
  },
  twinBars: {
    solid: [
      [5, 10, 4, 6.5],
      [10.5, 6, 4, 10.5]
    ],
    detail: [
      [2, 3, 8, 1],
      [3, 17.5, 16, 0.8]
    ],
    accent: [10.5, 6, 4, 2]
  },
  console: {
    solid: [
      [2, 3, 4, 14],
      [8, 4, 10, 1.4],
      [8, 8, 6.5, 5]
    ],
    detail: [
      [16, 8, 4, 1],
      [16, 10.5, 3, 1],
      [8, 15, 9, 0.9]
    ],
    accent: [2, 6, 4, 2]
  },
  lineChart: {
    solid: [
      [2, 3, 8, 1.5],
      [16, 3, 3, 1.5]
    ],
    detail: [[2, 16.5, 18, 0.8]],
    accent: [16, 3, 3, 1.5],
    trace: [
      [3, 14],
      [7, 10],
      [10, 12],
      [15, 7.5],
      [19, 9]
    ]
  },
  strips: {
    solid: [
      [2, 4, 10, 2.5],
      [5, 9, 13, 2.5]
    ],
    detail: [
      [8, 14, 12, 2],
      [2, 14, 4, 0.9]
    ],
    accent: [15, 4, 4, 2.5]
  },
  tiles: {
    solid: [
      [2, 3, 7.5, 6],
      [12, 3, 7.5, 6]
    ],
    detail: [
      [2, 11, 5, 1],
      [12, 11, 7, 1],
      [2, 15, 10, 1.2]
    ],
    accent: [15, 14.5, 4.5, 2.3]
  },
  columns: {
    solid: [
      [3, 3, 7, 1.5],
      [3, 7, 8, 9]
    ],
    detail: [
      [13, 7, 6, 1.3],
      [13, 10, 5, 1],
      [13, 13, 3.5, 1]
    ],
    accent: [13, 15.5, 5, 1.2]
  },
  tracks: {
    solid: [
      [2.5, 3, 8, 1.4],
      [2.5, 7, 2, 2],
      [2.5, 12, 2, 2]
    ],
    detail: [
      [6, 7, 12.5, 2],
      [6, 12, 8, 2],
      [6, 16, 11, 0.8]
    ],
    accent: [6, 12, 5, 2]
  },
  kiosk: {
    solid: [
      [3, 4, 15, 8],
      [9.5, 12, 2, 2],
      [7, 14, 7, 1.5]
    ],
    detail: [[3, 17, 7, 0.7]],
    accent: [5, 6, 9, 1.3]
  },
  folio: {
    solid: [[6, 3, 12, 13]],
    detail: [
      [3.5, 6, 1, 12],
      [3.5, 17, 11.5, 1]
    ],
    accent: [8, 6, 7, 1.5]
  },
  storefront: {
    solid: [
      [3, 5, 16, 3],
      [4, 10, 6, 5],
      [12, 10, 6, 5]
    ],
    detail: [[3, 17, 16, 0.8]],
    accent: [3, 5, 4, 1.2]
  },
  parcel: {
    solid: [[5, 5, 12, 10.5]],
    detail: [
      [3, 17.5, 7, 0.7],
      [12, 17.5, 4, 0.7]
    ],
    accent: [10, 5, 2, 4]
  },
  stack: {
    solid: [
      [3, 4, 13, 4],
      [6, 10, 13, 4]
    ],
    detail: [
      [3, 16, 5, 0.8],
      [10, 16, 9, 0.8]
    ],
    accent: [8, 11.5, 6, 1]
  }
} as const satisfies Record<string, Layout>

type Design = readonly [
  family: 'paper' | 'interface' | 'poster',
  background: string,
  layout: keyof typeof layouts,
  accent: string
]

// Interleave families so a partial deck also stays close to 30% paper, 45% dark, 25% color.
const designs: readonly Design[] = [
  ['interface', '#0B1020', 'windows', '#3B82F6'],
  ['paper', '#FFFFFF', 'article', '#2563EB'],
  ['poster', '#1A46CC', 'kiosk', '#1A46CC'],
  ['interface', '#0B1020', 'ticker', '#10B981'],
  ['paper', '#F6F8FC', 'catalog', '#D9413A'],
  ['interface', '#0B1020', 'twinBars', '#E59A38'],
  ['poster', '#9C3535', 'folio', '#9C3535'],
  ['interface', '#0B1020', 'console', '#3B82F6'],
  ['paper', '#FFFFFF', 'invoice', '#0F9D8A'],
  ['poster', '#126B5D', 'storefront', '#126B5D'],
  ['interface', '#0B1020', 'lineChart', '#10B981'],
  ['paper', '#F6F8FC', 'handbook', '#2563EB'],
  ['interface', '#0B1020', 'strips', '#D64545'],
  ['poster', '#A46224', 'parcel', '#A46224'],
  ['interface', '#0B1020', 'tiles', '#E59A38'],
  ['paper', '#FFFFFF', 'brief', '#D9413A'],
  ['interface', '#0B1020', 'columns', '#3B82F6'],
  ['poster', '#4B2F8E', 'stack', '#4B2F8E'],
  ['paper', '#F6F8FC', 'schedule', '#0F9D8A'],
  ['interface', '#0B1020', 'tracks', '#10B981']
]
function surface(w: number, h: number): Surface | undefined {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

function getBrush(tile: Surface | undefined) {
  const ctx = tile?.getContext('2d')
  return ctx && 'drawImage' in ctx ? ctx : undefined
}

function artwork(ctx: Brush, [family, background, name, accent]: Design) {
  const layout: Layout = layouts[name]
  ctx.fillStyle = background
  ctx.fillRect(0, 0, 22, 20)
  ctx.fillStyle = family === 'paper' ? '#334155' : family === 'poster' ? '#FFFFFF' : '#EDF2FA'
  for (const rect of layout.solid) ctx.fillRect(...rect)
  ctx.fillStyle = family === 'paper' ? '#BCC8D6' : '#CBD5E1'
  for (const rect of layout.detail) ctx.fillRect(...rect)
  if (layout.trace) {
    ctx.beginPath()
    ctx.moveTo(...layout.trace[0])
    for (const point of layout.trace.slice(1)) ctx.lineTo(...point)
    ctx.strokeStyle = '#EDF2FA'
    ctx.lineWidth = 1.1
    ctx.stroke()
  }
  ctx.fillStyle = accent
  ctx.fillRect(...layout.accent)
}

function bakeDesign(design: Design, w: number, h: number) {
  const tile = surface(2 * w, 2 * h)
  const ctx = getBrush(tile)
  if (!ctx) return
  ctx.scale(w / 11, h / 10)
  artwork(ctx, design)
  return tile
}

interface Photo {
  tiles: (Surface | undefined)[]
}
function loadPhoto(url: string): Photo {
  const photo: Photo = { tiles: [] }
  if (typeof Image === 'undefined') return photo
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) return
    // Crop once per aspect ratio. A bitmap of the original photo never enters the live draw loop.
    photo.tiles = formats.map(([w, h]) => {
      const tile = surface(2 * w, 2 * h)
      const ctx = getBrush(tile)
      if (!ctx || !tile) return
      const cover = Math.max(tile.width / image.naturalWidth, tile.height / image.naturalHeight)
      const sw = tile.width / cover,
        sh = tile.height / cover
      ctx.drawImage(
        image,
        (image.naturalWidth - sw) / 2,
        (image.naturalHeight - sh) / 2,
        sw,
        sh,
        0,
        0,
        tile.width,
        tile.height
      )
      return tile
    })
  }
  image.src = url
  return photo
}

function thumbnailFormat(id: string) {
  return Math.floor(seed(id + 'card') * formats.length)
}

function thumbnailSize(id: string): readonly [number, number] {
  return formats[thumbnailFormat(id)]
}

interface StarThumbnail {
  width: number
  height: number
  format: number
  design: Design
  image?: Surface
  photo?: Photo
}

class StarThumbnails {
  private atlas?: (Surface | undefined)[][]
  private photos = new Map<string, Photo>()

  private tile(id: string, motif: number, photo?: Photo): StarThumbnail {
    this.atlas ??= designs.map((design) => formats.map(([w, h]) => bakeDesign(design, w, h)))
    const format = thumbnailFormat(id),
      [width, height] = formats[format]
    return {
      width,
      height,
      format,
      design: designs[motif],
      image: this.atlas[motif][format],
      photo
    }
  }

  prepare(marks: Iterable<Mark>, entities: Iterable<Mark['entity']>) {
    const cards = new Map<string, StarThumbnail>()
    const photos = new Map<string, Photo>()
    const candidates: { mark: Mark; url: string }[] = []
    for (const mark of marks) {
      if (mark.role !== 'leaf') continue
      const supplied = 'thumbnailUrl' in mark.entity ? mark.entity.thumbnailUrl : null
      const url = typeof supplied === 'string' ? supplied.trim() : ''
      if (url || mark.seed >= 0.75) candidates.push({ mark, url })
    }
    const byCluster = new Map<string, Mark[]>()
    for (const { mark } of candidates) {
      const group = byCluster.get(mark.parent) ?? []
      group.push(mark)
      byCluster.set(mark.parent, group)
    }
    const assigned = new Map<string, number>()
    const clusters = [...byCluster.keys()].sort((a, b) => seed(a) - seed(b) || a.localeCompare(b))
    for (const cluster of clusters) {
      const group = byCluster.get(cluster)!
      group.sort(
        (a, b) => seed(a.key + '/poster') - seed(b.key + '/poster') || a.key.localeCompare(b.key)
      )
      for (const mark of group) assigned.set(mark.key, assigned.size % designs.length)
    }
    for (const { mark, url } of candidates) {
      const id = mark.entity.id
      const motif = assigned.get(mark.key)!
      let photo: Photo | undefined
      if (url) {
        photo = photos.get(url) ?? this.photos.get(url) ?? loadPhoto(url)
        photos.set(url, photo)
      }
      cards.set(mark.key, this.tile(id, motif, photo))
    }
    // A category hub in the full graph, or an unclassified entity, can first become a
    // card at depth two. Its fallback uses the same atlas without reassigning overview art.
    for (const entity of entities) {
      if (cards.has(entity.id)) continue
      const url =
        'thumbnailUrl' in entity && typeof entity.thumbnailUrl === 'string'
          ? entity.thumbnailUrl.trim()
          : ''
      if (!url && seed(entity.id) < 0.75) continue
      const photo = url ? (photos.get(url) ?? this.photos.get(url) ?? loadPhoto(url)) : undefined
      if (photo) photos.set(url, photo)
      const motif = Math.floor(seed(entity.id + '/poster') * designs.length)
      cards.set(entity.id, this.tile(entity.id, motif, photo))
    }
    this.photos = photos
    return cards
  }
}

function paintThumbnail(
  ctx: CanvasRenderingContext2D,
  card: StarThumbnail,
  x: number,
  y: number,
  w: number,
  h: number,
  family: number,
  leaf: number,
  dpr = 1,
  radial = false
) {
  const image = card.photo?.tiles[card.format] ?? card.image
  const framed = !!card.photo || card.design[0] !== 'interface'
  const left = framed ? Math.round((x - w / 2) * dpr) / dpr : x - w / 2
  const top = framed ? Math.round((y - h / 2) * dpr) / dpr : y - h / 2
  // A one-pixel dark gap keeps a white frame distinguishable even on white artwork.
  // Contain the entire cached tile at its original aspect ratio inside the existing hit box.
  const scale = framed ? Math.max(0, 1 - 4 / Math.min(w, h)) : 1
  const imageW = w * scale,
    imageH = h * scale
  const imageX = left + (w - imageW) / 2,
    imageY = top + (h - imageH) / 2
  if (framed) {
    ctx.fillStyle = '#0B1020'
    ctx.fillRect(left, top, w, h)
  }
  if (image) ctx.drawImage(image, imageX, imageY, imageW, imageH)
  else {
    ctx.save()
    ctx.translate(imageX, imageY)
    ctx.scale(imageW / 22, imageH / 20)
    artwork(ctx, card.design)
    ctx.restore()
  }
  const opacity = ctx.globalAlpha
  const emphasis = Math.max(family, leaf)
  ctx.globalAlpha = framed ? opacity : opacity * (0.45 + 0.55 * emphasis)
  ctx.strokeStyle = blendInk(framed ? '#FFFFFF' : '#B9CEF0', '#2EE89A', emphasis)
  if (radial)
    ctx.strokeStyle = blendInk(
      blendInk(framed ? '#FFFFFF' : '#B9CEF0', focusGreen, family),
      '#FFFFFF',
      leaf
    )
  ctx.lineWidth = radial ? mix(1, 1.1, family) + 0.1 * leaf : framed ? 1 : 0.85 + 0.15 * emphasis
  const inset = framed ? 0.5 : 0
  ctx.strokeRect(left + inset, top + inset, w - 2 * inset, h - 2 * inset)
  ctx.globalAlpha = opacity
}

const stretchStiffness = 0.075
const leafDrag = 0.76
const hubDrag = 0.85
const maxLeafSpeed = 26

interface FluidMark extends Mark {
  live: boolean
  position: Point
  velocity: Point
  naturalDist: number
  distNorm: number
  targetDist: number
  focusT: number
  avgLeafDist: number
  collideR: number
  phaseB: number
  wasHeld?: boolean
}

interface Bounds {
  left: number
  right: number
  top: number
  bottom: number
}

interface FluidFrame {
  seconds: number
  step: number
  zoom: number
  bounds: Bounds
  viewport?: { width: number; height: number }
  mouse: Point | null
  pointerFlow: Point
  intro?: boolean
  warmup?: number
  hotKey: string | null
  held?: FluidMark
  dragGoal: Point | null
  still: boolean
}

interface Canopy<T extends FluidMark> {
  hub: T
  leaves: T[]
}

function cacheCanopies<T extends FluidMark>(marks: Map<string, T>) {
  const groups = new Map<string, Canopy<T>>()
  for (const hub of marks.values()) {
    if (hub.live && hub.role === 'hub') groups.set(hub.key, { hub, leaves: [] })
  }
  for (const leaf of marks.values()) {
    if (!leaf.live || leaf.role !== 'leaf') continue
    const group = groups.get(leaf.parent)
    if (!group) continue
    leaf.naturalDist = Math.hypot(leaf.x - group.hub.x, leaf.y - group.hub.y)
    group.leaves.push(leaf)
  }
  for (const { hub, leaves } of groups.values()) {
    hub.avgLeafDist = leaves.reduce((sum, leaf) => sum + leaf.naturalDist, 0) / (leaves.length || 1)
    hub.collideR = Math.max(82, hub.avgLeafDist * 0.92 + 24)
    if (!leaves.length) continue
    const distances = leaves.map((leaf) => leaf.naturalDist)
    const minDist = Math.min(...distances)
    const span = Math.max(0.001, Math.max(...distances) - minDist)
    for (const leaf of leaves) {
      leaf.distNorm = (leaf.naturalDist - minDist) / span
      leaf.targetDist = leaf.naturalDist
    }
  }
  return [...groups.values()]
}

function limitVelocity(velocity: Point, maxSpeed: number) {
  const speed = Math.hypot(velocity.x, velocity.y)
  if (speed <= maxSpeed) return
  velocity.x *= maxSpeed / speed
  velocity.y *= maxSpeed / speed
}

function stayInView(hub: FluidMark, bounds: Bounds) {
  const { position, velocity } = hub
  const x = clamp(position.x, bounds.left, bounds.right)
  const y = clamp(position.y, bounds.top, bounds.bottom)
  if ((position.x - x) * velocity.x > 0) velocity.x = 0
  if ((position.y - y) * velocity.y > 0) velocity.y = 0
  position.x = x
  position.y = y
}

function hubCurrent(hub: FluidMark, seconds: number, intro = false): Point {
  const phaseA = hub.seed * TAU
  return {
    x: intro
      ? 0.05 * Math.sin(seconds * 0.18 + phaseA) + 0.026 * Math.cos(seconds * 0.24 + hub.phaseB)
      : 0.0165 * Math.sin(seconds * 0.32 + phaseA) + 0.0048 * Math.cos(seconds * 0.23 + hub.phaseB),
    y: intro
      ? 0.045 * Math.cos(seconds * 0.21 + hub.phaseB) + 0.024 * Math.sin(seconds * 0.15 + phaseA)
      : 0.0165 * Math.cos(seconds * 0.27 + hub.phaseB) + 0.0048 * Math.sin(seconds * 0.2 + phaseA)
  }
}

function leafSway(leaf: FluidMark, seconds: number) {
  return (
    0.021 * Math.sin(seconds * 0.57 + leaf.phaseB) +
    0.012 * Math.cos(seconds * 0.37 + leaf.seed * TAU)
  )
}

/** Advance the water current on the settled particles while the petals are still opening. */
function stepBloomCurrent(groups: readonly Canopy<FluidMark>[], seconds: number, step: number) {
  const hubRetention = hubDrag ** step,
    leafRetention = leafDrag ** step
  function drift(m: FluidMark, ax: number, ay: number, retention: number) {
    const { position, velocity } = m
    velocity.x = (velocity.x + ax * step) * retention
    velocity.y = (velocity.y + ay * step) * retention
    position.x += velocity.x * step
    position.y += velocity.y * step
  }
  for (const { hub, leaves } of groups) {
    const current = hubCurrent(hub, seconds)
    drift(hub, current.x, current.y, hubRetention)
    for (const leaf of leaves) {
      const dx = leaf.position.x - hub.position.x,
        dy = leaf.position.y - hub.position.y
      const speed = leafSway(leaf, seconds) / Math.max(0.001, Math.hypot(dx, dy))
      drift(leaf, -dy * speed, dx * speed, leafRetention)
    }
  }
}

function stepHub(hub: FluidMark, held: FluidMark | undefined, frame: FluidFrame, scale: number) {
  const { step, seconds, bounds, mouse, pointerFlow, zoom, still, intro } = frame
  const { position: p, velocity: v } = hub
  if (!still) {
    const swim = hubCurrent(hub, seconds, intro)
    v.x += swim.x * step
    v.y += swim.y * step
    if (mouse) {
      const dx = p.x - mouse.x
      const dy = p.y - mouse.y
      const dist = Math.hypot(dx, dy)
      const tDist = clamp(1 - (dist * zoom) / (intro ? 320 : 240))
      const localW = intro ? tDist ** 2 : tDist * tDist * (3 - 2 * tDist) * tDist
      const wind = (intro ? 0.025 : 0.055) * localW * step
      const ripple = intro
        ? 0
        : (0.055 * localW * clamp((Math.hypot(pointerFlow.x, pointerFlow.y) * zoom) / 8) * step) /
          Math.max(dist, 1)
      v.x += pointerFlow.x * wind + dx * ripple
      v.y += pointerFlow.y * wind + dy * ripple
    }
  }
  if (held?.parent === hub.key) {
    v.x += (held.position.x - p.x) * 0.004 * step
    v.y += (held.position.y - p.y) * 0.004 * step
  }

  const margin = hub.collideR * 0.72 * scale
  if (margin > 0) {
    const wall = (distance: number) => (Math.max(0, margin - distance) ** 2 * 0.045) / margin
    v.x += (wall(p.x - bounds.left) - wall(bounds.right - p.x)) * step
    v.y += (wall(p.y - bounds.top) - wall(bounds.bottom - p.y)) * step
  }
  // A hover adds local viscosity while collisions can still displace the hub.
  const hoverDrag = mouse && frame.hotKey === hub.key ? 0.28 : 1
  const drag = ((intro ? 0.84 : hubDrag) * hoverDrag) ** step
  v.x *= drag
  v.y *= drag
  limitVelocity(v, 20)
  p.x += v.x * step
  p.y += v.y * step
  stayInView(hub, bounds)
}

function pushHub(
  hub: FluidMark,
  other: FluidMark,
  ux: number,
  uy: number,
  correction: number,
  impulse: number,
  bounds: Bounds
) {
  const { position: p, velocity: v } = hub
  const tx = p.x + ux * correction,
    ty = p.y + uy * correction
  let x = clamp(tx, bounds.left, bounds.right),
    y = clamp(ty, bounds.top, bounds.bottom)

  // At a wall, spend the blocked part of the correction by sliding past the other hub.
  const blocked = Math.hypot(tx - x, ty - y)
  if (blocked > 0.001) {
    const q = other.position
    let best = Math.hypot(x - q.x, y - q.y)
    const baseX = x,
      baseY = y
    for (const side of [-1, 1]) {
      const sx = clamp(baseX - uy * blocked * side, bounds.left, bounds.right)
      const sy = clamp(baseY + ux * blocked * side, bounds.top, bounds.bottom)
      const gap = Math.hypot(sx - q.x, sy - q.y)
      if (gap > best) {
        best = gap
        x = sx
        y = sy
      }
    }
  }
  v.x += ((x - p.x) / correction) * impulse
  v.y += ((y - p.y) / correction) * impulse
  p.x = x
  p.y = y
}

function separateHubs(
  groups: readonly Canopy<FluidMark>[],
  { held, bounds, step, warmup = 1 }: FluidFrame,
  scale: number,
  samples: number,
  launchBounds?: ReadonlyMap<string, Bounds>
) {
  if (warmup <= 0) return
  const time = step / samples
  const heldShare = 1 - 0.62 ** step
  const freeShare = 1 - 0.78 ** time
  const heldHub = held?.role === 'hub' ? held : undefined

  function separate(a: FluidMark, b: FluidMark, pinned: boolean) {
    const minSep = (a.collideR + b.collideR + 18) * scale
    const dx = b.position.x - a.position.x,
      dy = b.position.y - a.position.y
    if (Math.abs(dx) >= minSep || Math.abs(dy) >= minSep) return
    const distance = Math.hypot(dx, dy)
    const overlap = minSep - distance
    if (overlap <= 0) return
    let ux = dx / Math.max(0.001, distance)
    let uy = dy / Math.max(0.001, distance)
    if (distance <= 0.001) {
      const phase =
        pinned && Math.hypot(a.velocity.x, a.velocity.y) > 0.001
          ? Math.atan2(a.velocity.y, a.velocity.x)
          : (a.seed + b.seed) * TAU
      ux = Math.cos(phase)
      uy = Math.sin(phase)
    }
    const correction = overlap * (pinned ? heldShare : freeShare) * warmup
    const impulse = overlap * 0.055 * time * (pinned ? 1 : 0.5) * warmup
    if (!pinned) pushHub(a, b, -ux, -uy, correction, impulse, launchBounds?.get(a.key) ?? bounds)
    pushHub(b, a, ux, uy, correction, impulse, launchBounds?.get(b.key) ?? bounds)
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < groups.length; i++) {
      const a = groups[i].hub
      if (a === heldHub) continue
      for (let j = i + 1; j < groups.length; j++) {
        const b = groups[j].hub
        if (b !== heldHub) separate(a, b, false)
      }
    }
    // Solve the pinned contacts last so the free pairs can't push a hub back through the pointer.
    if (heldHub) {
      for (const { hub } of groups) {
        if (hub !== heldHub) separate(heldHub, hub, true)
      }
    }
  }
}

function spreadLeaves(group: Canopy<FluidMark>, frame: FluidFrame) {
  const { hub, leaves } = group
  const minSpacing = 38 * (1 - 0.295 * hub.focusT)
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i]
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j]
      const repelR = Math.max(minSpacing, Math.min(a.targetDist, b.targetDist) * 0.68)
      const dx = b.position.x - a.position.x,
        dy = b.position.y - a.position.y
      if (Math.abs(dx) >= repelR || Math.abs(dy) >= repelR) continue
      const distance = Math.hypot(dx, dy)
      if (distance >= repelR) continue
      const angle = distance <= 0.001 ? seed(a.key + ':' + b.key) * TAU : 0
      const ux = distance > 0.001 ? dx / distance : Math.cos(angle)
      const uy = distance > 0.001 ? dy / distance : Math.sin(angle)
      const impulse = (1 - distance / repelR) * 0.65 * frame.step
      if (a !== frame.held) {
        a.velocity.x -= ux * impulse
        a.velocity.y -= uy * impulse
      }
      if (b !== frame.held) {
        b.velocity.x += ux * impulse
        b.velocity.y += uy * impulse
      }
    }
  }
}

function separateDraggedTips(group: Canopy<FluidMark>, frame: FluidFrame) {
  const { leaves, hub } = group
  const spacing = (26 * (1 - 0.295 * hub.focusT)) / frame.zoom
  if (leaves.length < 2) return
  for (let pass = 0; pass < 6; pass++) {
    let touching = false
    for (let i = 0; i < leaves.length; i++) {
      const a = leaves[i]
      for (let j = i + 1; j < leaves.length; j++) {
        const b = leaves[j]
        const dx = b.position.x - a.position.x
        const dy = b.position.y - a.position.y
        if (Math.abs(dx) >= spacing || Math.abs(dy) >= spacing) continue
        const distance = Math.hypot(dx, dy)
        if (distance >= spacing - 0.02 / frame.zoom) continue
        touching = true
        const angle = distance <= 0.001 ? seed(a.key + ':' + b.key) * TAU : 0
        const ux = distance > 0.001 ? dx / distance : Math.cos(angle)
        const uy = distance > 0.001 ? dy / distance : Math.sin(angle)
        const correction = (spacing - distance) * (a === frame.held || b === frame.held ? 1 : 0.5)
        if (a !== frame.held) {
          a.position.x -= ux * correction
          a.position.y -= uy * correction
        }
        if (b !== frame.held) {
          b.position.x += ux * correction
          b.position.y += uy * correction
        }
      }
    }
    if (!touching) break
  }
}

function leafCurrent(
  leaf: FluidMark,
  hub: FluidMark,
  nx: number,
  ny: number,
  distance: number,
  frame: FluidFrame
) {
  const { step, seconds, mouse, pointerFlow, zoom, intro } = frame
  const p = leaf.position
  const v = leaf.velocity
  if (!intro) {
    const sway = leafSway(leaf, seconds)
    v.x -= ny * sway * step
    v.y += nx * sway * step
  }
  if (!mouse) return
  const dx = p.x - mouse.x
  const dy = p.y - mouse.y
  const mouseDist = Math.hypot(dx, dy)
  const speed = Math.hypot(pointerFlow.x, pointerFlow.y) * zoom
  const w = clamp(1 - (mouseDist * zoom) / (intro ? 140 : 170)) ** (intro ? 2 : 2.2)
  if (!w) return
  if (intro) {
    const away = (0.46 * clamp(speed / 8)) / Math.max(mouseDist, 1)
    v.x += (dx * away + pointerFlow.x * 0.024) * w * step
    v.y += (dy * away + pointerFlow.y * 0.024) * w * step
    return
  }
  v.x += pointerFlow.x * 0.11 * w * step
  v.y += pointerFlow.y * 0.11 * w * step

  // A moving pointer parts the rays along the shaft as well as around their endpoints.
  const rx = mouse.x - hub.position.x
  const ry = mouse.y - hub.position.y
  const along = (rx * nx + ry * ny) * zoom
  const side = (ry * nx - rx * ny) * zoom
  const shaft = clamp(along / 26) * clamp((distance * zoom - along) / 18)
  const near = clamp(1 - Math.abs(side) / 58) ** 2
  const push = (-0.78 * side * shaft * near * clamp(speed / 8) * w * step) / (Math.abs(side) + 4)
  v.x -= ny * push
  v.y += nx * push
}

function stepLeaf(leaf: FluidMark, hub: FluidMark, frame: FluidFrame) {
  const { position: p, velocity: v, targetDist } = leaf
  const { step, still } = frame
  const dx = p.x - hub.position.x,
    dy = p.y - hub.position.y
  const distance = Math.hypot(dx, dy)
  const angle = leaf.seed * TAU
  const nx = distance > 0.001 ? dx / distance : Math.cos(angle)
  const ny = distance > 0.001 ? dy / distance : Math.sin(angle)
  if (!still) leafCurrent(leaf, hub, nx, ny, distance, frame)
  const dragging = frame.held === hub
  const tightening = hub.focusT > 0.05 && distance > targetDist
  const k = dragging ? 0.16 : tightening ? 0.26 : frame.intro ? 0.095 : 0.11
  const stretchLimit = dragging ? targetDist * 1.22 + 8 : targetDist * 1.55
  const stretch = Math.max(0, distance - stretchLimit)
  const error = targetDist - distance
  const force = error * k - stretch * stretchStiffness
  const drag = (dragging ? 0.74 : tightening ? 0.65 : leafDrag) ** step
  v.x = (v.x + nx * force * step) * drag
  v.y = (v.y + ny * force * step) * drag

  // Critically damp the rope's radial mode. The sideways mode only has water drag.
  const stiffness = k + (stretch > 0 ? stretchStiffness : 0)
  const retention = Math.min(1, (1 + Math.sqrt(stiffness) * step) ** -2 / drag)
  const radial = v.x * nx + v.y * ny
  // A moving spring damps against its anchor's speed along the rope. Tangential motion stays free.
  const anchorSpeed = dragging
    ? clamp((hub.velocity.x * nx + hub.velocity.y * ny) * 0.92, -35, 35)
    : 0
  const damped = radial * retention + anchorSpeed * (1 - drag * retention)
  // Stop a fast release from overshooting the current length under radial momentum.
  const stopAtTarget = error * damped > 0 && Math.abs(damped * step) > Math.abs(error)
  const nextRadial = stopAtTarget ? error / step : damped
  v.x += nx * (nextRadial - radial)
  v.y += ny * (nextRadial - radial)
  // Allow for the bounded radial speed of a moving anchor within the velocity limit.
  limitVelocity(v, maxLeafSpeed + Math.min(maxLeafSpeed, Math.abs(anchorSpeed)))
  p.x += v.x * step
  p.y += v.y * step
  if (stopAtTarget) {
    const remaining = v.x * nx + v.y * ny
    v.x -= nx * remaining
    v.y -= ny * remaining
  }
  if (dragging) {
    // Ease only extension beyond the moving rope's limit. Preserve the leaf's free bearing.
    const rx = p.x - hub.position.x
    const ry = p.y - hub.position.y
    const length = Math.hypot(rx, ry)
    if (length > stretchLimit) {
      const correction = Math.min((length - stretchLimit) * (1 - 0.12 ** step), maxLeafSpeed * step)
      p.x -= (rx / length) * correction
      p.y -= (ry / length) * correction
    }
  }
}

function overviewBounds(viewWidth: number, height: number, baseZoom: number): Bounds {
  const halfW = (viewWidth / 2 - Math.min(8, viewWidth * 0.1)) / baseZoom
  const halfH = (height / 2 - Math.min(8, height * 0.1)) / baseZoom
  return { left: -halfW, right: halfW, top: -halfH, bottom: halfH }
}

function centerClearRadius(width: number, height: number, zoom: number) {
  return Math.max(116, Math.min(width, height) * 0.19) / zoom
}

// A radial projection can hit a side wall on portrait screens. In that case choose the
// nearest valid circle/wall intersection, or the furthest feasible corner of a tiny viewport.
function clearCenter(hub: FluidMark, walls: Bounds, radius: number, blend: number, floor: number) {
  const p = hub.position
  const d = Math.hypot(p.x, p.y)
  if (d >= radius) return
  const r = Math.max(radius * floor, d + (radius - d) * blend)
  if (r <= d) return
  const angle = d > 1e-6 ? Math.atan2(p.y, p.x) : hub.phaseB
  const tx = r * Math.cos(angle),
    ty = r * Math.sin(angle)
  let x = clamp(tx, walls.left, walls.right),
    y = clamp(ty, walls.top, walls.bottom)
  if (Math.hypot(x, y) < r - 1e-7) {
    let best = Infinity,
      extent = -1
    const consider = (a: number, b: number) => {
      if (a < walls.left || a > walls.right || b < walls.top || b > walls.bottom) return
      const reach = Math.min(r, Math.hypot(a, b))
      const cost = (a - tx) ** 2 + (b - ty) ** 2
      if (reach > extent + 1e-7 || (reach >= extent - 1e-7 && cost < best)) {
        extent = reach
        best = cost
        x = a
        y = b
      }
    }
    for (const edge of [walls.left, walls.right]) {
      const along = Math.sqrt(Math.max(0, r * r - edge * edge))
      consider(edge, along)
      consider(edge, -along)
      consider(edge, walls.top)
      consider(edge, walls.bottom)
    }
    for (const edge of [walls.top, walls.bottom]) {
      const along = Math.sqrt(Math.max(0, r * r - edge * edge))
      consider(along, edge)
      consider(-along, edge)
    }
  }
  p.x = x
  p.y = y
  const n = Math.hypot(x, y) || 1
  const inward = Math.min(0, (hub.velocity.x * x + hub.velocity.y * y) / n)
  hub.velocity.x -= (inward * x) / n
  hub.velocity.y -= (inward * y) / n
  stayInView(hub, walls)
}

function contactScale(groups: readonly Canopy<FluidMark>[], bounds: Bounds) {
  const width = bounds.right - bounds.left,
    height = bounds.bottom - bounds.top
  let area = 0,
    largest = 0
  for (const { hub } of groups) {
    area += Math.PI * (hub.collideR + 9) ** 2
    largest = Math.max(largest, hub.collideR + 9)
  }
  // Scale contacts only when the drawer or a narrow viewport leaves too little room to pack them.
  return Math.min(
    1,
    Math.sqrt((0.64 * width * height) / area),
    Math.min(width, height) / (2 * largest)
  )
}

/** Solve the launch's hub contacts on copies of the fitted layout. */
function relaxLaunch(
  groups: readonly Canopy<FluidMark>[],
  bounds: Bounds,
  pad: number,
  zoom = 1,
  radius = centerClearRadius(
    (bounds.right - bounds.left) * zoom,
    (bounds.bottom - bounds.top) * zoom,
    zoom
  )
) {
  const hw = Math.max(1, (bounds.right - bounds.left) / 2)
  const hh = Math.max(1, (bounds.bottom - bounds.top) / 2)
  const copies = groups.map(({ hub }) => ({
    hub: { ...hub, position: { x: hub.x, y: hub.y }, velocity: { x: 0, y: 0 } },
    leaves: []
  }))
  if (copies.length === 8) {
    const ordered = copies
      .map(({ hub }) => ({ hub, angle: Math.atan2(hub.y / hh, hub.x / hw) }))
      .sort((a, b) => a.angle - b.angle)
    const arc = TAU / ordered.length
    const angle0 = Math.atan2(
      ordered.reduce((sum, v, i) => sum + Math.sin(v.angle - i * arc), 0),
      ordered.reduce((sum, v, i) => sum + Math.cos(v.angle - i * arc), 0)
    )
    ordered.forEach(({ hub }, i) => {
      const orbit = clamp(Math.hypot(hub.x / hw, hub.y / hh), 0.58, 0.88)
      hub.position.x = Math.cos(angle0 + arc * i) * hw * orbit
      hub.position.y = Math.sin(angle0 + arc * i) * hh * orbit
    })
  }
  const frame: FluidFrame = {
    seconds: 0,
    step: 1,
    zoom: 1,
    bounds,
    mouse: null,
    pointerFlow: { x: 0, y: 0 },
    hotKey: null,
    dragGoal: null,
    still: true
  }
  // Give each launch endpoint room for its fully unfurled rays and card edges.
  const launchBounds = new Map<string, Bounds>()
  for (const { hub, leaves } of groups) {
    if (!leaves.length) continue
    let { left, right, top, bottom } = bounds
    for (const leaf of leaves) {
      const dx = leaf.x - hub.x,
        dy = leaf.y - hub.y
      left = Math.max(left, bounds.left + pad - dx)
      right = Math.min(right, bounds.right - pad - dx)
      top = Math.max(top, bounds.top + pad - dy)
      bottom = Math.min(bottom, bounds.bottom - pad - dy)
    }
    // A very narrow viewport may fit the hub but be smaller than the open canopy.
    launchBounds.set(hub.key, {
      left: left <= right ? left : bounds.left,
      right: left <= right ? right : bounds.right,
      top: top <= bottom ? top : bounds.top,
      bottom: top <= bottom ? bottom : bounds.bottom
    })
  }
  const scale = contactScale(copies, bounds)
  for (let i = 0; i < 64; i++) {
    for (const { hub } of copies) {
      stepHub(hub, undefined, frame, scale)
      stayInView(hub, launchBounds.get(hub.key) ?? bounds)
    }
    separateHubs(copies, frame, scale, 1, launchBounds)
    for (const { hub } of copies)
      clearCenter(hub, launchBounds.get(hub.key) ?? bounds, radius, 1, 1)
  }
  return new Map(copies.map(({ hub }) => [hub.key, hub.position]))
}

function stepOverview(groups: readonly Canopy<FluidMark>[], frame: FluidFrame) {
  const { held, dragGoal, step, bounds } = frame
  if (!groups.length || step <= 0) return
  const width = frame.viewport?.width ?? (bounds.right - bounds.left) * frame.zoom
  const height = frame.viewport?.height ?? (bounds.bottom - bounds.top) * frame.zoom
  const radius = centerClearRadius(width, height, frame.zoom)
  // Only the central opening stays constant in screen pixels as the camera zooms.
  const centerBounds = frame.viewport ? overviewBounds(width, height, frame.zoom) : bounds
  const start = held && dragGoal ? { ...held.position } : null
  const dx = start && dragGoal ? dragGoal.x - start.x : 0
  const dy = start && dragGoal ? dragGoal.y - start.y : 0
  const moveLength = Math.hypot(dx, dy)
  for (const { hub, leaves } of groups) {
    if (!held && hub.wasHeld) clearCenter(hub, centerBounds, radius, 1, 1)
    const focus = Number(frame.hotKey === hub.key || held === hub)
    const focusSpeed = frame.intro ? 6.5 : focus > hub.focusT ? 18 : 9.5
    const focusBlend = frame.still ? 1 : 1 - Math.exp((-focusSpeed * step) / 60)
    hub.focusT += (focus - hub.focusT) * focusBlend
    hub.collideR = Math.max(82, hub.avgLeafDist * 0.92 + 24) * (1 - 0.44 * hub.focusT)
    for (const leaf of leaves) {
      const shrinkRatio = 0.24 + leaf.distNorm * 0.11
      leaf.targetDist = leaf.naturalDist * (1 - shrinkRatio * hub.focusT)
    }
  }

  const scale = contactScale(groups, bounds)
  if (held && dragGoal && start) {
    held.velocity.x = dx / step
    held.velocity.y = dy / step
    if (held.role === 'leaf') {
      held.position.x = dragGoal.x
      held.position.y = dragGoal.y
    }
  }

  const simulateHubs = !frame.still || !!held
  for (const { hub } of groups) {
    if (hub === held) continue
    if (simulateHubs || hub.velocity.x || hub.velocity.y) stepHub(hub, held, frame, scale)
    else stayInView(hub, bounds)
  }
  if (held?.role === 'hub' && start && dragGoal) {
    // Sweep fast pointer samples so crossing a whole cluster between paints still registers.
    const stride = Math.max(4 / frame.zoom, Math.min(held.collideR * 0.36, 16) * scale)
    const samples = clamp(Math.ceil(moveLength / stride), 1, 48)
    for (let i = 1; i <= samples; i++) {
      held.position.x = start.x + (dx * i) / samples
      held.position.y = start.y + (dy * i) / samples
      separateHubs(groups, frame, scale, samples)
    }
  } else if (simulateHubs) {
    separateHubs(groups, frame, scale, 1)
  }

  for (const group of groups) {
    const { hub } = group
    if (hub !== held) clearCenter(hub, centerBounds, radius, 1 - 0.88 ** step, 0.92)
    hub.wasHeld = hub === held
    spreadLeaves(group, frame)
    for (const leaf of group.leaves) {
      if (leaf !== held) stepLeaf(leaf, group.hub, frame)
    }
    if (group.hub === held) separateDraggedTips(group, frame)
  }
}

export interface CameraPose2D extends Point {
  zoom: number
}
interface RadialMotion {
  angle: number
  radius: number
  phase: number
  home: Point
  offset: Point
  speed: number
}
interface Moving extends FluidMark {
  radial?: RadialMotion
  orbitAngle: number
  orbitRadius: number
  hubFocusT: number
  fromAlpha: number
  sourceScreen: Point
  matchedScreen: boolean
  sourceGlyph?: SourceGlyph
  inBloom: boolean
  alpha: number
  screen: Point
  emphasis: number
  light: number
  titleLight: number
  trunkLight: number
  leafFocusT: number
  nameAlpha: number
  revealAlpha: number
  theme: ClusterInk
  whiteT: number
  thumbnail?: StarThumbnail
  trunkFlow?: LineFlow
}
interface Stroke extends Wire {
  flow: LineFlow
  fromAlpha: number
  alpha: number
  live: boolean
  emphasis: number
  drawProgress: number
  leafActive: boolean
  leafSince: number
  leafFrom: number
  leafWeight: number
  light: number
}
type RadialRole = 'center' | 'neighbor' | 'upstream' | 'satellite' | 'mini'
type RenderRole = SceneMark['role'] | 'satellite'
type Mark = Omit<SceneMark, 'role'> & {
  role: RenderRole
  caption?: Caption
  detailCaption?: Caption
}
type Scene = Omit<BaseScene, 'marks'> & { marks: Map<string, Mark> }
type Caption = {
  lines: string[]
  w: number
  h: number
  dx: number
  dy: number
  size: number
  cell?: { w: number; h: number }
}
type FlightKind = 'enter' | 'drill' | 'branch' | 'back' | 'exit'
const flightTime: Record<FlightKind, number> = {
  enter: 400,
  drill: 420,
  branch: 400,
  back: 360,
  exit: 360
}
const entryTurn = (20 * Math.PI) / 180
const focusGreen = '#22E59B'
const focusBlue = '#4B82FF'
const labelBlue = '#0033FF'
const isOuter = (role: RenderRole) => role === 'neighbor' || role === 'mini'
const isOverviewMark = (role: RenderRole) => role === 'hub' || role === 'leaf'

const breathAmplitude = (radius: number) => clamp(3.2 + (radius / 260) * 3.8, 3.5, 7)

function privateTip(x: number, y: number, fallbackAngle: number): Point {
  const d = Math.hypot(x, y)
  if (d < 0.001) return { x: 32 * Math.cos(fallbackAngle), y: 32 * Math.sin(fallbackAngle) }
  const scale = clamp(d, 32, 56) / d
  return { x: x * scale, y: y * scale }
}

// Separate the release displacement from the moving breathing target. The braking
// envelope brings the leaf in along its original displacement without crossing home.
function glideRadial(r: RadialMotion, step: number) {
  const distance = Math.hypot(r.offset.x, r.offset.y)
  if (!distance || step <= 0) return
  const count = Math.max(1, Math.ceil(step - 0.000001)),
    h = step / count
  const damping = 0.84 ** h
  let remaining = distance
  for (let i = 0; i < count; i++) {
    const traction = (remaining * 0.018 * 0.84 * (1 - damping)) / 0.16
    r.speed = Math.min(r.speed * damping + traction, 5.5, remaining * 0.105)
    remaining = Math.max(0, remaining - r.speed * h)
  }
  if (remaining < 0.035) remaining = r.speed = 0
  r.offset.x *= remaining / distance
  r.offset.y *= remaining / distance
}

function focusConnection(kind: Wire['kind'], from?: Mark, to?: Mark) {
  if (!from || !to || from.key !== to.parent || from.entity.id === to.entity.id) return false
  if (from.role === 'satellite') return kind === 'mini' && to.role === 'mini'
  if (from.role !== 'center') return false
  return (
    (kind === 'focus' && to.role === 'neighbor') ||
    (kind === 'guide' && (to.role === 'upstream' || to.role === 'satellite'))
  )
}

function measureCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  limit: number,
  size = 11.5,
  maxLines = 2
): Caption {
  ctx.font = font(size, 500)
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > limit) {
      lines.push(line)
      line = ''
      if (lines.length === maxLines) {
        let tail = lines[maxLines - 1]
        while (tail && ctx.measureText(tail + '…').width > limit) tail = tail.slice(0, -1)
        lines[maxLines - 1] = tail.trimEnd() + '…'
        break
      }
    }
    line += ch
  }
  if (line || !lines.length) lines.push(line)
  const w = Math.ceil(Math.max(...lines.map((s) => ctx.measureText(s).width))) + 8
  return { lines, w, h: lines.length * (size + 2) + 4, dx: 0, dy: 0, size }
}

function overlap(a: Box, b: Box) {
  const w = Math.min(a.x + a.w + 2, b.x + b.w + 2) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h + 2, b.y + b.h + 2) - Math.max(a.y, b.y)
  return Math.max(0, w) * Math.max(0, h)
}

// Index label rectangles by their vertical span; only nearby rows participate in fitting.
class CaptionObstacles {
  private rows = new Map<number, Box[]>()
  constructor(initial: Box[]) {
    initial.forEach((box) => this.add(box))
  }
  add(box: Box) {
    for (let i = Math.floor((box.y - 2) / 32); i <= Math.floor((box.y + box.h + 2) / 32); i++) {
      const row = this.rows.get(i)
      if (row) row.push(box)
      else this.rows.set(i, [box])
    }
  }
  cost(box: Box) {
    let total = 0
    const first = Math.floor(box.y / 32),
      last = Math.floor((box.y + box.h) / 32)
    for (let i = first; i <= last; i++) {
      for (const other of this.rows.get(i) ?? []) {
        if (i !== Math.max(first, Math.floor((other.y - 2) / 32))) continue
        total += overlap(box, other)
      }
    }
    return total
  }
}

function captionOffsets(p: Point, c: Caption, hw: number, hh: number) {
  const right = hw + 2,
    left = -right - c.w,
    top = -hh - 2 - c.h,
    bottom = hh + 2
  const outer = p.x < 0 ? left : right,
    inner = p.x < 0 ? right : left
  const outwardY = p.y < 0 ? top : bottom,
    inwardY = p.y < 0 ? bottom : top
  return [
    [outer, -c.h / 2],
    [-c.w / 2, outwardY],
    [inner, -c.h / 2],
    [-c.w / 2, inwardY],
    [outer, outwardY],
    [inner, outwardY],
    [outer, inwardY],
    [inner, inwardY]
  ]
}

function compactSlots(width: number, height: number, count: number, obstacles: Box[]) {
  if (width >= 310 || count < 36 || count > 65) return
  // Each cell fits an original-size card and a caption at both contraction endpoints.
  const rows = Math.max(1, Math.floor((height - 12) / 46)),
    pitchY = (height - 12) / rows
  for (
    let columns = Math.max(2, Math.ceil(count / rows));
    columns <= Math.floor(width / 29);
    columns++
  ) {
    const pitchX = (width - 10) / columns
    const slots: Point[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const x = (col + 0.5 - columns / 2) * pitchX,
          y = (row + 0.5 - rows / 2) * pitchY - 9
        const free = [1, 0.9].every((scale) => {
          const box = { x: x * scale - pitchX * 0.45, y: y * scale - 10, w: pitchX * 0.9, h: 40 }
          return !obstacles.some((other) => overlap(box, other) > 0)
        })
        if (free) slots.push({ x, y })
      }
    }
    if (slots.length >= count)
      return { slots, cell: { w: pitchX, h: pitchY }, textWidth: Math.floor(pitchX * 0.9) - 11 }
  }
}

function radialScene(
  index: GraphIndex,
  active: string,
  previous: string | undefined,
  width: number,
  height: number,
  ctx: CanvasRenderingContext2D,
  cards: Map<string, StarThumbnail>,
  bearings: Map<string, number>,
  trail: readonly string[]
): Scene {
  const marks = new Map<string, Mark>(),
    wires = new Map<string, Wire>()
  const occupied: Box[] = [],
    contracted: Box[] = []
  const limits: Box = {
    x: -width / 2 + 5,
    y: -height / 2 + 5,
    w: Math.max(1, width - 10),
    h: Math.max(1, height - 10)
  }
  const degree = (id: string) => index.neighbors.get(id)?.size ?? 0
  const add = (id: string, key: string, role: RadialRole, x: number, y: number, parent = '') => {
    const entity = index.entities.get(id)!
    const m: Mark = {
      key,
      entity,
      role,
      x,
      y,
      parent,
      order: 0,
      count: degree(id),
      seed: seed(id),
      color: colorOfKind(entity.kind)
    }
    marks.set(key, m)
    return m
  }
  const wire = (a: string, b: string, kind: Wire['kind'], label = '') => {
    if (!focusConnection(kind, marks.get(a), marks.get(b))) return
    const key = JSON.stringify([kind, a, b])
    wires.set(key, { key, a, b, kind, label })
  }
  const satelliteDisks: { x: number; y: number; r: number }[] = []
  const capWidth = Math.max(36, Math.min(114, width * 0.16))
  const center = add(active, active, 'center', 0, 0)
  const mainTitle = measureCaption(
    ctx,
    center.entity.name,
    Math.min(172, Math.max(55, width * 0.38)),
    13
  )
  mainTitle.dx = -mainTitle.w / 2
  mainTitle.dy = -16 - mainTitle.h
  center.caption = mainTitle
  occupied.push({
    x: mainTitle.dx - 2,
    y: mainTitle.dy - 2,
    w: mainTitle.w + 4,
    h: -mainTitle.dy + 12
  })
  occupied.push({ x: -width / 2 + 8, y: -height / 2 + 8, w: 98, h: 32 })
  const rows = [...(index.neighbors.get(active) ?? [])]
  const deep = !!previous && previous !== active && index.entities.has(previous)
  if (deep) {
    const top = add(previous, previous, 'upstream', 0, -height / 2 + 34, active)
    const c = measureCaption(ctx, top.entity.name, Math.min(135, width * 0.29))
    ctx.font = font(9, 600)
    c.w += ctx.measureText(String(top.count)).width + 5
    c.dx = 8
    c.dy = -c.h - 2
    top.caption = c
    occupied.push({ x: -5, y: top.y + c.dy, w: c.w + 14, h: c.h + 9 })
    wire(active, previous, 'guide', index.neighbors.get(active)?.get(previous))
  }
  const candidates = rows.filter(([id]) => id !== active && !(deep && id === previous))
  // Reserve all real first-hop IDs before allocating any private second-hop tips.
  const promoted = new Set<string>()
  if (deep) {
    const used = new Set([...trail, active, ...rows.map(([id]) => id)])
    const groups = candidates
      .map(([via]) => ({
        via,
        branches: [...(index.neighbors.get(via) ?? [])].filter(([id]) => !used.has(id))
      }))
      .filter((g) => g.branches.length >= 4)
      .sort((a, b) => b.branches.length - a.branches.length || a.via.localeCompare(b.via))
    const maxGroups = width >= 650 ? 2 : 1
    let count = 0
    for (const { via, branches } of groups) {
      const tips = branches.filter(([id]) => !used.has(id)).slice(0, 7)
      if (tips.length < 4) continue
      const side = count % 2 ? -1 : 1
      const arm = clamp(width * 0.059, 44, 50)
      const x = side * Math.max(0, width / 2 - arm - Math.min(59, width * 0.08))
      const y = (count % 2 ? 1 : -1) * Math.min(height * 0.22, 108)
      if (Math.hypot(x, y) <= arm + 12) continue
      const hub = add(via, via, 'satellite', x, y, active)
      promoted.add(via)
      wire(active, hub.key, 'guide', index.neighbors.get(active)?.get(via))
      satelliteDisks.push({ x, y, r: arm + 5 })
      occupied.push({ x: x - arm - 6, y: y - arm - 5, w: 2 * arm + 12, h: 2 * arm + 10 })
      const miniLabels: Box[] = []
      tips.forEach(([id, relation], i) => {
        used.add(id)
        const angle = -1.1 + (i * TAU) / tips.length
        const radius = Math.max(35, arm * (0.84 + 0.16 * (i % 2)))
        const dx = Math.cos(angle) * radius,
          dy = Math.sin(angle) * radius
        const tip = add(id, JSON.stringify(['branch', via, id]), 'mini', x + dx, y + dy, hub.key)
        const cap = measureCaption(ctx, tip.entity.name, Math.min(82, capWidth), 10)
        const opts = captionOffsets({ x: dx, y: dy }, cap, 3, 3)
        const bound = (a: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, a))
        let best: Box | undefined,
          score = Infinity
        for (const [px, py] of opts) {
          const b = {
            x: bound(tip.x + px, limits.x, limits.x + limits.w - cap.w),
            y: bound(tip.y + py, limits.y, limits.y + limits.h - cap.h),
            w: cap.w,
            h: cap.h
          }
          const cost = miniLabels.reduce((n, box) => n + overlap(b, box), 0)
          if (cost < score) {
            best = b
            score = cost
          }
          if (!cost) break
        }
        cap.dx = best!.x - tip.x
        cap.dy = best!.y - tip.y
        tip.caption = cap
        miniLabels.push(best!)
        wire(hub.key, tip.key, 'mini', relation)
      })
      if (++count >= maxGroups) break
    }
  }
  const direct = candidates.filter(([id]) => !promoted.has(id))
  contracted.push(...occupied)
  const rings = [0.48, 0.72, 0.96, 1.18]
  const base = Math.max(
    12,
    Math.min((width / 2 - 15) / (1.18 * 1.38), (height / 2 - 22) / (1.18 * 0.92))
  )
  const compact = width < 350 && direct.length > 20
  // The sidebar can leave a tall, narrow strip. Use its height before shortening any name.
  const vertical =
    width < height * 0.84 ? Math.max(base * 0.92, (height / 2 - 30) / 1.18) : base * 0.92
  const known = direct.filter(([id]) => bearings.has(id)).length
  if (known)
    direct.sort(
      ([a], [b]) => (bearings.get(a) ?? TAU) - (bearings.get(b) ?? TAU) || a.localeCompare(b)
    )
  const step = TAU / Math.max(1, direct.length)
  let sumX = 0,
    sumY = 0
  direct.forEach(([id], i) => {
    const a = bearings.get(id)
    if (a !== undefined) {
      sumX += Math.cos(a - i * step)
      sumY += Math.sin(a - i * step)
    }
  })
  const start = known ? Math.atan2(sumY, sumX) + entryTurn : -1.32
  const limitCost = (b: Box) =>
    Math.max(
      0,
      b.w * b.h -
        Math.max(0, Math.min(b.x + b.w, limits.x + limits.w) - Math.max(b.x, limits.x)) *
          Math.max(0, Math.min(b.y + b.h, limits.y + limits.h) - Math.max(b.y, limits.y))
    )
  const compactGrid = compactSlots(width, height, direct.length, occupied)
  const expandedSpace = new CaptionObstacles(occupied)
  const contractedSpace = new CaptionObstacles(contracted)
  direct.forEach(([id, relation], i) => {
    const mark = add(id, id, 'neighbor', 0, 0, active)
    const cap = measureCaption(
      ctx,
      mark.entity.name,
      compactGrid?.textWidth ?? (direct.length > 45 ? Math.min(capWidth, 85) : capWidth),
      11.5,
      compactGrid || (compact && (width * height) / direct.length < 2700) ? 1 : 2
    )
    const card = cards.get(id),
      hw = (card?.width ?? 6) / 2,
      hh = (card?.height ?? 6) / 2
    let best = Infinity
    const costOf = (box: Box, space: CaptionObstacles) => 3 * limitCost(box) + space.cost(box)
    const boxes = (x: number, y: number, dx: number, dy: number): [Box, Box] => {
      const r = Math.hypot(x, y) || 1
      const pulse = breathAmplitude(r)
      const px = Math.abs(x / r) * pulse + Math.abs(y) * 0.011
      const py = Math.abs(y / r) * pulse + Math.abs(x) * 0.011
      return [
        { x: x - hw - px - 1, y: y - hh - py - 1, w: 2 * (hw + px + 1), h: 2 * (hh + py + 1) },
        { x: x + dx - px, y: y + dy - py, w: cap.w + 2 * px, h: cap.h + 2 * py }
      ]
    }
    function place(x: number, y: number) {
      // Leave the satellite's entire fan clear of main spokes passing through it.
      if (
        satelliteDisks.some((disk) => {
          const t = clamp((disk.x * x + disk.y * y) / (x * x + y * y || 1))
          return Math.hypot(x * t - disk.x, y * t - disk.y) < disk.r
        })
      )
        return false
      const [outerBody, outerLabel] = boxes(x, y, 0, 0)
      const [innerBody, innerLabel] = boxes(x * 0.9, y * 0.9, 0, 0)
      const fixedCost = costOf(outerBody, expandedSpace) + costOf(innerBody, contractedSpace)
      if (fixedCost >= best) return false
      const outerX = outerLabel.x,
        outerY = outerLabel.y,
        innerX = innerLabel.x,
        innerY = innerLabel.y
      for (const [dx, dy] of captionOffsets({ x, y }, cap, hw, hh)) {
        outerLabel.x = outerX + dx
        outerLabel.y = outerY + dy
        innerLabel.x = innerX + dx
        innerLabel.y = innerY + dy
        const cost =
          fixedCost + costOf(outerLabel, expandedSpace) + costOf(innerLabel, contractedSpace)
        if (cost < best) {
          best = cost
          mark.x = x
          mark.y = y
          cap.dx = dx
          cap.dy = dy
        }
        if (cost < 0.001) return true
      }
      return false
    }
    const shifts =
      direct.length > 128
        ? [0, 0.12, -0.12]
        : [0, 0.08, -0.08, 0.16, -0.16, 0.24, -0.24, 0.35, -0.35]
    const deltas =
      direct.length > 128 ? [0, 0.5, -0.5] : [0, 0.24, -0.24, 0.49, -0.49, 0.82, -0.82, 1.35, -1.35]
    if (compactGrid) {
      const a = start + i * step,
        ring = rings[i % 4]
      const tx = Math.cos(a) * base * 1.38 * ring,
        ty = Math.sin(a) * vertical * ring
      let nearest = 0,
        distance = Infinity
      compactGrid.slots.forEach((p, j) => {
        const d = (p.x - tx) ** 2 + (p.y - ty) ** 2
        if (d < distance) {
          distance = d
          nearest = j
        }
      })
      const [p] = compactGrid.slots.splice(nearest, 1)
      mark.x = p.x
      mark.y = p.y
      cap.cell = compactGrid.cell
      cap.dx = -cap.w / 2
      cap.dy = hh + 2
      best = 0
    } else
      search: for (const shift of shifts) {
        for (const delta of deltas) {
          const a = start + (i + delta) * step,
            r = clamp(rings[i % 4] + shift, 0.34, 1.24)
          if (place(Math.cos(a) * r * base * 1.38, Math.sin(a) * r * vertical)) break search
        }
      }
    if (best > 0.001 && direct.length <= 65) {
      // Search vacant space nearest the proposed endpoint, including the corners of a narrow viewport.
      const xy: Point[] = []
      const spacing = compact ? 11 : 17
      for (let y = limits.y + hh + 2; y < limits.y + limits.h - hh; y += spacing)
        for (let x = limits.x + hw + 2; x < limits.x + limits.w - hw; x += spacing)
          xy.push({ x, y })
      const x0 = mark.x,
        y0 = mark.y
      xy.sort((a, b) => (a.x - x0) ** 2 + (a.y - y0) ** 2 - (b.x - x0) ** 2 - (b.y - y0) ** 2)
      for (const p of xy) if (place(p.x, p.y)) break
    }
    for (const box of boxes(mark.x, mark.y, cap.dx, cap.dy)) expandedSpace.add(box)
    for (const box of boxes(mark.x * 0.9, mark.y * 0.9, cap.dx, cap.dy)) contractedSpace.add(box)
    if (cap.lines.at(-1)?.endsWith('…')) {
      const detail = measureCaption(ctx, mark.entity.name, Math.max(70, Math.min(width - 22, 172)))
      detail.dx = cap.dx < -2 ? cap.dx + cap.w - detail.w : cap.dx
      detail.dy = cap.dy + (cap.h - detail.h) / 2
      mark.detailCaption = detail
    }
    mark.caption = cap
    wire(active, id, 'focus', relation)
  })
  return { overview: false, marks, wires }
}

type PaintedTitle = {
  count?: number
  key: string
  role: RenderRole
  box: Box
  lines: string[]
  size: number
  weight: number
  alpha: number
  pill: number
}
type Navigation = {
  kind: FlightKind
  start: number
  duration: number
  pivot: Point
  destination: string
  panoramaAtStart: number
  titleMap: PaintedTitle[]
}
type SourceGlyph = { role: RenderRole; card?: StarThumbnail; theme: ClusterInk }
function flightProjection(nav: Navigation, elapsed: number) {
  const forward = nav.kind !== 'back' && nav.kind !== 'exit'
  const classic = nav.kind === 'enter' || nav.kind === 'exit'
  const travel = forward
    ? easeOut(phase(elapsed, 0, nav.duration * 0.68))
    : smoothstep(phase(elapsed, 70, nav.duration - 70))
  const t = forward ? phase(elapsed, 0, nav.duration * 0.68) : 1 - travel
  const radius = mix(classic ? 0.22 : 0.35, 1, 1 - (1 - t) ** 4)
  const axis = mix(classic ? 0.72 : 0.15, 1, easeOut(t))
  const foldX = nav.kind === 'drill' || nav.kind === 'back'
  const angle = -entryTurn * (1 - easeOut(t))
  const project = (x: number, y: number) => ({
    x: radius * (foldX ? axis : 1) * (x * Math.cos(angle) - y * Math.sin(angle)),
    y: radius * (foldX ? 1 : axis) * (x * Math.sin(angle) + y * Math.cos(angle))
  })
  const initial = (x: number, y: number) => ({
    x:
      (classic ? 0.22 : 0.35) *
      (foldX ? 0.15 : 1) *
      (x * Math.cos(entryTurn) + y * Math.sin(entryTurn)),
    y:
      (classic ? 0.22 : 0.35) *
      (foldX ? 1 : classic ? 0.72 : 0.15) *
      (y * Math.cos(entryTurn) - x * Math.sin(entryTurn))
  })
  return {
    forward,
    travel,
    project,
    initial,
    residual: (1 - phase(elapsed, 0, nav.duration * 0.44)) ** 3
  }
}

function bloomPoint(
  m: Moving,
  to: Point,
  nav: Navigation,
  landing: Point,
  f: ReturnType<typeof flightProjection>
): Point {
  const origin = {
    x: mix(nav.pivot.x, landing.x, f.travel),
    y: mix(nav.pivot.y, landing.y, f.travel)
  }
  const ax = m.sourceScreen.x - nav.pivot.x,
    ay = m.sourceScreen.y - nav.pivot.y
  const bx = to.x - landing.x,
    by = to.y - landing.y
  if (f.forward) {
    const ray = f.project(bx, by)
    const start = f.initial(bx, by)
    return {
      x: origin.x + ray.x + (m.matchedScreen ? (ax - start.x) * f.residual : 0),
      y: origin.y + ray.y + (m.matchedScreen ? (ay - start.y) * f.residual : 0)
    }
  }
  const ray = f.project(ax, ay)
  return {
    x: origin.x + mix(ray.x, bx, f.travel),
    y: origin.y + mix(ray.y, by, f.travel)
  }
}

type Box = { x: number; y: number; w: number; h: number }
type Pick = { key: string; id: string; role: Mark['role'] }
type Target = { box: Box; hit: Pick; dot: boolean; rectangular?: boolean; foregroundPill?: boolean }
const font = (size: number, weight = 450) =>
  `${weight} ${size}px "Inter","Segoe UI","Microsoft YaHei",sans-serif`
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const rgba = (color: string, alpha: number) =>
  color +
  Math.round(clamp(alpha) * 255)
    .toString(16)
    .padStart(2, '0')
const INTRO_COLOR = '#6272FF'
const hubSide = (mass: number) => 7.5 + 3 * mass

/** Fit positions in world space; cards, halos and type retain their CSS pixel sizes. */
function fitOverview(scene: Scene, ctx: CanvasRenderingContext2D, width: number, height: number) {
  if (!scene.overview || !scene.marks.size) return 1
  const points = [...scene.marks.values()]
  const maxCount = Math.max(1, ...points.filter((m) => m.role === 'hub').map((m) => m.count))
  const boxes = points.map((m) => {
    if (m.role === 'hub') {
      const side = hubSide(Math.sqrt(m.count / maxCount))
      const glow = side * 2.4
      ctx.font = font(13, 500)
      const name = ctx.measureText(m.entity.name).width
      ctx.font = font(11, 500)
      const labelEnd = side / 2 + 4 + name + 4 + ctx.measureText(String(m.count)).width
      // A title wider than the viewport wraps and pins to its edge during drawing.
      const right = glow + labelEnd <= width * 0.9 ? Math.max(glow, labelEnd) : glow
      return { x: m.x, y: m.y, left: glow, right, top: glow, bottom: glow }
    }
    const url = 'thumbnailUrl' in m.entity ? m.entity.thumbnailUrl : undefined
    if (m.seed >= 0.75 || (typeof url === 'string' && url.trim())) {
      const [w, h] = thumbnailSize(m.entity.id)
      return {
        x: m.x,
        y: m.y,
        left: w / 2 + 0.45,
        right: w / 2 + 0.45,
        top: h / 2 + 0.45,
        bottom: h / 2 + 0.45
      }
    }
    const radius = 2.1
    return { x: m.x, y: m.y, left: radius, right: radius, top: radius, bottom: radius }
  })
  function axis(key: 'x' | 'y', span: number) {
    const horizontal = key === 'x'
    function bounds(scale: number) {
      let min = Infinity,
        max = -Infinity
      for (const box of boxes) {
        const c = box[key] * scale
        min = Math.min(min, c - (horizontal ? box.left : box.top))
        max = Math.max(max, c + (horizontal ? box.right : box.bottom))
      }
      return { span: max - min, center: (min + max) / 2 }
    }
    const values = points.map((m) => m[key])
    const extent = Math.max(...values) - Math.min(...values)
    if (extent < 1) return { scale: 1, center: bounds(1).center }
    const target = span * 0.9
    let lo = 0,
      hi = target / extent
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2
      if (bounds(mid).span < target) lo = mid
      else hi = mid
    }
    const scale = Math.max(0.01, (lo + hi) / 2)
    return { scale, center: bounds(scale).center }
  }
  const x = axis('x', width),
    y = axis('y', height)
  const baseZoom = Math.min(x.scale, y.scale)
  // Adapt the ellipse aspect before applying a single uniform camera zoom.
  for (const m of points) {
    m.x = (m.x * x.scale - x.center) / baseZoom
    m.y = (m.y * y.scale - y.center) / baseZoom
  }
  return baseZoom
}
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y
const inside = (p: Point, b: Box) =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
const copy = (p: Point) => ({ x: p.x, y: p.y })

class StarCanvas {
  marks = new Map<string, Moving>()
  wires = new Map<string, Stroke>()
  pose: CameraPose2D = { x: 0, y: 0, zoom: 1 }
  goal: CameraPose2D = { ...this.pose }
  width = 1
  height = 1
  sidebarInset = 0
  private baseZoom = 1
  private desiredBaseZoom = 1
  pointer: Point | null = null
  hover: string | null = null
  external: string | null = null
  private particles = new BlueParticles()
  private stars = new Starfield()
  private thumbnails = new StarThumbnails()
  kind: string | null = null
  filter: string | null = null
  still = false
  overview = true
  explore = true
  private ambientCrossEdges: readonly Wire[] = []
  private previews = new Map<string, { ids: Set<string>; extra: number }>()
  private retestAfterRelease = false
  private nodeDrag: { key: string; screen: Point; offset: Point; pending: boolean } | null = null
  private canopies: Canopy<Moving>[] = []
  private windPointer: Point | null = null
  private mouseFlow = { x: 0, y: 0 }
  private overviewPositions = new Map<string, { position: Point; parent: string }>()
  private waveSeconds = 0
  private targets: Target[] = []
  private lineTargets: { wire: Stroke; a: Point; b: Point }[] = []
  private hoveredLine: string | null = null
  private changed = 0
  private last = 0
  waitingForIntro = false
  private hubCount = 0
  private largestHub = 1
  private introLandings = new Map<string, Point>()
  private bloomMs = 0
  private launchViewWidth = 1
  private dockEnds = -Infinity
  private warmupStarted: number | null = -Infinity
  private physicsWarmup = 1
  private started: number | null = null
  private initial = true
  private chosenKey: string | null = null
  private route: string[] = []
  private entryKeys: string[] = []
  private navigation: Navigation | null = null
  private panoramaAlpha = 1
  private paintedTitles: PaintedTitle[] = []
  private cards = new Map<string, StarThumbnail>()
  private cardIndex?: GraphIndex
  private bearings = new Map<string, Map<string, number>>()
  private releaseHover: { key: string; at: Point } | null = null
  private coupledLeaves = new Map<string, number>()
  private radialSampleAt = -Infinity
  private focusWind: { from: Point; to: Point; at: number } | null = null

  prepareAtlas(index: GraphIndex, overview: Scene) {
    if (this.cardIndex === index) return
    this.cardIndex = index
    this.cards = this.thumbnails.prepare(overview.marks.values(), index.entities.values())
    this.bearings.clear()
  }

  focusScene(
    index: GraphIndex,
    trail: string[],
    width: number,
    height: number,
    ctx: CanvasRenderingContext2D
  ) {
    const active = trail[trail.length - 1]
    if (this.overview && this.canopies.length) {
      for (const { hub, leaves } of this.canopies) {
        const angles = new Map<string, number>()
        for (const leaf of leaves)
          angles.set(
            leaf.key,
            (Math.atan2(leaf.screen.y - hub.screen.y, leaf.screen.x - hub.screen.x) + TAU) % TAU
          )
        this.bearings.set(hub.key, angles)
      }
    }
    const scene = radialScene(
      index,
      active,
      trail.at(-2),
      width,
      height,
      ctx,
      this.cards,
      this.bearings.get(active) ?? new Map(),
      trail
    )
    return scene
  }
  private neighborKeys = new Map<string, Set<string>>()

  private cacheOrbits(
    marks: Map<string, Moving>,
    viewWidth: number,
    baseZoom: number,
    fresh?: Set<string>
  ) {
    this.launchViewWidth = viewWidth
    this.canopies = cacheCanopies(marks)
    const bounds = overviewBounds(viewWidth, this.height, baseZoom)
    const landingPad = Math.min(24, Math.min(viewWidth, this.height) * 0.065) / baseZoom
    const radius = centerClearRadius(viewWidth, this.height, baseZoom)
    const settled = relaxLaunch(this.canopies, bounds, landingPad, baseZoom, radius)
    const hubs = this.canopies.map(({ hub }) => hub)
    const angleOf = (m: Moving) => {
      const p = settled.get(m.key) ?? m
      return clockwiseAngle(p.x, p.y)
    }
    hubs.sort((a, b) => angleOf(a) - angleOf(b))
    // Start at the landing nearest the -135° ray, including the hub just before it.
    const preceding = hubs.at(-1)
    if (preceding && TAU - angleOf(preceding) < angleOf(hubs[0])) {
      hubs.unshift(hubs.pop()!)
    }
    this.hubCount = hubs.length
    this.largestHub = Math.max(1, ...hubs.map((m) => m.count))
    hubs.forEach((hub, order) => {
      hub.order = order
    })
    this.bloomMs = Math.max(
      0,
      ...this.canopies.map(({ hub, leaves }) => bloomEnd(hub.order, hubs.length, leaves.length > 0))
    )
    const previous = this.introLandings
    this.introLandings = new Map()
    for (const m of marks.values()) {
      if (!m.live) continue
      const parent = marks.get(m.parent)
      const parentLanding = parent && settled.get(parent.key)
      if (parent) m.order = parent.order
      const relX = m.x - (parent?.x ?? 0)
      const relY = m.y - (parent?.y ?? 0)
      const landing = settled.get(m.key) ?? {
        x: (parentLanding?.x ?? parent?.x ?? 0) + relX,
        y: (parentLanding?.y ?? parent?.y ?? 0) + relY
      }
      if (this.started !== null || fresh?.has(m.key)) {
        const prior = this.started !== null ? previous.get(m.key) : undefined
        m.position.x = landing.x + (prior ? m.position.x - prior.x : 0)
        m.position.y = landing.y + (prior ? m.position.y - prior.y : 0)
      }
      this.introLandings.set(m.key, { x: landing.x, y: landing.y })
      m.orbitAngle = Math.atan2(parent ? relY : landing.y, parent ? relX : landing.x)
      m.orbitRadius = Math.hypot(parent ? relX : landing.x, parent ? relY : landing.y)
    }
  }

  setScene(
    scene: Scene,
    now: number,
    resize = false,
    baseZoom = 1,
    viewWidth = Math.max(1, this.width - this.sidebarInset),
    route: string[] = []
  ) {
    this.desiredBaseZoom = baseZoom
    if (scene.overview) this.ambientCrossEdges = scene.ambientCrossEdges ?? []
    if (this.initial || this.waitingForIntro || this.still) this.baseZoom = baseZoom
    // A drawer refit updates the natural lengths while keeping live positions and velocities.
    if (resize && !this.initial && this.overview === scene.overview) {
      const sameTopology =
        scene.marks.size === [...this.marks.values()].filter((m) => m.live).length &&
        [...scene.marks.values()].every((m) => {
          const old = this.marks.get(m.key)
          return (
            old?.live && old.entity === m.entity && old.role === m.role && old.parent === m.parent
          )
        })
      if (sameTopology) {
        for (const m of scene.marks.values()) {
          const old = this.marks.get(m.key)!
          old.x = m.x
          old.y = m.y
          old.caption = m.caption
          old.detailCaption = m.detailCaption
        }
        if (scene.overview) this.cacheOrbits(this.marks, viewWidth, baseZoom)
        else this.cacheRadial(this.marks)
        return
      }
    }
    const oldId = this.route.at(-1),
      newId = route.at(-1)
    const navigating = !this.initial && (this.overview !== scene.overview || oldId !== newId)
    const root = (route.length ? route : this.route)[0]
    const goingBack =
      route.length < this.route.length && route.every((id, i) => this.route[i] === id)
    const clicked = this.chosenKey ? this.marks.get(this.chosenKey) : undefined
    const pivot = scene.overview
      ? this.marks.get(oldId ?? '')
      : ((clicked?.entity.id === newId ? clicked : this.marks.get(newId ?? '')) ??
        this.marks.get(oldId ?? ''))
    const kind: FlightKind = scene.overview
      ? 'exit'
      : this.overview
        ? 'enter'
        : goingBack
          ? 'back'
          : clicked?.role === 'mini' || clicked?.role === 'satellite'
            ? 'branch'
            : 'drill'
    if (navigating) {
      this.navigation = {
        kind,
        start: now,
        duration: flightTime[kind],
        pivot: copy(pivot?.screen ?? { x: viewWidth / 2, y: this.height / 2 }),
        destination: (scene.overview ? root : newId) ?? '',
        panoramaAtStart: this.panoramaAlpha,
        titleMap: goingBack || scene.overview ? this.paintedTitles.slice() : []
      }
      this.baseZoom = baseZoom
    } else if (!resize) this.navigation = null
    this.endNodeDrag(false)
    this.releaseHover = this.focusWind = null
    this.radialSampleAt = -Infinity
    if (this.overview && !scene.overview) {
      this.overviewPositions.clear()
      for (const m of this.marks.values()) {
        if (m.live)
          this.overviewPositions.set(m.key, { position: copy(m.position), parent: m.parent })
      }
    }
    const old = this.marks,
      next = new Map<string, Moving>()
    const fresh = new Set<string>()
    const cards = this.cards
    const oldToNew = new Map<string, string>()
    // The clicked satellite tip may represent an entity also visible elsewhere. Reserve
    // its on-screen instance for the new center before matching ordinary entity keys.
    const reserved = !scene.overview && clicked?.entity.id === newId ? clicked : undefined
    const returnKey = goingBack && !scene.overview ? this.entryKeys[route.length] : undefined
    const returningCenter =
      returnKey && scene.marks.has(returnKey) ? old.get(oldId ?? '') : undefined
    const destinationIds = new Set([...scene.marks.values()].map((m) => m.entity.id))
    const oldEntities = new Map(
      [...old.values()].filter((m) => m.live).map((m) => [m.entity.id, m])
    )
    for (const [key, n] of scene.marks) {
      const prior =
        old.get(key) ??
        (!scene.overview && !this.overview ? oldEntities.get(n.entity.id) : undefined)
      let source = prior
      if (n.role === 'center' && reserved) source = reserved
      else if (key === returnKey && returningCenter) source = returningCenter
      else if (prior === reserved || prior === returningCenter) source = undefined
      const saved = this.overviewPositions.get(key)
      const continuing =
        this.overview && prior?.live && prior.role === n.role && prior.parent === n.parent
      const overviewPosition = continuing
        ? prior.position
        : saved?.parent === n.parent
          ? saved.position
          : n
      if (scene.overview && !continuing && saved?.parent !== n.parent) fresh.add(key)
      const family = scene.overview ? n.key === root || n.parent === root : true
      const inBloom = !scene.overview || family
      const useSource =
        source &&
        (kind !== 'enter' || source.key === newId || source.parent === newId) &&
        (kind !== 'exit' || family)
          ? source
          : undefined
      if (source && (!navigating || useSource)) oldToNew.set(source.key, key)
      const alpha = (navigating ? useSource?.alpha : source?.alpha) ?? (this.initial ? 1 : 0)
      const start = (useSource || !navigating) && source ? source.screen : this.navigation?.pivot
      const previousGlyph =
        useSource &&
        useSource.role !== n.role &&
        !(useSource.role === 'leaf' && n.role === 'neighbor') &&
        !(useSource.role === 'neighbor' && n.role === 'leaf')
          ? { role: useSource.role, card: useSource.thumbnail, theme: useSource.theme }
          : undefined
      const theme = liveTheme(scene.marks.get(n.parent)?.entity.kind ?? n.entity.kind)
      next.set(key, {
        ...n,
        position: copy(scene.overview ? overviewPosition : n),
        sourceScreen: copy(start ?? n),
        matchedScreen: !!useSource,
        sourceGlyph: previousGlyph,
        inBloom,
        screen: copy(start ?? n),
        alpha,
        thumbnail: n.role === 'leaf' || n.role === 'neighbor' ? cards.get(n.entity.id) : undefined,
        fromAlpha: alpha,
        live: true,
        emphasis: prior?.emphasis ?? 0,
        light: prior?.light ?? 1,
        titleLight: prior?.titleLight ?? 1,
        trunkLight: prior?.trunkLight ?? 1,
        hubFocusT: prior?.hubFocusT ?? 0,
        leafFocusT: prior?.leafFocusT ?? 0,
        nameAlpha: prior?.nameAlpha ?? 0,
        velocity: copy(
          (scene.overview ? continuing && prior.velocity : source?.velocity) || { x: 0, y: 0 }
        ),
        theme,
        whiteT: prior?.whiteT ?? 0,
        trunkFlow: n.role === 'hub' ? (prior?.trunkFlow ?? makeFlow(n.key)) : undefined,
        orbitAngle: 0,
        orbitRadius: 0,
        naturalDist: 0,
        distNorm: 0,
        targetDist: 0,
        focusT: continuing ? prior.focusT : 0,
        avgLeafDist: 0,
        collideR: 82,
        phaseB: seed(n.key + ':drift') * TAU,
        revealAlpha: prior?.revealAlpha ?? 0
      })
    }
    for (const [key, m] of old) {
      if (
        oldToNew.has(key) ||
        m.alpha <= 0.005 ||
        (!scene.overview && destinationIds.has(m.entity.id))
      )
        continue
      const ghost = next.has(key) ? JSON.stringify(['outgoing', key]) : key
      oldToNew.set(key, ghost)
      next.set(ghost, {
        ...m,
        key: ghost,
        sourceScreen: copy(m.screen),
        matchedScreen: true,
        sourceGlyph: undefined,
        fromAlpha: m.alpha,
        live: false,
        inBloom: !isOverviewMark(m.role)
      })
    }
    // Carry the exact same animated spoke through a role change in either direction.
    const oldRays = new Map<string, Stroke>()
    const pairKey = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a])
    for (const w of this.wires.values()) {
      const a = oldToNew.get(w.a),
        b = oldToNew.get(w.b)
      if (
        a &&
        b &&
        (w.kind === 'focus' || w.kind === 'spoke' || w.kind === 'mini' || w.kind === 'guide')
      )
        oldRays.set(pairKey(a, b), w)
    }
    const adopted = new Set<string>()
    const edges = new Map<string, Stroke>()
    for (const [key, w] of scene.wires) {
      const oldRay =
        this.wires.get(key) ??
        (w.kind === 'relation' || w.kind === 'aggregate'
          ? undefined
          : oldRays.get(pairKey(w.a, w.b)))
      if (oldRay) adopted.add(oldRay.key)
      const a = oldRay?.alpha ?? (this.initial ? 1 : 0)
      edges.set(key, {
        ...w,
        flow: oldRay?.flow ?? makeFlow(key),
        fromAlpha: a,
        alpha: a,
        live: true,
        emphasis: 0,
        drawProgress: 0,
        leafActive: false,
        leafSince: now,
        leafFrom: 0,
        leafWeight: 0,
        light: 1
      })
    }
    // A focus frame owns exactly one tree, including the first frame of a drill.
    // Only the exit may carry old tree edges into a panorama.
    if (scene.overview)
      for (const [key, w] of this.wires) {
        if (!this.overview && !focusConnection(w.kind, old.get(w.a), old.get(w.b))) continue
        const a = oldToNew.get(w.a),
          b = oldToNew.get(w.b)
        if (!adopted.has(key) && !edges.has(key) && w.alpha > 0.005 && a && b)
          edges.set(key, { ...w, a, b, live: false, fromAlpha: w.alpha })
      }
    if (navigating) {
      this.entryKeys = route.map((id, i) =>
        this.route[i] === id
          ? (this.entryKeys[i] ?? id)
          : i === route.length - 1 && clicked?.entity.id === id
            ? clicked.key
            : id
      )
    }
    this.route = [...route]
    this.neighborKeys.clear()
    for (const w of scene.wires.values()) {
      for (const [a, b] of [
        [w.a, w.b],
        [w.b, w.a]
      ]) {
        const list = this.neighborKeys.get(a) ?? new Set()
        list.add(b)
        this.neighborKeys.set(a, list)
      }
    }
    this.previews.clear()
    if (scene.overview) {
      for (const m of scene.marks.values()) {
        if (m.role !== 'leaf') continue
        const ids = [...(this.neighborKeys.get(m.key) ?? [])]
        const withinCluster: string[] = [],
          crossCluster: string[] = []
        for (const id of ids) {
          const adjacent = scene.marks.get(id)
          if (id === m.parent || adjacent?.parent === m.parent) withinCluster.push(id)
          else crossCluster.push(id)
        }
        crossCluster.sort(
          (a, b) =>
            (this.neighborKeys.get(b)?.size ?? 0) - (this.neighborKeys.get(a)?.size ?? 0) ||
            a.localeCompare(b)
        )
        this.previews.set(m.key, {
          ids: new Set([...withinCluster, ...crossCluster.slice(0, 14)]),
          extra: Math.max(0, crossCluster.length - 14)
        })
      }
    }
    if (scene.overview) this.cacheOrbits(next, viewWidth, baseZoom, fresh)
    else {
      this.canopies = []
      this.introLandings.clear()
      this.cacheRadial(next)
    }
    this.windPointer = null
    this.mouseFlow.x = this.mouseFlow.y = 0
    this.overview = scene.overview
    this.marks = next
    this.wires = edges
    this.changed = this.initial || resize ? now - FLIGHT_MS : now
    this.initial = scene.marks.size === 0
    this.chosenKey = null
    this.hover = null
    this.hoveredLine = null
    this.targets = []
    this.lineTargets = []
  }
  reset(immediate = false) {
    this.goal = { x: 0, y: 0, zoom: 1 }
    if (immediate) this.pose = { ...this.goal }
  }
  beginIntro(start = performance.now()) {
    this.endNodeDrag(false)
    this.navigation = null
    this.overviewPositions.clear()
    this.windPointer = null
    this.mouseFlow.x = this.mouseFlow.y = 0
    this.reset(true)
    this.baseZoom = this.desiredBaseZoom
    this.hover = null
    this.landIntro()
    for (const m of this.marks.values()) m.focusT = 0
    this.dockEnds = start + DOCK_MS + DOCK_DURATION
    this.warmupStarted = null
    this.physicsWarmup = 0
    this.started = start
    this.changed = -Infinity
  }
  private landIntro() {
    for (const m of this.marks.values()) {
      const landing = this.introLandings.get(m.key) ?? m
      m.position.x = landing.x
      m.position.y = landing.y
      m.velocity.x = m.velocity.y = 0
      m.wasHeld = false
    }
  }
  finishIntro() {
    if (this.started === null && !this.waitingForIntro) return
    if (this.started === null) this.landIntro()
    this.dockEnds = -Infinity
    this.started = null
    this.waitingForIntro = false
    this.warmupStarted = null
    this.physicsWarmup = 0
  }
  select(hit: Pick) {
    this.chosenKey = hit.key
  }

  beginNodeDrag(hit: { key: string; role: Mark['role'] }, downScreen: Point) {
    if (this.navigation || (this.overview ? !isOverviewMark(hit.role) : !isOuter(hit.role)))
      return false
    const m = this.marks.get(hit.key)
    if (!m?.live || this.started !== null || this.waitingForIntro) return false
    const zoom = this.baseZoom * this.pose.zoom
    this.nodeDrag = {
      key: hit.key,
      pending: false,
      screen: copy(downScreen),
      offset: { x: (m.screen.x - downScreen.x) / zoom, y: (m.screen.y - downScreen.y) / zoom }
    }
    this.windPointer = null
    this.mouseFlow.x = this.mouseFlow.y = 0
    this.retestAfterRelease = false
    this.releaseHover = null
    this.pointer = copy(downScreen)
    if (m.radial && !this.overview) {
      this.focusWind = null
      m.emphasis = m.leafFocusT = m.light = 1
      this.coupleRadialNeighbors(m)
    }
    this.hover = hit.key
    return true
  }
  moveNodeDrag(screen: Point) {
    const drag = this.nodeDrag
    if (!drag || (drag.screen.x === screen.x && drag.screen.y === screen.y)) return
    drag.screen = copy(screen)
    this.pointer = drag.screen
    drag.pending = true
  }

  private advanceOverview(
    now: number,
    step: number,
    zoom: number,
    ox: number,
    oy: number,
    viewWidth: number,
    hotKey: string | null,
    pointerHeld: boolean
  ) {
    if (!this.canopies.length || step <= 0) return
    const grab = this.nodeDrag
    const held = grab ? this.marks.get(grab.key) : undefined
    const dragGoal = grab
      ? {
          x: (grab.screen.x - ox) / zoom + grab.offset.x,
          y: (grab.screen.y - oy) / zoom + grab.offset.y
        }
      : null
    const from = dragGoal && held ? copy(held.position) : null
    if (grab) grab.pending = false

    const p = this.pointer
    const pointer =
      !pointerHeld &&
      !grab &&
      !this.still &&
      p &&
      p.x >= 0 &&
      p.x <= viewWidth &&
      p.y >= 0 &&
      p.y <= this.height
        ? p
        : null
    const prior = this.windPointer
    this.windPointer = pointer
    const blend = 1 - 0.78 ** step
    const maxFlow = 35
    const vx =
      pointer && prior ? clamp((pointer.x - prior.x) / (zoom * step), -maxFlow, maxFlow) : 0
    const vy =
      pointer && prior ? clamp((pointer.y - prior.y) / (zoom * step), -maxFlow, maxFlow) : 0
    this.mouseFlow.x = mix(this.mouseFlow.x, vx, blend)
    this.mouseFlow.y = mix(this.mouseFlow.y, vy, blend)

    const frame: FluidFrame = {
      seconds: now / 1000,
      step,
      zoom,
      bounds: overviewBounds(
        now < this.dockEnds ? Math.min(viewWidth, this.launchViewWidth) : viewWidth,
        this.height,
        this.baseZoom
      ),
      viewport: { width: viewWidth, height: this.height },
      mouse: pointer ? { x: (pointer.x - ox) / zoom, y: (pointer.y - oy) / zoom } : null,
      pointerFlow: this.mouseFlow,
      warmup: this.physicsWarmup,
      hotKey,
      held,
      dragGoal,
      still: this.still
    }
    // A slow display takes smaller physics steps while the pointer still reaches its latest sample.
    const count = Math.ceil(step / 1.25)
    frame.step = step / count
    for (let i = 1; i <= count; i++) {
      if (from && dragGoal)
        frame.dragGoal = {
          x: mix(from.x, dragGoal.x, i / count),
          y: mix(from.y, dragGoal.y, i / count)
        }
      stepOverview(this.canopies, frame)
    }
  }

  endNodeDrag(commit = true, now = this.last) {
    const drag = this.nodeDrag
    const mark = drag && this.marks.get(drag.key)
    if (this.overview && commit && drag?.pending && mark?.live) {
      // Overview captures the final sample even when pointerup falls between two paints.
      const viewWidth = Math.max(1, this.width - this.sidebarInset)
      this.advanceOverview(
        this.last,
        1,
        this.pose.zoom * this.baseZoom,
        viewWidth / 2 + this.pose.x,
        this.height / 2 + this.pose.y,
        viewWidth,
        drag.key,
        true
      )
    }
    if (!this.overview && commit && drag?.pending && mark?.radial) {
      const dt = clamp((now - this.last) / 1000, 0, 1 / 60)
      if (dt > 0) {
        this.advanceRadial(
          now,
          dt,
          this.pose.zoom * this.baseZoom,
          (this.width - this.sidebarInset) / 2,
          this.height / 2
        )
        this.radialSampleAt = now
      }
    }
    this.coupledLeaves.clear()
    if (drag && commit && !this.overview)
      this.releaseHover = { key: drag.key, at: copy(drag.screen) }
    this.nodeDrag = null
    this.retestAfterRelease = !!drag && commit && this.overview
    if (mark) mark.velocity.x = mark.velocity.y = 0
  }
  zoomBy(factor: number) {
    this.goal.zoom = clamp(this.goal.zoom * factor, this.overview ? 0.35 : 1, 4)
  }
  get transitioning() {
    return this.navigation !== null
  }
  get flightEnd() {
    return this.navigation ? this.navigation.start + this.navigation.duration : 0
  }
  hit(p: Point): Pick | null {
    let nearest: Target | undefined
    let bestRank = -1,
      bestDistance = Infinity
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i]
      if (!inside(p, t.box)) continue
      const distance = t.dot
        ? Math.hypot(p.x - t.box.x - t.box.w / 2, p.y - t.box.y - t.box.h / 2)
        : 0
      if (t.dot && !t.rectangular && distance >= t.box.w / 2) continue
      // The active leaf pill is painted over any category marker beneath its rectangle.
      const rank = t.foregroundPill
        ? 4
        : Number(this.overview && t.hit.role === 'hub') * 2 + Number(!t.dot)
      if (rank > bestRank || (rank === bestRank && distance < bestDistance)) {
        nearest = t
        bestRank = rank
        bestDistance = distance
      }
    }
    return nearest?.hit ?? null
  }
  tracePointer(p: Point | null, time: number) {
    this.particles.trace(
      !this.still && this.started === null && !this.waitingForIntro ? p : null,
      time
    )
  }
  move(p: Point | null) {
    const previous = this.pointer
    if (!this.overview && p && previous && (p.x !== previous.x || p.y !== previous.y))
      this.focusWind = { from: copy(previous), to: copy(p), at: performance.now() }
    if (!p) this.focusWind = null
    const under = p ? (this.hit(p)?.key ?? null) : null
    if (
      this.releaseHover &&
      (!p ||
        (under !== this.releaseHover.key &&
          Math.hypot(p.x - this.releaseHover.at.x, p.y - this.releaseHover.at.y) > 2))
    )
      this.releaseHover = null
    this.pointer = p
    this.hover = this.nodeDrag?.key ?? this.releaseHover?.key ?? under
    this.hoveredLine = null
    if (!p || this.hover || this.overview) return
    let best = 4
    for (const { wire, a, b } of this.lineTargets) {
      const dx = b.x - a.x,
        dy = b.y - a.y
      const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
      if (d < best) {
        this.hoveredLine = wire.key
        best = d
      }
    }
  }
  private cacheRadial(marks: Map<string, Moving>) {
    for (const m of marks.values()) {
      if (!m.live || isOverviewMark(m.role)) continue
      const parent = marks.get(m.parent)
      const dx = m.x - (parent?.x ?? 0),
        dy = m.y - (parent?.y ?? 0)
      const angle = Math.atan2(dy, dx)
      m.radial = {
        angle,
        radius: Math.hypot(dx, dy),
        phase: angle * 2 + m.seed * 6.28,
        home: { x: m.x, y: m.y },
        offset: m.radial?.offset ?? { x: 0, y: 0 },
        speed: m.radial?.speed ?? 0
      }
    }
  }

  private coupleRadialNeighbors(held: Moving) {
    this.coupledLeaves.clear()
    const ring = [...this.marks.values()]
      .filter((m) => m.live && isOuter(m.role) && m.parent === held.parent)
      .sort((a, b) => a.radial!.angle - b.radial!.angle)
    const index = ring.indexOf(held)
    const nearest = Math.min(3, Math.ceil((ring.length - 1) / 2))
    for (const side of [-1, 1]) {
      for (let i = 1; i <= nearest; i++) {
        const sibling = ring[(index + side * i + ring.length) % ring.length]
        const gap = (side * (sibling.radial!.angle - held.radial!.angle) + TAU) % TAU
        const weight = 0.06 + 0.08 * Math.max(0, 1 - gap / ((4 * TAU) / ring.length))
        this.coupledLeaves.set(
          sibling.key,
          Math.max(this.coupledLeaves.get(sibling.key) ?? 0, weight)
        )
      }
    }
  }

  private advanceRadial(now: number, seconds: number, zoom: number, ox: number, oy: number) {
    // homes and displacements are in CSS pixels relative to the pinned focus center.
    const step = seconds * 60
    const grab = this.nodeDrag
    const held = grab && this.marks.get(grab.key)?.radial
    const wind = !grab && !this.still && !this.navigation ? this.focusWind : null
    const energy = wind
      ? clamp(Math.hypot(wind.to.x - wind.from.x, wind.to.y - wind.from.y) / 12) *
        clamp(1 - Math.max(0, now - wind.at) / 210)
      : 0
    for (const m of this.marks.values()) {
      const r = m.radial
      if (!m.live || !r) continue
      const parent = this.marks.get(m.parent)
      const base = r.radius * (m.role === 'neighbor' ? zoom : 1)
      const contract = isOuter(m.role) ? 1 - 0.1 * (parent?.hubFocusT ?? 0) : 1
      const gain =
        this.still || m.role === 'center'
          ? 0
          : m.role === 'upstream'
            ? 0.32
            : m.role === 'satellite'
              ? 0.62
              : 1
      const breath = gain * Math.sin(now * 0.001 + r.phase) * breathAmplitude(base)
      const angle =
        r.angle + (m.role === 'upstream' ? 0 : gain * Math.cos(now * 0.00085 + m.seed * 19) * 0.011)
      const radius = base * contract + breath
      r.home.x = (parent?.radial?.home.x ?? 0) + Math.cos(angle) * radius
      r.home.y = (parent?.radial?.home.y ?? 0) + Math.sin(angle) * radius
      if (m.role === 'upstream') r.home.x = 0
      if (!isOuter(m.role)) {
        m.position.x = r.home.x / zoom
        m.position.y = r.home.y / zoom
      }
    }
    const follow = 1 - 0.68 ** step
    if (held && grab) {
      const m = this.marks.get(grab.key)!
      let dx = grab.screen.x - ox + grab.offset.x * zoom - held.home.x
      let dy = grab.screen.y - oy + grab.offset.y * zoom - held.home.y
      const distance = Math.hypot(dx, dy)
      if (distance > 140) {
        const ratio = (140 - 96 * Math.expm1(-(distance - 140) / 96)) / distance
        dx *= ratio
        dy *= ratio
      }
      if (m.role === 'mini') {
        const hub = this.marks.get(m.parent)!.radial!.home
        const tip = privateTip(held.home.x + dx - hub.x, held.home.y + dy - hub.y, held.angle)
        dx = hub.x + tip.x - held.home.x
        dy = hub.y + tip.y - held.home.y
      }
      held.offset.x = mix(held.offset.x, dx, follow)
      held.offset.y = mix(held.offset.y, dy, follow)
      held.speed = 0
      grab.pending = false
    }
    for (const m of this.marks.values()) {
      const r = m.radial
      if (!m.live || !r || !isOuter(m.role)) continue
      const hub = this.marks.get(m.parent)!.radial!.home
      let dx = 0,
        dy = 0
      const weight = this.coupledLeaves.get(m.key)
      if (weight && held) {
        dx = held.offset.x * weight
        dy = held.offset.y * weight
      } else if (energy && wind) {
        const vx = r.home.x - hub.x,
          vy = r.home.y - hub.y
        const cx = wind.to.x - ox - hub.x,
          cy = wind.to.y - oy - hub.y
        const along = clamp((cx * vx + cy * vy) / (vx * vx + vy * vy || 1), 0.16, 1)
        let nx = vx * along - cx,
          ny = vy * along - cy
        const distance = Math.hypot(nx, ny)
        if (distance < 125) {
          if (distance < 0.1) {
            nx = -vy
            ny = vx
          }
          const force =
            (22 * energy * (1 - distance / 125) ** 1.35 * along) / (Math.hypot(nx, ny) || 1)
          dx = nx * force
          dy = ny * force
        }
      }
      if (r !== held) {
        if (dx || dy) {
          const blend = 1 - 0.8 ** step
          r.offset.x = mix(r.offset.x, dx, blend)
          r.offset.y = mix(r.offset.y, dy, blend)
          r.speed = 0
        } else glideRadial(r, step)
      }
      let x = r.home.x + r.offset.x,
        y = r.home.y + r.offset.y
      if (m.role === 'mini') {
        const tip = privateTip(x - hub.x, y - hub.y, r.angle)
        x = hub.x + tip.x
        y = hub.y + tip.y
        r.offset.x = x - r.home.x
        r.offset.y = y - r.home.y
      }
      m.position.x = x / zoom
      m.position.y = y / zoom
    }
  }

  draw(ctx: CanvasRenderingContext2D, now: number, dpr: number, pointerHeld = false) {
    const w = this.width,
      h = this.height
    // Flow uses wall time even on a 30 Hz display; don't jump a lap when returning from a hidden tab.
    if (!this.still) this.waveSeconds += clamp((now - (this.last || now)) / 1000, 0, 0.25)
    const frameSeconds = Math.max(0, now - (this.last || now - 16.67)) / 1000
    const dt = Math.min(32, frameSeconds * 1000) / 16.67
    this.last = now
    const lerp = this.still ? 1 : 1 - 0.86 ** dt
    const nav = this.navigation
    const progress = !nav || this.still ? 1 : phase(now, nav.start, nav.duration)
    const elapsed = nav ? progress * nav.duration : 0
    const projection = nav && flightProjection(nav, elapsed)
    const flight = nav
      ? smoothstep(progress)
      : this.still
        ? 1
        : easeOut(phase(now, this.changed, FLIGHT_MS))
    this.panoramaAlpha = nav
      ? mix(
          nav.panoramaAtStart,
          Number(this.overview),
          smoothstep(this.overview ? phase(elapsed, 70, nav.duration - 70) : clamp(elapsed / 120))
        )
      : Number(this.overview)
    const namesIn = nav ? smoothstep(phase(elapsed, nav.duration - 100, 100)) : 1
    const namesOut = nav && !projection?.forward ? 1 - smoothstep(clamp(elapsed / 85)) : 0
    const start = this.started
    const cutoff = start === null ? -Infinity : start + this.bloomMs
    const ms = this.waitingForIntro
      ? 0
      : start === null || this.still
        ? Infinity
        : Math.max(0, now - start)
    const launching = this.waitingForIntro || ms < this.bloomMs
    const handedOff = start !== null && !launching
    const bloomMix = launching
      ? this.bloomMs
        ? smoothstep(phase(ms, this.bloomMs * 0.7, this.bloomMs * 0.3))
        : 0
      : 1
    if (start !== null && !this.waitingForIntro && !this.still) {
      const end = Math.min(now, cutoff)
      const previous = Math.max(now - frameSeconds * 1000, start + this.bloomMs * 0.7)
      const step = Math.min(32, end - previous) / 16.67
      if (step > 0) stepBloomCurrent(this.canopies, end / 1000, step)
    }
    if (handedOff) {
      this.started = null
      this.warmupStarted = cutoff
    }
    if (!launching) {
      this.warmupStarted ??= now
      const t = this.still ? 1 : phase(now, this.warmupStarted, 120)
      this.physicsWarmup = 1 - (1 - t) ** 2
    }
    const hoverLerp = this.still
      ? 1
      : this.overview && !launching
        ? -Math.expm1(-6 * frameSeconds)
        : -Math.expm1(-12 * frameSeconds)
    this.pose.x = this.pose.y = 0
    this.pose.zoom = mix(this.pose.zoom, this.goal.zoom, lerp)
    this.baseZoom = mix(this.baseZoom, this.desiredBaseZoom, lerp)
    const zoom = this.pose.zoom * this.baseZoom
    const viewWidth = Math.max(1, w - this.sidebarInset)
    const ox = viewWidth / 2 + this.pose.x,
      oy = h / 2 + this.pose.y
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = NIGHT
    ctx.fillRect(0, 0, w, h)
    const snap = (x: number) => Math.round(x * dpr) / dpr
    this.stars.draw(ctx, now, w, h, viewWidth, this.still)
    this.particles.draw(ctx, now, w, h, this.still, viewWidth)
    const directory =
      this.overview && this.kind
        ? [...this.marks.values()].find((m) => m.role === 'hub' && m.entity.kind === this.kind)?.key
        : null
    // A captured node owns the preview, even when the pointer crosses another mark or the drawer.
    const candidate =
      launching || nav
        ? null
        : (this.nodeDrag?.key ?? this.hover ?? this.external ?? directory ?? null)
    const hovered = this.marks.get(candidate ?? '')
    const preview = hovered ? this.previews.get(hovered.key) : undefined
    const directNeighbors = hovered ? this.neighborKeys.get(hovered.key) : undefined
    const neighbors = preview?.ids ?? directNeighbors
    const activeHub = hovered?.role === 'hub' && this.explore
    const miniGroup = hovered?.role === 'satellite'
    if (!this.overview) {
      const seconds = clamp((now - this.radialSampleAt) / 1000, 0, Math.min(frameSeconds, 0.08))
      this.advanceRadial(now, seconds, zoom, ox, oy)
    }
    const landingMark = nav && this.marks.get(nav.destination)
    const landing = landingMark
      ? { x: ox + landingMark.position.x * zoom, y: oy + landingMark.position.y * zoom }
      : { x: ox, y: oy }
    const projected = new Map<string, ReturnType<typeof shot> & Point>()
    const swirl = launching && this.bloomMs ? globalSwirl(ms, this.bloomMs) : 0
    if (launching) {
      for (const { hub } of this.canopies) {
        const state = shot(ms, hub.order, this.hubCount)
        const angle = hub.orbitAngle + swirl + state.localSwirl
        const radius = hub.orbitRadius * state.travel
        projected.set(hub.key, {
          ...state,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius
        })
      }
    } else if (this.overview && !nav) {
      // In a frame that straddles the final petal, each integrator gets only its part of the frame.
      const step = handedOff ? Math.min(dt, Math.max(0, now - cutoff) / 16.67) : dt
      this.advanceOverview(now, step, zoom, ox, oy, viewWidth, candidate, pointerHeld)
    }
    const ringRadius = 2 + 3.5 * easeBloom(phase(ms, 0, 240))
    for (const [key, m] of this.marks) {
      let alpha = mix(m.fromAlpha, m.live ? 1 : 0, flight)
      if (nav && !m.inBloom && isOverviewMark(m.role))
        alpha = m.live
          ? mix(m.fromAlpha, 1, smoothstep(phase(elapsed, 70, nav.duration - 70)))
          : m.fromAlpha * (1 - smoothstep(clamp(elapsed / 120)))
      else if (projection?.forward)
        alpha = m.live
          ? mix(m.fromAlpha, 1, easeOut(clamp(elapsed / 100)))
          : m.fromAlpha * (1 - smoothstep(clamp(elapsed / 100)))
      if (!m.live && flight === 1) {
        this.marks.delete(key)
        continue
      }
      m.alpha = alpha
      const over = m === hovered
      const related =
        !hovered ||
        over ||
        (activeHub
          ? m.parent === hovered.key
          : miniGroup
            ? m.parent === hovered.key || m.role === 'center'
            : neighbors?.has(key) ||
              (hovered.role === 'leaf' && m.thumbnail && directNeighbors?.has(key)))
      const filtered = !hovered && this.overview && this.filter && this.filter !== m.entity.kind
      let bodyLight = 1
      let titleLight = 1
      let trunkLight = 1
      if (!related || filtered) {
        if (this.overview && hovered?.role === 'hub') {
          bodyLight = m.thumbnail ? 0.6 : 0.64
          titleLight = 0.82
        } else if (this.overview && hovered?.role === 'leaf') {
          bodyLight = trunkLight = 0.44
          titleLight = 0.56
        } else {
          bodyLight =
            titleLight =
            trunkLight =
              this.overview ? 0.15 : isOuter(hovered?.role ?? 'center') ? 0.6 : 1
        }
      }
      m.light = mix(m.light, bodyLight, hoverLerp)
      m.titleLight = mix(m.titleLight, titleLight, hoverLerp)
      m.trunkLight = mix(m.trunkLight, trunkLight, hoverLerp)
      m.emphasis = mix(m.emphasis, over ? 1 : 0, hoverLerp)
      m.hubFocusT = mix(
        m.hubFocusT,
        over && (activeHub || m.role === 'center' || miniGroup) ? 1 : 0,
        hoverLerp
      )
      m.leafFocusT = mix(
        m.leafFocusT,
        over && (m.role === 'leaf' || isOuter(m.role)) ? 1 : 0,
        hoverLerp
      )
      const hub = m.role === 'hub',
        leaf = m.role === 'leaf'
      const state = launching ? projected.get(hub ? key : m.parent) : undefined
      let orbit: Point | undefined
      if (state && (hub || leaf)) {
        const growth = leaf ? leafGrowth(ms, state.bloomStart, m.seed) : state.travel
        const landing = this.introLandings.get(key) ?? m
        orbit = {
          x: state.x + (m.position.x - landing.x) * bloomMix,
          y: state.y + (m.position.y - landing.y) * bloomMix
        }
        if (leaf) {
          const theta = m.orbitAngle + swirl * 0.85 - 0.38 * (1 - growth)
          orbit.x += Math.cos(theta) * m.orbitRadius * growth
          orbit.y += Math.sin(theta) * m.orbitRadius * growth
        }
        m.alpha *= leaf ? growth : state.visible
      }
      const painted = orbit ?? m.position
      const end = { x: ox + painted.x * zoom, y: oy + painted.y * zoom }
      if (nav && projection && m.inBloom) {
        m.screen = bloomPoint(m, m.live ? end : landing, nav, landing, projection)
        const owner = this.marks.get(m.parent)
        if (m.live && m.role === 'upstream' && owner) {
          m.screen.x = owner.screen.x
          m.screen.y = Math.min(owner.screen.y - 8, m.screen.y)
        } else if (m.live && m.role === 'mini' && owner) {
          // Project a private tip about its moving square even when its entity was
          // previously visible in another role. Its spoke can never span the canvas.
          const dx = (m.position.x - owner.position.x) * zoom
          const dy = (m.position.y - owner.position.y) * zoom
          const local = projection.project(dx, dy)
          if (!projection.forward) {
            local.x = mix(local.x, dx, projection.travel)
            local.y = mix(local.y, dy, projection.travel)
          }
          const tip = privateTip(local.x, local.y, m.radial!.angle)
          m.screen.x = owner.screen.x + tip.x
          m.screen.y = owner.screen.y + tip.y
        }
      } else m.screen = !m.live && nav ? copy(m.sourceScreen) : end
    }
    const line = (
      a: Point,
      b: Point,
      style: ReturnType<typeof waveInk>,
      width: number,
      alpha: number
    ) => {
      if (alpha < 0.002) return
      ctx.globalAlpha = clamp(alpha)
      ctx.lineWidth = width
      if (typeof style === 'function') {
        // Hundreds of translucent gradients can force a cold shader compilation.
        // Sample their original color and traveling crest on the straight segment
        // for this short fade, so even the first exit uses ordinary solid strokes.
        const x = snap(a.x),
          y = snap(a.y),
          dx = snap(b.x) - x,
          dy = snap(b.y) - y
        const length = Math.hypot(dx, dy)
        const bands = clamp(Math.ceil(length / 14), 2, 32)
        for (let i = 0; i < bands; i++) {
          const start = Math.max(0, i / bands - 0.22 / (length || 1)),
            end = (i + 1) / bands
          ctx.strokeStyle = color(style((i + 0.5) / bands))
          ctx.beginPath()
          ctx.moveTo(x + dx * start, y + dy * start)
          ctx.lineTo(x + dx * end, y + dy * end)
          ctx.stroke()
        }
        return
      }
      ctx.strokeStyle = style
      ctx.beginPath()
      ctx.moveTo(snap(a.x), snap(a.y))
      ctx.lineTo(snap(b.x), snap(b.y))
      ctx.stroke()
    }
    const circle = (
      p: Point,
      r: number,
      style: string | CanvasGradient,
      stroke = false,
      lineWidth = 1
    ) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, TAU)
      if (stroke) {
        ctx.strokeStyle = style
        ctx.lineWidth = lineWidth
        ctx.stroke()
      } else {
        ctx.fillStyle = style
        ctx.fill()
      }
    }
    if (this.overview && this.panoramaAlpha > 0 && this.explore && bloomMix > 0) {
      for (const edge of this.ambientCrossEdges) {
        const a = this.marks.get(edge.a)
        const b = this.marks.get(edge.b)
        if (!a?.live || !b?.live) continue
        const highlight = this.wires.get(edge.key)?.leafWeight ?? 0
        // Projection is already in CSS pixels (0.75 / zoom in world units).
        line(
          a.screen,
          b.screen,
          'rgba(66, 108, 218, 0.12)',
          0.75,
          Math.min(a.alpha, b.alpha) * (1 - highlight) * bloomMix * this.panoramaAlpha
        )
      }
    }
    const water = 1
    if (this.overview && this.panoramaAlpha > 0 && this.explore && (this.marks.size || launching)) {
      const ring = { x: ox, y: oy }
      let ringFocus = 0
      for (const m of this.marks.values()) {
        if (m.role !== 'hub') continue
        const dx = m.screen.x - ring.x,
          dy = m.screen.y - ring.y
        const len = Math.hypot(dx, dy) || 1
        const rim = { x: ring.x + (ringRadius * dx) / len, y: ring.y + (ringRadius * dy) / len }
        const focus = m.focusT
        ringFocus = Math.max(ringFocus, focus)
        if (m.trunkFlow) {
          const ink = waveInk(
            ctx,
            m.trunkFlow,
            ring,
            m.screen,
            this.waveSeconds,
            m.theme,
            'trunk',
            focus,
            0,
            this.still,
            false,
            nav?.kind === 'exit'
          )
          line(rim, m.screen, ink, 0.95, m.trunkLight * m.alpha * this.panoramaAlpha)
        }
      }
      ctx.globalAlpha =
        this.panoramaAlpha * (launching ? 0.24 + 0.76 * easeBloom(phase(ms, 0, 240)) : 1)
      circle(
        ring,
        ringRadius,
        ringFocus === 0
          ? 'rgba(112, 148, 228, 0.36)'
          : rgba(blendInk('#7094E4', '#6ED7B9', ringFocus), 0.36 + 0.16 * ringFocus),
        true,
        0.9
      )
    }
    this.lineTargets = []
    const relationLabels: {
      text: string
      x: number
      y: number
      alpha: number
      emphasis: number
    }[] = []
    const categoryOverview = this.overview && this.explore
    for (const [key, wire] of this.wires) {
      if (!wire.live && flight === 1) {
        this.wires.delete(key)
        continue
      }
      const a = this.marks.get(wire.a),
        b = this.marks.get(wire.b)
      if (!a || !b) continue
      if (!this.overview && (!wire.live || !a.live || !b.live || !focusConnection(wire.kind, a, b)))
        continue
      // The category overview paints its ambient edges under the hierarchy.
      if (categoryOverview && wire.kind === 'aggregate') {
        wire.alpha = 0
        continue
      }
      const touches = hovered?.key === wire.a || hovered?.key === wire.b
      const revealRelation = categoryOverview && wire.kind === 'relation' && wire.live
      if (revealRelation && !touches && !wire.leafActive && wire.leafWeight === 0) {
        wire.alpha = 0
        wire.emphasis = 0
        continue
      }
      const hot =
        this.hoveredLine === key ||
        (touches &&
          (!preview || neighbors?.has(hovered?.key === wire.a ? wire.b : wire.a)) &&
          (!activeHub || wire.kind === 'spoke') &&
          (!miniGroup || wire.kind === 'mini' || wire.kind === 'guide'))
      const rate = this.still ? 1 : 1 - (hot ? 0.9 : 0.925) ** dt
      wire.emphasis = mix(wire.emphasis, hot ? 1 : 0, rate)
      wire.drawProgress = mix(wire.drawProgress, hot ? 1 : 0, rate)
      wire.alpha = mix(
        wire.fromAlpha,
        wire.live ? 1 : 0,
        projection?.forward ? easeOut(clamp(elapsed / 100)) : flight
      )
      const leafActive = this.overview && hovered?.role === 'leaf' && !!hot
      if (wire.leafActive !== leafActive) {
        wire.leafActive = leafActive
        wire.leafFrom = wire.leafWeight
        wire.leafSince = now
      }
      if (wire.leafActive || wire.leafWeight > 0) {
        const t = this.still ? 1 : phase(now, wire.leafSince, leafActive ? 220 : 260)
        wire.leafWeight = mix(wire.leafFrom, leafActive ? 1 : 0, t * t * (3 - 2 * t))
      }
      if (revealRelation) {
        // Persist the displayed opacity so a click cannot resurrect hidden edges
        // as outgoing wires during the flight into the radial view.
        wire.alpha *= wire.leafWeight
        wire.emphasis = wire.leafWeight
        if (!wire.alpha) continue
      }
      const strength = wire.emphasis
      let alpha = wire.alpha * Math.min(a.alpha, b.alpha)
      if (wire.kind === 'aggregate' || wire.kind === 'relation') alpha *= phase(ms, DOCK_MS, 500)
      if (alpha < 0.003) continue
      const focused = wire.kind === 'focus' || wire.kind === 'mini' || wire.kind === 'guide'
      if (focused) {
        const family = a.hubFocusT
        const single = Math.max(
          b.leafFocusT,
          this.hoveredLine === key || (b.role === 'upstream' && b === hovered) ? 1 : 0
        )
        const level = (isOuter(hovered?.role ?? 'center') || this.hoveredLine) && !hot ? 0.42 : 1
        wire.light = mix(wire.light, level, hoverLerp)
        const beam = waveInk(
          ctx,
          wire.flow,
          a.screen,
          b.screen,
          this.waveSeconds,
          wire.kind === 'mini' ? sky : a.theme,
          'spoke',
          family,
          single,
          this.still,
          true,
          nav?.kind === 'exit'
        )
        line(
          a.screen,
          b.screen,
          beam,
          mix(wire.kind === 'mini' ? 0.78 : 0.95, 1.15, single),
          alpha * wire.light
        )
        if (wire.live) this.lineTargets.push({ wire, a: a.screen, b: b.screen })
        if (wire.label && (this.hoveredLine === key || hovered?.key === b.key) && !nav)
          relationLabels.push({
            text: wire.label,
            x: (a.screen.x + b.screen.x) / 2,
            y: (a.screen.y + b.screen.y) / 2 - 7,
            alpha: 0.92,
            emphasis: 1
          })
        continue
      }
      const dimTarget =
        this.overview && hovered && (hovered.role === 'hub' || hovered.role === 'leaf')
          ? hot
            ? 1
            : hovered.role === 'hub'
              ? 0.64
              : 0.44
          : Math.min(a.light, b.light)
      wire.light = mix(wire.light, dimTarget, hoverLerp)
      const dim = wire.light
      let style: ReturnType<typeof waveInk>
      const owner = a.role === 'hub' ? a : b
      const hubFocus = wire.kind === 'spoke' && this.explore ? owner.focusT : 0
      const leafFocus = wire.leafWeight
      if (wire.kind === 'spoke' && water > 0) {
        style = waveInk(
          ctx,
          wire.flow,
          owner.screen,
          (owner === a ? b : a).screen,
          this.waveSeconds,
          owner.theme,
          'spoke',
          hubFocus,
          leafFocus,
          this.still,
          false,
          nav?.kind === 'exit'
        )
      } else if (wire.kind === 'spoke') {
        style = ctx.createLinearGradient(a.screen.x, a.screen.y, b.screen.x, b.screen.y)
        style.addColorStop(0, rgba(a.color, 0.34 + 0.51 * strength))
        style.addColorStop(
          1,
          strength > 0.001
            ? rgba(activeHub ? a.color : '#E6F0FF', 0.14 + 0.71 * strength)
            : 'rgba(130,165,245,.14)'
        )
      } else if (this.overview && wire.kind === 'relation') {
        style = waveInk(
          ctx,
          wire.flow,
          a.screen,
          b.screen,
          this.waveSeconds,
          owner.theme,
          'relation',
          0,
          revealRelation ? 1 : strength,
          this.still
        )
      } else style = 'rgba(98,134,218,.10)'
      let width = mix(0.9, 0.95, water)
      if (this.overview && wire.kind === 'relation') width = 0.85
      else if (this.overview && wire.kind === 'spoke') width = mix(0.95, 0.85, leafFocus)
      const inkAlpha =
        this.overview && this.explore && wire.kind === 'relation' && launching
          ? 0
          : revealRelation
            ? alpha
            : alpha * dim
      line(a.screen, b.screen, style, width, inkAlpha)
    }
    this.targets = []
    const occupied: Box[] = []
    const cardBoxes: Box[] = []
    type Label = {
      m: Moving
      text: string
      size: number
      weight: number
      alpha: number
      pill: number
      main: boolean
      relatedName: boolean
      count: boolean
      box: Box
      lines: string[]
    }
    const labels: Label[] = []
    const radialTitles: { m: Moving; box: Box; cap: Caption; alpha: number; pill: number }[] = []
    this.paintedTitles = []
    function target(m: Moving): Pick {
      return { key: m.key, id: m.entity.id, role: m.role }
    }
    const drawingOrder = launching
      ? [...this.marks.values()].sort((a, b) => Number(a.role === 'hub') - Number(b.role === 'hub'))
      : this.marks.values()
    for (const m of drawingOrder) {
      const p = m.screen,
        e = m.emphasis
      ctx.globalAlpha = m.alpha * m.light
      if (ctx.globalAlpha < 0.003) continue
      const shapeMix = nav && m.sourceGlyph ? smoothstep(clamp(progress / 0.66)) : 1
      if (shapeMix < 1 && m.sourceGlyph) {
        const old = m.sourceGlyph
        ctx.globalAlpha = m.alpha * m.light * (1 - shapeMix)
        if (old.card)
          paintThumbnail(ctx, old.card, p.x, p.y, old.card.width, old.card.height, 0, 0, dpr)
        else if (old.role === 'hub' || old.role === 'upstream' || old.role === 'satellite') {
          const side =
            old.role === 'hub'
              ? hubSide(Math.sqrt(m.count / Math.max(1, this.largestHub)))
              : old.role === 'satellite'
                ? 6
                : 8
          ctx.fillStyle = old.theme.hub
          ctx.fillRect(p.x - side / 2, p.y - side / 2, side, side)
        } else
          circle(
            p,
            old.role === 'center' ? 3.3 : 2.1,
            old.role === 'center' ? '#EAF5FF' : focusBlue
          )
      }
      ctx.globalAlpha = m.alpha * m.light * shapeMix
      if (!isOverviewMark(m.role)) {
        const parent = this.marks.get(m.parent)
        const family = parent?.hubFocusT ?? 0
        const single = m.leafFocusT
        const chip = m.role === 'satellite',
          up = m.role === 'upstream',
          core = m.role === 'center'
        let halfW = 9,
          halfH = 9
        if (core || up || chip) {
          const tint = blendInk(
            core ? '#EDF6FF' : up && m.theme === jade ? '#1AD9A4' : focusBlue,
            focusGreen,
            e
          )
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 13)
          glow.addColorStop(0, rgba(tint, 0.38 + 0.2 * e))
          glow.addColorStop(1, rgba(tint, 0))
          circle(p, 13, glow)
          if (core) {
            circle(p, 3.3, tint)
            if (e > 0.002) circle(p, 10, rgba(focusGreen, e), true, 1.2)
          } else {
            const side = up ? 8 : 6
            ctx.fillStyle = tint
            ctx.fillRect(snap(p.x - side / 2), snap(p.y - side / 2), side, side)
          }
        } else if (m.thumbnail) {
          const scale = 1 + 0.08 * single
          const width = m.thumbnail.width * scale,
            height = m.thumbnail.height * scale
          paintThumbnail(ctx, m.thumbnail, p.x, p.y, width, height, family, single, dpr, true)
          halfW = Math.max(halfW, width / 2 + 2)
          halfH = Math.max(halfH, height / 2 + 2)
        } else {
          const regular = m.role === 'mini' ? 1.65 : 2.1
          const t = Math.max(family, single)
          const radius = mix(mix(regular, 3.8, family), 4.6, single)
          circle(p, radius, blendInk(focusBlue, NIGHT, t))
          if (t > 0.002)
            circle(
              p,
              radius,
              rgba(blendInk(focusGreen, '#FFFFFF', single), t),
              true,
              mix(1.1, 1.2, single)
            )
        }
        if (m.live && !nav && m.alpha > 0.38)
          this.targets.push({
            box: { x: p.x - halfW, y: p.y - halfH, w: halfW * 2, h: halfH * 2 },
            hit: target(m),
            dot: true,
            rectangular: !!m.thumbnail || up || chip
          })
        const cap = m === hovered && m.detailCaption ? m.detailCaption : m.caption
        const captured = this.nodeDrag?.key === m.key
        if (!cap || !m.live || (!captured && (p.x < 0 || p.x > viewWidth || p.y < 0 || p.y > h)))
          continue
        // A group opens its own labels only. Fixed label offsets keep dragging and contraction coherent.
        const visibility = m.role === 'mini' ? Math.max(family, e) : 1
        const delay = nav ? nav.duration * 0.45 + (core ? 0 : m.seed * 42) : 0
        const shown = nav ? smoothstep(phase(elapsed, delay, nav.duration - delay)) : 1
        const labelAlpha = m.alpha * m.light * visibility * shown
        if (labelAlpha < 0.003) continue
        const angle = m.radial?.angle ?? 0
        const slide = core ? 0 : 5 * (1 - shown)
        let x = nav ? ox + m.position.x * zoom + slide * Math.cos(angle) : p.x
        let y = nav ? oy + m.position.y * zoom + slide * Math.sin(angle) : p.y
        if (cap.cell && m.radial && !captured) {
          // On phone-width canvases, leave the text inside its own cell as the
          // card breathes. The shared drag displacement still follows the card.
          const scale = zoom * (1 - 0.1 * family)
          const swayX = m.radial.home.x - m.x * scale,
            swayY = m.radial.home.y - m.y * scale
          const roomX = Math.max(0, (cap.cell.w * scale - cap.w) / 2 - 1)
          const roomY = Math.max(0, (cap.cell.h * scale - cap.h - 12) / 2 - 1)
          x += clamp(swayX, -roomX, roomX) - swayX
          y += clamp(swayY, -roomY, roomY) - swayY
        }
        const box = {
          x: captured ? x + cap.dx : clamp(x + cap.dx, 3, Math.max(3, viewWidth - cap.w - 3)),
          y: captured ? y + cap.dy : clamp(y + cap.dy, 3, Math.max(3, h - cap.h - 3)),
          w: cap.w,
          h: cap.h
        }
        radialTitles.push({
          m,
          box,
          cap,
          alpha: labelAlpha,
          pill: core || up || m.role === 'mini' ? 1 : single
        })
        continue
      }
      const hub = m.role === 'hub'
      const state = launching && hub ? projected.get(m.key) : undefined
      const family = m.role === 'leaf' && this.explore ? (this.marks.get(m.parent)?.focusT ?? 0) : 0
      const thumb = m.role === 'leaf' ? m.thumbnail : undefined
      let labelGap = 10
      if (hub) {
        const mass = Math.sqrt(m.count / this.largestHub)
        const shrink = state?.shrink ?? 1
        const side = mix(24 + 18 * mass, hubSide(mass), shrink) * (1 + 0.12 * e)
        const focus = this.explore && !state ? m.focusT : 0
        const color = state
          ? blendInk(INTRO_COLOR, m.theme.hub, shrink)
          : blendInk(m.theme.hub, '#34F5A4', focus)
        const radius = side * mix(1.9, 2.6, focus)
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
        glow.addColorStop(0, rgba(color, mix(0.22, 0.52, focus)))
        glow.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = glow
        ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2)
        ctx.fillStyle = color
        ctx.fillRect(snap(p.x - side / 2), snap(p.y - side / 2), side, side)
        labelGap = side / 2 + 4
      } else if (thumb) {
        const x = snap(p.x),
          y = snap(p.y)
        const { width, height } = thumb
        labelGap = width / 2 + 5
        if (hovered?.role === 'leaf')
          cardBoxes.push({ x: x - width / 2, y: y - height / 2, w: width, h: height })
        const linked = hovered?.role === 'leaf' && directNeighbors?.has(m.key)
        m.whiteT = mix(m.whiteT, linked ? 1 : 0, hoverLerp)
        paintThumbnail(ctx, thumb, x, y, width, height, family, m.whiteT, dpr)
      } else {
        // Screen pixels correspond to 110 / zoom in the world.
        const nearby = this.pointer
          ? clamp(1 - Math.hypot(p.x - this.pointer.x, p.y - this.pointer.y) / 110)
          : 0
        const related = hovered?.role === 'leaf' && neighbors?.has(m.key)
        m.whiteT = mix(m.whiteT, related ? 1 : nearby, hoverLerp)
        paintWaterDot(ctx, p, m.theme.dot, m.whiteT, family, m.leafFocusT)
      }
      if (m.live && m.alpha > 0.38 && !launching && !nav) {
        const r = hub ? 13 : 10
        const halfW = thumb ? Math.max(r, thumb.width / 2 + 1.5) : r
        const halfH = thumb ? Math.max(r, thumb.height / 2 + 1.5) : r
        this.targets.push({
          box: { x: p.x - halfW, y: p.y - halfH, w: halfW * 2, h: halfH * 2 },
          hit: target(m),
          dot: true,
          rectangular: !!thumb
        })
      }
      if (!m.entity.name || (!launching && !m.live) || (nav && !this.overview)) continue
      const main = hub
      const neighborName =
        this.overview && !activeHub && hovered?.role === 'leaf' && neighbors?.has(m.key)
      const showName = main || neighborName || m === hovered
      const inView = p.x >= 0 && p.x <= viewWidth && p.y >= 0 && p.y <= h
      if (this.overview && !launching && (!showName || !inView)) {
        m.nameAlpha = m.revealAlpha = 0
        continue
      }
      m.nameAlpha = mix(m.nameAlpha, showName ? 1 : 0, hoverLerp)
      const textLight = hub ? m.titleLight : m.light
      const alpha = m.alpha * textLight * m.nameAlpha * (state?.shrink ?? 1) * (nav ? namesIn : 1)
      if (alpha < 0.015) continue
      const pill = hub ? 0 : m.leafFocusT
      const relatedName = this.overview && m.role === 'leaf' && !!neighborName && m !== hovered
      const size = hub ? 13 + (water > 0 ? 8 * m.hubFocusT : 8 * e) : relatedName ? 11 : 12
      const weight = hub ? Math.round(mix(650, 500, water)) : main ? 650 : relatedName ? 400 : 450
      ctx.font = font(size, weight)
      const title = m.entity.name + (m === hovered && preview?.extra ? '  +' + preview.extra : '')
      const text = title
      const count = hub
      const pad = pill > 0 ? 6 * pill : 0
      const screenMax = Math.max(42, viewWidth - 22)
      const lines: string[] = []
      if (ctx.measureText(text).width > screenMax - 2 * pad) {
        let part = ''
        for (const c of text) {
          if (part && ctx.measureText(part + c).width > screenMax - 2 * pad) {
            lines.push(part)
            part = ''
          }
          part += c
        }
        lines.push(part)
      } else lines.push(text)
      const tw = Math.max(...lines.map((t) => ctx.measureText(t).width))
      let extra = 0
      if (count) {
        ctx.font = font(10 + water, 500)
        extra = 4 + ctx.measureText(String(m.count)).width
      }
      const bw = tw + extra + 2 * pad,
        bh = lines.length * (size + 2) + 4 * pill
      let x = p.x + labelGap
      let y = p.y - bh / 2
      if (m.live && inView) {
        x = clamp(x, 4, viewWidth - bw - 4)
        y = clamp(y, 4, h - bh - 4)
      }
      labels.push({
        m,
        text,
        size,
        weight,
        alpha,
        pill,
        main,
        relatedName,
        count,
        box: { x, y, w: bw, h: bh },
        lines
      })
    }
    const radius = (m: Moving) => Math.hypot(m.screen.x - ox, m.screen.y - oy)
    labels.sort(
      (a, b) =>
        Number(b.m === hovered) - Number(a.m === hovered) ||
        (this.overview && hovered ? Number(b.m.role === 'hub') - Number(a.m.role === 'hub') : 0) ||
        Number(hovered?.role === 'leaf' && neighbors?.has(b.m.key)) -
          Number(hovered?.role === 'leaf' && neighbors?.has(a.m.key)) ||
        Number(b.main) - Number(a.main) ||
        radius(b.m) - radius(a.m) ||
        (this.neighborKeys.get(b.m.key)?.size ?? 0) - (this.neighborKeys.get(a.m.key)?.size ?? 0)
    )
    const placed: Label[] = []
    for (const label of labels) {
      const b = label.box
      const p = label.m.screen
      const crowdedAt = (box: Box) =>
        occupied.some((other) => intersects(other, box)) ||
        (hovered?.role === 'leaf' && cardBoxes.some((card) => intersects(card, box)))
      const preferredX = b.x
      const preferredY = b.y
      let crowded = crowdedAt(b)
      if (crowded && this.overview && hovered) {
        const dx = (label.m.thumbnail?.width ?? 12) / 2 + 5
        const dy = (label.m.thumbnail?.height ?? 12) / 2 + 4
        for (const [x, y] of [
          [p.x - dx - b.w, p.y - b.h / 2],
          [p.x - b.w / 2, p.y - dy - b.h],
          [p.x - b.w / 2, p.y + dy],
          [p.x + dx, p.y - dy - b.h],
          [p.x + dx, p.y + dy],
          [p.x - dx - b.w, p.y - dy - b.h],
          [p.x - dx - b.w, p.y + dy]
        ]) {
          b.x = clamp(x, 4, Math.max(4, viewWidth - b.w - 4))
          b.y = clamp(y, 4, Math.max(4, h - b.h - 4))
          crowded = crowdedAt(b)
          if (!crowded) break
        }
      }
      if (crowded && this.overview && hovered?.role === 'leaf' && label.m === hovered) {
        // Keep the captured pill pickable in a dense cluster. Try the closest clear
        // row above or below the cards in its column before using the foreground.
        b.x = preferredX
        const maxY = Math.max(4, h - b.h - 4)
        const rows = [4, maxY]
        for (const card of cardBoxes) {
          if (card.x + card.w + 3 <= b.x || card.x >= b.x + b.w + 3) continue
          rows.push(card.y - b.h - 3, card.y + card.h + 3)
        }
        rows.sort((a, c) => Math.abs(a - preferredY) - Math.abs(c - preferredY))
        b.y = rows.find((y) => y >= 4 && y <= maxY && !crowdedAt({ ...b, y })) ?? preferredY
        crowded = false
      }
      if (crowded) {
        label.m.revealAlpha = 0
        continue
      }
      label.m.revealAlpha = mix(label.m.revealAlpha, 1, hoverLerp)
      label.alpha *= label.m.revealAlpha
      occupied.push(b)
      placed.push(label)
    }
    occupied.push(...radialTitles.map((t) => t.box))
    if (nav && namesOut > 0) {
      for (const old of nav.titleMap) {
        const { x, y, w, h } = old.box
        ctx.globalAlpha = old.alpha * namesOut
        if (old.pill > 0.002) {
          ctx.fillStyle = rgba(labelBlue, old.pill)
          if (old.role === 'neighbor') {
            ctx.beginPath()
            ctx.roundRect(x, y, w, h, Math.min(h / 2, 7))
            ctx.fill()
          } else ctx.fillRect(x, y, w, h)
        }
        ctx.fillStyle = old.pill > 0.5 ? '#FFFFFF' : 'rgba(240,246,255,0.92)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.font = font(old.size, old.weight)
        old.lines.forEach((part, i) =>
          ctx.fillText(part, x + 4, y + (i + 0.5) * (old.size + 2) + 2)
        )
        if (old.count !== undefined) {
          const end = x + 7 + Math.max(...old.lines.map((part) => ctx.measureText(part).width))
          ctx.font = font(9, 600)
          ctx.fillText(String(old.count), end, y + (old.size + 2) / 2 - 1)
        }
        this.paintedTitles.push({ ...old, alpha: old.alpha * namesOut })
      }
    }
    // Paint a single active relation after locating its endpoints, above other text if necessary.
    ctx.font = font(10)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    for (const r of relationLabels) {
      const tw = ctx.measureText(r.text).width
      const box = { x: r.x - tw / 2, y: r.y - 5, w: tw, h: 10 }
      const free =
        [0, -14, 14, -27, 27]
          .map((dy) => ({ ...box, y: box.y + dy }))
          .find((b) => !occupied.some((other) => intersects(other, b))) ?? box
      ctx.globalAlpha = r.alpha
      ctx.fillStyle = '#EEF5FF'
      ctx.fillText(r.text, free.x + free.w / 2, free.y + 5)
      occupied.push(free)
    }
    // Paint the hot label last. Picking uses these very same screen rectangles.
    placed.sort((a, b) => a.m.emphasis - b.m.emphasis)
    for (const { m, box, size, weight, alpha, pill, count, lines, relatedName } of placed) {
      ctx.globalAlpha = alpha
      if (pill > 0.005) {
        ctx.fillStyle = rgba('#0033FF', pill)
        ctx.fillRect(box.x, box.y, box.w, box.h)
      }
      ctx.fillStyle = relatedName ? 'rgba(242, 247, 255, 0.92)' : '#FFFFFF'
      ctx.font = font(size, weight)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      const tx = box.x + 6 * pill,
        ty = box.y + (size + 2) / 2 + 2 * pill
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], tx, ty + i * (size + 2))
      if (count) {
        const end = tx + ctx.measureText(lines[lines.length - 1]).width + 4
        ctx.fillStyle = 'rgba(180,206,255,.72)'
        ctx.font = font(10 + water, 500)
        ctx.fillText(String(m.count), end, ty - 4)
      }
      this.paintedTitles.push({
        key: m.key,
        role: m.role,
        box,
        lines,
        size,
        weight,
        alpha,
        pill
      })
      if (m.live && alpha > 0.28 && !launching && !nav)
        this.targets.push({
          box,
          hit: target(m),
          dot: false,
          foregroundPill: this.overview && m === hovered && m.role === 'leaf' && pill > 0.005
        })
    }
    radialTitles.sort((a, b) => a.m.emphasis - b.m.emphasis)
    for (const { m, cap, box, alpha, pill } of radialTitles) {
      ctx.globalAlpha = alpha
      if (pill > 0.002) {
        ctx.fillStyle = rgba(labelBlue, pill)
        if (m.role === 'neighbor') {
          ctx.beginPath()
          ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(box.h / 2, 7))
          ctx.fill()
        } else ctx.fillRect(box.x, box.y, box.w, box.h)
      }
      ctx.fillStyle = pill > 0.5 ? '#FFFFFF' : 'rgba(240,246,255,0.92)'
      ctx.font = font(cap.size, 500)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const y = box.y + 2 + (cap.size + 2) / 2
      cap.lines.forEach((part, i) => ctx.fillText(part, box.x + 4, y + i * (cap.size + 2)))
      if (m.role === 'upstream') {
        const x = box.x + 7 + Math.max(...cap.lines.map((part) => ctx.measureText(part).width))
        ctx.font = font(9, 600)
        ctx.fillText(String(m.count), x, y - 3)
      }
      this.paintedTitles.push({
        key: m.key,
        role: m.role,
        box,
        lines: cap.lines,
        count: m.role === 'upstream' ? m.count : undefined,
        size: cap.size,
        weight: 500,
        alpha,
        pill
      })
      if (!nav && alpha > 0.25)
        this.targets.push({
          box,
          hit: target(m),
          dot: false,
          foregroundPill: m === hovered && pill > 0.5
        })
    }
    if (nav && progress >= 1) this.navigation = null
    if (this.retestAfterRelease) {
      // A final pointer sample can arrive between paints. Reconcile the immediate
      // release hit with the first set of boxes painted at the new positions.
      this.retestAfterRelease = false
      this.move(this.pointer)
    } else if (
      this.overview &&
      !launching &&
      this.pointer &&
      !pointerHeld &&
      !this.nodeDrag &&
      !this.external &&
      !directory
    ) {
      // Flow can carry a mark away from a stationary pointer. Resolve against the boxes
      // just painted, so the next press selects the same mark as the hover indication.
      this.hover = this.hit(this.pointer)?.key ?? null
    }
    ctx.globalAlpha = 1
    return handedOff
  }
}
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch
} from 'vue'
import type { KnowledgeGraph } from './graphData'
import type { CategoryGraph } from './categoryGraph'
import { buildScene, graphIndex } from './starScene'

const props = defineProps<{
  full: KnowledgeGraph
  indexPanel?: HTMLElement
  indexOpen: boolean
  indexReveal: () => number
  waitingForIntro?: boolean
  model?: CategoryGraph
  selected: string | null
  trail: string[]
  explore: boolean
  highlightKind?: string | null
  activeKindFilter?: string | null
  externalHoverId?: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  back: []
  clear: []
  detail: []
  introEnd: []
}>()
const host = ref<HTMLElement>(),
  canvasRef = ref<HTMLCanvasElement>()
const engine = new StarCanvas()
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const index = computed(() => graphIndex(props.model, props.full, props.explore))
let atlasIndex: GraphIndex | undefined
let panelWidth = 0
let layoutWidth = 1
let context: CanvasRenderingContext2D | null = null
let flightTimer = 0,
  paintedAt = -Infinity
let raf = 0,
  active = false,
  visible = true
let resize: ResizeObserver | undefined, intersection: IntersectionObserver | undefined
let press: {
  id: number
  start: Point
  last: Point
  target: ReturnType<StarCanvas['hit']>
  mode: 'pending' | 'hub' | 'leaf' | 'blank'
  distance: number
  clientX: number
  clientY: number
} | null = null
const dragThreshold = 5
function rebuild(resizing = false) {
  if (!host.value || !context) return
  const data = index.value
  const selected = props.selected && data.entities.has(props.selected) ? props.selected : null
  let overview: Scene | undefined
  if (!selected || atlasIndex !== data) {
    overview = buildScene(data, null, undefined, layoutWidth, engine.height)
    engine.prepareAtlas(data, overview)
    atlasIndex = data
  }
  const path = selected ? (props.trail.at(-1) === selected ? props.trail : [selected]) : []
  const scene = selected
    ? engine.focusScene(data, path, layoutWidth, engine.height, context)
    : overview!
  engine.explore = props.explore
  const baseZoom = context ? fitOverview(scene, context, layoutWidth, engine.height) : 1
  engine.setScene(scene, performance.now(), resizing, baseZoom, layoutWidth, path)
  scheduleFlightFrame()
}
function syncSize() {
  if (!host.value || !context) return
  const { clientWidth: w, clientHeight: h } = host.value
  if (w <= 1 || h <= 1) return
  panelWidth = props.indexPanel?.getBoundingClientRect().width ?? 0
  const worldWidth = Math.max(1, w - (props.indexOpen ? panelWidth : 0))
  const changed = worldWidth !== layoutWidth || h !== engine.height
  layoutWidth = worldWidth
  engine.width = w
  engine.height = h
  if (changed) rebuild(true)
}
function paintFrame(timestamp: number) {
  const canvas = canvasRef.value
  if (!context || !canvas || !active || !visible || document.hidden) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(engine.width * dpr),
    h = Math.round(engine.height * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  engine.still = reduced.matches
  engine.kind = props.highlightKind ?? null
  engine.filter = props.activeKindFilter ?? null
  engine.external = props.externalHoverId ?? null
  engine.waitingForIntro = !!props.waitingForIntro
  engine.sidebarInset = panelWidth * props.indexReveal()
  // A queued RAF may have an older timestamp than a frame painted during a gap.
  paintedAt = Math.max(paintedAt, timestamp)
  if (engine.draw(context, paintedAt, dpr, !!press)) emit('introEnd')
  if (!press) setCursor(engine.hover ? 'pointer' : 'default')
  return true
}
function render(now: number) {
  raf = 0
  if (paintFrame(now)) raf = requestAnimationFrame(render)
}
function scheduleFlightFrame() {
  if (flightTimer || !engine.transitioning || !active || !visible || document.hidden) return
  const delay = clamp(engine.flightEnd - performance.now(), 1, 16)
  flightTimer = window.setTimeout(() => {
    flightTimer = 0
    if (!engine.transitioning || !active || !visible || document.hidden) return
    const now = performance.now()
    // Some compositors skip RAF callbacks when a full panorama first fades in.
    // Advance that short flight on its wall clock while the main RAF remains queued.
    if (now - paintedAt >= 24 || now >= engine.flightEnd) paintFrame(now)
    scheduleFlightFrame()
  }, delay)
}
function schedule() {
  if (!active || !visible || document.hidden) {
    cancelGesture()
    cancelAnimationFrame(raf)
    clearTimeout(flightTimer)
    flightTimer = raf = 0
  } else {
    if (!raf) raf = requestAnimationFrame(render)
    scheduleFlightFrame()
  }
}
function point(e: MouseEvent, box = canvasRef.value!.getBoundingClientRect()) {
  return {
    x: ((e.clientX - box.left) * engine.width) / box.width,
    y: ((e.clientY - box.top) * engine.height) / box.height
  }
}
function onPointerDown(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0 || press || engine.transitioning) return
  const p = point(e)
  engine.move(p)
  press = {
    id: e.pointerId,
    start: p,
    last: p,
    target: engine.hit(p),
    mode: 'pending',
    distance: 0,
    clientX: e.clientX,
    clientY: e.clientY
  }
  canvasRef.value?.setPointerCapture(e.pointerId)
}
// Use travelled CSS pixels, including coalesced samples. A short out-and-back is a drag too.
function updateGesture(e: PointerEvent, p: Point) {
  const gesture = press
  if (!gesture || gesture.id !== e.pointerId) return
  if (gesture.mode === 'pending') {
    const sample = (x: number, y: number) => {
      gesture.distance += Math.hypot(x - gesture.clientX, y - gesture.clientY)
      gesture.clientX = x
      gesture.clientY = y
    }
    for (const event of e.getCoalescedEvents?.() ?? []) sample(event.clientX, event.clientY)
    sample(e.clientX, e.clientY)
    if (gesture.distance < dragThreshold) return
    const hit = gesture.target
    if (
      hit &&
      (props.selected ? isOuter(hit.role) : isOverviewMark(hit.role)) &&
      engine.beginNodeDrag(hit, gesture.start)
    ) {
      gesture.mode = hit.role === 'hub' ? 'hub' : 'leaf'
    } else {
      gesture.mode = 'blank'
    }
  }
  const moved = gesture.last.x !== p.x || gesture.last.y !== p.y
  if ((gesture.mode === 'hub' || gesture.mode === 'leaf') && moved) {
    engine.moveNodeDrag(p)
  } else if (gesture.mode === 'blank') {
    engine.move(null)
  }
  if (moved) {
    gesture.last = p
  }
}
function setCursor(cursor: string) {
  const canvas = canvasRef.value
  if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor
}
function onPointerMove(e: PointerEvent) {
  if (!e.isPrimary) return
  const box = canvasRef.value!.getBoundingClientRect()
  const p = point(e, box)
  if (e.pointerType !== 'touch') {
    for (const sample of e.getCoalescedEvents?.() ?? []) {
      engine.tracePointer(point(sample, box), sample.timeStamp)
    }
    engine.tracePointer(p, e.timeStamp)
  }
  if (press) updateGesture(e, p)
  else if (e.pointerType !== 'touch') engine.move(p)
  setCursor(
    press && (press.mode === 'hub' || press.mode === 'leaf')
      ? 'grabbing'
      : engine.hover
        ? 'pointer'
        : 'default'
  )
}
function onPointerUp(e: PointerEvent) {
  if (!press || press.id !== e.pointerId) return
  const p = point(e)
  updateGesture(e, p)
  const { target, mode } = press
  press = null
  engine.endNodeDrag(true, e.timeStamp)
  if (mode !== 'pending') {
    const inside =
      p.x >= 0 && p.x <= engine.width - engine.sidebarInset && p.y >= 0 && p.y <= engine.height
    // Re-test the release position, including drags released over the drawer or outside the canvas.
    engine.move(inside && e.pointerType !== 'touch' ? p : null)
    setCursor(engine.hover ? 'pointer' : 'default')
    return
  }
  setCursor(target ? 'pointer' : 'default')
  if (!target) {
    if (props.selected) emit('clear')
    return
  }
  if (target.role === 'center') {
    emit('detail')
    return
  }
  engine.select(target)
  if (target.role === 'upstream') emit('back')
  else emit('select', target.id)
}
function onPointerCancel(e: PointerEvent) {
  if (press?.id !== e.pointerId) return
  cancelGesture()
}
function cancelGesture() {
  press = null
  engine.endNodeDrag(false)
  engine.move(null)
  engine.tracePointer(null, 0)
}
function onPointerLeave() {
  if (!press) engine.move(null)
  engine.tracePointer(null, 0)
}
function onWheel(e: WheelEvent) {
  if (e.deltaY !== 0) engine.zoomBy(e.deltaY < 0 ? 1.12 : 0.89)
}
watch(
  () => [index.value, props.selected, props.trail] as const,
  () => {
    cancelGesture()
    engine.reset()
    rebuild()
  }
)
watch(() => [props.indexOpen, props.indexPanel] as const, syncSize, { flush: 'post' })
onMounted(() => {
  context = canvasRef.value!.getContext('2d', { alpha: false })
  active = true
  syncSize()
  resize = new ResizeObserver(syncSize)
  resize.observe(host.value!)
  intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    schedule()
  })
  intersection.observe(host.value!)
  document.addEventListener('visibilitychange', schedule)
  schedule()
})
function suspend() {
  active = false
  schedule()
}
onActivated(() => {
  active = true
  void nextTick(syncSize)
  schedule()
})
onDeactivated(suspend)
onBeforeUnmount(() => {
  suspend()
  resize?.disconnect()
  intersection?.disconnect()
  document.removeEventListener('visibilitychange', schedule)
})
function reset() {
  engine.reset()
}
function getPose() {
  return { ...engine.goal }
}
function restorePose(saved: CameraPose2D) {
  engine.goal = { ...saved }
}
function playIntro(start = performance.now()) {
  syncSize()
  engine.beginIntro(start)
  schedule()
}
function finishIntro() {
  engine.finishIntro()
  schedule()
}
defineExpose({ reset, getPose, restorePose, playIntro, finishIntro })
</script>

<template>
  <div ref="host" class="expo-stage">
    <canvas
      ref="canvasRef"
      class="expo-canvas"
      :aria-label="
        selected
          ? '放射图。点击叶子下钻，拖动叶子调整位置，点击空白或按 Esc 返回全景。'
          : '知识图谱星图。悬停查看关联，单击节点进入放射聚焦，拖动节点调整位置，滚轮缩放。'
      "
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onPointerCancel"
      @wheel.prevent="onWheel"
    ></canvas>

    <div v-if="selected" class="expo-hud-top">
      <button type="button" class="expo-hud-btn" @click="emit('back')">← 返回上一层</button>
    </div>
  </div>
</template>

<style scoped>
.expo-stage {
  position: relative;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: #020618;
  user-select: none;
}

.expo-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.expo-hud-top {
  position: absolute;
  inset: 12px calc(var(--hud-inset, 0px) + 12px) auto 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  pointer-events: none;
}
.expo-hud-btn {
  pointer-events: auto;
  padding: 5px 9px;
  border: 1px solid rgba(130, 168, 255, 0.3);
  color: #e6efff;
  background: rgba(2, 6, 24, 0.75);
  font-size: 12px;
  cursor: pointer;
}
.expo-hud-btn:hover {
  background: #0033ff;
}
</style>
