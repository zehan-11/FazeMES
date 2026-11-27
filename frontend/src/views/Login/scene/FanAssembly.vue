<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, shallowRef, useId } from 'vue'
import GlassLens from './GlassLens.vue'
import { project } from './model.mjs'
import { drawingAmount } from './art-direction.mjs'
import { clamp, durationMs, poseAtTime, rates, reducedPose, timeAtPose } from './motion.mjs'
const assets = shallowRef(null)
const instance = useId()
const rate = ref(1)
const printFilter = 'fan-ink-' + instance.replace(/[^a-zA-Z0-9_-]/g, '')
const props = defineProps({ dark: Boolean, english: Boolean })
const p = ref(0),
  playing = ref(false),
  surface = ref(null),
  scene = computed(() => (assets.value ? project(p.value, assets.value) : null))
const canvas = ref(null),
  threeReady = ref(false)
let renderer = null
watch(
  [p, () => props.dark],
  ([val, night]) => {
    if (threeReady.value) renderer?.update(val, night)
  },
  { flush: 'sync' }
)
const t = (a, b) => (props.english ? b : a)
const reduce = matchMedia('(prefers-reduced-motion: reduce)')
let request = 0,
  dir = 1,
  lastTime = 0,
  touch = null,
  skipClick = 0,
  clock = 0
function stop() {
  playing.value = false
  cancelAnimationFrame(request)
  request = 0
}
function seek(value) {
  p.value = clamp(value)
  clock = timeAtPose(p.value)
}
function advanceTo(now, speed) {
  clock = clamp(clock + (dir * Math.max(0, now - lastTime) * speed) / durationMs)
  lastTime = now
  const pose = poseAtTime(clock)
  p.value = reduce.matches ? reducedPose(pose, p.value, dir) : pose
  if ((dir > 0 && clock === 1) || (dir < 0 && clock === 0)) stop()
}
function tick(now) {
  advanceTo(now, rate.value)
  if (playing.value) request = requestAnimationFrame(tick)
}
function toggle() {
  if (playing.value) {
    advanceTo(performance.now(), rate.value)
    stop()
    return
  }
  if (clock <= 0) dir = 1
  else if (clock >= 1) dir = -1
  lastTime = performance.now()
  playing.value = true
  request = requestAnimationFrame(tick)
}
function setRate(value) {
  if (playing.value) advanceTo(performance.now(), rate.value)
  rate.value = value
}
function scrub(delta) {
  if (!delta) return
  stop()
  dir = Math.sign(delta)
  seek(p.value + delta)
}
function handleWheel(e) {
  if (e.ctrlKey || e.metaKey) return
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? surface.value.clientHeight : 1
  const value = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  if (!value) return
  if ((p.value <= 0 && value < 0) || (p.value >= 1 && value > 0)) {
    stop()
    return
  }
  e.preventDefault()
  scrub(Math.max(-0.13, Math.min(0.13, (value * unit) / 2350)))
}
function handleKey(e) {
  if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault()
    const jump = e.shiftKey ? 0.1 : 0.025
    if (e.key === 'Home' || e.key === 'End') {
      stop()
      seek(e.key === 'Home' ? 0 : 1)
      return
    }
    scrub(['ArrowRight', 'ArrowDown'].includes(e.key) ? jump : -jump)
  }
}
function handleClick(e) {
  if (e.detail > 0 && performance.now() < skipClick) return
  toggle()
}
function touchDown(e) {
  if (e.pointerType === 'mouse' || !e.isPrimary) return
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, start: p.value, drag: false }
}
function touchMove(e) {
  if (!touch || touch.id !== e.pointerId) return
  const dx = e.clientX - touch.x,
    dy = e.clientY - touch.y
  if (!touch.drag) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
    if (Math.abs(dy) > Math.abs(dx)) {
      touch = null
      return
    }
    touch.drag = true
    surface.value.setPointerCapture(e.pointerId)
  }
  const next = Math.max(
    0,
    Math.min(1, touch.start + dx / Math.max(240, surface.value.clientWidth * 0.75))
  )
  scrub(next - p.value)
}
function touchEnd(e) {
  if (touch?.id !== e.pointerId) return
  if (touch.drag) skipClick = performance.now() + 450
  touch = null
}
function touchCancel() {
  touch = null
}
function visibility() {
  if (document.hidden) stop()
}
const showFallback = ref(false)
let setupFrame = 0,
  setupTimer = 0,
  disposed = false
async function showIllustration() {
  threeReady.value = false
  const { default: illustrations } = await import('./pieces.json')
  if (disposed) return
  assets.value = illustrations
  showFallback.value = true
}
async function setupRenderer() {
  try {
    const { createFan } = await import('./fan3d.mjs')
    if (disposed || !canvas.value) return
    renderer = createFan(canvas.value, showIllustration)
    threeReady.value = true
    renderer.update(p.value, props.dark)
  } catch (error) {
    await showIllustration()
    console.warn('Using illustrated rendering', error)
  }
}
onMounted(() => {
  surface.value.addEventListener('wheel', handleWheel, { passive: false })
  document.addEventListener('visibilitychange', visibility)
  setupFrame = requestAnimationFrame(() => {
    setupTimer = setTimeout(setupRenderer, 70)
  })
})
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(setupFrame)
  clearTimeout(setupTimer)
  stop()
  threeReady.value = false
  renderer?.dispose()
  surface.value?.removeEventListener('wheel', handleWheel)
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <div class="fan-stage" :class="{ 'night-studio': props.dark }" :style="{ '--assembly-pose': p }">
    <button
      class="fan glass-window"
      :class="{ 'fan-dark': props.dark }"
      ref="surface"
      type="button"
      :aria-pressed="playing"
      :aria-label="
        t('电风扇装配动画，单击播放或暂停', 'Fan assembly animation, click to play or pause')
      "
      :aria-description="
        t(
          '滚轮或方向键逐步拆解或合拢。触屏可左右滑动。',
          'Use the wheel, arrow keys or a horizontal swipe to scrub.'
        )
      "
      @click="handleClick"
      @keydown="handleKey"
      @pointerdown="touchDown"
      @pointermove="touchMove"
      @pointerup="touchEnd"
      @pointercancel="touchCancel"
    >
      <canvas
        ref="canvas"
        aria-hidden="true"
        :class="{ inactive: !threeReady }"
        :data-renderer="threeReady ? 'three-webgl' : showFallback ? 'illustration' : 'pending'"
      ></canvas
      ><svg
        v-if="showFallback"
        aria-hidden="true"
        viewBox="0 0 1040 600"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter :id="printFilter" color-interpolation-filters="sRGB">
            <feColorMatrix
              type="matrix"
              :values="
                props.dark
                  ? '-.11 -.24 -.04 0 .67  -.12 -.28 -.04 0 .82  -.12 -.29 -.04 0 .89  0 0 0 1 0'
                  : '.229 .55 .073 0 .105  .205 .49 .065 0 .215  .175 .422 .056 0 .332  0 0 0 1 0'
              "
            />
          </filter>
        </defs>
        <g :transform="scene.transform">
          <g
            v-for="q in scene.parts"
            :key="q.key"
            :opacity="q.alpha"
            :transform="'translate(' + q.x + ' ' + q.y + ')'"
          >
            <image :data-part="q.key" :href="assets[q.asset].src" :width="q.w" :height="q.h" />
            <image
              v-if="drawingAmount(q.asset, p) > 0"
              :href="assets[q.asset].src"
              :width="q.w"
              :height="q.h"
              :opacity="drawingAmount(q.asset, p)"
              :filter="'url(#' + printFilter + ')'"
            />
          </g>
        </g></svg
      ><GlassLens rim />
    </button>
    <fieldset class="speed"
      ><legend class="sr-only">{{ t('播放速度', 'Playback speed') }}</legend>
      <span class="speed-label" aria-hidden="true">{{ t('速度', 'Speed') }}</span>
      <label v-for="r in rates" :key="r"
        ><input
          type="radio"
          :name="'fan-rate-' + instance"
          :value="r"
          :checked="rate === r"
          @change="setRate(r)"
        /><span class="glass-control rate"
          ><GlassLens /><span>{{ r }}×</span></span
        ></label
      >
    </fieldset>
  </div>
</template>
<style scoped>
.fan-stage {
  --grid-rgb: 83, 110, 159;
  --speed-bg: #f4f7fd;
  --speed-ink: #324462;
  --active: #2457bf;
  --selected: #fff;
  position: relative;
  isolation: isolate;
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  background: transparent;
  overflow: hidden;
  border-radius: inherit;
}
.night-studio {
  --grid-rgb: 104, 137, 200;
  --speed-bg: #0c1321;
  --speed-ink: #bdcbe3;
  --active: #295dcc;
  --selected: #fff;
}
.fan {
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: block;
  flex: 1;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  touch-action: pan-y pinch-zoom;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
  color: inherit;
}
.fan:focus-visible {
  outline: 2px solid #4a95c2;
  outline-offset: -5px;
}
.fan > canvas,
.fan > svg {
  display: block;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.fan canvas.inactive {
  visibility: hidden;
}
.fan > svg {
  filter: grayscale(0.94) sepia(0.36) hue-rotate(178deg) saturate(1.65);
}
.speed {
  margin: 0;
  padding: 4px;
  position: absolute;
  left: clamp(12px, 3.3%, 32px);
  bottom: clamp(12px, 3.5%, 30px);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid rgba(var(--grid-rgb), 0.52);
  border-radius: 7px;
  background: var(--speed-bg);
  color: var(--speed-ink);
  box-shadow: 0 2px 6px rgba(29, 56, 72, 0.09);
  font:
    500 12px/1.3 system-ui,
    sans-serif;
  font-variant-numeric: tabular-nums;
}
.speed-label {
  padding: 0 9px;
  border-right: 1px solid rgba(var(--grid-rgb), 0.38);
  margin-right: 2px;
}
.speed label {
  cursor: pointer;
  position: relative;
}
.speed label > span {
  display: grid;
  place-items: center;
  min-width: 41px;
  min-height: 31px;
  border-radius: 4px;
}
.speed label:hover > span {
  background: rgba(var(--grid-rgb), 0.14);
}
.speed input:checked + span {
  background: var(--active);
  color: var(--selected);
  font-weight: 700;
}
.speed input:focus-visible + span {
  outline: 2px solid #408bba;
  outline-offset: 1px;
}
.speed input,
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 720px) {
  .fan-stage {
    flex-direction: column;
  }
  .fan {
    width: 100%;
    aspect-ratio: 1.65;
    flex: none;
  }
  .speed {
    position: static;
    align-self: flex-start;
    margin: 0 10px 9px;
  }
  .speed label > span {
    min-width: 45px;
    min-height: 34px;
  }
}
</style>
