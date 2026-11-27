<script setup lang="ts">
import FaceCapture from '@/views/mes/face/FaceCapture.vue'
import { FaceApi } from '@/api/mes/face'
import type { TokenType } from '@/api/login/types'
const props = defineProps<{ modelValue: boolean; username: string }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: [value: TokenType]
  usePassword: []
}>()
function returnToPassword() {
  emit('update:modelValue', false)
  emit('usePassword')
}
const working = ref(false)
const error = ref('')
const verified = ref(false)
let generation = 0
const capture = async (image: string) => {
  verified.value = false
  working.value = true
  error.value = ''
  const current = ++generation
  try {
    const challenge = await FaceApi.challenge(props.username.trim())
    if (current !== generation || !props.modelValue) return
    const result = await FaceApi.login(props.username.trim(), challenge.challenge, image)
    if (current === generation && props.modelValue) {
      verified.value = true
      emit('update:modelValue', false)
      emit('success', result)
    }
  } catch (cause) {
    if (current === generation)
      error.value =
        cause instanceof Error ? cause.message : '核验未完成，可重新采集或使用密码登录。'
  } finally {
    if (current === generation) working.value = false
  }
}
watch(
  () => props.modelValue,
  (value) => {
    if (value) verified.value = false
    if (!value) {
      generation++
      working.value = false
      error.value = ''
    }
  }
)
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <el-dialog
    class="fm-face-login-dialog fm-optical-rim"
    :model-value="modelValue"
    title="本人人脸登录"
    width="min(656px, 94vw)"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="face-login-account"
      >核验账号：<strong>{{ username }}</strong
      >。请使用已录入的本人人脸；本次画面仅送至本地服务处理。</p
    >
    <FaceCapture
      :active="modelValue"
      :disabled="working"
      :processing="working"
      :confirmed="verified"
      :failed="!!error"
      :capture-label="working ? '正在核验…' : '开始人脸核验'"
      @capture="capture"
    />
    <el-alert v-if="error" class="mt-16px" :title="error" type="error" :closable="false" />
    <p class="face-login-note"
      >首次使用请先密码登录，从右上角头像打开「人脸登录设置」。核验采用单人正脸，不含活体检测。</p
    >
    <template #footer><el-button @click="returnToPassword">返回密码登录</el-button></template>
  </el-dialog>
</template>
<style scoped>
.face-login-account {
  margin: 0 0 12px;
}
.face-login-note {
  margin: 16px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
</style>

<style>
/* This dialog is teleported to body. The camera sets is-live after video.play() resolves. */
:root .el-dialog.fm-face-login-dialog {
  --face-lamp-width: clamp(16px, 5vw, 36px);
  border-radius: calc(var(--face-lamp-width) + 18px);
  margin-block: clamp(16px, 4vh, 52px);
  padding: calc(14px + var(--face-lamp-width));
}

.fm-face-login-dialog .el-dialog__headerbtn {
  top: var(--face-lamp-width);
  right: var(--face-lamp-width);
}

.fm-face-login-dialog::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: inherit;
  border: var(--face-lamp-width) solid #fffefa;
  box-shadow:
    inset 0 0 4px 1px rgb(255 255 255 / 65%),
    inset 0 0 16px rgb(255 253 247 / 32%),
    0 0 6px 1px rgb(255 255 255 / 55%),
    0 0 28px 4px rgb(255 253 247 / 28%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease-out;
}
.fm-face-login-dialog:has(.face-capture.is-live)::before {
  opacity: 1;
  transition-duration: 450ms;
}

.fm-face-login-dialog .face-capture.is-live .camera-frame::before,
.fm-face-login-dialog .face-capture.is-live .camera-frame::after,
.fm-face-login-dialog .face-capture.is-live .face-guide::after,
.fm-face-login-dialog .face-capture.is-live .fm-card-optics {
  display: none;
}
.fm-face-login-dialog .face-capture.is-live .face-guide {
  border-color: rgb(227 246 255 / 56%);
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .fm-face-login-dialog::before {
    transition: none;
  }
}
</style>
