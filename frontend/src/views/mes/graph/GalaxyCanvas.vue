<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Color, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { AggregateRenderer } from '@/vendor/galaxy-view/render/AggregateRenderer'
import { TIERS } from '@/vendor/galaxy-view/quality/tiers'
import ForceWorker from './forceLayout.worker?worker'
import { seedPositions } from './forceLayout'
import { getVisualPreset, presetColors, presetPhysics } from './visualPresets'
import { CameraFlight, type CameraPose, type Vec3 } from './cameraFlight'
import { toGalaxyData, type KnowledgeGraph } from './graphData'

const props = defineProps<{
  graph: KnowledgeGraph
  selected: string | null
  rotating: boolean
  presetId: string
  nebula: number
  bloom: number
  layoutPaused: boolean
}>()
const emit = defineEmits<{ select: [id: string | null]; layoutSettled: [value: boolean] }>()
const host = ref<HTMLElement>()
const error = ref('')
const labels = ref<{ id: string; name: string; x: number; y: number; visible: boolean }[]>([])
let renderer: AggregateRenderer | undefined
let layoutWorker: Worker | undefined
let positions: Float32Array = new Float32Array(0)
let positionDirty = false
let latestSettled = false
let refreshClouds = false
let autoFramePending = true
let renderedData: ReturnType<typeof toGalaxyData> = { nodes: [], links: [] }
const flight = new CameraFlight()
let focusId: string | null = null
let focusOffset = new Vector3()
function pose(): CameraPose {
  return {
    position: renderer!.camera.position.toArray() as Vec3,
    target: controls!.target.toArray() as Vec3
  }
}
function moveCamera(to: CameraPose, animate = true) {
  if (!renderer || !controls) return
  if (!animate || reducedMotion.matches) {
    flight.cancel()
    renderer.camera.position.fromArray(to.position)
    controls.target.fromArray(to.target)
    controls.update()
    return
  }
  flight.begin(pose(), to)
}
function applyVisuals() {
  if (!renderer) return
  const preset = getVisualPreset(props.presetId),
    colors = presetColors(props.presetId)
  renderer.setColorFn((node) => new Color(colors[node.folderTop] || '#a6bcff'))
  renderer.recolor()
  renderer.setNebulaTint(colors['设备'], colors['原因'])
  renderer.setStarfieldEnabled(preset.starfield)
  renderer.setSpace({ ...preset.space, nebula: props.nebula })
  renderer.setBloomParams({ ...preset.bloom, strength: props.bloom })
  renderer.setLinkCurve(preset.look.linkCurve)
  renderer.setLinkOpacity(preset.look.linkOpacity)
  renderer.setNodeScale(preset.look.nodeSize * 1.3)
  renderer.setSizeMode(preset.look.sizeBy)
  renderer.twinkleFreq = reducedMotion.matches ? 0 : preset.look.twinkle
}
let controls: OrbitControls | undefined
let observer: ResizeObserver | undefined
let frame = 0,
  previous = 0
let width = 1,
  height = 1
let visible = true,
  onscreen = true
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let intersection: IntersectionObserver | undefined
let down: { x: number; y: number } | undefined
const cleanups: (() => void)[] = []
function reset(animate = true) {
  if (!renderer || !controls) return
  focusId = null
  let radius = 80
  props.graph.nodes.forEach((_, i) => {
    radius = Math.max(radius, renderer!.nodePosition(i, new Vector3()).length())
  })
  const distance = Math.max(260, (radius * 2.4) / Math.min(1, width / height))
  const elevation = ((getVisualPreset(props.presetId).frameElevDeg || 35) * Math.PI) / 180
  moveCamera(
    {
      position: [0, Math.sin(elevation) * distance, Math.cos(elevation) * distance],
      target: [0, 0, 0]
    },
    animate
  )
}
function selectFocus() {
  if (!renderer) return
  const data = toGalaxyData(props.graph)
  const selected = data.nodes.findIndex((n) => n.id === props.selected)
  const neighbors = new Set<number>([selected])
  const edges: number[] = []
  data.links.forEach((edge, i) => {
    if (edge.source === selected || edge.target === selected) {
      neighbors.add(edge.source)
      neighbors.add(edge.target)
      edges.push(i)
    }
  })
  renderer.setFocus(selected < 0 ? null : (i) => (neighbors.has(i) ? 1 : 0.12))
  renderer.setSelectedLinks(edges, [])
}
function focusNode(id: string) {
  const i = props.graph.nodes.findIndex((n) => n.id === id)
  if (!renderer || !controls || i < 0) return
  autoFramePending = false
  focusId = id
  const point = renderer.nodePosition(i, new Vector3())
  focusOffset = renderer.camera.position.clone().sub(controls.target)
  if (focusOffset.lengthSq() < 0.001) focusOffset.set(0, 1, 1)
  focusOffset.normalize().multiplyScalar(170)
  moveCamera({
    position: point.clone().add(focusOffset).toArray() as Vec3,
    target: point.toArray() as Vec3
  })
}
function projectLabels() {
  if (!renderer) return
  const nodes = renderedData.nodes
  const order = nodes
    .map((node, i) => ({ node, i }))
    .sort(
      (a, b) =>
        Number(b.node.id === props.selected) - Number(a.node.id === props.selected) ||
        b.node.degree - a.node.degree
    )
  const occupied: { x: number; y: number; width: number }[] = []
  labels.value = order.map(({ node, i }) => {
    const p = renderer!.projectNode(i, width, height),
      labelWidth = Math.max(48, node.name.length * 12)
    const visible =
      !p.behind &&
      p.x > 30 &&
      p.y > 20 &&
      p.x < width - 30 &&
      p.y < height - 25 &&
      occupied.length < 35 &&
      !occupied.some(
        (o) => Math.abs(o.x - p.x) < (o.width + labelWidth) / 2 + 8 && Math.abs(o.y - p.y) < 22
      )
    if (visible) occupied.push({ x: p.x, y: p.y, width: labelWidth })
    return { id: node.id, name: node.name, x: p.x, y: p.y, visible }
  })
}
function stop() {
  cancelAnimationFrame(frame)
  frame = 0
  previous = 0
}
function loop(now: number) {
  if (!renderer || !controls) return
  const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0
  previous = now
  if (flight.active && focusId) {
    const i = props.graph.nodes.findIndex((n) => n.id === focusId)
    if (i >= 0) {
      const point = renderer.nodePosition(i, new Vector3())
      flight.retarget({
        position: point.clone().add(focusOffset).toArray() as Vec3,
        target: point.toArray() as Vec3
      })
    }
  }
  const nextPose = flight.step(delta)
  controls.autoRotate = props.rotating && !reducedMotion.matches && !nextPose
  controls.enableDamping = !nextPose
  if (nextPose) {
    renderer.camera.position.fromArray(nextPose.position)
    controls.target.fromArray(nextPose.target)
  }
  controls.update()
  if (positionDirty && (!props.layoutPaused || latestSettled)) {
    renderer.updatePositions()
    positionDirty = false
    if (refreshClouds) {
      renderer.refreshClusterClouds()
      if (autoFramePending && !focusId) {
        reset()
        autoFramePending = false
      }
      refreshClouds = false
    }
  }
  renderer.render(reducedMotion.matches ? 0 : delta)
  projectLabels()
  frame = requestAnimationFrame(loop)
}
function syncVisibility() {
  visible = !document.hidden
  layoutWorker?.postMessage({ type: 'pause', value: props.layoutPaused || !visible || !onscreen })
  if (visible && onscreen && !frame && renderer) frame = requestAnimationFrame(loop)
  else if (!visible || !onscreen) stop()
}
function dispose() {
  stop()
  flight.cancel()
  focusId = null
  layoutWorker?.terminate()
  layoutWorker = undefined
  observer?.disconnect()
  intersection?.disconnect()
  cleanups.splice(0).forEach((fn) => fn())
  controls?.dispose()
  controls = undefined
  renderer?.dispose()
  renderer = undefined
}
function initialize() {
  if (!host.value) return
  try {
    const data = toGalaxyData(props.graph)
    renderedData = data
    autoFramePending = true
    renderer = new AggregateRenderer(host.value, 110)
    renderer.applyTier(TIERS.low, 0.65)
    positions = seedPositions(data)
    positionDirty = false
    latestSettled = false
    emit('layoutSettled', false)
    layoutWorker = new ForceWorker()
    layoutWorker.onmessage = ({
      data: update
    }: MessageEvent<{ positions: Float32Array; settled: boolean }>) => {
      positions.set(update.positions)
      positionDirty = true
      latestSettled = update.settled
      refreshClouds = update.settled
      emit('layoutSettled', update.settled)
    }
    layoutWorker.onerror = () => {
      error.value = '力导向布局计算失败，请重新进入图谱。'
      layoutWorker?.terminate()
      layoutWorker = undefined
    }
    layoutWorker.postMessage({
      type: 'init',
      data,
      positions: positions.slice(),
      params: presetPhysics(props.presetId),
      finalOnly: reducedMotion.matches,
      paused: props.layoutPaused || !visible || !onscreen
    })
    renderer.setData(data, positions)
    applyVisuals()
    controls = new OrbitControls(renderer.camera, renderer.renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotateSpeed = 0.3
    controls.minDistance = 55
    controls.maxDistance = 12000
    const cancelFlight = () => {
      flight.cancel()
      focusId = null
      autoFramePending = false
    }
    controls.addEventListener('start', cancelFlight)
    cleanups.push(() => controls?.removeEventListener('start', cancelFlight))
    reset(false)
    observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width
      height = entry.contentRect.height
      renderer?.resize(width, height)
    })
    observer.observe(host.value)
    const canvas = renderer.renderer.domElement
    canvas.setAttribute('aria-label', '星系图：拖动旋转，滚轮缩放；也可使用旁边的实体列表查看关系')
    canvas.addEventListener('webglcontextlost', contextLost)
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const pointerUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
        down = undefined
        return
      }
      down = undefined
      const rect = canvas.getBoundingClientRect()
      const i =
        renderer?.pickNearest(e.clientX - rect.left, e.clientY - rect.top, width, height, 18) ?? -1
      emit('select', props.graph.nodes[i]?.id ?? null)
    }
    const pointerCancel = () => {
      down = undefined
    }
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', pointerCancel)
    cleanups.push(() => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerCancel)
      canvas.removeEventListener('webglcontextlost', contextLost)
    })
    document.addEventListener('visibilitychange', syncVisibility)
    cleanups.push(() => document.removeEventListener('visibilitychange', syncVisibility))
    intersection = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting
      syncVisibility()
    })
    intersection.observe(host.value)
    selectFocus()
    syncVisibility()
  } catch (e) {
    error.value = `星系渲染未能启动：${e instanceof Error ? e.message : 'WebGL 不可用'}。仍可通过实体列表查看关系与来源。`
    dispose()
  }
}
function contextLost(e: Event) {
  e.preventDefault()
  error.value = '图形上下文已丢失，请重新进入知识图谱。实体列表仍可使用。'
  stop()
}
watch(
  () => props.selected,
  (id) => {
    selectFocus()
    if (id) focusNode(id)
    else {
      flight.cancel()
      focusId = null
    }
  }
)
watch(() => [props.nebula, props.bloom], applyVisuals)
watch(
  () => props.presetId,
  () => {
    applyVisuals()
    autoFramePending = true
    latestSettled = false
    emit('layoutSettled', false)
    layoutWorker?.postMessage({ type: 'params', params: presetPhysics(props.presetId) })
    reset()
  }
)
watch(
  () => props.layoutPaused,
  (value) => {
    layoutWorker?.postMessage({ type: 'pause', value: value || !visible || !onscreen })
  }
)
watch(
  () => props.graph,
  () => {
    dispose()
    labels.value = []
    error.value = ''
    initialize()
  }
)
onMounted(initialize)
onBeforeUnmount(dispose)
defineExpose({ reset, focusNode })
</script>

<template>
  <div class="galaxy-stage">
    <div ref="host" class="galaxy-host"></div>
    <div class="galaxy-labels" aria-hidden="true">
      <span
        v-for="label in labels.filter((l) => l.visible)"
        :key="label.id"
        :class="{ selected: label.id === selected }"
        :style="{ left: `${label.x}px`, top: `${label.y}px` }"
        >{{ label.name }}</span
      >
    </div>
    <p v-if="error" class="galaxy-error" role="alert">{{ error }}</p>
    <p class="galaxy-hint">拖动旋转 · 滚轮 / 双指缩放 · 点击节点查看关联</p>
  </div>
</template>
<style scoped>
.galaxy-stage {
  position: relative;
  height: 590px;
  min-width: 0;
  overflow: hidden;
  background: #000003;
  border-radius: 12px;
}

.galaxy-host {
  width: 100%;
  height: 100%;
  touch-action: none;
}

.galaxy-host :deep(canvas) {
  display: block;
}

.galaxy-labels {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
  inset: 0;
}

.galaxy-labels span {
  position: absolute;
  font-size: 12px;
  color: #e5ecff;
  text-shadow:
    0 1px 5px #000,
    0 0 8px #000;
  white-space: nowrap;
  transform: translate(-50%, 14px);
}

.galaxy-labels span.selected {
  font-weight: 700;
  color: #fff1be;
}

.galaxy-hint {
  position: absolute;
  bottom: 12px;
  width: 100%;
  margin: 0;
  font-size: 12px;
  color: #a8b7d4;
  text-align: center;
  pointer-events: none;
}

.galaxy-error {
  position: absolute;
  top: 20px;
  right: 20px;
  left: 20px;
  padding: 16px;
  color: #ffe0e7;
  background: #30232c;
  border-radius: 8px;
}

@media (width <= 768px) {
  .galaxy-stage {
    height: 430px;
  }
}
</style>
