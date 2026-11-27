<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createAmbientField } from './ambientField'

const canvas = ref<HTMLCanvasElement>()
let dispose: (() => void) | undefined

onMounted(() => {
  const surface = canvas.value!
  const ctx = surface.getContext('2d')
  if (!ctx) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const field = createAmbientField(ctx)
  let width = 0
  let height = 0
  let frame = 0
  let lastPaint = 0
  let nextPaint = 0
  let visible = false
  const interval = 1000 / 60
  function tick(now: number) {
    if (now + 0.6 >= nextPaint) {
      field.draw(width, height, Math.min(now - lastPaint, 50) / 1000)
      lastPaint = now
      nextPaint = Math.max(nextPaint + interval, now)
    }
    frame = requestAnimationFrame(tick)
  }
  function move(event: PointerEvent) {
    if (event.pointerType === 'touch') clearPointer()
    else field.point(event.clientX, event.clientY)
  }
  function clearPointer() {
    field.release()
  }
  function leave(event: PointerEvent) {
    if (!event.relatedTarget) clearPointer()
  }
  function sleep() {
    cancelAnimationFrame(frame)
    frame = 0
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerout', leave)
    window.removeEventListener('pointercancel', clearPointer)
    window.removeEventListener('blur', clearPointer)
    clearPointer()
  }
  function sync() {
    sleep()
    if (!visible || document.hidden || !width || !height) return
    field.draw(width, height, 0)
    if (reduced.matches) return
    lastPaint = performance.now()
    nextPaint = lastPaint + interval
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerout', leave)
    window.addEventListener('pointercancel', clearPointer)
    window.addEventListener('blur', clearPointer)
    frame = requestAnimationFrame(tick)
  }
  const resize = new ResizeObserver(() => {
    width = surface.clientWidth
    height = surface.clientHeight
    const dpr = Math.min(devicePixelRatio || 1, 1.5)
    surface.width = Math.round(width * dpr)
    surface.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    sync()
  })
  // The layout hides this canvas when the graph or production screen owns the viewport.
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    sync()
  })
  resize.observe(surface)
  observer.observe(surface)
  document.addEventListener('visibilitychange', sync)
  reduced.addEventListener('change', sync)
  dispose = () => {
    sleep()
    resize.disconnect()
    observer.disconnect()
    document.removeEventListener('visibilitychange', sync)
    reduced.removeEventListener('change', sync)
  }
})
onBeforeUnmount(() => dispose?.())
</script>

<template>
  <div class="fazemes-ambient-backdrop" aria-hidden="true">
    <canvas ref="canvas" class="ambient-particles"></canvas>
  </div>
</template>

<style scoped>
.ambient-particles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
