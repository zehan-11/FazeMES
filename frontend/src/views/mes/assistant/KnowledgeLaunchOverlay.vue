<template>
  <Teleport to="body">
    <Transition name="faze-launch-fade">
      <div
        v-if="visible"
        class="launch-overlay"
        role="status"
        aria-live="polite"
        aria-label="正在启动 AI 助手与知识库"
      >
        <canvas ref="canvasRef" class="launch-canvas"></canvas>

        <!-- 顶部克莱因蓝栏（复刻视频顶部视觉锚点） -->
        <header class="launch-topbar">
          <div class="launch-brand">
            <span class="brand-badge">FAZEMES</span>
            <span class="brand-name">AI 助手与知识库</span>
          </div>
          <div class="launch-top-right">
            <span class="launch-status">{{ statusText }}</span>
            <button type="button" class="launch-skip-btn" @click="finish">跳过</button>
          </div>
        </header>

        <!-- 顶部 2px 扫光细进度条 -->
        <div class="launch-progress-track">
          <div class="launch-progress-fill" :style="{ width: `${progressPercent}%` }"></div>
        </div>

        <!-- 收尾阶段右侧克莱因蓝预览滑入条（与图谱右侧栏方位呼应） -->
        <aside class="launch-right-ribbon" :class="{ 'is-shown': ribbonShown }">
          <span class="ribbon-tag">KNOWLEDGE ENGINE</span>
          <div class="ribbon-title">FazeGraph</div>
          <ul class="ribbon-list">
            <li v-for="(item, idx) in RIBBON_ITEMS" :key="item.label">
              <span class="ribbon-num">{{ String(idx + 1).padStart(2, '0') }}</span>
              <span class="ribbon-label">{{ item.label }}</span>
              <span class="ribbon-count">{{ item.count }}</span>
            </li>
          </ul>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 后端初始化是否已完成（用于状态文案反馈，不会阻塞动画结束） */
    ready?: boolean
    /** 动画总时长（毫秒） */
    durationMs?: number
  }>(),
  {
    ready: false,
    durationMs: 1950
  }
)

const emit = defineEmits<{
  finish: []
}>()

const canvasRef = ref<HTMLCanvasElement>()
const visible = ref(false)
const progress = ref(0)
const ribbonShown = ref(false)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

interface LeafSpec {
  angleOffset: number
  distRatio: number
  isCard: boolean
  iconType: number
  delay: number
}

interface ClusterSpec {
  label: string
  count: number
  color: string
  angle: number
  radiusRatio: number
  squareSize: number
  launchDelay: number
  bloomStart: number
  leaves: LeafSpec[]
}

const RIBBON_ITEMS = [
  { label: '设备资产', count: 16 },
  { label: '核心部件', count: 28 },
  { label: '工艺路线', count: 19 },
  { label: '故障现象', count: 34 },
  { label: '故障原因', count: 24 },
  { label: '维护措施', count: 31 }
]

const CLUSTER_PRESETS: Array<{
  label: string
  count: number
  color: string
  angleDeg: number
  radiusRatio: number
  squareSize: number
  launchDelay: number
  bloomStart: number
}> = [
  { label: '设备', count: 16, color: '#5B8CFF', angleDeg: -82, radiusRatio: 0.31, squareSize: 22, launchDelay: 0.0, bloomStart: 0.28 },
  { label: '部件', count: 28, color: '#38BDF8', angleDeg: -38, radiusRatio: 0.34, squareSize: 20, launchDelay: 0.03, bloomStart: 0.32 },
  { label: '工艺', count: 19, color: '#34D399', angleDeg: 10, radiusRatio: 0.32, squareSize: 18, launchDelay: 0.06, bloomStart: 0.36 },
  { label: '措施', count: 31, color: '#2DD4BF', angleDeg: 52, radiusRatio: 0.28, squareSize: 15, launchDelay: 0.09, bloomStart: 0.41 },
  { label: '原因', count: 24, color: '#818CF8', angleDeg: 95, radiusRatio: 0.34, squareSize: 21, launchDelay: 0.12, bloomStart: 0.45 },
  { label: '故障', count: 34, color: '#F472B6', angleDeg: 146, radiusRatio: 0.32, squareSize: 24, launchDelay: 0.14, bloomStart: 0.48 },
  { label: '手册', count: 14, color: '#60A5FA', angleDeg: -162, radiusRatio: 0.33, squareSize: 17, launchDelay: 0.16, bloomStart: 0.51 },
  { label: '规则库', count: 12, color: '#FBBF24', angleDeg: -124, radiusRatio: 0.25, squareSize: 26, launchDelay: 0.04, bloomStart: 0.39 }
]

const CROSS_LINKS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 0],
  [0, 2],
  [1, 4],
  [5, 7]
]

let clusters: ClusterSpec[] = []
let stars: Array<{ x: number; y: number; alpha: number; size: number }> = []
let rafId = 0
let startTime = 0

const progressPercent = computed(() => Math.min(100, Math.round(progress.value * 100)))
const statusText = computed(() => {
  if (progress.value < 0.28) return '正在初始化知识图谱引擎…'
  if (progress.value < 0.72) return '正在展开实体与语义索引…'
  return props.ready ? 'AI 助手与知识库已就绪' : '正在接入工作台…'
})

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 4)
}

function hash01(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return s - Math.floor(s)
}

function buildScene(width: number, height: number) {
  stars = Array.from({ length: 110 }, (_, i) => ({
    x: hash01(i * 3.1 + 1) * width,
    y: hash01(i * 5.7 + 2) * height,
    alpha: 0.14 + (i % 6) * 0.028,
    size: i % 8 === 0 ? 1.5 : 1
  }))

  clusters = CLUSTER_PRESETS.map((preset, cIdx) => {
    const leafCount = 13 + (cIdx % 4) * 2
    const leaves: LeafSpec[] = Array.from({ length: leafCount }, (_, j) => {
      const seed = hash01(cIdx * 97 + j * 13 + 7)
      const spread = (j / leafCount) * Math.PI * 2 + (seed - 0.5) * 0.25
      return {
        angleOffset: spread,
        distRatio: 0.085 + (j % 3) * 0.032 + seed * 0.035,
        isCard: j % 4 === 0,
        iconType: (cIdx + j) % 4,
        delay: (j % 5) * 0.03
      }
    })
    return {
      label: preset.label,
      count: preset.count,
      color: preset.color,
      angle: (preset.angleDeg * Math.PI) / 180,
      radiusRatio: preset.radiusRatio,
      squareSize: preset.squareSize,
      launchDelay: preset.launchDelay,
      bloomStart: preset.bloomStart,
      leaves
    }
  })
}

function drawMicroCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  iconType: number,
  alpha: number
) {
  const w = 13 * scale
  const h = 10 * scale
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = '#071130'
  ctx.strokeStyle = 'rgba(175, 206, 255, 0.82)'
  ctx.lineWidth = 0.9
  ctx.fillRect(x - w / 2, y - h / 2, w, h)
  ctx.strokeRect(x - w / 2, y - h / 2, w, h)

  ctx.beginPath()
  ctx.strokeStyle = 'rgba(225, 238, 255, 0.85)'
  ctx.lineWidth = 0.8
  if (iconType === 0) {
    ctx.moveTo(x - w * 0.26, y - h * 0.14)
    ctx.lineTo(x + w * 0.26, y - h * 0.14)
    ctx.moveTo(x - w * 0.26, y + h * 0.16)
    ctx.lineTo(x + w * 0.12, y + h * 0.16)
  } else if (iconType === 1) {
    ctx.arc(x, y, Math.max(1.2, h * 0.24), 0, Math.PI * 2)
  } else if (iconType === 2) {
    ctx.strokeRect(x - w * 0.22, y - h * 0.22, w * 0.44, h * 0.44)
  } else {
    ctx.moveTo(x - w * 0.25, y + h * 0.18)
    ctx.lineTo(x, y - h * 0.22)
    ctx.lineTo(x + w * 0.25, y + h * 0.18)
  }
  ctx.stroke()
  ctx.restore()
}

function drawFrame(now: number) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) {
    rafId = requestAnimationFrame(drawFrame)
    return
  }

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    buildScene(width, height)
  }

  const total = reducedMotion.matches ? 420 : props.durationMs
  const t = clamp01((now - startTime) / total)
  progress.value = t
  ribbonShown.value = t >= 0.72 && t < 0.96

  // 退场阶段：轻微推近并淡出，平滑揭开工作台
  const exitT = clamp01((t - 0.84) / 0.16)
  const sceneScale = 1 + easeOutQuart(exitT) * 0.06
  const sceneAlpha = 1 - easeOutQuart(exitT)
  // 右侧栏滑入时画布中心轻度左移避让
  const shiftX = -easeOutQuart(clamp01((t - 0.7) / 0.18)) * Math.min(72, width * 0.06)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#020618'
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.globalAlpha = sceneAlpha

  // 1. 静态微星点
  for (const s of stars) {
    ctx.fillStyle = `rgba(186, 208, 255, ${s.alpha})`
    ctx.fillRect(s.x, s.y, s.size, s.size)
  }

  const cx = width / 2 + shiftX
  const cy = (height + 44) / 2
  const span = Math.min(width * 0.92, height * 1.05)

  ctx.translate(cx, cy)
  ctx.scale(sceneScale, sceneScale)

  // 2. 中心细线空心圆环
  const ringAlpha = clamp01((t - 0.08) / 0.14)
  const ringRadius = 7.5 + easeOutQuart(clamp01((t - 0.1) / 0.25)) * 2.5
  if (ringAlpha > 0) {
    ctx.beginPath()
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(130, 162, 245, ${0.78 * ringAlpha})`
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  // 计算各主簇实时坐标
  const hubCoords: Array<{ x: number; y: number; launchP: number; bloomP: number }> = clusters.map(
    (c) => {
      const launchP = easeOutExpo(clamp01((t - (0.12 + c.launchDelay)) / 0.28))
      const bloomP = clamp01((t - c.bloomStart) / 0.3)
      const dist = span * c.radiusRatio * launchP
      return {
        x: Math.cos(c.angle) * dist,
        y: Math.sin(c.angle) * dist,
        launchP,
        bloomP
      }
    }
  )

  // 3. 阶段四：跨簇极细关联线织网
  const crossAlpha = easeOutQuart(clamp01((t - 0.62) / 0.18))
  if (crossAlpha > 0.01) {
    ctx.strokeStyle = `rgba(126, 164, 245, ${0.15 * crossAlpha})`
    ctx.lineWidth = 0.85
    for (const [a, b] of CROSS_LINKS) {
      const ha = hubCoords[a]
      const hb = hubCoords[b]
      if (!ha || !hb) continue
      ctx.beginPath()
      ctx.moveTo(ha.x, ha.y)
      ctx.lineTo(hb.x, hb.y)
      ctx.stroke()
    }
  }

  // 4. 逐簇绘制：中心射出主干线 -> #5B6BFF 蓝紫方块 -> 蒲公英二级绽放
  clusters.forEach((cluster, idx) => {
    const state = hubCoords[idx]
    if (state.launchP <= 0.002) return

    // 中心空心环 -> 一级主干极细直线
    const len = Math.hypot(state.x, state.y)
    if (len > ringRadius) {
      ctx.beginPath()
      ctx.moveTo((state.x / len) * ringRadius, (state.y / len) * ringRadius)
      ctx.lineTo(state.x, state.y)
      ctx.strokeStyle = `rgba(124, 158, 240, ${0.26 + (1 - state.bloomP) * 0.22})`
      ctx.lineWidth = 0.95
      ctx.stroke()
    }

    // 二级蒲公英分支放射展开
    if (state.bloomP > 0.005) {
      for (const leaf of cluster.leaves) {
        const lp = easeOutQuart(clamp01((state.bloomP - leaf.delay) / (1 - leaf.delay)))
        if (lp <= 0.005) continue
        const lDist = span * leaf.distRatio * lp
        const lx = state.x + Math.cos(leaf.angleOffset) * lDist
        const ly = state.y + Math.sin(leaf.angleOffset) * lDist

        ctx.beginPath()
        ctx.moveTo(state.x, state.y)
        ctx.lineTo(lx, ly)
        ctx.strokeStyle = `rgba(130, 170, 255, ${0.28 * lp})`
        ctx.lineWidth = 0.85
        ctx.stroke()

        if (leaf.isCard) {
          drawMicroCard(ctx, lx, ly, lp, leaf.iconType, lp)
        } else {
          ctx.beginPath()
          ctx.arc(lx, ly, 2 * lp, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(218, 234, 255, ${0.9 * lp})`
          ctx.fill()
        }
      }
    }

    // 一级主干本体：先是锐利 #5B6BFF 蓝紫实心方块，绽放时平滑蜕变为彩色核心圆点 + 标签计数
    const morph = easeOutQuart(clamp01(state.bloomP / 0.45))
    if (morph < 0.99) {
      const sz = cluster.squareSize * (0.4 + 0.6 * state.launchP) * (1 - morph * 0.55)
      ctx.fillStyle = `rgba(91, 107, 255, ${(1 - morph) * 0.96})`
      ctx.fillRect(state.x - sz / 2, state.y - sz / 2, sz, sz)
    }

    if (morph > 0.02) {
      ctx.save()
      ctx.globalAlpha = sceneAlpha * morph
      ctx.beginPath()
      ctx.arc(state.x, state.y, 8.5, 0, Math.PI * 2)
      ctx.strokeStyle = `${cluster.color}55`
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(state.x, state.y, 4.4, 0, Math.PI * 2)
      ctx.fillStyle = cluster.color
      ctx.fill()

      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.fillStyle = '#F2F6FF'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(cluster.label, state.x + 11, state.y)

      const labelW = ctx.measureText(cluster.label).width
      ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.fillStyle = 'rgba(182, 206, 255, 0.78)'
      ctx.fillText(String(cluster.count), state.x + 15 + labelW, state.y - 3)
      ctx.restore()
    }
  })

  ctx.restore()

  if (t >= 1) {
    finish()
    return
  }
  rafId = requestAnimationFrame(drawFrame)
}

function replay() {
  cancelAnimationFrame(rafId)
  visible.value = true
  progress.value = 0
  ribbonShown.value = false
  startTime = performance.now()
  rafId = requestAnimationFrame(drawFrame)
}

function finish() {
  cancelAnimationFrame(rafId)
  visible.value = false
  ribbonShown.value = false
  emit('finish')
}

function onKeyDown(e: KeyboardEvent) {
  if (visible.value && e.key === 'Escape') finish()
}

defineExpose({ replay })

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  replay()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.launch-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #020618;
  box-shadow: inset 0 0 0 4px #0022cc;
  overflow: hidden;
  user-select: none;
}

.launch-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.launch-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0022cc;
  color: #ffffff;
}

.launch-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-badge {
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  background: rgba(2, 6, 24, 0.35);
}

.brand-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.launch-top-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.launch-status {
  font-size: 12px;
  color: rgba(232, 240, 255, 0.86);
}

.launch-skip-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: #ffffff;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.34);
  transition: background-color 150ms ease;
}

.launch-skip-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

.launch-progress-track {
  position: absolute;
  top: 44px;
  left: 0;
  right: 0;
  height: 2px;
  background: rgba(255, 255, 255, 0.1);
}

.launch-progress-fill {
  height: 100%;
  background: #7aa8ff;
  transition: width 50ms linear;
}

.launch-right-ribbon {
  position: absolute;
  top: 46px;
  right: 4px;
  bottom: 4px;
  width: 248px;
  padding: 20px 18px;
  color: #ffffff;
  background: #0022cc;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
  transform: translateX(104%);
  transition: transform 380ms cubic-bezier(0.16, 1, 0.3, 1);
}

.launch-right-ribbon.is-shown {
  transform: translateX(0);
}

.ribbon-tag {
  display: block;
  margin-bottom: 6px;
  font-size: 10px;
  letter-spacing: 0.16em;
  color: rgba(255, 255, 255, 0.72);
}

.ribbon-title {
  margin-bottom: 18px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.ribbon-list {
  padding: 0;
  margin: 0;
  list-style: none;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
}

.ribbon-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  font-size: 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
}

.ribbon-num {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.62);
  font-variant-numeric: tabular-nums;
}

.ribbon-label {
  flex: 1;
}

.ribbon-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.86);
  font-variant-numeric: tabular-nums;
}

.faze-launch-fade-leave-active {
  transition: opacity 280ms ease;
}

.faze-launch-fade-leave-to {
  opacity: 0;
}

@media (width <= 768px) {
  .launch-right-ribbon,
  .launch-status {
    display: none;
  }
}
</style>