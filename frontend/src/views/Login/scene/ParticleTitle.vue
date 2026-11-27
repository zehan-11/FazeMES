<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { mountParticleText } from './particle-text.mjs'
const props = defineProps({
  text: { type: String, required: true },
  compact: Boolean,
  active: { type: Boolean, default: true }
})
const box = ref(null),
  surface = ref(null)
let stop
function paint() {
  stop?.()
  if (props.active && box.value)
    stop = mountParticleText(box.value, surface.value, props.text, props.compact)
}
onMounted(paint)
watch(() => [props.active, props.text], paint, { flush: 'post' })
onBeforeUnmount(() => stop?.())
</script>
<template>
  <span ref="box" class="particle-title" :class="{ 'particle-small': compact }"
    ><span class="type-source">{{ text }}</span
    ><canvas ref="surface" aria-hidden="true"></canvas
  ></span>
</template>
