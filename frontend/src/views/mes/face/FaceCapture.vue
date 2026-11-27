<script setup lang="ts">
import { createFaceCamera, type CameraState } from './faceCamera'
const props = withDefaults(
  defineProps<{
    active?: boolean
    disabled?: boolean
    captureLabel?: string
    processing?: boolean
    failed?: boolean
    confirmed?: boolean
  }>(),
  { active: true, disabled: false, captureLabel: '采集当前画面' }
)
const emit = defineEmits<{ capture: [image: string]; start: [] }>()
const video = ref<HTMLVideoElement>()
const state = ref<CameraState>({
  ready: false,
  loading: false,
  message: '点击开启摄像头后，仅在本机核验画面'
})
const camera = createFaceCamera(
  () => video.value,
  (value) => {
    state.value = value
  }
)
const startPreview = () => {
  emit('start')
  return camera.start()
}
const capture = () => {
  try {
    emit('capture', camera.capture())
  } catch (error) {
    state.value.message = (error as Error).message
  }
}
watch(
  () => props.active,
  (value) => {
    if (!value) camera.stop()
  }
)
onDeactivated(camera.stop)
onBeforeUnmount(camera.dispose)
defineExpose({ stop: camera.stop })
</script>
<template>
  <div
    class="face-capture"
    :class="{ 'is-live': state.ready, 'is-processing': processing, 'is-confirmed': confirmed }"
  >
    <div v-tech-card class="camera-frame fm-hud fm-auto-scan" :class="{ 'fm-invalid': failed }"
      ><video ref="video" autoplay playsinline muted aria-label="本人人脸摄像头预览"></video
      ><span class="face-guide" aria-hidden="true"></span
    ></div>
    <p role="status">{{ state.message }}</p>
    <div class="capture-actions">
      <el-button
        :loading="state.loading"
        :disabled="!active || disabled || state.loading"
        :type="state.ready ? undefined : 'primary'"
        @click="startPreview"
        >开启摄像头</el-button
      >
      <el-button type="primary" :disabled="!active || !state.ready || disabled" @click="capture">{{
        captureLabel
      }}</el-button>
      <el-button @click="camera.stop()">关闭摄像头</el-button>
    </div>
  </div>
</template>
<style scoped>
.face-capture {
  --ring: #5cebff;
  --ring-inner: color-mix(in srgb, var(--ring) 68%, white);
  --outer-speed: 26s;
  --inner-speed: 23s;
  --sweep-speed: 6.5s;
  min-width: 0;
}
.face-capture.is-live {
  --outer-speed: 12s;
  --inner-speed: 10s;
  --sweep-speed: 4s;
}
.face-capture.is-processing {
  --outer-speed: 4s;
  --inner-speed: 3.5s;
  --sweep-speed: 2.3s;
}
.face-capture.is-confirmed {
  --ring: #34e8a8;
  --ring-inner: #80f3d0;
}
.camera-frame {
  position: relative;
  isolation: isolate;
  width: 100%;
  max-width: 640px;
  aspect-ratio: 4 / 3;
  margin: auto;
  overflow: hidden;
  border: 1px solid var(--fm-strong-line);
  border-radius: 16px;
  background:
    radial-gradient(ellipse at 50% 46%, color-mix(in srgb, var(--ring) 13%, transparent), transparent 66%),
    var(--fm-card-glass);
  backdrop-filter: var(--fm-card-filter);
  box-shadow:
    inset 0 1px var(--fm-highlight),
    var(--fm-shadow);
}
.camera-frame video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform: scaleX(-1);
}
.face-capture:not(.is-live) video {
  opacity: 0;
}
.face-capture .camera-frame::before,
.face-capture .camera-frame::after {
  content: '';
  position: absolute;
  z-index: 2;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  width: 57%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: repeating-conic-gradient(var(--ring) 0deg 1deg, transparent 1deg 7.5deg);
  mask-image: radial-gradient(closest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
  animation: face-ring var(--outer-speed) linear infinite;
  pointer-events: none;
}
.face-capture .camera-frame::after {
  width: 51.5%;
  opacity: 0.85;
  background: repeating-conic-gradient(var(--ring-inner) 0deg 2deg, transparent 2deg 15deg);
  animation: face-ring var(--inner-speed) linear infinite reverse;
}
.face-capture .face-guide {
  position: absolute;
  pointer-events: none;
  inset: 50% auto auto 50%;
  translate: -50% -50%;
  width: 54%;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ring) 64%, transparent);
  border-radius: 50%;
  box-shadow:
    0 0 24px color-mix(in srgb, var(--ring) 17%, transparent),
    inset 0 0 22px color-mix(in srgb, var(--ring) 12%, transparent);
}
.face-capture .face-guide::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 26%;
  border-bottom: 1px solid color-mix(in srgb, var(--ring) 80%, transparent);
  background: linear-gradient(transparent, color-mix(in srgb, var(--ring) 24%, transparent));
  animation: face-scan var(--sweep-speed) ease-in-out infinite alternate;
}
.is-confirmed .face-guide {
  border-color: var(--ring);
  box-shadow:
    0 0 22px rgb(52 232 168 / 38%),
    inset 0 0 14px rgb(52 232 168 / 19%);
}
.is-confirmed .camera-frame::before,
.is-confirmed .camera-frame::after {
  animation-play-state: paused;
}
.is-confirmed .face-guide::after {
  opacity: 0;
  animation: none;
}
@keyframes face-ring {
  to {
    transform: rotate(1turn);
  }
}
@keyframes face-scan {
  from {
    transform: translateY(-94%);
  }
  to {
    transform: translateY(370%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .face-capture .camera-frame::before,
  .face-capture .camera-frame::after,
  .face-capture .face-guide::after {
    animation: none;
  }
  .face-capture .face-guide::after {
    transform: translateY(145%);
  }
}
.face-capture p {
  margin: 10px 0;
  font-size: 13px;
  color: var(--fm-secondary);
  text-align: center;
}

.capture-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
</style>
