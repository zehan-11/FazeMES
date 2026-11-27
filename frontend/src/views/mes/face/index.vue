<script setup lang="ts">
import { ElMessage } from 'element-plus'
import SuccessMark from '@/components/SuccessMark.vue'
import FaceCapture from './FaceCapture.vue'
import { FaceApi, bindingLabels, type FaceStatus } from '@/api/mes/face'
defineOptions({ name: 'MesFaceEnrollment' })
const status = ref<FaceStatus>()
const password = ref('')
const consent = ref(false)
const images = ref<string[]>([])
const saving = ref(false)
const error = ref('')
const enrollmentFeedback = ref<'idle' | 'processing' | 'confirmed'>('idle')
const camera = ref<InstanceType<typeof FaceCapture>>()
const message = useMessage()
const suspended = computed(() => status.value?.status === 'ADMIN_SUSPENDED')
let enrollId = ''
let revokeId = ''
let generation = 0
const discard = () => {
  camera.value?.stop()
  password.value = ''
  images.value = []
  consent.value = false
  enrollId = ''
  revokeId = ''
}
const load = async () => {
  const current = generation
  try {
    const next = await FaceApi.status()
    if (current !== generation) return
    if (status.value && next.revision !== status.value.revision) discard()
    status.value = next
  } catch {
    if (current === generation) error.value = '状态读取失败，请刷新状态后重试。'
  }
}
const capture = (image: string) => {
  if (consent.value && images.value.length < 3) {
    enrollmentFeedback.value = 'idle'
    images.value.push(image)
    enrollId = ''
  }
}
const clearSamples = () => {
  images.value = []
  enrollId = ''
}
watch(consent, (value) => {
  if (!value) {
    camera.value?.stop()
    clearSamples()
  }
})
const submit = async (revoke: boolean) => {
  if (saving.value || !status.value) return
  if (!password.value || (!revoke && (!consent.value || !images.value.length))) {
    message.warning(revoke ? '请输入当前密码' : '请先授权、采集本人画面并输入当前密码')
    return
  }
  if (revoke) {
    try {
      await message.confirm('立即停止本账号刷脸登录并清理特征？仍可使用密码登录。')
    } catch {
      return
    }
  }
  const current = generation
  saving.value = true
  error.value = ''
  try {
    enrollmentFeedback.value = revoke ? 'idle' : 'processing'
    if (revoke) {
      revokeId ||= crypto.randomUUID()
      await FaceApi.disable(password.value, status.value.revision, revokeId)
    } else {
      enrollId ||= crypto.randomUUID()
      await FaceApi.enroll(password.value, images.value, status.value.revision, enrollId)
    }
    if (current !== generation) return
    discard()
    if (revoke) {
      message.success('刷脸登录已停用')
    } else {
      enrollmentFeedback.value = 'confirmed'
      ElMessage.success({ message: '本人人脸绑定已生效', icon: SuccessMark, customClass: 'fm-success-toast' })
    }
  } catch (e) {
    if (current === generation)
      error.value = e instanceof Error ? e.message : '提交未完成，请刷新状态后重试'
  } finally {
    if (current === generation) {
      if (enrollmentFeedback.value === 'processing') enrollmentFeedback.value = 'idle'
      saving.value = false
      await load()
    }
  }
}
const leave = () => {
  generation++
  enrollmentFeedback.value = 'idle'
  saving.value = false
  status.value = undefined
  error.value = ''
  discard()
}
onMounted(load)
onActivated(() => {
  if (!status.value) load()
})
onDeactivated(leave)
onBeforeUnmount(leave)
</script>
<template>
  <ContentWrap class="face-enrollment" title="人脸登录设置">
    <el-alert
      title="先使用密码登录，再为当前账号录入本人人脸。登录时填写账号后进行一对一核验。"
      type="info"
      :closable="false"
    />
    <div class="face-settings">
      <section class="enrollment-viewport fm-panel fm-optical-rim" aria-labelledby="face-preview-title">
        <h3 id="face-preview-title">人脸取景</h3>
        <FaceCapture
          ref="camera"
          :active="!!status?.ready && consent && !suspended"
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
            :disabled="saving || !images.length"
            @click="clearSamples"
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
            >{{ status ? bindingLabels[status.status] : '正在读取状态' }}</el-tag
          >
        </p>
        <el-button link @click="load">刷新状态</el-button>
        <p v-if="status?.cleanupPending">历史特征清理中。</p>
        <p v-if="suspended">管理员已停用刷脸。如需重新录入，请联系管理员。仍可使用密码登录。</p>
        <p v-else-if="status?.status === 'REENROLL_REQUIRED'">管理员已要求本人重新录入。</p>
        <p v-if="status && !status.ready">人脸服务暂不可用，仍可使用密码登录或撤销绑定。</p>
        <div class="face-step"><span aria-hidden="true">1</span>授权并采集本人画面</div>
        <el-checkbox v-model="consent" class="consent" :disabled="saving || suspended || !status?.ready">
          我同意采集本人画面，并使用人脸特征验证此账号。
        </el-checkbox>
        <p>采用 SFace + YuNet，只核验你填写的账号，不检索其他人员身份。该实现不含硬件活体检测。</p>
        <p>画面发送至本地服务提取特征后即丢弃；保存的 128 维特征仅供当前租户和账号核验，可随时撤销绑定。</p>
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
        <div class="face-step"><span aria-hidden="true">3</span>确认本人绑定</div>
        <div class="enrollment-actions"
          ><el-button type="primary" :loading="saving" :disabled="!status?.ready || suspended || !consent || !images.length" @click="submit(false)"
            >{{ status?.enrolled ? '更新本人绑定' : '录入本人' }}</el-button
          ><el-button
            type="danger"
            plain
            :loading="saving"
            :disabled="!status?.enrolled"
            @click="submit(true)"
            >撤销绑定</el-button
          ></div
        >
        <el-alert v-if="error" :title="error" type="error" :closable="false" />
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
