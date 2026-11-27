<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const canvas = ref<HTMLCanvasElement>()
let dispose: (() => void) | undefined

onMounted(() => {
  const surface = canvas.value!
  const ctx = surface.getContext('2d')
  if (!ctx) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const particles = Array.from({ length: 75 }, (_, i) => ({
    x: Math.random(),
    y: Math.random(),
    radius: 1.2 + Math.random() * 1.4,
    dx: 2 + Math.random() * 5,
    dy: 4 + Math.random() * 7,
    phase: Math.random() * Math.PI * 2,
    rate: 0.55 + Math.random() * 0.6,
    tint: i % 2,
    px: 0,
    py: 0,
    near: 0
  }))
  function sprite(rgb: string, halo = false) {
    const tile = document.createElement('canvas')
    tile.width = tile.height = halo ? 160 : 40
    const c = tile.getContext('2d')!
    const r = tile.width / 2
    const glow = c.createRadialGradient(r, r, 0, r, r, r)
    glow.addColorStop(0, 'rgba(' + rgb + ',' + (halo ? 0.085 : 1) + ')')
    glow.addColorStop(halo ? 0.45 : 0.3, 'rgba(' + rgb + ',' + (halo ? 0.035 : 0.85) + ')')
    glow.addColorStop(0.64, 'rgba(' + rgb + ',' + (halo ? 0.017 : 0.12) + ')')
    glow.addColorStop(1, 'rgba(' + rgb + ',0)')
    c.fillStyle = glow
    c.fillRect(0, 0, tile.width, tile.height)
    return tile
  }
  const sprites = [sprite('56,224,255'), sprite('96,165,250')]
  const halo = sprite('56,224,255', true)
  let width = 0,
    height = 0,
    frame = 0,
    previous = 0,
    seconds = 0
  let visible = false,
    pointing = false,
    mx = 0,
    my = 0
  function draw(dt: number) {
    if (!ctx || !width || !height) return
    seconds += dt
    ctx.clearRect(0, 0, width, height)
    for (const p of particles) {
      p.x = (p.x + (dt * p.dx) / width + 1) % 1
      p.y = (p.y - (dt * p.dy) / height + 1) % 1
      const x = p.x * width,
        y = p.y * height
      const dx = mx - x,
        dy = my - y
      p.near = pointing ? Math.max(0, 1 - Math.hypot(dx, dy) / 140) : 0
      p.px = x + dx * p.near * 0.13
      p.py = y + dy * p.near * 0.13
    }
    if (pointing) ctx.drawImage(halo, mx - 140, my - 140, 280, 280)
    ctx.lineWidth = 0.8
    ctx.strokeStyle = 'rgb(56,210,255)'
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i]
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j]
        const dx = a.px - b.px,
          dy = a.py - b.py,
          d2 = dx * dx + dy * dy
        if (d2 >= 115 * 115) continue
        ctx.globalAlpha = 0.12 * (1 - Math.sqrt(d2) / 115)
        ctx.beginPath()
        ctx.moveTo(a.px, a.py)
        ctx.lineTo(b.px, b.py)
        ctx.stroke()
      }
    }
    for (const p of particles) {
      const size = p.radius * 5
      ctx.globalAlpha = Math.min(
        1,
        0.53 + Math.sin(seconds * p.rate + p.phase) * 0.17 + p.near * 0.42
      )
      ctx.drawImage(sprites[p.tint], p.px - size / 2, p.py - size / 2, size, size)
    }
    ctx.globalAlpha = 1
  }
  const interval = 1000 / 60
  function tick(now: number) {
    const elapsed = now - previous
    if (elapsed >= interval - 0.6) {
      draw(Math.min(elapsed, 50) / 1000)
      previous = now - (Math.max(0, elapsed - interval) % interval)
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
    previous = performance.now()
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
  <canvas ref="canvas" class="ambient-particles" aria-hidden="true"></canvas>
</template>

<style scoped>
.ambient-particles {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
