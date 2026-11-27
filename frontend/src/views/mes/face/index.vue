<script setup lang="ts">
import { ElMessage } from 'element-plus'
import SuccessMark from '@/components/SuccessMark.vue'
import FaceCapture from './FaceCapture.vue'
import { FaceApi, type FaceStatus } from '@/api/mes/face'
defineOptions({ name: 'MesFaceEnrollment' })
const status = ref<FaceStatus>()
const password = ref('')
const consent = ref(false)
const images = ref<string[]>([])
const saving = ref(false)
const enrollmentFeedback = ref<'idle' | 'processing' | 'confirmed'>('idle')

const message = useMessage()
const load = async () => {
  status.value = await FaceApi.status()
}
const capture = (image: string) => {
  enrollmentFeedback.value = 'idle'
  if (images.value.length < 3) images.value.push(image)
}
const retake = () => {
  images.value = []
  enrollmentFeedback.value = 'idle'
}
const save = async () => {
  if (!password.value || !consent.value || !images.value.length) {
    message.warning('请采集本人画面、输入当前密码并确认授权')
    return
  }
  saving.value = true
  try {
    enrollmentFeedback.value = 'processing'
    await FaceApi.enroll(password.value, images.value, consent.value)
    enrollmentFeedback.value = 'confirmed'
    images.value = []
    password.value = ''
    ElMessage.success({ message: '本人人脸已录入', icon: SuccessMark, customClass: 'fm-success-toast' })
    await load()
  } finally {
    if (enrollmentFeedback.value === 'processing') enrollmentFeedback.value = 'idle'
    saving.value = false
  }
}
const disable = async () => {
  if (!password.value) {
    message.warning('请输入当前账号密码确认停用')
    return
  }
  saving.value = true
  try {
    enrollmentFeedback.value = 'idle'
    await FaceApi.disable(password.value)
    password.value = ''
    images.value = []
    message.success('人脸特征已清除')
    await load()
  } finally {
    saving.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  images.value = []
  password.value = ''
})
</script>
<template>
  <ContentWrap class="face-enrollment" title="本人人脸登录">
    <el-alert
      title="先使用密码登录，再为当前账号录入本人人脸。登录时填写账号后进行一对一核验。"
      type="info"
      :closable="false"
    />
    <div class="face-settings">
      <section class="enrollment-viewport fm-panel fm-optical-rim" aria-labelledby="face-preview-title">
        <h3 id="face-preview-title">人脸取景</h3>
        <FaceCapture
          :disabled="saving || images.length >= 3"
          :processing="enrollmentFeedback === 'processing'"
          :confirmed="enrollmentFeedback === 'confirmed'"
          @start="enrollmentFeedback = 'idle'"
          @capture="capture"
        />
        <div class="sample-actions"
          ><span>已采集 {{ images.length }} / 3 张，仅暂存在本页面</span>
          <el-button
            text
            @click="retake"
            >重新采集</el-button
          >
        </div>
      </section>
      <section v-tech-card class="enrollment-settings fm-panel fm-hud fm-optical-rim">
        <h3>当前账号绑定</h3>
        <p class="face-status">
          <el-tag :type="status?.ready ? 'success' : 'warning'">{{
            status?.ready ? '本地模型已就绪' : '本地模型未就绪'
          }}</el-tag>
          <el-tag :type="status?.enrolled ? 'success' : 'info'"
            ><i v-if="status?.enrolled" class="fm-live-dot" aria-hidden="true"></i
            >{{ status?.enrolled ? '已录入' : '尚未录入' }}</el-tag
          >
        </p>
        <div class="face-step"><span aria-hidden="true">1</span>采集本人画面</div>
        <p>采用 SFace + YuNet，只核验你填写的账号，不检索其他人员身份。该实现不含硬件活体检测。</p>
        <p>画面发送至本地服务提取特征后即丢弃；特征加密保存，可随时停用并清除。</p>
        <label class="face-step" for="face-settings-password"
          ><span aria-hidden="true">2</span>输入当前账号密码</label
        >
        <el-input
          id="face-settings-password"
          v-model="password"
          type="password"
          show-password
          autocomplete="current-password"
          placeholder="输入当前账号密码确认操作"
          :disabled="saving"
        />
        <div class="face-step"><span aria-hidden="true">3</span>确认授权并录入</div>
        <el-checkbox v-model="consent" class="consent"
          >我确认画面为本人，并授权将本人人脸特征用于此账号登录核验。</el-checkbox
        >
        <div class="enrollment-actions"
          ><el-button type="primary" :loading="saving" :disabled="!status?.ready" @click="save"
            >录入 / 更新本人绑定</el-button
          ><el-button
            type="danger"
            plain
            :loading="saving"
            :disabled="!status?.enrolled"
            @click="disable"
            >停用并清除特征</el-button
          ></div
        >
      </section>
    </div>
  </ContentWrap>
</template>
<style scoped>
.face-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: clamp(14px, 2vw, 24px);
  margin-top: 18px;
}

.sample-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  font-size: 12px;
  color: var(--fm-secondary);
}

.enrollment-viewport,
.enrollment-settings {
  min-width: 0;
  padding: clamp(16px, 2vw, 26px);
}
.face-settings h3 {
  margin: 0 0 16px;
  color: var(--fm-text);
  font-size: 16px;
}
.enrollment-viewport :deep(.camera-frame) {
  backdrop-filter: none;
  box-shadow: inset 0 1px var(--fm-highlight);
}
.face-status,
.face-step {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.face-status .fm-live-dot {
  margin-right: 6px;
}
.face-step {
  margin: 16px 0 8px;
  color: var(--fm-text);
  font-size: 13px;
  font-weight: 600;
}
.face-step span {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--fm-blue-ink);
  background: var(--fm-hover);
  border: 1px solid var(--fm-strong-line);
  border-radius: 50%;
  font-variant-numeric: tabular-nums;
}
.enrollment-settings p {
  font-size: 13px;
  line-height: 1.8;
  color: color-mix(in srgb, var(--fm-text) 75%, var(--fm-secondary));
}

.consent {
  height: auto;
  margin: 0 0 16px;
}

.consent :deep(.el-checkbox__label) {
  line-height: 1.7;
  white-space: normal;
}

.enrollment-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

</style>
