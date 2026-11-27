<script setup lang="ts">
import particleFan from './particle-fan.webp'

const props = defineProps<{ destination: HTMLElement | null }>()
const emit = defineEmits<{ enter: []; finish: [focusForm: boolean] }>()
const layer = ref<HTMLElement>()
const image = ref<HTMLImageElement>()
const reduce = matchMedia('(prefers-reduced-motion: reduce)')
let raf = 0
let deadline = 0
let entered = false
let done = false
const duration = 4520
function ease(from: number, to: number, value: number) {
  const u = Math.max(0, Math.min(1, (value - from) / (to - from)))
  return u * u * (3 - 2 * u)
}
function enter() {
  if (!entered) {
    entered = true
    emit('enter')
  }
}
function finish(focusForm = false) {
  if (done) return
  done = true
  cancelAnimationFrame(raf)
  clearTimeout(deadline)
  enter()
  emit('finish', focusForm)
}
function skipKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' && event.key !== 'Tab') return
  event.preventDefault()
  finish(event.key === 'Tab')
}
function visibility() {
  if (document.hidden || reduce.matches) finish()
}
function play() {
  if (done || !image.value || !layer.value) return
  const start = performance.now()
  const draw = (now: number) => {
    if (!image.value || !layer.value || done) return
    const t = (now - start) / 1000
    if (t >= duration / 1000) {
      finish()
      return
    }
    const w = layer.value.clientWidth,
      h = layer.value.clientHeight
    const to = props.destination?.getBoundingClientRect()
    const dock = ease(3.21, 4.2, t)
    const width = w + ((to?.width ?? w) - w) * dock
    const height = h + ((to?.height ?? h) - h) * dock
    const iw = Math.min(height * 1.6, width * 1.735)
    const bias = (1 - ease(0.76, 1.28, width / height)) * 0.0518 * iw
    const targetX = to ? to.left + to.width / 2 : w / 2
    const targetY = to ? to.top + to.height / 2 : h / 2
    image.value.style.width = iw + 'px'
    image.value.style.left = w / 2 + (targetX - w / 2) * dock + bias + 'px'
    image.value.style.top = h / 2 + (targetY - h / 2) * dock + 'px'
    image.value.style.opacity = String(1 - ease(3.77, 4.45, t))
    layer.value.style.backgroundColor = 'rgba(1,3,8,' + (1 - ease(3.21, 4.16, t)) + ')'
    if (t >= 3.21) enter()
    raf = requestAnimationFrame(draw)
  }
  draw(start)
}
onMounted(() => {
  if (reduce.matches || document.hidden) {
    finish()
    return
  }
  document.addEventListener('keydown', skipKey)
  document.addEventListener('visibilitychange', visibility)
  reduce.addEventListener('change', visibility)
  deadline = window.setTimeout(() => finish(), duration + 180)
  play()
})
onBeforeUnmount(() => {
  done = true
  cancelAnimationFrame(raf)
  clearTimeout(deadline)
  document.removeEventListener('keydown', skipKey)
  document.removeEventListener('visibilitychange', visibility)
  reduce.removeEventListener('change', visibility)
})
</script>
<template>
  <div ref="layer" class="mes-opening" aria-hidden="true">
    <img ref="image" :src="particleFan" alt="" fetchpriority="high" @error="finish()" />
  </div>
</template>
<style scoped>
.mes-opening {
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  background: #010308;
  pointer-events: auto;
  mix-blend-mode: screen;
}
.mes-opening img {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(160vh, 173.5vw);
  max-width: none;
  height: auto;
  transform: translate(-50%, -50%);
  mix-blend-mode: screen;
  pointer-events: none;
}
</style>
