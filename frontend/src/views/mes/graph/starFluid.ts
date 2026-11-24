import { clamp, seed, TAU, type Mark, type Point } from './starScene'

const stretchStiffness = 0.075
const leafDrag = 0.76
const hubDrag = 0.85
const maxLeafSpeed = 26
const centerStiffness = 0.0018

export interface FluidMark extends Mark {
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
}

interface Bounds {
  left: number
  right: number
  top: number
  bottom: number
}

export interface FluidFrame {
  seconds: number
  step: number
  zoom: number
  bounds: Bounds
  mouse: Point | null
  pointerFlow: Point
  intro?: boolean
  warmup?: number
  hotKey: string | null
  held?: FluidMark
  dragGoal: Point | null
  still: boolean
}

export interface Canopy<T extends FluidMark> {
  hub: T
  leaves: T[]
}

export function cacheCanopies<T extends FluidMark>(marks: Map<string, T>) {
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
export function stepBloomCurrent(
  groups: readonly Canopy<FluidMark>[],
  seconds: number,
  step: number
) {
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
    const dx = (bounds.left + bounds.right) / 2 - p.x
    const dy = (bounds.top + bounds.bottom) / 2 - p.y
    const centering = centerStiffness / (1 + Math.hypot(dx, dy) / 540)
    const swim = hubCurrent(hub, seconds, intro)
    v.x += (dx * centering + swim.x) * step
    v.y += (dy * centering + swim.y) * step
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

export function overviewBounds(viewWidth: number, height: number, baseZoom: number): Bounds {
  const halfW = (viewWidth / 2 - Math.min(8, viewWidth * 0.1)) / baseZoom
  const halfH = (height / 2 - Math.min(8, height * 0.1)) / baseZoom
  return { left: -halfW, right: halfW, top: -halfH, bottom: halfH }
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
export function relaxLaunch(groups: readonly Canopy<FluidMark>[], bounds: Bounds, pad: number) {
  const copies = groups.map(({ hub }) => ({
    hub: { ...hub, position: { x: hub.x, y: hub.y }, velocity: { x: 0, y: 0 } },
    leaves: []
  }))
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
  for (let i = 0; i < 56; i++) {
    for (const { hub } of copies) {
      stepHub(hub, undefined, frame, scale)
      stayInView(hub, launchBounds.get(hub.key) ?? bounds)
    }
    separateHubs(copies, frame, scale, 1, launchBounds)
  }
  return new Map(copies.map(({ hub }) => [hub.key, hub.position]))
}

export function stepOverview(groups: readonly Canopy<FluidMark>[], frame: FluidFrame) {
  const { held, dragGoal, step, bounds } = frame
  if (!groups.length || step <= 0) return
  const start = held && dragGoal ? { ...held.position } : null
  const dx = start && dragGoal ? dragGoal.x - start.x : 0
  const dy = start && dragGoal ? dragGoal.y - start.y : 0
  const moveLength = Math.hypot(dx, dy)
  for (const { hub, leaves } of groups) {
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
    spreadLeaves(group, frame)
    for (const leaf of group.leaves) {
      if (leaf !== held) stepLeaf(leaf, group.hub, frame)
    }
    if (group.hub === held) separateDraggedTips(group, frame)
  }
}
