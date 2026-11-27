<script lang="ts" setup>
import { ElLoading } from 'element-plus'
import {
  ArrowRight,
  Camera,
  Connection,
  FullScreen,
  Hide,
  Lock,
  TopRight,
  View
} from '@element-plus/icons-vue'
import GlassLens from '../scene/GlassLens.vue'
import FaceLoginDialog from './FaceLoginDialog.vue'
import type { TokenType } from '@/api/login/types'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

import { useIcon } from '@/hooks/web/useIcon'

import * as authUtil from '@/utils/auth'
import { usePermissionStore } from '@/store/modules/permission'
import * as LoginApi from '@/api/login'
import { LoginStateEnum, useFormValid, useLoginState } from './useLogin'

defineOptions({ name: 'LoginForm' })

const { t } = useI18n()
const localMes = import.meta.env.VITE_APP_LOCAL_MES === 'true'
const message = useMessage()
const iconHouse = useIcon({ icon: 'ep:house' })
const iconAvatar = useIcon({ icon: 'ep:avatar' })
const iconLock = useIcon({ icon: 'ep:lock' })
const formLogin = ref()
const { validForm } = useFormValid(formLogin)
const { setLoginState, getLoginState } = useLoginState()
const { currentRoute, push, replace } = useRouter()
const permissionStore = usePermissionStore()
const redirect = ref<string>('')
const loginLoading = ref(false)
const mode = ref<'password' | 'face'>('password')
const passwordVisible = ref(false)
const passwordTab = ref<HTMLButtonElement>()
const faceTab = ref<HTMLButtonElement>()
function chooseMode(next: 'password' | 'face') {
  mode.value = next
  passwordVisible.value = false
  formLogin.value?.clearValidate()
}
function keyMode(e: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const next =
    e.key === 'Home'
      ? 'password'
      : e.key === 'End'
        ? 'face'
        : mode.value === 'password'
          ? 'face'
          : 'password'
  chooseMode(next)
  ;(next === 'face' ? faceTab : passwordTab).value?.focus()
}
function submitSelected() {
  if (loginLoading.value) return
  if (mode.value === 'face') return openFaceLogin()
  return getCode()
}
const badPassword = ref(false)
const faceLoginOpen = ref(false)
const verify = ref()
const captchaType = ref('blockPuzzle') // blockPuzzle 滑块 clickWord 点击文字 pictureWord 文字验证码

const getShow = computed(() => unref(getLoginState) === LoginStateEnum.LOGIN)

const LoginRules = {
  tenantName: [required],
  username: [required],
  password: [required]
}
const loginData = reactive({
  captchaEnable: import.meta.env.VITE_APP_CAPTCHA_ENABLE,
  tenantEnable: import.meta.env.VITE_APP_TENANT_ENABLE,
  loginForm: {
    tenantName: import.meta.env.VITE_APP_DEFAULT_LOGIN_TENANT || '',
    username: import.meta.env.VITE_APP_DEFAULT_LOGIN_USERNAME || '',
    password: import.meta.env.VITE_APP_DEFAULT_LOGIN_PASSWORD || '',
    captchaVerification: '',
    rememberMe: true // 默认记录我。如果不需要，可手动修改
  }
})

const alternateModes = [
  [LoginStateEnum.RESET_PASSWORD, 'login.forgetPassword'],
  [LoginStateEnum.MOBILE, 'login.btnMobile'],
  [LoginStateEnum.QR_CODE, 'login.btnQRCode'],
  [LoginStateEnum.REGISTER, 'login.btnRegister']
] as const

const socialList = [
  { icon: 'ant-design:wechat-filled', type: 30 },
  { icon: 'ant-design:dingtalk-circle-filled', type: 20 },
  { icon: 'ant-design:github-filled', type: 0 },
  { icon: 'ant-design:alipay-circle-filled', type: 0 }
]

watch(
  () => loginData.loginForm.password,
  (value) => {
    if (!value) passwordVisible.value = false
  }
)

// 获取验证码
const getCode = async () => {
  // 情况一，未开启：则直接登录
  if (loginData.captchaEnable === 'false') {
    await handleLogin({})
  } else {
    // 情况二，已开启：则展示验证码；只有完成验证码的情况，才进行登录
    // 弹出验证码
    verify.value.show()
  }
}
// 获取租户 ID
const getTenantId = async () => {
  if (loginData.tenantEnable === 'true') {
    const res = await LoginApi.getTenantIdByName(loginData.loginForm.tenantName)
    authUtil.setTenantId(res)
    if (!res) {
      message.warning(t('login.invalidTenantName'))
      return false
    }
  }
  return true
}
const openFaceLogin = async () => {
  if (!loginData.loginForm.username.trim()) {
    message.warning('请先填写需要核验的账号')
    return
  }
  try {
    loginLoading.value = true
    if (await getTenantId()) faceLoginOpen.value = true
  } catch {
    message.warning('无法确认租户，请检查租户名称或稍后重试')
  } finally {
    loginLoading.value = false
  }
}
const handleFaceLogin = async (result: TokenType) => {
  const route = currentRoute.value
  const requested = route.query.redirect
  const target =
    typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/'
  // The shared guard uses the login page's redirect when choosing the employee landing page.
  if (requested !== undefined && (target === '/' || target === '/index')) {
    await replace({ path: route.path, query: { ...route.query, redirect: undefined } })
  }
  authUtil.setToken(result)
  await push(target === '/index' ? '/' : target)
}
// 记住我
const getLoginFormCache = () => {
  const loginForm = authUtil.getLoginForm()
  if (loginForm) {
    loginData.loginForm = {
      ...loginData.loginForm,
      username: loginForm.username ? loginForm.username : loginData.loginForm.username,
      password: loginForm.password ? loginForm.password : loginData.loginForm.password,
      rememberMe: loginForm.rememberMe,
      tenantName: loginForm.tenantName ? loginForm.tenantName : loginData.loginForm.tenantName
    }
  }
}
// 根据域名，获得租户信息
const getTenantByWebsite = async () => {
  if (loginData.tenantEnable === 'true') {
    const website = location.host
    const res = await LoginApi.getTenantByWebsite(website)
    if (res) {
      loginData.loginForm.tenantName = res.name
      authUtil.setTenantId(res.id)
    }
  }
}
const loading = ref() // ElLoading.service 返回的实例
// 登录
const handleLogin = async (params: any) => {
  badPassword.value = false
  loginLoading.value = true
  try {
    const data = await validForm()
    if (!data || !(await getTenantId())) {
      return
    }
    const loginDataLoginForm = { ...loginData.loginForm }
    loginDataLoginForm.captchaVerification = params.captchaVerification
    const res = await LoginApi.login(loginDataLoginForm)
    if (!res) {
      return
    }
    loading.value = ElLoading.service({
      lock: true,
      text: '正在加载系统中...',
      background: 'rgba(0, 0, 0, 0.7)'
    })
    if (loginDataLoginForm.rememberMe) {
      authUtil.setLoginForm(loginDataLoginForm)
    } else {
      authUtil.removeLoginForm()
    }
    authUtil.setToken(res)
    if (!redirect.value) {
      redirect.value = '/'
    }
    // 判断是否为SSO登录
    if (redirect.value.indexOf('sso') !== -1) {
      window.location.href = window.location.href.replace('/login?redirect=', '')
    } else {
      await push({ path: redirect.value || permissionStore.addRouters[0].path })
    }
  } catch (error) {
    badPassword.value = error instanceof Error && error.message.includes('账号密码不正确')
  } finally {
    loginLoading.value = false
    loading.value?.close()
    loading.value = undefined
  }
}

// 社交登录
const doSocialLogin = async (type: number) => {
  if (type === 0) {
    message.error('此方式未配置')
  } else {
    loginLoading.value = true
    if (loginData.tenantEnable === 'true') {
      // 尝试先通过 tenantName 获取租户
      await getTenantId()
      // 如果获取不到，则需要弹出提示，进行处理
      if (!authUtil.getTenantId()) {
        try {
          const data = await message.prompt('请输入租户名称', t('common.reminder'))
          if (data?.action !== 'confirm') throw 'cancel'
          const res = await LoginApi.getTenantIdByName(data.value)
          authUtil.setTenantId(res)
        } catch (error) {
          if (error === 'cancel') return
        } finally {
          loginLoading.value = false
        }
      }
    }
    // 计算 redirectUri
    // 注意: type、redirect 需要先 encode 一次，否则钉钉回调会丢失。
    // 配合 social-login.vue#getUrlValue() 使用
    const redirectUri =
      location.origin +
      '/social-login?' +
      encodeURIComponent(`type=${type}&redirect=${redirect.value || '/'}`)

    // 进行跳转
    window.location.href = await LoginApi.socialAuthRedirect(type, encodeURIComponent(redirectUri))
  }
}
watch(
  () => currentRoute.value,
  (route: RouteLocationNormalizedLoaded) => {
    redirect.value = route?.query?.redirect as string
  },
  {
    immediate: true
  }
)
onMounted(() => {
  getLoginFormCache()
  getTenantByWebsite()
})
</script>

<template>
  <div v-show="getShow" class="workspace-auth">
    <div class="modes" role="tablist" :aria-label="t('login.scene.method')" @keydown="keyMode">
      <button
        id="mode-password"
        ref="passwordTab"
        class="glass-control"
        type="button"
        role="tab"
        aria-controls="login-fields"
        :aria-selected="mode === 'password'"
        :tabindex="mode === 'password' ? 0 : -1"
        @click="chooseMode('password')"
      >
        <GlassLens /><ElIcon><Lock /></ElIcon><span>{{ t('login.scene.accountTab') }}</span>
      </button>
      <button
        id="mode-face"
        ref="faceTab"
        class="glass-control"
        type="button"
        role="tab"
        aria-controls="login-fields"
        :aria-selected="mode === 'face'"
        :tabindex="mode === 'face' ? 0 : -1"
        @click="chooseMode('face')"
      >
        <GlassLens /><ElIcon><FullScreen /></ElIcon><span>{{ t('login.scene.faceTab') }}</span>
      </button>
    </div>
    <div id="login-fields" role="tabpanel" :aria-labelledby="'mode-' + mode">
      <el-form
        ref="formLogin"
        :model="loginData.loginForm"
        :rules="LoginRules"
        label-position="top"
        class="workspace-fields"
        :class="{ 'fm-invalid': badPassword }"
        hide-required-asterisk
        @submit.prevent="submitSelected"
      >
        <el-form-item
          v-if="loginData.tenantEnable === 'true'"
          class="field"
          prop="tenantName"
          :label="t('login.tenantname')"
          for="tenant"
        >
          <el-input
            id="tenant"
            v-model="loginData.loginForm.tenantName"
            :placeholder="t('login.tenantNamePlaceholder')"
            :prefix-icon="iconHouse"
            autocomplete="organization"
          />
        </el-form-item>
        <el-form-item class="field" prop="username" :label="t('login.scene.account')" for="account">
          <el-input
            id="account"
            v-model="loginData.loginForm.username"
            :placeholder="t('login.usernamePlaceholder')"
            :prefix-icon="iconAvatar"
            autocomplete="username"
          />
        </el-form-item>
        <el-form-item
          v-if="mode === 'password'"
          class="field"
          prop="password"
          :label="t('login.password')"
          for="password"
        >
          <el-input
            id="password"
            v-model="loginData.loginForm.password"
            :type="passwordVisible ? 'text' : 'password'"
            :placeholder="t('login.passwordPlaceholder')"
            :prefix-icon="iconLock"
            autocomplete="current-password"
            @input="badPassword = false"
          >
            <template #suffix
              ><button
                v-if="loginData.loginForm.password"
                class="glass-control reveal"
                type="button"
                :aria-label="
                  t(passwordVisible ? 'login.scene.hidePassword' : 'login.scene.showPassword')
                "
                :aria-pressed="passwordVisible"
                @mousedown.prevent
                @click="passwordVisible = !passwordVisible"
                ><GlassLens /><ElIcon
                  ><Hide v-if="passwordVisible" /><View v-else /></ElIcon></button
            ></template>
          </el-input>
        </el-form-item>
        <div v-else class="facepane"
          ><span class="scan-icon"
            ><ElIcon><Camera /></ElIcon></span
          >{{ t('login.scene.identity') }}</div
        >
        <el-checkbox v-if="mode === 'password'" v-model="loginData.loginForm.rememberMe">{{
          t('login.remember')
        }}</el-checkbox>
        <button
          class="glass-control submit"
          type="submit"
          :disabled="loginLoading"
          :aria-busy="loginLoading"
        >
          <GlassLens /><span>{{
            t(mode === 'password' ? 'login.login' : 'login.scene.verify')
          }}</span
          ><span class="submit-arrow"
            ><ElIcon><ArrowRight /></ElIcon
          ></span>
        </button>
      </el-form>
    </div>
    <RouterLink class="glass-control portal" to="/customer-portal"
      ><GlassLens /><span class="portal-icon"
        ><ElIcon><Connection /></ElIcon></span
      ><span>{{ t('login.scene.portal') }}</span
      ><ElIcon class="portal-arrow"><TopRight /></ElIcon
    ></RouterLink>
    <div v-if="!localMes" class="extra-actions">
      <button
        v-for="[state, label] in alternateModes"
        :key="state"
        type="button"
        class="glass-control"
        @click="setLoginState(state)"
        ><GlassLens /><span>{{ t(label) }}</span></button
      >
      <button
        v-for="item in socialList"
        :key="item.type"
        class="glass-control"
        type="button"
        :aria-label="item.icon.split(':').pop()?.replace('-filled', '')"
        @click="doSocialLogin(item.type)"
        ><GlassLens /><Icon :icon="item.icon"
      /></button>
    </div>
    <Verify
      v-if="loginData.captchaEnable === 'true'"
      ref="verify"
      :captchaType="captchaType"
      :imgSize="{ width: '400px', height: '200px' }"
      mode="pop"
      @success="handleLogin"
    />
    <FaceLoginDialog
      v-model="faceLoginOpen"
      :username="loginData.loginForm.username"
      @success="handleFaceLogin"
      @use-password="chooseMode('password')"
    />
  </div>
</template>
