<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'

// The displacement map encodes the curved lip of a lens in its red/green
// channels. Neutral pixels in the middle leave text and icons undisturbed.
const props = defineProps({ rim: Boolean })
const host = ref(null),
  map = ref(''),
  power = ref(10)
const id = 'mes-glass-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
const lensStyle = computed(() => (map.value ? { '--glass-refraction': 'url("#' + id + '")' } : {}))
let observer
function updateMap() {
  const element = host.value
  if (!element) return
  const w = element.clientWidth,
    h = element.clientHeight
  if (!w || !h) return
  const factor = Math.min(1, 240 / w, 76 / h)
  const width = Math.max(2, Math.round(w * factor)),
    height = Math.max(2, Math.round(h * factor))
  const declared = parseFloat(getComputedStyle(element.parentElement).borderTopLeftRadius)
  const radius = Math.max(1, Math.min(width / 2, height / 2, (declared || h / 2) * factor))
  const lip = Math.max(1.3, Math.min(5, height * 0.14))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pixels = ctx.createImageData(width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - width / 2,
        py = y + 0.5 - height / 2
      const qx = Math.abs(px) - (width / 2 - radius),
        qy = Math.abs(py) - (height / 2 - radius)
      const nx = Math.max(0, qx),
        ny = Math.max(0, qy),
        length = Math.hypot(nx, ny)
      const inside = radius - (length + Math.min(Math.max(qx, qy), 0))
      const t = Math.max(0, Math.min(1, inside / lip))
      const curve = inside < 0 ? 0 : Math.pow(1 - t, 1.6)
      const dx = length ? nx / length : Number(qx >= qy),
        dy = length ? ny / length : Number(qy > qx)
      const i = (y * width + x) * 4
      pixels.data[i] = 128 + Math.round(116 * curve * dx * Math.sign(px))
      pixels.data[i + 1] = 128 + Math.round(116 * curve * dy * Math.sign(py))
      pixels.data[i + 2] = 128
      pixels.data[i + 3] = 255
    }
  ctx.putImageData(pixels, 0, 0)
  power.value = Math.min(20, Math.max(7, h * 0.32))
  map.value = canvas.toDataURL()
}
onMounted(() => {
  if (props.rim || !CSS.supports('backdrop-filter', 'url("#test")')) return
  observer = new ResizeObserver(updateMap)
  observer.observe(host.value)
  updateMap()
})
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <span
    ref="host"
    aria-hidden="true"
    class="glass-lens"
    :class="{ 'glass-rim': rim }"
    :style="lensStyle"
  >
    <svg v-if="map" class="lens-defs" width="0" height="0" focusable="false">
      <defs>
        <filter
          :id="id"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          color-interpolation-filters="sRGB"
        >
          <feImage
            :href="map"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="normal"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="normal"
            :scale="-power"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
    <span class="lens-sample"></span>
  </span>
</template>
