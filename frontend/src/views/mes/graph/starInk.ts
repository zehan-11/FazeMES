import { seed, type Point } from './starScene'

export const NIGHT = '#020518'

type Tone = readonly [number, number, number, number]
type Ramp = readonly [Tone, Tone, Tone]

const trunkBlue: Tone = [58, 98, 212, 0.18]
const relationBlue: Tone = [98, 134, 218, 0.1]
const green: Ramp = [
  [34, 198, 138, 0.45],
  [55, 226.5, 165, 0.705],
  [76, 255, 192, 0.96]
]
const white: Ramp = [
  [242, 247, 255, 0.88],
  [248, 251, 255, 0.94],
  [255, 255, 255, 1]
]

export interface ClusterInk {
  hub: string
  dot: string
  wave: Ramp
}
const blue = { hub: '#4372FF', dot: '#3E72F2' }
const jade: ClusterInk = {
  ...blue,
  wave: [
    [22, 108, 148, 0.34],
    [30, 173, 166, 0.61],
    [38, 238, 184, 0.88]
  ]
}
const sky: ClusterInk = {
  ...blue,
  wave: [
    [40, 84, 206, 0.34],
    [56, 131, 230.5, 0.62],
    [72, 178, 255, 0.9]
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
export function liveTheme(kind: string): ClusterInk {
  return themes.get(kind) ?? (seed(kind) < 0.5 ? sky : jade)
}

export function blendInk(from: string, to: string, weight: number) {
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

export function makeFlow(id: string, relation = false) {
  const outward = seed(id + '/out')
  const offset = seed(id + '/in')
  return {
    outward,
    inward: relation ? 1 - offset : (outward + 0.35 + 0.3 * offset) % 1,
    outSpeed: relation ? 0.065 + 0.03 * seed(id + '/speed') : 0.18 + 0.06 * seed(id + '/speed'),
    inSpeed: relation
      ? 0.065 + 0.03 * seed(id + '/return-speed')
      : 0.14 + 0.05 * seed(id + '/return-speed'),
    span: relation ? 0.6 + 0.1 * seed(id + '/span') : 0.32 + 0.08 * seed(id + '/span')
  }
}

export type LineFlow = ReturnType<typeof makeFlow>

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

function toneAt(ramp: Ramp, w: number): Tone {
  return w < 0.5 ? mixTone(ramp[0], ramp[1], w * 2) : mixTone(ramp[1], ramp[2], w * 2 - 1)
}

function color(t: Tone) {
  return (
    'rgba(' +
    [Math.round(t[0]), Math.round(t[1]), Math.round(t[2]), t[3].toFixed(3)].join(',') +
    ')'
  )
}

// Wrapped cosine lobes cross both endpoints continuously. Their bounded union lets waves
// pass through one another without an additive flash where their crests coincide.
function lobe(at: number, phase: number, span: number) {
  const d = Math.abs(at - phase)
  const t = (Math.min(d, 1 - d) * 2) / span
  return t >= 1 ? 0 : Math.cos((Math.PI / 2) * t) ** 2
}

export function waveInk(
  ctx: CanvasRenderingContext2D,
  flow: LineFlow,
  from: Point,
  to: Point,
  seconds: number,
  theme: ClusterInk,
  kind: 'spoke' | 'trunk' | 'relation',
  hubFocus: number,
  leafFocus: number,
  still: boolean
) {
  if (kind === 'trunk' && hubFocus === 0) return color(trunkBlue)
  if (kind === 'relation' && leafFocus === 0) return color(relationBlue)
  if (!still) {
    const outward = flow.outSpeed + (0.26 - flow.outSpeed) * hubFocus
    const inward = flow.inSpeed + (0.26 - flow.inSpeed) * hubFocus
    flow.outward = (flow.outward + seconds * outward) % 1
    flow.inward = (1 + flow.inward - seconds * inward) % 1
  }
  const ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
  const segments = kind === 'relation' ? 6 : 10
  for (let i = 0; i <= segments; i++) {
    const x = i / segments
    const a = lobe(x, flow.outward, flow.span)
    const b = lobe(x, flow.inward, flow.span)
    const w = 1 - (1 - a) * (1 - b)
    let tone: Tone
    if (kind === 'trunk') tone = trunkBlue
    else if (kind === 'relation') tone = relationBlue
    else tone = still ? theme.wave[0] : toneAt(theme.wave, w)
    if (hubFocus > 0) tone = mixTone(tone, toneAt(green, w), hubFocus)
    if (leafFocus > 0) tone = mixTone(tone, toneAt(white, w), leafFocus)
    ink.addColorStop(x, color(tone))
  }
  return ink
}

/** A live dot keeps its cluster tint until the pointer approaches; rings mask their spoke. */
export function paintWaterDot(
  ctx: CanvasRenderingContext2D,
  at: Point,
  dotInk: string,
  whiteT: number,
  family: number,
  single: number
) {
  const familyRadius = 2 + 1.5 * family
  const radius = familyRadius + (3.8 - familyRadius) * single
  const focus = Math.max(family, single)
  const alpha = ctx.globalAlpha
  const body = blendInk(dotInk, '#FFFFFF', whiteT)
  ctx.beginPath()
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2)
  ctx.globalAlpha = Math.min(alpha, 0.88 + 0.12 * Math.max(whiteT, focus))
  ctx.fillStyle = blendInk(body, NIGHT, focus)
  ctx.fill()
  if (focus > 0.002) {
    ctx.globalAlpha = alpha * focus
    ctx.strokeStyle = blendInk('#CEF4E6', '#FFFFFF', single)
    ctx.lineWidth = 1 + 0.1 * single
    ctx.stroke()
  }
  ctx.globalAlpha = alpha
}
