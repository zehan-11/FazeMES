<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { CATEGORY_SPECS } from '../graph/categoryGraph'
import { buildScene, graphIndex, LAUNCH_MS } from '../graph/starScene'
import { StarCanvas } from '../graph/starCanvas'

const emit = defineEmits<{ done: [] }>()
const surface = ref<HTMLCanvasElement>()
let raf = 0
let fade: Animation | undefined
let observer: ResizeObserver | undefined
// A noninteractive ornament for non-graph tabs. No document data or requests.
const geometry = CATEGORY_SPECS.flatMap(({ id, label }, i) =>
  Array.from({ length: 8 + ((i * 7) % 15) }, (_, j) => ({
    id: id + '/' + j,
    kind: label,
    name: '',
    description: ''
  }))
)
const index = graphIndex(undefined, { nodes: geometry, relations: [] }, false)
index.explore = true
const engine = new StarCanvas()
function done() {
  emit('done')
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') done()
}

onMounted(() => {
  const canvas = surface.value!
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done()
    return
  }
  function resize() {
    engine.width = canvas.clientWidth
    engine.height = canvas.clientHeight
    engine.setScene(
      buildScene(index, null, undefined, engine.width, engine.height),
      performance.now(),
      true
    )
  }
  resize()
  observer = new ResizeObserver(resize)
  observer.observe(canvas)
  const start = Number(document.timeline.currentTime ?? performance.now())
  engine.beginIntro(start)
  fade = canvas.parentElement!.animate(
    [
      { opacity: 1, transform: 'scale(1)', offset: 0 },
      {
        opacity: 1,
        transform: 'scale(1)',
        offset: (LAUNCH_MS - 300) / LAUNCH_MS,
        easing: 'ease-out'
      },
      { opacity: 0, transform: 'scale(1.035)', offset: 1 }
    ],
    { duration: LAUNCH_MS, fill: 'both' }
  )
  fade.startTime = start
  fade.onfinish = done
  function draw(now: number) {
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(engine.width * dpr),
      h = Math.round(engine.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    engine.draw(ctx!, now, dpr)
    raf = requestAnimationFrame(draw)
  }
  draw(start)
  window.addEventListener('keydown', key)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
  fade?.cancel()
  window.removeEventListener('keydown', key)
})
</script>

<template>
  <Teleport to="body">
    <div class="module-intro">
      <canvas ref="surface" aria-hidden="true"></canvas>
      <i aria-hidden="true" :style="{ animationDelay: LAUNCH_MS - 300 + 'ms' }"></i>
      <button type="button" @click="done">跳过</button>
    </div>
  </Teleport>
</template>

<style scoped>
.module-intro {
  position: fixed;
  inset: 0;
  z-index: 2100;
  overflow: hidden;
  background: #020618;
}
.module-intro canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.module-intro i {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse, transparent 16%, #0022cc55 78%);
  opacity: 0;
  animation: tint 300ms ease-out both;
  pointer-events: none;
}
@keyframes tint {
  to {
    opacity: 1;
  }
}
.module-intro button {
  position: absolute;
  top: 16px;
  right: 18px;
  padding: 7px 13px;
  border: 1px solid #ffffff55;
  background: #0022cc;
  color: white;
  cursor: pointer;
}
</style>
