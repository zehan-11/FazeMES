<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GraphEntity, GraphRelation, KnowledgeGraph } from './graphData'

export interface CameraPose2D {
  x: number
  y: number
  zoom: number
}

const props = defineProps<{
  graph: KnowledgeGraph
  selected: string | null
  trail: string[]
  explore: boolean
  entryIds: string[]
  highlightKind?: string | null
  activeKindFilter?: string | null
  externalHoverId?: string | null
}>()

const emit = defineEmits<{
  select: [id: string | null]
  back: []
  clear: []
}>()

const host = ref<HTMLElement>()
const canvasRef = ref<HTMLCanvasElement>()
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

interface KindVisual {
  color: string
  icon: 'equipment' | 'part' | 'process' | 'fault' | 'cause' | 'solution' | 'doc'
}

const KIND_VISUALS: Record<string, KindVisual> = {
  设备: { color: '#5B8CFF', icon: 'equipment' },
  部件: { color: '#38BDF8', icon: 'part' },
  工艺: { color: '#818CF8', icon: 'process' },
  故障: { color: '#F472B6', icon: 'fault' },
  原因: { color: '#FBBF24', icon: 'cause' },
  措施: { color: '#34D399', icon: 'solution' }
}

function visualOf(kind: string): KindVisual {
  return KIND_VISUALS[kind] ?? { color: '#7AA2FF', icon: 'doc' }
}

interface SimNode {
  id: string
  entity: GraphEntity
  x: number
  y: number
  targetX: number
  targetY: number
  overviewX: number
  overviewY: number
  alpha: number
  targetAlpha: number
  degree: number
  isEntry: boolean
  isHub: boolean
  useIconSquare: boolean
  seed: number
}

interface Star {
  x: number
  y: number
  alpha: number
  size: number
}

let simNodes = new Map<string, SimNode>()
let adjacency = new Map<string, Array<{ neighborId: string; relation: GraphRelation }>>()
let hubIds = new Set<string>()
let stars: Star[] = []

const cam = {
  x: 0,
  y: 0,
  zoom: 1,
  targetX: 0,
  targetY: 0,
  targetZoom: 1
}

let width = 1
let height = 1
let hoveredId: string | null = null
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragCamX = 0
let dragCamY = 0
let dragDist = 0
let rafId = 0
let observer: ResizeObserver | undefined
let onscreen = true
let intersection: IntersectionObserver | undefined

function hash01(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function buildStars(w: number, h: number) {
  stars = Array.from({ length: 90 }, (_, i) => ({
    x: hash01(`star-x-${i}`) * w,
    y: hash01(`star-y-${i}`) * h,
    alpha: 0.14 + (i % 6) * 0.028,
    size: i % 7 === 0 ? 1.5 : 1
  }))
}

function rebuildAdjacency(graph: KnowledgeGraph) {
  const nextAdj = new Map<string, Array<{ neighborId: string; relation: GraphRelation }>>()
  for (const node of graph.nodes) nextAdj.set(node.id, [])
  for (const rel of graph.relations) {
    if (nextAdj.has(rel.source) && nextAdj.has(rel.target)) {
      nextAdj.get(rel.source)!.push({ neighborId: rel.target, relation: rel })
      if (rel.source !== rel.target) {
        nextAdj.get(rel.target)!.push({ neighborId: rel.source, relation: rel })
      }
    }
  }
  adjacency = nextAdj
}

/** 计算纯 2D 星群布局（总览态按入口星群放射，全量态按类型星座分布） */
function rebuildLayout(preserveExisting: boolean) {
  const graph = props.graph
  rebuildAdjacency(graph)

  const prevNodes = preserveExisting ? simNodes : new Map<string, SimNode>()
  const nextNodes = new Map<string, SimNode>()
  const entrySet = new Set(props.entryIds)
  hubIds = new Set<string>()

  const anchorPrev = props.selected ? prevNodes.get(props.selected) : undefined

  if (props.explore) {
    // 设备总览态：入口节点围绕中心空心圆环均匀分布，各自 1 跳邻居呈蒲公英放射状展开
    const roots = graph.nodes.filter((n) => entrySet.has(n.id))
    const fallbackRoots = roots.length ? roots : graph.nodes.slice(0, 6)
    const rootSet = new Set(fallbackRoots.map((n) => n.id))
    const rootOrbit = fallbackRoots.length <= 1 ? 0 : Math.min(225, 130 + fallbackRoots.length * 16)

    const rootCoords = new Map<string, { x: number; y: number; angle: number }>()
    fallbackRoots.forEach((node, idx) => {
      const angle = (Math.PI * 2 * idx) / Math.max(1, fallbackRoots.length) - Math.PI / 2
      const rx = Math.cos(angle) * rootOrbit
      const ry = Math.sin(angle) * rootOrbit
      rootCoords.set(node.id, { x: rx, y: ry, angle })
      hubIds.add(node.id)
    })

    // 将非入口节点归属到相连的入口星群
    const branches = new Map<string, GraphEntity[]>()
    for (const r of fallbackRoots) branches.set(r.id, [])
    const unattached: GraphEntity[] = []

    for (const node of graph.nodes) {
      if (rootSet.has(node.id)) continue
      const links = adjacency.get(node.id) ?? []
      const connectedRoots = links
        .map((l) => l.neighborId)
        .filter((nid) => rootCoords.has(nid))
      if (connectedRoots.length > 0) {
        branches.get(connectedRoots[0])!.push(node)
      } else {
        unattached.push(node)
      }
    }

    // 写入入口节点
    for (const r of fallbackRoots) {
      const pos = rootCoords.get(r.id)!
      const old = prevNodes.get(r.id)
      const deg = adjacency.get(r.id)?.length ?? 0
      const seed = hash01(r.id)
      nextNodes.set(r.id, {
        id: r.id,
        entity: r,
        x: old ? old.x : pos.x,
        y: old ? old.y : pos.y,
        targetX: pos.x,
        targetY: pos.y,
        overviewX: old ? old.overviewX : pos.x,
        overviewY: old ? old.overviewY : pos.y,
        alpha: old ? old.alpha : 1,
        targetAlpha: 1,
        degree: deg,
        isEntry: true,
        isHub: true,
        useIconSquare: false,
        seed
      })
    }

    // 写入星群蒲公英叶子节点
    for (const [rootId, leaves] of branches.entries()) {
      const rootPos = rootCoords.get(rootId)!
      leaves.forEach((node, idx) => {
        const old = prevNodes.get(node.id)
        const seed = hash01(node.id)
        const deg = adjacency.get(node.id)?.length ?? 0
        const spreadAngle =
          rootPos.angle +
          ((idx / Math.max(1, leaves.length)) - 0.5) * Math.PI * 1.55 +
          (seed - 0.5) * 0.25
        const ring = 46 + (idx % 3) * 18 + seed * 14
        const ox = rootPos.x + Math.cos(spreadAngle) * ring
        const oy = rootPos.y + Math.sin(spreadAngle) * ring
        const spawnX = old ? old.x : anchorPrev ? anchorPrev.x : ox
        const spawnY = old ? old.y : anchorPrev ? anchorPrev.y : oy
        nextNodes.set(node.id, {
          id: node.id,
          entity: node,
          x: spawnX,
          y: spawnY,
          targetX: ox,
          targetY: oy,
          overviewX: old ? old.overviewX : ox,
          overviewY: old ? old.overviewY : oy,
          alpha: old ? old.alpha : 0.2,
          targetAlpha: 1,
          degree: deg,
          isEntry: false,
          isHub: false,
          useIconSquare: seed > 0.56,
          seed
        })
      })
    }

    // 写入二级探索拉回的扩展节点（未直连入口）
    unattached.forEach((node, idx) => {
      const old = prevNodes.get(node.id)
      const seed = hash01(node.id)
      const deg = adjacency.get(node.id)?.length ?? 0
      const angle = (Math.PI * 2 * idx) / Math.max(1, unattached.length) + seed * 0.4
      const dist = rootOrbit + 115 + (idx % 4) * 24
      const ox = Math.cos(angle) * dist
      const oy = Math.sin(angle) * dist
      nextNodes.set(node.id, {
        id: node.id,
        entity: node,
        x: old ? old.x : anchorPrev ? anchorPrev.x : ox,
        y: old ? old.y : anchorPrev ? anchorPrev.y : oy,
        targetX: ox,
        targetY: oy,
        overviewX: old ? old.overviewX : ox,
        overviewY: old ? old.overviewY : oy,
        alpha: old ? old.alpha : 0.15,
        targetAlpha: 1,
        degree: deg,
        isEntry: false,
        isHub: false,
        useIconSquare: seed > 0.56,
        seed
      })
    })
  } else {
    // 全量图谱态：按实体类型（设备/部件/工艺/故障/原因/措施）聚成 2D 星座，避免 3D 堆叠
    const groups = new Map<string, GraphEntity[]>()
    for (const node of graph.nodes) {
      const list = groups.get(node.kind) ?? []
      list.push(node)
      groups.set(node.kind, list)
    }

    const kindOrder = ['设备', '部件', '工艺', '故障', '原因', '措施']
    const keys = [...groups.keys()].sort((a, b) => {
      const ia = kindOrder.indexOf(a)
      const ib = kindOrder.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })

    const count = Math.max(1, keys.length)
    const totalNodes = graph.nodes.length
    const orbit = count === 1 ? 0 : Math.min(460, 175 + Math.sqrt(totalNodes) * 14)

    keys.forEach((kind, gIdx) => {
      const members = groups.get(kind)!
      members.sort((a, b) => (adjacency.get(b.id)?.length ?? 0) - (adjacency.get(a.id)?.length ?? 0))

      const gAngle = (Math.PI * 2 * gIdx) / count - Math.PI / 2
      const gx = Math.cos(gAngle) * orbit
      const gy = Math.sin(gAngle) * orbit

      members.forEach((node, idx) => {
        const deg = adjacency.get(node.id)?.length ?? 0
        const seed = hash01(node.id)
        const isHub = idx === 0 || (idx < 3 && deg >= 5)
        if (idx === 0) hubIds.add(node.id)

        let ox = gx
        let oy = gy
        if (idx > 0) {
          // 黄金角螺旋排布，保证高密度全量图谱也分布均匀
          const step = totalNodes > 400 ? 15 : 22
          const r = 34 + Math.sqrt(idx) * step
          const theta = idx * 2.399963 + gIdx * 0.7
          ox = gx + Math.cos(theta) * r
          oy = gy + Math.sin(theta) * r
        }

        const old = prevNodes.get(node.id)
        nextNodes.set(node.id, {
          id: node.id,
          entity: node,
          x: old ? old.x : ox,
          y: old ? old.y : oy,
          targetX: ox,
          targetY: oy,
          overviewX: ox,
          overviewY: oy,
          alpha: old ? old.alpha : 1,
          targetAlpha: 1,
          degree: deg,
          isEntry: node.kind === '设备' && idx < 6,
          isHub,
          useIconSquare: !isHub && seed > 0.62,
          seed
        })
      })
    })
  }

  simNodes = nextNodes
  applyFocusTargets()
}

/** 切换全景星群态 <-> 点击标准圆周放射聚焦态（带顶部上游回溯锚点） */
function applyFocusTargets() {
  const activeId = props.selected
  const prevId = props.trail.length >= 2 ? props.trail[props.trail.length - 2] : null

  if (!activeId || !simNodes.has(activeId)) {
    for (const sn of simNodes.values()) {
      sn.targetX = sn.overviewX
      sn.targetY = sn.overviewY
      const mutedByFilter = props.activeKindFilter && sn.entity.kind !== props.activeKindFilter
      sn.targetAlpha = mutedByFilter ? 0.14 : 1
    }
    return
  }

  const rawNeighbors = adjacency.get(activeId) ?? []
  const uniqueNeighborIds: string[] = []
  const seen = new Set<string>([activeId])
  if (prevId && simNodes.has(prevId)) seen.add(prevId)

  for (const item of rawNeighbors) {
    if (!seen.has(item.neighborId) && simNodes.has(item.neighborId)) {
      seen.add(item.neighborId)
      uniqueNeighborIds.push(item.neighborId)
    }
  }

  const neighborCount = uniqueNeighborIds.length
  const twoRings = neighborCount > 24
  const innerRadius = twoRings
    ? 152
    : Math.max(148, Math.min(238, 118 + neighborCount * 6.5))
  const outerRadius = 246
  const hasUpstream = Boolean(prevId && simNodes.has(prevId) && prevId !== activeId)
  const centerY = hasUpstream ? 26 : 0

  const neighborIndexMap = new Map(uniqueNeighborIds.map((id, i) => [id, i]))

  for (const sn of simNodes.values()) {
    if (sn.id === activeId) {
      sn.targetX = 0
      sn.targetY = centerY
      sn.targetAlpha = 1
    } else if (hasUpstream && sn.id === prevId) {
      // 上游回溯锚点退居画布上方
      const topOffset = (twoRings ? outerRadius : innerRadius) + 86
      sn.targetX = 0
      sn.targetY = centerY - topOffset
      sn.targetAlpha = 0.96
    } else if (neighborIndexMap.has(sn.id)) {
      const idx = neighborIndexMap.get(sn.id)!
      const ringIdx = twoRings ? idx % 2 : 0
      const slotInRing = twoRings ? Math.floor(idx / 2) : idx
      const countInRing = twoRings ? Math.ceil((neighborCount - ringIdx) / 2) : neighborCount
      const radius = ringIdx === 0 ? innerRadius : outerRadius

      const gap = hasUpstream ? 0.36 : 0
      const startAngle = -Math.PI / 2 + gap / 2 + (ringIdx === 1 ? 0.14 : 0)
      const span = Math.PI * 2 - gap
      const angle = startAngle + (span * slotInRing) / Math.max(1, countInRing)

      sn.targetX = Math.cos(angle) * radius
      sn.targetY = centerY + Math.sin(angle) * radius
      sn.targetAlpha = 1
    } else {
      sn.targetX = sn.overviewX
      sn.targetY = sn.overviewY
      sn.targetAlpha = 0.03
    }
  }

  // 自动将放射星轮居中适配当前视口
  const maxSpan = (twoRings ? outerRadius : innerRadius) + (hasUpstream ? 130 : 85)
  const fitZoom = Math.min(1.08, Math.max(0.58, Math.min(width, height) / (maxSpan * 2.25)))
  cam.targetX = 0
  cam.targetY = hasUpstream ? 26 * fitZoom : 0
  cam.targetZoom = fitZoom
}

function fitOverviewCamera(animate = true) {
  if (!simNodes.size) return
  let maxX = 160
  let maxY = 160
  for (const sn of simNodes.values()) {
    maxX = Math.max(maxX, Math.abs(sn.overviewX) + 85)
    maxY = Math.max(maxY, Math.abs(sn.overviewY) + 60)
  }
  const zoomX = width / (maxX * 2.15)
  const zoomY = height / (maxY * 2.15)
  const fit = Math.min(1.12, Math.max(0.32, Math.min(zoomX, zoomY)))
  cam.targetX = 0
  cam.targetY = 0
  cam.targetZoom = fit
  if (!animate || reducedMotion.matches) {
    cam.x = cam.targetX
    cam.y = cam.targetY
    cam.zoom = cam.targetZoom
  }
}

function reset() {
  if (props.selected && simNodes.has(props.selected)) {
    applyFocusTargets()
  } else {
    fitOverviewCamera(true)
  }
}

function getPose(): CameraPose2D {
  return { x: cam.targetX, y: cam.targetY, zoom: cam.targetZoom }
}

function restorePose(saved: CameraPose2D) {
  cam.targetX = saved.x
  cam.targetY = saved.y
  cam.targetZoom = saved.zoom
}

// ---------- 绘制工具：极简矢量线框微图标 + 克莱因蓝胶囊 ----------
function drawMicroIconSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  icon: KindVisual['icon'],
  strokeColor: string,
  highlighted: boolean
) {
  const half = highlighted ? 7 : 5.5
  const size = half * 2
  ctx.fillStyle = highlighted ? '#0033FF' : '#071130'
  ctx.strokeStyle = highlighted ? '#FFFFFF' : strokeColor
  ctx.lineWidth = highlighted ? 1.25 : 0.95
  ctx.fillRect(x - half, y - half, size, size)
  ctx.strokeRect(x - half, y - half, size, size)

  ctx.beginPath()
  ctx.strokeStyle = highlighted ? '#FFFFFF' : 'rgba(220, 234, 255, 0.9)'
  ctx.lineWidth = 0.9

  if (icon === 'equipment') {
    ctx.strokeRect(x - 2.8, y - 2.2, 5.6, 4.4)
    ctx.moveTo(x - 1.4, y)
    ctx.lineTo(x + 1.4, y)
  } else if (icon === 'part') {
    ctx.arc(x, y, 2.2, 0, Math.PI * 2)
  } else if (icon === 'process') {
    ctx.moveTo(x - 2.8, y + 1.6)
    ctx.lineTo(x, y - 2.2)
    ctx.lineTo(x + 2.8, y + 1.6)
  } else if (icon === 'fault') {
    ctx.moveTo(x, y - 2.6)
    ctx.lineTo(x, y + 0.5)
    ctx.moveTo(x, y + 2)
    ctx.lineTo(x, y + 2.7)
  } else if (icon === 'cause') {
    ctx.moveTo(x - 2.2, y - 2.2)
    ctx.lineTo(x + 2.2, y + 2.2)
    ctx.moveTo(x + 2.2, y - 2.2)
    ctx.lineTo(x - 2.2, y + 2.2)
  } else if (icon === 'solution') {
    ctx.moveTo(x - 2.6, y)
    ctx.lineTo(x - 0.5, y + 2)
    ctx.lineTo(x + 2.8, y - 2)
  } else {
    ctx.moveTo(x - 2.3, y - 1.5)
    ctx.lineTo(x + 2.3, y - 1.5)
    ctx.moveTo(x - 2.3, y + 1.3)
    ctx.lineTo(x + 1.3, y + 1.3)
  }
  ctx.stroke()
}

function drawKleinPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  align: 'center' | 'left' = 'left'
) {
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  const padX = 8
  const h = 22
  const w = ctx.measureText(text).width + padX * 2
  const bx = align === 'center' ? x - w / 2 : x
  const by = y - h / 2

  ctx.fillStyle = '#0033FF'
  ctx.fillRect(bx, by, w, h)

  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, bx + padX, y + 0.5)
}

function render(now: number) {
  if (!onscreen) {
    rafId = 0
    return
  }
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    buildStars(width, height)
  }

  const still = reducedMotion.matches
  const camLerp = still ? 1 : 0.13
  const nodeLerp = still ? 1 : 0.14

  cam.x += (cam.targetX - cam.x) * camLerp
  cam.y += (cam.targetY - cam.y) * camLerp
  cam.zoom += (cam.targetZoom - cam.zoom) * camLerp

  const activeId = props.selected && simNodes.has(props.selected) ? props.selected : null
  const prevId =
    activeId && props.trail.length >= 2 && simNodes.has(props.trail[props.trail.length - 2])
      ? props.trail[props.trail.length - 2]
      : null
  const effectiveHover = hoveredId ?? props.externalHoverId ?? null

  for (const sn of simNodes.values()) {
    const sway = !still && !activeId ? 1.15 : 0
    const dx = sway ? Math.sin(now * 0.00065 + sn.seed * 22) * sway : 0
    const dy = sway ? Math.cos(now * 0.00058 + sn.seed * 19) * sway : 0
    sn.x += (sn.targetX + dx - sn.x) * nodeLerp
    sn.y += (sn.targetY + dy - sn.y) * nodeLerp
    sn.alpha += (sn.targetAlpha - sn.alpha) * (still ? 1 : 0.16)
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 1. 纯净极深午夜蓝底色 + 克制静态微星点
  ctx.fillStyle = '#020618'
  ctx.fillRect(0, 0, width, height)

  for (const s of stars) {
    ctx.fillStyle = `rgba(186, 208, 255, ${s.alpha})`
    ctx.fillRect(s.x, s.y, s.size, s.size)
  }

  // 计算悬停关联集
  const hoverSet = new Set<string>()
  if (effectiveHover && simNodes.has(effectiveHover)) {
    hoverSet.add(effectiveHover)
    for (const item of adjacency.get(effectiveHover) ?? []) {
      hoverSet.add(item.neighborId)
    }
  }

  ctx.save()
  ctx.translate(width / 2 + cam.x, height / 2 + cam.y)
  ctx.scale(cam.zoom, cam.zoom)

  // 2. 全景态下绘制中央细线空心原点及向各大入口簇的辐射极细引导线
  if (!activeId && hubIds.size > 1) {
    ctx.beginPath()
    ctx.arc(0, 0, 6.5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(195, 215, 255, 0.55)'
    ctx.lineWidth = 1 / cam.zoom
    ctx.stroke()

    for (const hid of hubIds) {
      const hub = simNodes.get(hid)
      if (!hub) continue
      const len = Math.hypot(hub.x, hub.y)
      if (len < 12) continue
      ctx.beginPath()
      ctx.moveTo((hub.x / len) * 7, (hub.y / len) * 7)
      ctx.lineTo(hub.x, hub.y)
      ctx.strokeStyle =
        props.highlightKind && hub.entity.kind === props.highlightKind
          ? 'rgba(130, 175, 255, 0.52)'
          : 'rgba(120, 158, 240, 0.16)'
      ctx.lineWidth = 0.9 / cam.zoom
      ctx.stroke()
    }
  }

  // 3. 绘制 1px 极细直线关系边（同对节点去重渲染，聚焦态仅绘放射关联线）
  const drawnPairs = new Set<string>()
  for (const rel of props.graph.relations) {
    const s = simNodes.get(rel.source)
    const t = simNodes.get(rel.target)
    if (!s || !t) continue

    const baseAlpha = Math.min(s.alpha, t.alpha)
    if (baseAlpha < 0.06) continue

    const touchesActive = activeId !== null && (rel.source === activeId || rel.target === activeId)
    if (activeId && !touchesActive) continue

    const pairKey = rel.source < rel.target ? `${rel.source}|${rel.target}` : `${rel.target}|${rel.source}`
    if (drawnPairs.has(pairKey)) continue
    drawnPairs.add(pairKey)

    const touchesHover =
      effectiveHover !== null && (rel.source === effectiveHover || rel.target === effectiveHover)
    const touchesKind =
      props.highlightKind &&
      (s.entity.kind === props.highlightKind || t.entity.kind === props.highlightKind)

    let stroke = `rgba(136, 172, 255, ${0.22 * baseAlpha})`
    let lineW = 0.95 / cam.zoom

    if (touchesHover) {
      stroke = 'rgba(255, 255, 255, 0.94)'
      lineW = 1.35 / cam.zoom
    } else if (touchesActive) {
      stroke = 'rgba(162, 196, 255, 0.46)'
      lineW = 1.05 / cam.zoom
    } else if (touchesKind) {
      stroke = 'rgba(120, 166, 255, 0.56)'
      lineW = 1.1 / cam.zoom
    } else if (effectiveHover) {
      stroke = `rgba(136, 172, 255, ${0.06 * baseAlpha})`
    }

    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(t.x, t.y)
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineW
    ctx.stroke()

    // 放射聚焦态下在连线中点轻量显示关系类型
    if (touchesActive && rel.type) {
      const mx = (s.x + t.x) / 2
      const my = (s.y + t.y) / 2
      ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.fillStyle = touchesHover ? '#FFFFFF' : 'rgba(168, 196, 255, 0.7)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(rel.type, mx, my - 7)
    }
  }

  // 若存在上游回溯锚点但无直接边（如通过搜索跳转），补绘虚线回溯指引线
  if (activeId && prevId && prevId !== activeId) {
    const a = simNodes.get(activeId)
    const p = simNodes.get(prevId)
    const pairKey = activeId < prevId ? `${activeId}|${prevId}` : `${prevId}|${activeId}`
    if (a && p && !drawnPairs.has(pairKey)) {
      ctx.beginPath()
      ctx.setLineDash([3, 4])
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(p.x, p.y)
      ctx.strokeStyle = 'rgba(140, 178, 255, 0.45)'
      ctx.lineWidth = 1 / cam.zoom
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // 4. 绘制节点本体（中心环 / 上游缩略锚点 / 微圆点 + 线框小方框）
  const placedLabels: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  const hoveredOverlay: Array<{ x: number; y: number; text: string; align: 'center' | 'left' }> = []

  const centerNode = activeId ? simNodes.get(activeId) : undefined

  for (const sn of simNodes.values()) {
    if (sn.alpha < 0.06) continue
    const visual = visualOf(sn.entity.kind)
    const isCenter = sn.id === activeId
    const isUpstream = sn.id === prevId
    const isHovered = sn.id === effectiveHover
    const isHoverRelated = effectiveHover !== null && hoverSet.has(sn.id)
    const isKindHighlighted = props.highlightKind ? sn.entity.kind === props.highlightKind : false

    let alpha = sn.alpha
    if (effectiveHover && !isHoverRelated && !isCenter) {
      alpha *= 0.18
    } else if (props.highlightKind && !isKindHighlighted && !activeId) {
      alpha *= 0.2
    }

    ctx.save()
    ctx.globalAlpha = alpha

    if (isCenter) {
      ctx.beginPath()
      ctx.arc(sn.x, sn.y, 13, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(170, 202, 255, 0.88)'
      ctx.lineWidth = 1.25 / cam.zoom
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(sn.x, sn.y, 5.2, 0, Math.PI * 2)
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
    } else if (isUpstream) {
      // 上游缩略星群锚点
      ctx.beginPath()
      ctx.arc(sn.x, sn.y, 17, 0, Math.PI * 2)
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = isHovered ? '#FFFFFF' : 'rgba(128, 168, 255, 0.62)'
      ctx.lineWidth = 1 / cam.zoom
      ctx.stroke()
      ctx.setLineDash([])

      // 微缩装饰放射小点
      for (let k = 0; k < 5; k++) {
        const ang = (Math.PI * 2 * k) / 5 - 0.3
        ctx.beginPath()
        ctx.arc(sn.x + Math.cos(ang) * 11, sn.y + Math.sin(ang) * 11, 1.3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(165, 198, 255, 0.7)'
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(sn.x, sn.y, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = isHovered ? '#FFFFFF' : visual.color
      ctx.fill()
    } else if (sn.useIconSquare) {
      drawMicroIconSquare(ctx, sn.x, sn.y, visual.icon, visual.color, isHovered || isHoverRelated)
    } else {
      const r = sn.isHub ? 4.8 : 2.5
      if (sn.isHub || isHovered) {
        ctx.beginPath()
        ctx.arc(sn.x, sn.y, r + 4.2, 0, Math.PI * 2)
        ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.8)' : `${visual.color}55`
        ctx.lineWidth = 1 / cam.zoom
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(sn.x, sn.y, isHovered ? r + 1.4 : r, 0, Math.PI * 2)
      ctx.fillStyle = isHovered ? '#FFFFFF' : visual.color
      ctx.fill()
    }

    // 5. 渐进式文字披露（带轻碰撞检测，杜绝堆叠）
    if (isCenter) {
      hoveredOverlay.push({ x: sn.x, y: sn.y + 27, text: sn.entity.name, align: 'center' })
    } else if (isHovered) {
      hoveredOverlay.push({
        x: sn.x + 12,
        y: sn.y,
        text: isUpstream ? `↑ 返回：${sn.entity.name}` : sn.entity.name,
        align: 'left'
      })
    } else if (isUpstream) {
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.fillStyle = 'rgba(205, 224, 255, 0.94)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`↑ 返回：${sn.entity.name}`, sn.x, sn.y - 22)
    } else if (activeId && sn.alpha > 0.5 && centerNode) {
      const angle = Math.atan2(sn.y - centerNode.y, sn.x - centerNode.x)
      const onRight = Math.cos(angle) >= 0
      const text = sn.entity.name
      ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      const tw = ctx.measureText(text).width
      const tx = sn.x + (onRight ? 12 : -12)
      const box = {
        x1: onRight ? tx : tx - tw,
        y1: sn.y - 8,
        x2: onRight ? tx + tw : tx,
        y2: sn.y + 8
      }
      const overlaps = placedLabels.some(
        (b) => !(box.x2 < b.x1 - 4 || box.x1 > b.x2 + 4 || box.y2 < b.y1 - 2 || box.y1 > b.y2 + 2)
      )
      if (!overlaps || isHoverRelated) {
        placedLabels.push(box)
        ctx.fillStyle = isHoverRelated ? '#FFFFFF' : 'rgba(226, 238, 255, 0.9)'
        ctx.textAlign = onRight ? 'left' : 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, tx, sn.y)
      }
    } else if (!activeId && (sn.isHub || isHoverRelated || isKindHighlighted)) {
      const label = sn.isHub ? `${sn.entity.name}  ${sn.degree}` : sn.entity.name
      ctx.font = sn.isHub
        ? '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '400 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      const tw = ctx.measureText(label).width
      const tx = sn.x + 10
      const box = { x1: tx, y1: sn.y - 8, x2: tx + tw, y2: sn.y + 8 }
      const overlaps = placedLabels.some(
        (b) => !(box.x2 < b.x1 - 4 || box.x1 > b.x2 + 4 || box.y2 < b.y1 - 2 || box.y1 > b.y2 + 2)
      )
      if (!overlaps || isHoverRelated) {
        placedLabels.push(box)
        ctx.fillStyle = isHoverRelated ? '#FFFFFF' : 'rgba(235, 242, 255, 0.92)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, tx, sn.y)
      }
    }

    ctx.restore()
  }

  // 顶层绘制克莱因蓝实底白字高亮胶囊，确保永不被遮挡
  for (const item of hoveredOverlay) {
    drawKleinPill(ctx, item.x, item.y, item.text, item.align)
  }

  ctx.restore()
  rafId = requestAnimationFrame(render)
}

// ---------- 2D 指针命中与以鼠标为中心的平滑缩放 ----------
function screenToWorld(clientX: number, clientY: number) {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const sx = clientX - rect.left
  const sy = clientY - rect.top
  return {
    x: (sx - rect.width / 2 - cam.x) / cam.zoom,
    y: (sy - rect.height / 2 - cam.y) / cam.zoom
  }
}

function hitTest(worldX: number, worldY: number): string | null {
  const prevId = props.trail.length >= 2 ? props.trail[props.trail.length - 2] : null
  let bestId: string | null = null
  let bestDist = Infinity

  for (const sn of simNodes.values()) {
    if (sn.alpha < 0.25) continue
    const threshold = (sn.id === prevId ? 24 : sn.isHub ? 18 : 14) / cam.zoom
    const d = Math.hypot(sn.x - worldX, sn.y - worldY)
    if (d < threshold && d < bestDist) {
      bestDist = d
      bestId = sn.id
    }
  }
  return bestId
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  isDragging = true
  dragDist = 0
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragCamX = cam.targetX
  dragCamY = cam.targetY
}

function onPointerMove(e: PointerEvent) {
  if (isDragging) {
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    dragDist = Math.hypot(dx, dy)
    cam.targetX = dragCamX + dx
    cam.targetY = dragCamY + dy
    return
  }
  if (e.pointerType === 'touch') return
  const world = screenToWorld(e.clientX, e.clientY)
  hoveredId = hitTest(world.x, world.y)
  if (canvasRef.value) {
    canvasRef.value.style.cursor = hoveredId ? 'pointer' : 'grab'
  }
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging) return
  isDragging = false
  if (dragDist >= 5) return

  const world = screenToWorld(e.clientX, e.clientY)
  const hit = hitTest(world.x, world.y)
  const prevId = props.trail.length >= 2 ? props.trail[props.trail.length - 2] : null

  if (hit) {
    if (props.selected && hit === prevId) {
      emit('back')
    } else {
      emit('select', hit)
    }
  } else if (props.selected) {
    emit('clear')
  }
}

function onPointerLeave() {
  isDragging = false
  hoveredId = null
}

function onWheel(e: WheelEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  const factor = e.deltaY < 0 ? 1.13 : 0.88
  const nextZoom = Math.max(0.28, Math.min(3.2, cam.targetZoom * factor))
  const wx = (mx - rect.width / 2 - cam.targetX) / cam.targetZoom
  const wy = (my - rect.height / 2 - cam.targetY) / cam.targetZoom

  cam.targetZoom = nextZoom
  cam.targetX = mx - rect.width / 2 - wx * nextZoom
  cam.targetY = my - rect.height / 2 - wy * nextZoom
}

function syncSize() {
  if (!host.value) return
  width = Math.max(2, host.value.clientWidth)
  height = Math.max(2, host.value.clientHeight)
}

function startLoop() {
  if (!rafId && onscreen && !document.hidden) {
    rafId = requestAnimationFrame(render)
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    cancelAnimationFrame(rafId)
    rafId = 0
  } else {
    startLoop()
  }
}

watch(
  () => [props.graph, props.explore] as const,
  ([, explore], [, wasExplore]) => {
    const preserve = Boolean(explore && wasExplore && simNodes.size > 0)
    rebuildLayout(preserve)
    if (!preserve && !props.selected) fitOverviewCamera(false)
  }
)

watch(
  () => [props.selected, props.trail, props.activeKindFilter],
  () => {
    applyFocusTargets()
  },
  { deep: true }
)

onMounted(() => {
  syncSize()
  buildStars(width, height)
  rebuildLayout(false)
  if (!props.selected) fitOverviewCamera(false)

  if (host.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(syncSize)
    observer.observe(host.value)
  }
  if (host.value && typeof IntersectionObserver !== 'undefined') {
    intersection = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting
      if (onscreen) startLoop()
      else {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
    })
    intersection.observe(host.value)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  startLoop()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  observer?.disconnect()
  intersection?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

defineExpose({ reset, getPose, restorePose })
</script>

<template>
  <div ref="host" class="expo-stage">
    <canvas
      ref="canvasRef"
      class="expo-canvas"
      aria-label="知识图谱 2D 星图：悬停查看关联路径，点击放射展开，拖拽平移，滚轮缩放"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @pointercancel="onPointerLeave"
      @wheel.prevent="onWheel"
    ></canvas>

    <div class="expo-hud-top">
      <span class="expo-status-chip">
        <i class="expo-status-dot"></i>
        <template v-if="selected">放射聚焦 · 第 {{ Math.max(1, trail.length) }} 层</template>
        <template v-else-if="explore">设备星群总览</template>
        <template v-else>全量星座视图</template>
      </span>
      <button v-if="selected" type="button" class="expo-hud-btn" @click="emit('back')">
        ← 上一层
      </button>
      <button v-if="selected" type="button" class="expo-hud-btn is-accent" @click="emit('clear')">
        回到全景
      </button>
    </div>

    <p class="expo-hint">悬停透视关联 · 点击放射下钻 · 拖拽平移 · 滚轮缩放</p>
  </div>
</template>

<style scoped>
.expo-stage {
  position: relative;
  height: 620px;
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
  top: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.expo-hud-top > * {
  pointer-events: auto;
}

.expo-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  font-size: 12px;
  color: #dce7ff;
  background: rgba(2, 6, 24, 0.84);
  border: 1px solid rgba(130, 168, 255, 0.28);
}

.expo-status-dot {
  width: 6px;
  height: 6px;
  background: #0033ff;
  border: 1px solid #8eb2ff;
}

.expo-hud-btn {
  padding: 5px 11px;
  font-size: 12px;
  color: #e6efff;
  cursor: pointer;
  background: rgba(8, 18, 52, 0.9);
  border: 1px solid rgba(130, 168, 255, 0.34);
  transition: background-color 140ms ease, border-color 140ms ease;
}

.expo-hud-btn:hover,
.expo-hud-btn.is-accent {
  background: #0022cc;
  border-color: #6ea0ff;
}

.expo-hint {
  position: absolute;
  bottom: 12px;
  left: 16px;
  margin: 0;
  font-size: 11px;
  color: rgba(176, 198, 245, 0.56);
  pointer-events: none;
}

@media (width <= 768px) {
  .expo-stage {
    height: 440px;
  }
}
</style>