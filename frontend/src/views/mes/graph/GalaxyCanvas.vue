<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Color, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { AggregateRenderer } from '@/vendor/galaxy-view/render/AggregateRenderer'
import { TIERS } from '@/vendor/galaxy-view/quality/tiers'
import { toGalaxyData, kindColors, type KnowledgeGraph } from './graphData'

const props = defineProps<{ graph: KnowledgeGraph; selected: string | null; rotating: boolean }>()
const emit = defineEmits<{ select: [id: string | null] }>()
const host = ref<HTMLElement>()
const error = ref('')
const labels = ref<{ id: string; name: string; x: number; y: number; visible: boolean }[]>([])
let renderer: AggregateRenderer | undefined
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
function reset() {
  if (!renderer || !controls) return
  controls.target.set(0, 0, 0)
  renderer.camera.position.set(0, 260, 180)
  controls.update()
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
  const point = renderer.nodePosition(i, new Vector3())
  const offset = renderer.camera.position
    .clone()
    .sub(controls.target)
    .normalize()
    .multiplyScalar(235)
  controls.target.copy(point)
  renderer.camera.position.copy(point).add(offset)
  controls.update()
}
function projectLabels() {
  if (!renderer) return
  labels.value = props.graph.nodes.map((node, i) => {
    const p = renderer!.projectNode(i, width, height)
    return {
      id: node.id,
      name: node.name,
      x: p.x,
      y: p.y,
      visible: !p.behind && p.x > 30 && p.y > 20 && p.x < width - 30 && p.y < height - 25
    }
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
  controls.autoRotate = props.rotating && !reducedMotion.matches
  controls.update()
  renderer.render(reducedMotion.matches ? 0 : delta)
  projectLabels()
  frame = requestAnimationFrame(loop)
}
function syncVisibility() {
  visible = !document.hidden
  if (visible && onscreen && !frame && renderer) frame = requestAnimationFrame(loop)
  else if (!visible || !onscreen) stop()
}
function dispose() {
  stop()
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
    renderer = new AggregateRenderer(host.value, 110)
    renderer.applyTier(TIERS.low, 0.65)
    renderer.setColorFn((node) => new Color(kindColors[node.folderTop] || '#9fbaff'))
    // Fixed spiral seed for this small prototype; does not infer knowledge or relationships.
    const positions = new Float32Array(data.nodes.length * 3)
    data.nodes.forEach((_, i) => {
      const angle = i * 2.399963,
        radius = i === 0 ? 0 : 38 + Math.sqrt(i) * 38
      positions.set(
        [Math.cos(angle) * radius, Math.sin(i * 1.7) * 24, Math.sin(angle) * radius],
        i * 3
      )
    })
    renderer.setData(data, positions)
    renderer.setLinkCurve(0.28)
    renderer.setLinkOpacity(0.4)
    renderer.setNodeScale(1.4)
    renderer.setSpace({ nebula: 0.18, fieldStars: 0.15, clusterClouds: 0.15 })
    renderer.twinkleFreq = reducedMotion.matches ? 0 : 0.4
    controls = new OrbitControls(renderer.camera, renderer.renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotateSpeed = 0.3
    controls.minDistance = 55
    controls.maxDistance = 1100
    reset()
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
watch(() => props.selected, selectFocus)
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
