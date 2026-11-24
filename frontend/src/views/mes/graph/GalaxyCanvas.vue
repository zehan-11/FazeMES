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
import { buildScene, focusWindow, graphIndex, type Point } from './starScene'
import { fitOverview, StarCanvas, type CameraPose2D } from './starCanvas'
export type { CameraPose2D } from './starCanvas'

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
const kind = ref(''),
  page = ref(0),
  all = ref(false)
const focus = computed(() =>
  focusWindow(index.value, props.selected ?? '', kind.value, page.value, all.value)
)
watch(
  () => props.selected,
  () => {
    kind.value = ''
    page.value = 0
    all.value = false
  },
  { flush: 'sync' }
)
function filterKind(value: string) {
  kind.value = value
  page.value = 0
}
watch([kind, page, all], () => rebuild())
let panelWidth = 0
let layoutWidth = 1
let context: CanvasRenderingContext2D | null = null
let raf = 0,
  active = false,
  visible = true
let resize: ResizeObserver | undefined, intersection: IntersectionObserver | undefined
let press: {
  id: number
  start: Point
  last: Point
  time: number
  target: ReturnType<StarCanvas['hit']>
  mode: 'pending' | 'hub' | 'leaf' | 'pan' | 'blank'
  distance: number
  clientX: number
  clientY: number
} | null = null
const dragThreshold = 5
function rebuild(resizing = false) {
  if (!host.value) return
  const scene = buildScene(
    index.value,
    props.selected,
    props.trail.at(-2),
    layoutWidth,
    engine.height,
    props.trail.length,
    focus.value.rows
  )
  engine.explore = props.explore
  const baseZoom = context ? fitOverview(scene, context, layoutWidth, engine.height) : 1
  engine.setScene(scene, performance.now(), resizing, baseZoom, layoutWidth)
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
function render(now: number) {
  raf = 0
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
  if (engine.draw(context, now, dpr, !!press)) emit('introEnd')
  if (!press) setCursor(engine.hover ? 'pointer' : props.selected ? 'grab' : 'default')
  raf = requestAnimationFrame(render)
}
function schedule() {
  if (!active || !visible || document.hidden) {
    cancelGesture()
    cancelAnimationFrame(raf)
    raf = 0
  } else if (!raf) raf = requestAnimationFrame(render)
}
function point(e: MouseEvent, box = canvasRef.value!.getBoundingClientRect()) {
  return {
    x: ((e.clientX - box.left) * engine.width) / box.width,
    y: ((e.clientY - box.top) * engine.height) / box.height
  }
}
function onPointerDown(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0 || press) return
  const p = point(e)
  engine.move(p)
  engine.dragEnd(false)
  press = {
    id: e.pointerId,
    start: p,
    last: p,
    time: e.timeStamp,
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
    if (props.selected) {
      gesture.mode = 'pan'
      engine.dragStart()
    } else if (
      hit &&
      (hit.role === 'hub' || hit.role === 'leaf') &&
      engine.beginNodeDrag(hit, gesture.start)
    ) {
      gesture.mode = hit.role
    } else {
      gesture.mode = 'blank'
    }
  }
  const moved = gesture.last.x !== p.x || gesture.last.y !== p.y
  if (gesture.mode === 'pan' && moved) {
    engine.drag(p.x - gesture.last.x, p.y - gesture.last.y, e.timeStamp - gesture.time)
  } else if ((gesture.mode === 'hub' || gesture.mode === 'leaf') && moved) {
    engine.moveNodeDrag(p)
  } else if (gesture.mode === 'blank') {
    engine.move(null)
  }
  if (moved) {
    gesture.last = p
    gesture.time = e.timeStamp
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
    press && (press.mode === 'hub' || press.mode === 'leaf' || press.mode === 'pan')
      ? 'grabbing'
      : engine.hover
        ? 'pointer'
        : props.selected
          ? 'grab'
          : 'default'
  )
}
function onPointerUp(e: PointerEvent) {
  if (!press || press.id !== e.pointerId) return
  const p = point(e)
  updateGesture(e, p)
  const { target, mode, time } = press
  press = null
  engine.endNodeDrag()
  engine.dragEnd(mode === 'pan' && e.timeStamp - time < 85)
  if (mode !== 'pending') {
    const inside =
      p.x >= 0 && p.x <= engine.width - engine.sidebarInset && p.y >= 0 && p.y <= engine.height
    // Re-test the release position, including drags released over the drawer or outside the canvas.
    engine.move(inside && e.pointerType !== 'touch' ? p : null)
    setCursor(engine.hover ? 'pointer' : props.selected ? 'grab' : 'default')
    return
  }
  setCursor(target ? 'pointer' : props.selected ? 'grab' : 'default')
  if (!target) {
    if (props.selected) emit('back')
    return
  }
  if (target.role === 'center') {
    engine.push()
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
  engine.dragEnd(false)
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
      aria-label="知识图谱星图。悬停查看关联，单击节点进入放射聚焦，拖动节点调整位置，滚轮缩放。"
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
      <button type="button" class="expo-hud-btn" @click="emit('clear')">返回全景</button>
    </div>

    <div v-if="selected && focus.total > 20" class="focus-pages" aria-label="一跳邻居分组">
      <button :aria-pressed="!kind" @click="filterKind('')">全部 ({{ focus.total }})</button>
      <button
        v-for="[type, rows] in focus.groups"
        :key="type"
        :aria-pressed="kind === type"
        @click="filterKind(type)"
        >{{ type }} ({{ rows.length }})</button
      >
      <template v-if="!all"
        ><button :disabled="page === 0" @click="page--">上一组</button
        ><span>第 {{ page + 1 }} / {{ focus.pages }} 组</span
        ><button :disabled="page + 1 >= focus.pages" @click="page++">下一组</button></template
      >
      <button :aria-pressed="all" @click="all = !all">{{ all ? '恢复分组' : '显示全部' }}</button>
    </div>
  </div>
</template>

<style scoped>
.expo-stage {
  position: relative;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: #020518;
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
.focus-pages {
  position: absolute;
  inset: 54px calc(var(--hud-inset, 0px) + 12px) auto 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  color: white;
  font-size: 11px;
  pointer-events: none;
}
.focus-pages button,
.focus-pages span {
  pointer-events: auto;
  padding: 3px 6px;
  border: 1px solid #536db1;
  background: #070e29;
  color: inherit;
}
.focus-pages button {
  cursor: pointer;
}
.focus-pages button[aria-pressed='true'] {
  background: #0022cc;
}
.focus-pages button:disabled {
  opacity: 0.45;
}
</style>
