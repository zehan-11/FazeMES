<script setup lang="ts">
import { ChatDotRound, Close, FullScreen } from '@element-plus/icons-vue'
import { checkPermi } from '@/utils/permission'
import { useLockStore } from '@/store/modules/lock'
import { useUserStore } from '@/store/modules/user'

const Assistant = defineAsyncComponent(() => import('@/views/mes/assistant/index.vue'))
const route = useRoute()
const router = useRouter()
const lock = useLockStore()
const user = useUserStore()
const allowed = computed(
  () =>
    router.getRoutes().some((item) => item.path === '/mes/assistant') &&
    (checkPermi(['mes:assistant:knowledge']) ||
      (checkPermi(['mes:insight:query']) && checkPermi(['mes:insight:chat'])))
)
const available = computed(
  () =>
    allowed.value &&
    !lock.getLockInfo?.isLock &&
    !route.matched.some((record) => record.path === '/mes/assistant')
)
const open = ref(false)
const mounted = ref(false)
const trigger = ref<HTMLButtonElement>()
const closeButton = ref<HTMLButtonElement>()
const tab = ref('chat')
const session = ref<number>()
function rememberContext(active: string, id?: number) {
  tab.value = active
  session.value = id
}

async function toggle() {
  open.value = !open.value
  if (open.value) mounted.value = true
  await nextTick()
  if (open.value) closeButton.value?.focus()
  else trigger.value?.focus()
}
function dismiss(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    (event.target as HTMLElement)?.closest('.el-dialog,.el-popper,.el-select')
  )
    return
  if (document.querySelector('.el-popper[aria-hidden="false"]')) return
  if (open.value) void toggle()
}
function reset() {
  open.value = false
  mounted.value = false
}
watch(
  [
    available,
    () => user.getUser.id,
    ...[
      'mes:assistant:knowledge',
      'mes:assistant:chat',
      'mes:assistant:manage',
      'mes:insight:query',
      'mes:insight:chat'
    ].map((permission) => () => checkPermi([permission]))
  ],
  reset
)
</script>

<template>
  <aside v-if="available" class="floating-assistant" aria-label="全局 AI 助手">
    <div
      v-if="mounted"
      v-show="open"
      id="workbench-ai-panel"
      class="floating-panel"
      role="dialog"
      aria-label="工作台 AI 助手"
      @keydown.esc="dismiss"
    >
      <header class="floating-heading">
        <strong
          ><el-icon><ChatDotRound /></el-icon> 工作台 AI 助手</strong
        >
        <div
          ><button
            type="button"
            title="打开完整助手"
            aria-label="打开完整助手"
            @click="router.push({ path: '/mes/assistant', query: { tab, session } })"
            ><el-icon><FullScreen /></el-icon
          ></button>
          <button
            ref="closeButton"
            type="button"
            title="收起"
            aria-label="收起 AI 助手"
            @click="toggle"
            ><el-icon><Close /></el-icon></button
        ></div>
      </header>
      <div class="floating-body"
        ><Assistant embedded :visible="open" @context="rememberContext"
      /></div>
    </div>
    <button
      ref="trigger"
      type="button"
      class="ai-trigger"
      :aria-controls="mounted ? 'workbench-ai-panel' : undefined"
      :aria-expanded="open"
      @click="toggle"
    >
      <el-icon><ChatDotRound /></el-icon><span>AI 助手</span>
    </button>
  </aside>
</template>

<style scoped>
.floating-assistant {
  position: fixed;
  z-index: 1100;
  right: max(18px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  display: grid;
  justify-items: end;
  gap: 8px;
  pointer-events: none;
}
.ai-trigger,
.floating-panel {
  pointer-events: auto;
}
.ai-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 16px;
  border: 1px solid var(--fm-strong-line);
  border-radius: 999px;
  background: linear-gradient(115deg, #265dc9, #2447ae);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--fm-float-shadow);
}
.ai-trigger:hover {
  background: linear-gradient(115deg, #286be3, #2751c6);
}
.floating-panel {
  display: flex;
  flex-direction: column;
  max-height: min(750px, calc(100dvh - 104px));
  width: min(540px, calc(100vw - 32px));
  border: 1px solid var(--fm-strong-line);
  border-radius: 16px;
  background: var(--fm-overlay);
  box-shadow:
    var(--fm-float-shadow),
    inset 0 1px var(--fm-highlight);
  backdrop-filter: blur(15px);
  overflow: hidden;
}
.floating-heading,
.floating-heading strong,
.floating-heading > div {
  display: flex;
  gap: 7px;
  align-items: center;
}
.floating-heading {
  justify-content: space-between;
  flex-shrink: 0;
  padding: 10px 13px 8px;
  border-bottom: 1px solid var(--fm-divider);
}
.floating-heading strong {
  font-size: 15px;
  color: var(--fm-text);
}
.floating-heading button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  cursor: pointer;
  color: var(--fm-blue-ink);
  border: 1px solid var(--fm-line);
  border-radius: 9px;
  background: var(--fm-slot);
}
.floating-body {
  min-height: 0;
  padding: 6px 12px 12px;
  overflow: auto;
  overscroll-behavior: contain;
}
@media (max-width: 550px) {
  .floating-assistant {
    right: 8px;
  }
  .floating-panel {
    width: calc(100vw - 16px);
  }
}
</style>
