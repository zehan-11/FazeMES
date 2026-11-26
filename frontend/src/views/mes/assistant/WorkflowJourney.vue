<template>
  <section
    class="journey"
    :class="{ 'has-trace': run.trace }"
    :style="{ '--accent': station.light }"
    aria-label="问答流程"
  >
    <header class="mast">
      <div class="brand"><i aria-hidden="true"></i>FazeMES <span>/</span> 知识助手</div>
      <span class="origin"><i aria-hidden="true"></i>{{ run.origin }}</span>
    </header>
    <div class="workspace">
      <aside class="console">
        <h2>问答流程</h2>
        <nav class="stations" aria-label="流程阶段">
          <button
            v-for="(s, i) in stations"
            :key="s.id"
            type="button"
            :class="{ current: active === i }"
            :style="{ '--ink': s.light }"
            :aria-current="active === i ? 'step' : undefined"
            @click="go(i)"
          >
            <i aria-hidden="true"></i><b>{{ s.name }}</b
            ><small>{{ s.label }}</small>
          </button>
        </nav>
        <section class="inspector" :aria-label="station.name">
          <div class="section-label">{{ station.label }}</div>
          <template v-if="step && run.trace">
            <h3>{{ step.title }}</h3>
            <p
              >{{ stepStatus(step.status)
              }}<span v-if="step.seconds != null"> · {{ formatElapsed(step.seconds) }}</span></p
            >
            <p v-if="step.type === 'start'">{{ run.question }}</p>
            <template v-if="step.type === 'knowledge-retrieval'">
              <p>返回 {{ run.sources.length }} 条来源片段</p>
              <details v-for="(source, i) in run.sources" :key="i" class="source">
                <summary>[{{ i + 1 }}] {{ source.title }}</summary
                ><p>{{ source.text }}</p>
              </details>
            </template>
            <p v-if="step.type === 'if-else' && run.trace.steps[active + 1]">
              本次进入「{{ run.trace.steps[active + 1].title }}」。
            </p>
            <p v-else-if="step.detail">{{ step.detail }}</p>
            <small>运行 ID · {{ run.trace.runId }}</small>
          </template>
          <template v-else-if="active === 0">
            <h3>{{ run.question }}</h3
            ><p>{{ run.scope }}</p>
          </template>
          <template v-else-if="active === 1">
            <h3>{{ run.sources.length }} 条来源片段</h3>
            <p v-if="!run.sources.length">本条记录没有可展示的来源。</p>
            <details v-for="(source, i) in run.sources" :key="i" class="source">
              <summary
                >[{{ i + 1 }}] {{ source.title }}
                <small v-if="source.page">p. {{ source.page }}</small></summary
              >
              <p>{{ source.text }}</p>
              <button v-if="source.doc" class="link" type="button" @click="$emit('source', source)"
                >打开原文 ↗</button
              >
            </details>
          </template>
          <template v-else-if="active === 2">
            <h3>{{ run.branch }}</h3
            ><p>{{ run.origin === '会话记录' ? '会话返回状态' : '检索返回结果' }}</p>
          </template>
          <template v-else>
            <h3>{{ run.origin === '检索记录' ? '检索结束' : '本次结果' }}</h3>
            <p class="result">{{ run.result }}</p>
            <button v-if="run.sources.length" class="link" type="button" @click="go(1)"
              >核对来源片段 ↗</button
            >
          </template>
        </section>
      </aside>
      <div class="stage">
        <div
          class="travel"
          ref="travel"
          tabindex="0"
          aria-label="流程长带，滚动或使用方向键浏览"
          @scroll.passive="schedule"
          @click="selectBand"
          @keydown.down.prevent="go(active + 1)"
          @keydown.up.prevent="go(active - 1)"
          @keydown.home.prevent="go(0)"
          @keydown.end.prevent="go(last)"
        >
          <div class="screen">
            <canvas ref="canvas" aria-hidden="true"></canvas>
          </div>
          <div class="distance" :style="{ height: last * 100 + '%' }" aria-hidden="true"></div>
        </div>
        <footer>
          <span>{{ run.trace ? `节点 ${active + 1} / ${stations.length}` : '滚动浏览流程' }}</span>
          <div class="meter" aria-hidden="true"
            ><i
              v-for="(s, i) in stations"
              :key="s.id"
              :style="{ background: i <= active ? s.light : undefined }"
            ></i
          ></div>
          <button
            type="button"
            :disabled="active === 0"
            aria-label="上一阶段"
            @click="go(active - 1)"
            >↑</button
          >
          <button
            type="button"
            :disabled="active === last"
            aria-label="下一阶段"
            @click="go(active + 1)"
            >↓</button
          >
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { exampleJourney, type Journey, type JourneySource } from './workflowJourney'
import { journeyStations, paintRunway, stationAt, stepStatus } from './workflowRunway'

const props = defineProps<{ journey?: Journey }>()
defineEmits<{ source: [source: JourneySource] }>()
const run = computed(() => props.journey ?? exampleJourney)
const travel = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const active = ref(0)
const stations = computed(() => journeyStations(run.value))
const last = computed(() => stations.value.length - 1)
const step = computed(() => run.value.trace?.steps[active.value])
const station = computed(() => stations.value[Math.min(active.value, last.value)])
let observer: ResizeObserver | undefined
let frame = 0
let drawnPosition = 0
const motion = window.matchMedia('(prefers-reduced-motion: reduce)')

function formatElapsed(seconds: number) {
  if (seconds > 0 && seconds < 0.001) return '不足 1 毫秒'
  return seconds < 1 ? Math.round(seconds * 1000) + ' 毫秒' : seconds.toFixed(2) + ' 秒'
}
function paint() {
  frame = 0
  const viewport = travel.value
  if (!viewport || !canvas.value) return
  const range = Math.max(1, viewport.scrollHeight - viewport.clientHeight)
  const position = Math.max(0, Math.min(last.value, (last.value * viewport.scrollTop) / range))
  active.value = Math.round(position)
  drawnPosition = motion.matches ? active.value : position
  paintRunway(canvas.value, drawnPosition, run.value, stations.value)
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(paint)
}
function selectBand(event: MouseEvent) {
  if (!canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  const index = stationAt(
    (event.clientX - rect.left) / rect.width,
    (event.clientY - rect.top) / rect.height,
    drawnPosition,
    stations.value.length
  )
  if (index !== undefined) go(index)
}
function go(i: number) {
  const viewport = travel.value
  if (!viewport) return
  viewport.scrollTo({
    top:
      (Math.max(0, Math.min(last.value, i)) / Math.max(1, last.value)) *
      (viewport.scrollHeight - viewport.clientHeight),
    behavior: motion.matches ? 'instant' : 'smooth'
  })
}
watch(run, () => {
  if (travel.value) travel.value.scrollTop = 0
  schedule()
})
onMounted(() => {
  observer = new ResizeObserver(schedule)
  if (canvas.value) observer.observe(canvas.value)
  motion.addEventListener('change', schedule)
  schedule()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  motion.removeEventListener('change', schedule)
  cancelAnimationFrame(frame)
})
</script>

<style scoped>
.journey {
  color-scheme: dark;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  color: #eff3f6;
  background: #101418;
  text-align: left;
  line-height: 1.5;
}
.journey * {
  box-sizing: border-box;
}
.journey button,
.journey summary {
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.journey button:focus-visible,
.journey summary:focus-visible,
.travel:focus-visible {
  outline: 2px solid #fff;
  outline-offset: -3px;
}
.mast {
  height: 60px;
  padding: 0 clamp(16px, 3vw, 42px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #333a41;
}
.brand,
.origin,
.section-label,
.stations small {
  font-family: Consolas, 'Microsoft YaHei', monospace;
}
.brand,
.origin {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.03em;
}
.brand span {
  color: #788492;
}
.brand i {
  width: 17px;
  height: 18px;
  background: repeating-linear-gradient(135deg, #b3f4ce 0 3px, transparent 3px 6px);
}
.origin {
  font-size: 12px;
  border: 1px solid #49545d;
  border-radius: 20px;
  padding: 3px 10px;
}
.origin i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #add3ef;
}
.workspace {
  display: grid;
  grid-template-columns: clamp(260px, 26%, 380px) minmax(0, 1fr);
  height: clamp(420px, 70vh, 850px);
}
.console {
  padding: clamp(18px, 2.6vw, 40px);
  overflow: auto;
  border-right: 1px solid #333a41;
  background: #151a1f;
}
.console h2 {
  font-size: clamp(28px, 3vw, 44px);
  letter-spacing: -0.055em;
  line-height: 1.15;
  margin: 0 0 24px;
  color: #f6f7f9;
  font-weight: 680;
}
.stations {
  display: grid;
  gap: 2px;
}
.stations button {
  background: transparent;
  border: 0;
  padding: 0 9px;
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 8px;
  text-align: left;
  min-height: 44px;
  border-radius: 3px;
}
.stations button.current {
  background: #2a3239;
}
.stations button:hover,
footer button:hover:enabled {
  background: #37414b;
}
.stations b {
  font-size: 14px;
  font-weight: 550;
}
.stations i {
  width: 8px;
  height: 8px;
  border: 1px solid var(--ink);
  border-radius: 50%;
}
.current i {
  background: var(--ink);
  box-shadow: 0 0 0 3px #ffffff12;
}
.stations small,
.section-label {
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--ink);
}
.has-trace .stations {
  max-height: 36vh;
  overflow-y: auto;
}
.has-trace .stations small {
  letter-spacing: 0.03em;
}
.inspector {
  margin-top: clamp(18px, 3vh, 36px);
  padding-top: 20px;
  border-top: 1px solid #3a4249;
  overflow-wrap: anywhere;
}
.section-label {
  color: var(--accent);
}
.inspector h3 {
  color: #f6f7f9;
  margin: 9px 0;
  font-size: clamp(18px, 1.6vw, 25px);
  line-height: 1.5;
  font-weight: 600;
}
.inspector p {
  margin: 8px 0;
  font-size: 14px;
  line-height: 1.75;
  color: #c0cad3;
  white-space: pre-wrap;
}
.source {
  font-size: 14px;
  border-top: 1px solid #3a4249;
}
.source summary {
  padding: 11px 0;
}
.source small {
  color: var(--accent);
  white-space: nowrap;
}
.link {
  border: none;
  padding: 6px 0;
  color: var(--accent) !important;
  background: transparent;
  text-decoration: underline;
  min-height: 40px;
}
.stage {
  display: grid;
  grid-template-rows: minmax(0, 1fr) 55px;
  min-width: 0;
  min-height: 0;
}
.travel {
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #64717d #1e252c;
  overscroll-behavior: contain;
  position: relative;
  touch-action: pan-y;
}
.screen {
  position: sticky;
  top: 0;
  height: 100%;
  pointer-events: none;
}
.screen canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.distance {
  height: 300%;
  pointer-events: none;
}
footer {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 16px;
  border-top: 1px solid #333a41;
}
footer span {
  color: #b5bfc7;
  font-size: 12px;
}
.meter {
  margin-right: auto;
  display: flex;
  gap: 3px;
}
.meter i {
  height: 3px;
  width: 14px;
  background: #343e47;
}
footer button {
  background: #202830;
  border: 1px solid #46515c;
  width: 44px;
  height: 40px;
  border-radius: 4px;
}
footer button:disabled {
  opacity: 0.4;
  cursor: default;
}
@media (max-width: 760px) {
  .mast {
    height: 44px;
  }
  .workspace {
    height: auto;
    display: flex;
    flex-direction: column;
  }
  .console {
    display: contents;
  }
  .console h2 {
    font-size: 26px;
    padding: 12px 16px 4px;
    margin: 0;
  }
  .stations {
    display: flex;
    padding: 3px 8px;
    justify-content: space-around;
  }
  .has-trace .stations {
    justify-content: flex-start;
    flex-wrap: wrap;
    max-height: 16vh;
    gap: 2px 7px;
  }
  .has-trace .stations button {
    white-space: nowrap;
  }
  .stations button {
    display: flex;
    gap: 5px;
    padding: 4px;
    min-height: 44px;
  }
  .stations b {
    font-size: 13px;
  }
  .stations small {
    display: none;
  }
  .stage {
    order: 2;
    height: clamp(235px, 42vh, 400px);
    grid-template-rows: minmax(0, 1fr) 46px;
  }
  .inspector {
    order: 3;
    margin: 0;
    padding: 12px 16px;
    max-height: 32vh;
    overflow: auto;
  }
}
</style>
