import { seed, type Point } from './starScene'

export const NIGHT = '#020518'

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
export interface ClusterInk {
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

export function makeFlow(id: string) {
  return { phase: seed(id + '/travel'), speed: 0.12 + 0.04 * seed(id + '/speed') }
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

function color(t: Tone) {
  return (
    'rgba(' +
    [Math.round(t[0]), Math.round(t[1]), Math.round(t[2]), t[3].toFixed(3)].join(',') +
    ')'
  )
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
  if (kind === 'relation') return color(mixTone(relationBlue, silver, leafFocus))
  if (leafFocus === 1) return color(silver)
  const ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
  if (kind === 'trunk' && hubFocus === 0) {
    ink.addColorStop(0, color(trunkRoot))
    ink.addColorStop(1, color(trunkTip))
    return ink
  }

  const root = mixTone(kind === 'trunk' ? trunkRoot : theme.wave[0], green[0], hubFocus)
  const tip = mixTone(kind === 'trunk' ? trunkTip : theme.wave[2], green[2], hubFocus)
  const middle =
    kind === 'trunk' ? mixTone(root, tip, 0.48) : mixTone(theme.wave[1], green[1], hubFocus)
  const crest = mixTone(theme.wave[3], green[3], hubFocus)
  const center = (1 - Math.cos(2 * Math.PI * (flow.phase + seconds * flow.speed))) / 2
  const halfWidth = 0.22
  const strength = still ? 0 : kind === 'trunk' ? hubFocus : 1

  function stop(t: number) {
    const base =
      t < 0.48 ? mixTone(root, middle, t / 0.48) : mixTone(middle, tip, (t - 0.48) / 0.52)
    const distance = Math.abs(t - center) / halfWidth
    const weight = distance < 1 ? strength * Math.cos((Math.PI / 2) * distance) ** 2 : 0
    ink.addColorStop(t, color(mixTone(mixTone(base, crest, weight), silver, leafFocus)))
  }

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

export function paintWaterDot(
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
