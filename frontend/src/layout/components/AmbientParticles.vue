<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const canvas = ref<HTMLCanvasElement>()
let dispose: (() => void) | undefined

onMounted(() => {
  const surface = canvas.value!
  const ctx = surface.getContext('2d')
  if (!ctx) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  // Most new particles rise near the edges, leaving the reading area quiet.
  function lane(index: number) {
    const x = Math.random()
    if (index % 3 === 0) return x
    return index % 3 === 1 ? x * 0.22 : 1 - x * 0.22
  }
  const particles = Array.from({ length: 66 }, (_, i) => ({
    x: lane(i),
    y: Math.random(),
    radius: 1.2 + Math.random() * 2,
    speed: 12 + Math.random() * 14,
    sway: 4 + Math.random() * 10,
    phase: Math.random() * Math.PI * 2,
    rate: 0.4 + Math.random() * 0.55
  }))
  // Paint the core and soft halo once. Each particle is one image draw per frame.
  function sprite(tint: string) {
    const tile = document.createElement('canvas')
    tile.width = tile.height = 48
    const brush = tile.getContext('2d')!
    const r = tile.width / 2
    const glow = brush.createRadialGradient(r, r, 0, r, r, r)
    glow.addColorStop(0, '#f5fdff')
    glow.addColorStop(0.15, '#defaff')
    glow.addColorStop(0.29, `rgba(${tint},0.8)`)
    glow.addColorStop(0.52, `rgba(${tint},0.19)`)
    glow.addColorStop(1, `rgba(${tint},0)`)
    brush.fillStyle = glow
    brush.fillRect(0, 0, tile.width, tile.height)
    return tile
  }
  const sprites = [sprite('100,228,255'), sprite('125,177,255')]
  let width = 0
  let height = 0
  let frame = 0
  let lastPaint = 0
  let nextPaint = 0
  let seconds = 0
  let visible = false
  let pointing = false
  let mx = 0
  let my = 0

  function draw(dt: number) {
    if (!ctx || !width || !height) return
    seconds += dt
    ctx.clearRect(0, 0, width, height)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const phase = seconds * p.rate + p.phase
      const x = p.x * width + Math.sin(phase * 0.55) * p.sway
      const y = p.y * height
      const near = pointing ? Math.max(0, 1 - Math.hypot(mx - x, my - y) / 140) : 0
      const fade = Math.min(1, p.y / 0.07, (1 - p.y) / 0.05)
      const size = p.radius * 5
      ctx.globalAlpha = Math.min(1, 0.59 + Math.sin(phase) * 0.14 + near * 0.29) * fade
      ctx.drawImage(sprites[i % 2], x - size / 2, y - size / 2, size, size)
      p.y -= (dt * p.speed * (1 + near * 0.55)) / height
      if (p.y <= 0) {
        p.y = 1
        p.x = lane(i)
      }
    }
    ctx.globalAlpha = 1
  }
  const interval = 1000 / 60
  function tick(now: number) {
    if (now + 0.6 >= nextPaint) {
      draw(Math.min(now - lastPaint, 50) / 1000)
      lastPaint = now
      nextPaint = Math.max(nextPaint + interval, now)
    }
    frame = requestAnimationFrame(tick)
  }
  function move(event: PointerEvent) {
    pointing = event.pointerType !== 'touch'
    mx = event.clientX
    my = event.clientY
  }
  function clearPointer() {
    pointing = false
  }
  function leave(event: PointerEvent) {
    if (!event.relatedTarget) clearPointer()
  }
  function sleep() {
    cancelAnimationFrame(frame)
    frame = 0
    window.removeEventListener('pointermove', move)
    clearPointer()
  }
  function sync() {
    sleep()
    if (!visible || document.hidden || !width || !height) return
    draw(0)
    if (reduced.matches) return
    lastPaint = performance.now()
    nextPaint = lastPaint + interval
    window.addEventListener('pointermove', move, { passive: true })
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
  window.addEventListener('pointerout', leave)
  window.addEventListener('blur', clearPointer)
  dispose = () => {
    sleep()
    resize.disconnect()
    observer.disconnect()
    document.removeEventListener('visibilitychange', sync)
    reduced.removeEventListener('change', sync)
    window.removeEventListener('pointerout', leave)
    window.removeEventListener('blur', clearPointer)
  }
})
onBeforeUnmount(() => dispose?.())
</script>

<template>
  <div class="fazemes-ambient-backdrop" aria-hidden="true">
    <div class="ambient-floor"></div>
    <canvas ref="canvas" class="ambient-particles"></canvas>
    <div class="ambient-stars"><i v-for="star in 5" :key="star"></i></div>
  </div>
</template>

<style scoped>
.ambient-particles,
.ambient-stars {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
