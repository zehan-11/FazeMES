<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { mountSplash } from './splash-cursor.mjs'
import { drawAirflow } from './fluid-plate.mjs'
const props = defineProps({ dark: Boolean })
const plate = ref(null),
  ink = ref(null)
let observer, media, stop, frame, timer
let first = true
function repaint() {
  if (plate.value) drawAirflow(plate.value, props.dark)
}
function resetInk() {
  cancelAnimationFrame(frame)
  clearTimeout(timer)
  stop?.()
  stop = undefined
  if (ink.value && !media?.matches) {
    frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        stop = mountSplash(ink.value, props.dark, resetInk, first)
        first = false
      }, 100)
    })
  } else first = false
}
onMounted(() => {
  media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', resetInk)
  observer = new ResizeObserver(repaint)
  observer.observe(plate.value)
  repaint()
  resetInk()
})
watch(
  () => props.dark,
  () => {
    repaint()
    resetInk()
  },
  { flush: 'post' }
)
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  clearTimeout(timer)
  observer?.disconnect()
  media?.removeEventListener('change', resetInk)
  stop?.()
})
</script>
<template>
  <div class="fluid-backdrop" aria-hidden="true"
    ><canvas class="flow-paper" ref="plate"></canvas><canvas class="flow-ink" ref="ink"></canvas
  ></div>
</template>
