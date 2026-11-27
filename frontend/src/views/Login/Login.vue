<script lang="ts" setup>
import { Collection, Moon, Sunny } from '@element-plus/icons-vue'
import { useAppStore } from '@/store/modules/app'
import { useLocaleStore } from '@/store/modules/locale'
import { useLocale } from '@/hooks/web/useLocale'
import {
  LoginForm,
  MobileForm,
  QrCodeForm,
  RegisterForm,
  SSOLoginVue,
  ForgetPasswordForm
} from './components'
import FanAssembly from './scene/FanAssembly.vue'
import FluidBackdrop from './scene/FluidBackdrop.vue'
import GlassLens from './scene/GlassLens.vue'
import LoginOpening from './scene/LoginOpening.vue'
import ParticleTitle from './scene/ParticleTitle.vue'
import { enterLogin } from './scene/entrance.mjs'
import './scene/login-scene.css'

defineOptions({ name: 'Login' })
const app = useAppStore()
const locale = useLocaleStore()
const { changeLocale } = useLocale()
const { t } = useI18n()
const en = computed(() => locale.getCurrentLocale.lang === 'en')
const content = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const destination = computed(() => panel.value?.querySelector<HTMLElement>('.fan') ?? null)
const opening = ref(!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches)
const entered = ref(!opening.value)
const publicBase = import.meta.env.BASE_URL
let stopEntrance: (() => void) | undefined
function enter() {
  entered.value = true
  if (content.value) stopEntrance = enterLogin(content.value)
}
async function finish(focusForm: boolean) {
  opening.value = false
  if (focusForm) {
    await nextTick()
    content.value?.querySelector<HTMLInputElement>('form input:not([type="hidden"])')?.focus()
  }
}
onMounted(() => {
  if (!opening.value) enter()
})
onBeforeUnmount(() => stopEntrance?.())
</script>
<template>
  <div class="mes-login">
    <div ref="content" class="login-content" :class="{ entered }" :inert="opening">
      <FluidBackdrop :dark="app.getIsDark" />
      <header class="mast">
        <div class="brand"
          ><img :src="publicBase + 'fazemes-logo.svg'" alt="" /><strong>{{
            app.getTitle
          }}</strong></div
        >
        <span class="mast-title"><ParticleTitle compact :text="t('login.scene.system')" /></span>
        <div class="utilities">
          <button
            class="glass-control locale"
            type="button"
            :aria-label="t('login.scene.locale')"
            @click="changeLocale(en ? 'zh-CN' : 'en')"
            ><GlassLens /><ElIcon><Collection /></ElIcon
            ><span>{{ en ? 'EN' : '中文' }}</span></button
          >
          <button
            class="glass-control theme"
            type="button"
            :aria-label="t('login.scene.theme')"
            @click="app.setIsDark(!app.getIsDark)"
            ><GlassLens /><ElIcon><Sunny v-if="app.getIsDark" /><Moon v-else /></ElIcon
          ></button>
        </div>
      </header>
      <main>
        <section ref="panel" class="fan-panel" :aria-label="t('login.scene.assembly')"
          ><FanAssembly :dark="app.getIsDark" :english="en"
        /></section>
        <section class="signin" aria-labelledby="login-title">
          <header class="signin-head"
            ><img class="factory" :src="publicBase + 'login-manufacturing.webp'" alt="" />
            <h1 id="login-title"
              ><ParticleTitle :text="t('login.scene.title')" :active="entered"
            /></h1>
          </header>
          <div class="formwrap">
            <LoginForm />
            <MobileForm />
            <QrCodeForm />
            <RegisterForm />
            <SSOLoginVue />
            <ForgetPasswordForm />
          </div>
        </section>
      </main>
    </div>
    <LoginOpening v-if="opening" :destination="destination" @enter="enter" @finish="finish" />
  </div>
</template>
