import { BlueParticles, Starfield } from './blueParticles'
import { paintThumbnail, StarThumbnails, thumbnailSize, type StarThumbnail } from './starThumbnails'
import {
  bloomEnd,
  clamp,
  easeOut,
  easeBloom,
  FLIGHT_MS,
  DOCK_MS,
  DOCK_DURATION,
  clockwiseAngle,
  globalSwirl,
  leafGrowth,
  smoothstep,
  phase,
  seed,
  shot,
  TAU,
  type Mark,
  type Point,
  type Scene,
  type Wire
} from './starScene'
import {
  NIGHT,
  type ClusterInk,
  blendInk,
  makeFlow,
  waveInk,
  liveTheme,
  paintWaterDot,
  type LineFlow
} from './starInk'

import {
  cacheCanopies,
  centerClearRadius,
  overviewBounds,
  relaxLaunch,
  stepBloomCurrent,
  stepOverview,
  type Canopy,
  type FluidFrame,
  type FluidMark
} from './starFluid'

export interface CameraPose2D extends Point {
  zoom: number
}
interface Moving extends FluidMark {
  orbitAngle: number
  orbitRadius: number
  hubFocusT: number
  from: Point
  fromAlpha: number
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
const cardSizes = [
  [20, 14],
  [13, 17],
  [15, 15]
] as const
const cardSize = (id: string) => cardSizes[Math.floor(seed(id + 'card') * cardSizes.length)]
const hubSide = (mass: number) => 7.5 + 3 * mass

function paintWireframeCard(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  e: number
) {
  const [cw, ch] = cardSize(id)
  ctx.save()
  ctx.translate(x, y)
  const scale = 1 + e * 0.18
  ctx.scale(scale, scale)
  ctx.fillStyle = '#091332'
  ctx.fillRect(-cw / 2, -ch / 2, cw, ch)
  ctx.lineWidth = 0.9 + 0.6 * e
  ctx.strokeStyle = rgba('#C4DAFF', 0.65 + 0.35 * e)
  ctx.strokeRect(-cw / 2, -ch / 2, cw, ch)
  ctx.lineWidth = 1
  ctx.beginPath()
  if (cw === 20) {
    ctx.rect(-6, -3, 4, 6)
    ctx.moveTo(0, -2)
    ctx.lineTo(6, -2)
    ctx.moveTo(0, 2)
    ctx.lineTo(4, 2)
  } else if (ch === 17) {
    for (let j = 0; j < 3; j++) {
      ctx.moveTo(-3, -4 + j * 3)
      ctx.lineTo(j === 2 ? 1 : 3, -4 + j * 3)
    }
  } else {
    ctx.moveTo(-4, 3)
    ctx.lineTo(0, -3)
    ctx.lineTo(4, 3)
    ctx.closePath()
  }
  ctx.stroke()
  ctx.restore()
}

/** Fit positions in world space; cards, halos and type retain their CSS pixel sizes. */
export function fitOverview(
  scene: Scene,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
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

export class StarCanvas {
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
  private candidate: string | null = null
  private candidateSince = 0
  private lastMouse: Point | null = null
  private ambientCrossEdges: readonly Wire[] = []
  private previews = new Map<string, { ids: Set<string>; extra: number }>()
  private retestAfterRelease = false
  private down = false
  private nodeDrag: { key: string; screen: Point; offset: Point; pending: boolean } | null = null
  private canopies: Canopy<Moving>[] = []
  private windPointer: Point | null = null
  private mouseFlow = { x: 0, y: 0 }
  private overviewPositions = new Map<string, { position: Point; parent: string }>()
  private cameraVelocity = { x: 0, y: 0 }
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
  private pulse = -Infinity
  private initial = true
  private chosenKey: string | null = null
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
    viewWidth = Math.max(1, this.width - this.sidebarInset)
  ) {
    this.desiredBaseZoom = baseZoom
    this.ambientCrossEdges = scene.ambientCrossEdges ?? []
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
        }
        if (scene.overview) this.cacheOrbits(this.marks, viewWidth, baseZoom)
        return
      }
    }
    this.endNodeDrag(false)
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
    const cards = scene.overview ? this.thumbnails.prepare(scene.marks.values()) : undefined
    const origin = scene.marks.values().next().value as Mark | undefined
    const anchor = origin && (old.get(this.chosenKey ?? '') ?? old.get(origin.key))
    for (const [key, n] of scene.marks) {
      const prior = old.get(key)
      const source =
        (key === origin?.key && this.chosenKey ? anchor : prior) ??
        old.get(n.entity.id) ??
        old.get('up:' + n.entity.id)
      const from = copy(source?.position ?? anchor?.position ?? n)
      const saved = this.overviewPositions.get(key)
      const continuing =
        this.overview && prior?.live && prior.role === n.role && prior.parent === n.parent
      const overviewPosition = continuing
        ? prior.position
        : saved?.parent === n.parent
          ? saved.position
          : n
      if (scene.overview && !continuing && saved?.parent !== n.parent) fresh.add(key)
      const alpha = source?.alpha ?? (this.initial ? 1 : 0)
      const theme = liveTheme(scene.marks.get(n.parent)?.entity.kind ?? n.entity.kind)
      next.set(key, {
        ...n,
        from,
        position: copy(scene.overview ? overviewPosition : from),
        screen: { x: 0, y: 0 },
        alpha,
        thumbnail: cards?.get(key),
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
    for (const [key, m] of old)
      if (!next.has(key) && m.alpha > 0.005)
        next.set(key, { ...m, from: copy(m.position), fromAlpha: m.alpha, live: false })
    const edges = new Map<string, Stroke>()
    for (const [key, w] of scene.wires) {
      const a = this.wires.get(key)?.alpha ?? (this.initial ? 1 : 0)
      edges.set(key, {
        ...w,
        flow: this.wires.get(key)?.flow ?? makeFlow(key),
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
    for (const [key, w] of this.wires)
      if (!edges.has(key) && w.alpha > 0.005 && next.has(w.a) && next.has(w.b))
        edges.set(key, { ...w, live: false, fromAlpha: w.alpha })
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
    }
    this.windPointer = null
    this.mouseFlow.x = this.mouseFlow.y = 0
    this.candidate = null
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
    this.cameraVelocity = { x: 0, y: 0 }
    this.goal = { x: 0, y: 0, zoom: 1 }
    if (immediate) this.pose = { ...this.goal }
  }
  beginIntro(start = performance.now()) {
    this.endNodeDrag(false)
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
  push() {
    this.pulse = performance.now()
  }
  beginNodeDrag(hit: { key: string; role: Mark['role'] }, downScreen: Point) {
    if (!this.overview || (hit.role !== 'hub' && hit.role !== 'leaf')) return false
    const m = this.marks.get(hit.key)
    if (!m?.live || this.started !== null || this.waitingForIntro) return false
    const zoom = this.baseZoom * this.pose.zoom
    this.nodeDrag = {
      key: hit.key,
      pending: false,
      screen: copy(downScreen),
      offset: { x: (m.screen.x - downScreen.x) / zoom, y: (m.screen.y - downScreen.y) / zoom }
    }
    this.cameraVelocity.x = this.cameraVelocity.y = 0
    this.windPointer = null
    this.mouseFlow.x = this.mouseFlow.y = 0
    this.retestAfterRelease = false
    this.pointer = copy(downScreen)
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

  endNodeDrag(commit = true) {
    const drag = this.nodeDrag
    const mark = drag && this.marks.get(drag.key)
    if (commit && drag?.pending && mark?.live) {
      // Apply the last captured sample even if the release happens between animation frames.
      const viewWidth = Math.max(1, this.width - this.sidebarInset)
      const zoom = this.pose.zoom * this.baseZoom
      this.advanceOverview(
        this.last,
        1,
        zoom,
        viewWidth / 2 + this.pose.x,
        this.height / 2 + this.pose.y,
        viewWidth,
        drag.key,
        true
      )
    }
    this.nodeDrag = null
    this.retestAfterRelease = !!drag && commit
    if (mark) mark.velocity.x = mark.velocity.y = 0
  }
  dragStart() {
    if (this.overview) return
    this.down = true
    this.cameraVelocity = { x: 0, y: 0 }
  }
  drag(dx: number, dy: number, dt: number) {
    if (this.overview) return
    this.hover = null
    this.hoveredLine = null
    this.goal.x += dx
    this.goal.y += dy
    this.cameraVelocity = {
      x: clamp((dx * 16) / Math.max(8, dt), -35, 35),
      y: clamp((dy * 16) / Math.max(8, dt), -35, 35)
    }
  }
  dragEnd(inertia: boolean) {
    this.down = false
    if (!inertia || this.still) this.cameraVelocity = { x: 0, y: 0 }
  }
  zoomBy(factor: number) {
    this.goal.zoom = clamp(this.goal.zoom * factor, 0.35, 4)
    this.cameraVelocity = { x: 0, y: 0 }
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
      this.overview && !this.still && this.started === null && !this.waitingForIntro ? p : null,
      time
    )
  }
  move(p: Point | null) {
    this.pointer = p
    this.hover = p ? (this.hit(p)?.key ?? null) : null
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
  draw(ctx: CanvasRenderingContext2D, now: number, dpr: number, pointerHeld = false) {
    const w = this.width,
      h = this.height
    // Flow uses wall time even on a 30 Hz display; don't jump a lap when returning from a hidden tab.
    if (!this.still) this.waveSeconds += clamp((now - (this.last || now)) / 1000, 0, 0.25)
    const frameSeconds = Math.max(0, now - (this.last || now - 16.67)) / 1000
    const dt = Math.min(32, frameSeconds * 1000) / 16.67
    this.last = now
    const lerp = this.still ? 1 : 1 - 0.86 ** dt
    const flight = this.still ? 1 : easeOut(phase(now, this.changed, FLIGHT_MS))
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
        : 1 - (this.candidate ? 0.9 : 0.925) ** dt
    const pressPulse = this.still ? 0 : Math.sin(Math.PI * phase(now, this.pulse, 350))
    if (!this.overview && !this.down && !this.still) {
      this.goal.x += this.cameraVelocity.x * dt
      this.goal.y += this.cameraVelocity.y * dt
      this.cameraVelocity.x *= 0.88 ** dt
      this.cameraVelocity.y *= 0.88 ** dt
    }
    this.pose.x = this.overview ? 0 : mix(this.pose.x, this.goal.x, lerp)
    this.pose.y = this.overview ? 0 : mix(this.pose.y, this.goal.y, lerp)
    this.pose.zoom = mix(this.pose.zoom, this.goal.zoom, lerp)
    this.baseZoom = mix(this.baseZoom, this.desiredBaseZoom, lerp)
    const zoom = this.pose.zoom * this.baseZoom * (1 + 0.065 * pressPulse)
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
    const candidate = launching
      ? null
      : (this.nodeDrag?.key ?? this.hover ?? this.external ?? directory ?? null)
    if (this.candidate !== candidate) {
      this.candidate = candidate
      this.candidateSince = now
    }
    const hovered =
      this.overview || now - this.candidateSince >= 55 ? this.marks.get(candidate ?? '') : undefined
    const preview = hovered ? this.previews.get(hovered.key) : undefined
    const directNeighbors = hovered ? this.neighborKeys.get(hovered.key) : undefined
    const neighbors = preview?.ids ?? directNeighbors
    const mouse =
      this.pointer && !this.down
        ? { x: (this.pointer.x - ox) / zoom, y: (this.pointer.y - oy) / zoom }
        : null
    const cursor = mouse ? this.pointer : null
    const windX =
      cursor && this.lastMouse ? clamp((cursor.x - this.lastMouse.x) / zoom, -35, 35) : 0
    const windY =
      cursor && this.lastMouse ? clamp((cursor.y - this.lastMouse.y) / zoom, -35, 35) : 0
    this.lastMouse = cursor
    const activeHub = hovered?.role === 'hub' && this.explore
    const miniGroup = hovered?.role === 'upstream'
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
    } else if (this.overview) {
      // In a frame that straddles the final petal, each integrator gets only its part of the frame.
      const step = handedOff ? Math.min(dt, Math.max(0, now - cutoff) / 16.67) : dt
      this.advanceOverview(now, step, zoom, ox, oy, viewWidth, candidate, pointerHeld)
    }
    const ringRadius = 2 + 3.5 * easeBloom(phase(ms, 0, 240))
    for (const [key, m] of this.marks) {
      const alpha = mix(m.fromAlpha, m.live ? 1 : 0, flight)
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
            ? m.role === 'mini' || m.role === 'center'
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
          bodyLight = titleLight = trunkLight = this.overview ? 0.15 : 0.16
        }
      }
      m.light = mix(m.light, bodyLight, hoverLerp)
      m.titleLight = mix(m.titleLight, titleLight, hoverLerp)
      m.trunkLight = mix(m.trunkLight, trunkLight, hoverLerp)
      m.emphasis = mix(m.emphasis, over ? 1 : 0, hoverLerp)
      m.hubFocusT = mix(m.hubFocusT, over && activeHub ? 1 : 0, hoverLerp)
      m.leafFocusT = mix(m.leafFocusT, over && m.role === 'leaf' ? 1 : 0, hoverLerp)
      const hub = m.role === 'hub',
        leaf = m.role === 'leaf'
      const simulated = this.overview && (hub || leaf)
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
      } else if (!simulated && this.still) {
        m.position = { x: m.x, y: m.y }
        m.velocity = { x: 0, y: 0 }
      } else if (!simulated && (!this.down || this.hover !== key)) {
        // Ease directly into the radial layout. Only new pointer travel displaces a resting mark.
        const dx = m.x - m.position.x
        const dy = m.y - m.position.y
        if (Math.hypot(dx, dy) < 0.025) {
          m.position.x = m.x
          m.position.y = m.y
        } else {
          m.position.x += dx * lerp
          m.position.y += dy * lerp
        }
        m.velocity.x = m.velocity.y = 0
        if (mouse && (windX || windY) && m.live && candidate !== key && m.role !== 'center') {
          const dist = Math.hypot(m.position.x - mouse.x, m.position.y - mouse.y)
          const radius = 155 / zoom
          if (dist < radius) {
            const falloff = (1 - dist / radius) ** 3
            m.position.x += windX * 0.12 * falloff
            m.position.y += windY * 0.12 * falloff
          }
        }
      }
      const painted = orbit ?? m.position
      m.screen = { x: ox + painted.x * zoom, y: oy + painted.y * zoom }
    }
    const line = (
      a: Point,
      b: Point,
      style: string | CanvasGradient,
      width: number,
      alpha: number
    ) => {
      if (alpha < 0.002) return
      ctx.globalAlpha = clamp(alpha)
      ctx.strokeStyle = style
      ctx.lineWidth = width
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
    if (this.overview && this.explore && bloomMix > 0) {
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
          Math.min(a.alpha, b.alpha) * (1 - highlight) * bloomMix
        )
      }
    }
    const water = this.overview ? 1 : 0
    if (this.overview && this.explore && (this.marks.size || launching)) {
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
            this.still
          )
          line(rim, m.screen, ink, 0.95, m.trunkLight * m.alpha)
        }
      }
      ctx.globalAlpha = launching ? 0.24 + 0.76 * easeBloom(phase(ms, 0, 240)) : 1
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
    const visibleRays = [...this.wires.values()].filter((w) => w.live && w.kind === 'focus').length
    const lineAlpha = clamp(4.8 / Math.max(12, visibleRays), 0.07, 0.28)
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
      // The category overview paints its ambient edges under the hierarchy.
      if (categoryOverview && wire.kind === 'aggregate') {
        wire.alpha = 0
        continue
      }
      const touches = hovered?.key === wire.a || hovered?.key === wire.b
      const revealRelation = categoryOverview && wire.kind === 'relation'
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
      wire.alpha = mix(wire.fromAlpha, wire.live ? 1 : 0, flight)
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
      const focused = wire.kind === 'focus'
      const dimTarget =
        focused && (hovered || this.hoveredLine)
          ? 0.18 + 0.82 * strength
          : this.overview && hovered && (hovered.role === 'hub' || hovered.role === 'leaf')
            ? hot
              ? 1
              : hovered.role === 'hub'
                ? 0.64
                : 0.44
            : Math.min(a.light, b.light)
      wire.light = mix(wire.light, dimTarget, hoverLerp)
      const dim = wire.light
      let style: string | CanvasGradient
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
          this.still
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
      } else if (focused) {
        style = ctx.createLinearGradient(a.screen.x, a.screen.y, b.screen.x, b.screen.y)
        const ink = rgba('#E1F0FF', mix(lineAlpha, 0.88, strength))
        style.addColorStop(0, 'transparent')
        style.addColorStop(0.12, 'transparent')
        style.addColorStop(0.25, ink)
        style.addColorStop(1, ink)
      } else if (wire.kind === 'mini' || wire.kind === 'guide') style = 'rgba(166,194,247,.46)'
      else if (this.overview && wire.kind === 'relation') {
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
      let width = wire.kind === 'mini' ? 0.8 : mix(0.9, 0.95, water)
      if (this.overview && wire.kind === 'relation') width = 0.85
      else if (this.overview && wire.kind === 'spoke') width = mix(0.95, 0.85, leafFocus)
      const inkAlpha =
        this.overview && this.explore && wire.kind === 'relation' && launching
          ? 0
          : revealRelation
            ? alpha
            : alpha * dim
      line(a.screen, b.screen, style, width, inkAlpha)
      if (!this.overview && !focused && strength > 0.001) {
        const end = {
          x: mix(a.screen.x, b.screen.x, wire.drawProgress),
          y: mix(a.screen.y, b.screen.y, wire.drawProgress)
        }
        const ink = ctx.createLinearGradient(a.screen.x, a.screen.y, end.x, end.y)
        ink.addColorStop(0, 'rgba(175,210,255,.62)')
        ink.addColorStop(0.5, 'rgba(120,168,255,.36)')
        ink.addColorStop(1, 'rgba(175,210,255,.62)')
        line(a.screen, end, ink, 1, wire.alpha * strength)
      }
      if (focused && wire.live) {
        this.lineTargets.push({ wire, a: a.screen, b: b.screen })
        if (wire.label)
          relationLabels.push({
            text: wire.label,
            x: (a.screen.x + b.screen.x) / 2,
            y: (a.screen.y + b.screen.y) / 2 - 6,
            alpha: alpha * dim,
            emphasis: strength
          })
      }
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
    const miniTop = Math.min(
      h,
      ...[...this.marks.values()].filter((m) => m.live && m.role === 'mini').map((m) => m.screen.y)
    )
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
      const hub = m.role === 'hub',
        mini = m.role === 'mini',
        upstream = m.role === 'upstream',
        center = m.role === 'center'
      const state = launching && hub ? projected.get(m.key) : undefined
      const family = m.role === 'leaf' && this.explore ? (this.marks.get(m.parent)?.focusT ?? 0) : 0
      const thumb = water > 0 && m.role === 'leaf' ? m.thumbnail : undefined
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
      } else if (center || upstream) {
        const r = center ? 13 : 9
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * (1 + 0.6 * e))
        const color = center ? '#FFFFFF' : m.color
        glow.addColorStop(0, rgba(color, 0.59))
        glow.addColorStop(0.36, rgba(color, 0.21))
        glow.addColorStop(1, rgba(color, 0))
        circle(p, r * (1 + 0.6 * e), glow)
        circle(p, (center ? 4.5 : 3.1) * (1 + 0.12 * e), color)
      } else if (mini) {
        circle(p, 1.55 + 1.15 * e, e > 0.5 ? '#FFFFFF' : '#ACC6F2')
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
      } else if (water > 0 && m.role === 'leaf' && m.seed < 0.75) {
        // Screen pixels correspond to 110 / zoom in the world.
        const nearby =
          this.pointer && !this.down
            ? clamp(1 - Math.hypot(p.x - this.pointer.x, p.y - this.pointer.y) / 110)
            : 0
        const related = hovered?.role === 'leaf' && neighbors?.has(m.key)
        m.whiteT = mix(m.whiteT, related ? 1 : nearby, hoverLerp)
        paintWaterDot(ctx, p, m.theme.dot, m.whiteT, family, m.leafFocusT)
      } else if (m.seed < 0.6) {
        const r = (1.6 + (0.8 * m.seed) / 0.6) * (1 + 0.4 * e)
        circle(p, r, '#E8F1FF')
        if (e > 0.005) circle(p, r + 1.8, rgba('#FFFFFF', e), true, 1.5)
      } else if (m.seed < 0.75) {
        circle(p, 2.8 + 1.6 * e, rgba('#E8F1FF', 0.78 + 0.22 * e), true, 0.9 + 0.6 * e)
      } else {
        paintWireframeCard(ctx, m.entity.id, snap(p.x), snap(p.y), e)
      }
      if (m.live && m.alpha > 0.38 && !launching) {
        const r = mini ? 4.4 : hub || center ? 13 : 10
        const halfW = thumb ? Math.max(r, thumb.width / 2 + 1.5) : r
        const halfH = thumb ? Math.max(r, thumb.height / 2 + 1.5) : r
        this.targets.push({
          box: { x: p.x - halfW, y: p.y - halfH, w: halfW * 2, h: halfH * 2 },
          hit: target(m),
          dot: true,
          rectangular: !!thumb
        })
      }
      if (!m.entity.name || (!launching && !m.live)) continue
      const main = hub || center || upstream
      const neighborName =
        m.role === 'neighbor' ||
        (this.overview && !activeHub && hovered?.role === 'leaf' && neighbors?.has(m.key))
      const showName = main || neighborName || m === hovered
      const inView = p.x >= 0 && p.x <= viewWidth && p.y >= 0 && p.y <= h
      if (this.overview && !launching && (!showName || !inView)) {
        m.nameAlpha = m.revealAlpha = 0
        continue
      }
      m.nameAlpha = mix(m.nameAlpha, showName ? 1 : 0, hoverLerp)
      const textLight = hub ? m.titleLight : m.light
      const alpha = m.alpha * textLight * m.nameAlpha * (state?.shrink ?? 1)
      if (alpha < 0.015) continue
      const pill =
        center || upstream ? 1 : hub ? 0 : water > 0 && m.role === 'leaf' ? m.leafFocusT : e
      const relatedName = this.overview && m.role === 'leaf' && !!neighborName && m !== hovered
      const size = hub ? 13 + (water > 0 ? 8 * m.hubFocusT : 8 * e) : relatedName ? 11 : 12
      const weight = hub ? Math.round(mix(650, 500, water)) : main ? 650 : relatedName ? 400 : 450
      ctx.font = font(size, weight)
      const title = m.entity.name + (m === hovered && preview?.extra ? '  +' + preview.extra : '')
      const text = upstream ? title + '  ' + m.count + (m === hovered ? ' · 点击返回' : '') : title
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
      const left = m.role === 'neighbor' && p.x < ox
      let x = center || upstream ? p.x - bw / 2 : left ? p.x - 9 - bw : p.x + labelGap
      let y = center
        ? p.y - 14 - bh
        : upstream
          ? Math.min(p.y - 16, miniTop - 7) - bh
          : p.y - bh / 2
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
    ctx.font = font(10)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    for (const r of relationLabels) {
      const tw = ctx.measureText(r.text).width
      const box = { x: r.x - tw / 2, y: r.y - 5, w: tw, h: 10 }
      if (occupied.some((b) => intersects(b, box))) continue
      ctx.globalAlpha = r.alpha * (0.5 + 0.5 * r.emphasis)
      ctx.fillStyle = r.emphasis > 0.4 ? '#FFFFFF' : '#ACC3E7'
      ctx.fillText(r.text, r.x, r.y)
      occupied.push(box)
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
      if (m.live && alpha > 0.28 && !launching)
        this.targets.push({
          box,
          hit: target(m),
          dot: false,
          foregroundPill: this.overview && m === hovered && m.role === 'leaf' && pill > 0.005
        })
    }
    if (pressPulse > 0.001) {
      ctx.globalAlpha = 0.12 * pressPulse
      ctx.fillStyle = '#0033FF'
      ctx.fillRect(0, 0, w, h)
    }
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
      !this.down &&
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
