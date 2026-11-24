import { CATEGORY_SPECS, type CategoryGraph } from './categoryGraph'
import type { GraphEntity, GraphRelation, KnowledgeGraph } from './graphData'

export const DOCK_MS = 2050
export const DOCK_DURATION = 620
export const LAUNCH_MS = 2750
const SHRINK_MS = 900
const PETAL_MS = 950
const lastLaunchLag = 570
export const ORBIT_MS = 580 + lastLaunchLag + PETAL_MS
export const FLIGHT_MS = 520
export const TAU = Math.PI * 2
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
export const phase = (ms: number, from: number, duration: number) => clamp((ms - from) / duration)
export const easeOut = (t: number) => 1 - (1 - t) ** 3
export function seed(id: string) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export interface Point {
  x: number
  y: number
}
export type Role = 'hub' | 'leaf' | 'center' | 'neighbor' | 'upstream' | 'mini'
export interface Mark extends Point {
  key: string
  entity: GraphEntity
  role: Role
  parent: string
  order: number
  count: number
  seed: number
  color: string
}
export interface Wire {
  key: string
  a: string
  b: string
  kind: 'spoke' | 'aggregate' | 'relation' | 'focus' | 'mini' | 'guide'
  label: string
}
export interface Scene {
  marks: Map<string, Mark>
  wires: Map<string, Wire>
  overview: boolean
  ambientCrossEdges?: readonly Wire[]
}
const palette = new Map<string, string>(CATEGORY_SPECS.map((s) => [s.label, s.color]))
export const colorOfKind = (kind: string) => palette.get(kind) ?? '#7CE8E8'
/** Screen-space angles grow clockwise because Canvas Y points down. */
export function clockwiseAngle(x: number, y: number) {
  return (Math.atan2(y, x) + (3 * Math.PI) / 4 + TAU) % TAU
}
export function easeBloom(t: number) {
  const c = clamp(t)
  return 0.45 * c * c * (3 - 2 * c) + 0.55 * easeOut(c)
}
export function globalSwirl(ms: number, duration = ORBIT_MS) {
  return -1.75 * (1 - easeBloom(phase(ms, 0, duration)))
}
export function shot(ms: number, order: number, count: number) {
  // Eight clusters launch 81 ms apart; fit any larger catalogue into the same bloom window.
  const lag = order * Math.min(100, lastLaunchLag / Math.max(1, count - 1))
  const delay = 140 + lag
  const travel = easeBloom(phase(ms, delay, 820))
  const bloomStart = 580 + lag
  return {
    travel,
    localSwirl: -0.18 * (1 - travel),
    bloomStart,
    shrink: easeBloom(phase(ms, bloomStart, SHRINK_MS)),
    visible: easeBloom(phase(ms, delay, 75))
  }
}
export function bloomEnd(order: number, count: number, hasLeaves: boolean) {
  return shot(0, order, count).bloomStart + (hasLeaves ? PETAL_MS : SHRINK_MS)
}
export const smoothstep = (t: number) => t * t * (3 - 2 * t)

export function leafGrowth(ms: number, bloomStart: number, leafSeed: number) {
  const stagger = leafSeed * 105
  return easeBloom(phase(ms, bloomStart + stagger, PETAL_MS - stagger))
}

function selectAmbientCrossEdges(
  families: Map<string, GraphEntity[]>,
  relations: Map<string, Wire>,
  eligible: Set<string>
) {
  const owners = new Map<string, string>()
  for (const [family, members] of families) {
    owners.set(family, family)
    for (const member of members) owners.set(member.id, family)
  }
  const candidates: { wire: Wire; a: string; b: string; pair: string }[] = []
  const available = new Map<string, number>()
  for (const key of eligible) {
    const wire = relations.get(key)!
    const a = owners.get(wire.a)
    const b = owners.get(wire.b)
    if (a === undefined || b === undefined || a === b) continue
    candidates.push({ wire, a, b, pair: JSON.stringify(a < b ? [a, b] : [b, a]) })
    available.set(a, (available.get(a) ?? 0) + 1)
    available.set(b, (available.get(b) ?? 0) + 1)
  }
  candidates.sort((a, b) => a.wire.key.localeCompare(b.wire.key))

  const selected = new Set<Wire>()
  const nodeUses = new Map<string, number>()
  const pairUses = new Map<string, number>()
  const familyUses = new Map<string, number>()
  function familyPriority(id: string) {
    const used = familyUses.get(id) ?? 0
    return used ? 1 / (1 + used) : 3 + 1 / (available.get(id) ?? 1)
  }
  // Cover families with scarce evidence first, then spread the remaining budget across pairs.
  while (selected.size < 36) {
    let best: (typeof candidates)[number] | undefined
    let bestScore = -Infinity
    for (const candidate of candidates) {
      const { wire, a, b, pair } = candidate
      const aUses = nodeUses.get(wire.a) ?? 0
      const bUses = nodeUses.get(wire.b) ?? 0
      const pairCount = pairUses.get(pair) ?? 0
      if (aUses >= 2 || bUses >= 2 || pairCount >= 4 || selected.has(wire)) continue
      const score =
        familyPriority(a) + familyPriority(b) + 1 / (1 + pairCount) - 0.3 * (aUses + bUses)
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (!best) break
    selected.add(best.wire)
    for (const node of [best.wire.a, best.wire.b]) nodeUses.set(node, (nodeUses.get(node) ?? 0) + 1)
    pairUses.set(best.pair, (pairUses.get(best.pair) ?? 0) + 1)
    for (const family of [best.a, best.b]) familyUses.set(family, (familyUses.get(family) ?? 0) + 1)
  }
  return [...selected]
}

export function graphIndex(
  model: CategoryGraph | undefined,
  full: KnowledgeGraph,
  explore: boolean
) {
  const entities = new Map<string, GraphEntity>(
    explore ? model?.items : full.nodes.map((n) => [n.id, n])
  )
  const families = new Map<string, GraphEntity[]>()
  if (explore && model) {
    for (const [id, { root, members }] of model.categories) {
      entities.set(id, root)
      families.set(id, members)
    }
  } else {
    const groups = new Map<string, GraphEntity[]>()
    for (const entity of entities.values()) {
      const group = groups.get(entity.kind) ?? []
      group.push(entity)
      groups.set(entity.kind, group)
    }
    for (const group of groups.values()) families.set(group[0].id, group.slice(1))
  }
  const pairs = new Map<string, Wire>()
  const eligible = new Set<string>()
  const neighbors = new Map<string, Map<string, string>>()
  function connect(list: Map<string, string>, id: string, name: string) {
    if (!list.has(id)) list.set(id, name)
  }
  function link(edge: GraphRelation) {
    if (!entities.has(edge.source) || !entities.has(edge.target) || edge.source === edge.target)
      return
    const [a, b] =
      edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source]
    const key = JSON.stringify([a, b])
    if (explore && !edge.presentation) eligible.add(key)
    if (pairs.has(key)) return
    pairs.set(key, { key, a, b, kind: 'relation', label: edge.type })
    for (const [id, other] of [
      [a, b],
      [b, a]
    ]) {
      const list = neighbors.get(id) ?? new Map()
      connect(list, other, edge.type)
      neighbors.set(id, list)
    }
  }
  for (const edge of full.relations) link(edge)
  if (explore && model) {
    for (const doc of model.documents.keys())
      for (const edge of model.neighbors.get(doc) ?? []) link(edge)
    for (const [id, members] of families) neighbors.set(id, new Map(members.map((n) => [n.id, ''])))
  }
  return {
    entities,
    families,
    pairs,
    ambientCrossEdges: selectAmbientCrossEdges(families, pairs, eligible),
    neighbors,
    aggregates: explore
      ? (model?.overview.relations.filter((r) => r.presentation === 'category-link') ?? [])
      : [],
    explore
  }
}
export type GraphIndex = ReturnType<typeof graphIndex>
export function focusWindow(index: GraphIndex, id: string, kind = '', page = 0, all = false) {
  const rows = [...(index.neighbors.get(id) ?? [])]
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const name = index.entities.get(row[0])!.kind
    const bucket = groups.get(name) ?? []
    bucket.push(row)
    groups.set(name, bucket)
  }
  const degree = (id: string) => index.neighbors.get(id)?.size ?? 0
  const buckets = [...groups]
    .filter(([name]) => !kind || name === kind)
    .map(([, bucket]) =>
      bucket.sort((a, b) => degree(b[0]) - degree(a[0]) || a[0].localeCompare(b[0]))
    )
  const ordered: typeof rows = []
  for (let i = 0; buckets.some((bucket) => i < bucket.length); i++) {
    const round = buckets.flatMap((bucket) => (bucket[i] ? [bucket[i]] : []))
    ordered.push(...round.sort((a, b) => degree(b[0]) - degree(a[0])))
  }
  const pages = Math.max(1, Math.ceil(ordered.length / 18))
  const start = Math.min(Math.max(page, 0), pages - 1) * 18
  return {
    total: rows.length,
    groups,
    pages,
    rows: rows.length <= 20 ? rows : all ? ordered : ordered.slice(start, start + 18)
  }
}
export function buildScene(
  index: GraphIndex,
  active: string | null,
  previous: string | undefined,
  width: number,
  height: number,
  depth = previous ? 2 : 1,
  windowRows?: [string, string][]
): Scene {
  const marks = new Map<string, Mark>(),
    wires = new Map<string, Wire>()
  const scene = { marks, wires, overview: !active }
  function mark(id: string, role: Role, x: number, y: number, parent = '', order = 0, count = 0) {
    const entity = index.entities.get(id)!
    const key = role === 'upstream' || role === 'mini' ? 'up:' + id : id
    marks.set(key, {
      key,
      entity,
      role,
      x,
      y,
      parent,
      order,
      count,
      seed: seed(id),
      color: colorOfKind(entity.kind)
    })
    return key
  }
  function wire(a: string, b: string, kind: Wire['kind'], label = '') {
    const key = JSON.stringify([kind, a, b])
    wires.set(key, { key, a, b, kind, label })
  }
  const familyList = [...index.families]
  if (!active || !index.entities.has(active)) {
    const max = Math.max(1, ...familyList.map(([, list]) => list.length))
    familyList.forEach(([id, members], i) => {
      const spec = CATEGORY_SPECS.find((s) => s.label === index.entities.get(id)?.kind)
      const mass = Math.sqrt(members.length / max)
      const angle =
        (spec ? (spec.angle * Math.PI) / 180 : (i * TAU) / familyList.length) + (mass - 0.5) * 0.14
      const orbit = (spec?.orbit ?? 1) * (0.82 + 0.18 * mass)
      const cx = Math.cos(angle) * width * (0.31 + 0.05 * mass) * orbit,
        cy = Math.sin(angle) * height * (0.29 + 0.05 * mass) * orbit
      const order = spec ? CATEGORY_SPECS.indexOf(spec) : i
      mark(
        id,
        'hub',
        cx,
        cy,
        '',
        order,
        index.explore ? members.length : (index.neighbors.get(id)?.size ?? 0)
      )
      const radius =
        Math.min(width * 0.112, height * 0.155) * (0.65 + 0.41 * mass) * (1 + 0.36 * mass * mass)
      const bands = [
        [0.42, 0.65],
        [0.68, 1.12],
        [1.15, 1.48]
      ] as const
      const dotMembers: GraphEntity[] = [],
        cardMembers: GraphEntity[] = []
      for (const entity of members) {
        const url = 'thumbnailUrl' in entity ? entity.thumbnailUrl : null
        const hasCard = seed(entity.id) >= 0.75 || (typeof url === 'string' && !!url.trim())
        if (hasCard) cardMembers.push(entity)
        else dotMembers.push(entity)
      }
      // Interleave card and dot ranks so both can occupy every length band.
      const spokes = [dotMembers, cardMembers]
        .flatMap((group) =>
          group
            .map((entity) => ({ entity, lengthOrder: seed(entity.id + ':length-band') }))
            .sort((a, b) => a.lengthOrder - b.lengthOrder)
            .map(({ entity }, i) => ({
              entity,
              rank: (i + 0.5) / group.length,
              angleOrder: seed(entity.id + ':angle-order'),
              gap: 0.24 + 1.76 * seed(entity.id + ':angle-gap') ** 1.65,
              length: 0
            }))
        )
        .sort((a, b) => a.rank - b.rank)
      for (const [k, spoke] of spokes.entries()) {
        const quantile = (k + 0.5) / spokes.length
        const [short, long] = bands[quantile < 0.25 ? 0 : quantile < 0.75 ? 1 : 2]
        spoke.length = radius * (short + (long - short) * seed(spoke.entity.id + ':length'))
      }
      const totalGap = spokes.reduce((sum, spoke) => sum + spoke.gap, 0)
      let theta = angle + TAU * seed(id + ':burst')
      for (const { entity, gap, length } of spokes.sort((a, b) => a.angleOrder - b.angleOrder)) {
        mark(
          entity.id,
          'leaf',
          cx + Math.cos(theta) * length,
          cy + Math.sin(theta) * length,
          id,
          order
        )
        if (index.explore) wire(id, entity.id, 'spoke')
        theta += (TAU * gap) / totalGap
      }
    })
    for (const r of index.aggregates) wire(r.source, r.target, 'aggregate')
    for (const [k, r] of index.pairs) if (marks.has(r.a) && marks.has(r.b)) wires.set(k, r)
    return { ...scene, ambientCrossEdges: index.ambientCrossEdges }
  }
  const deep = previous && previous !== active && index.entities.has(previous)
  const baseY = deep ? 36 : 15
  const limit = Math.min(width * 0.32, height * (deep ? 0.242 : 0.32))
  function wheel(id: string, cx: number, cy: number, mini: boolean) {
    const list = (!mini && windowRows) || focusWindow(index, id).rows
    const factor = mini ? 0.285 : 1
    const priorLimit = depth === 2 ? Math.min(width * 0.32, height * 0.32) : limit
    const r = Math.max(48, mini ? priorLimit : limit) * factor * (list.length > 22 ? 1.22 : 1)
    const center = mark(id, mini ? 'upstream' : 'center', cx, cy, '', 0, list.length)
    list.forEach(([other, label], i) => {
      const angle = -Math.PI / 2 + ((i + (seed(other + 'angle') - 0.5) * 0.08) * TAU) / list.length
      const radius = r * [0.74, 0.98, 1.24][i % 3]
      const end = mark(
        other,
        mini ? 'mini' : 'neighbor',
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
        center
      )
      wire(center, end, mini ? 'mini' : 'focus', label)
    })
    return center
  }
  wheel(active, 0, baseY, false)
  if (deep) {
    const upstream = wheel(previous!, -Math.min(40, width * 0.07), -height * 0.323, true)
    wire(upstream, active, 'guide')
  }
  return scene
}
