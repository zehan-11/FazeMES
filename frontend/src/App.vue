<script lang="ts" setup>
import HistoryBackButton from '@/components/HistoryBackButton.vue'
import { bindTactile } from '@/directives/tactile'
import { useAppStore } from '@/store/modules/app'
import { useDesign } from '@/hooks/web/useDesign'
import routerSearch from '@/components/RouterSearch/index.vue'

defineOptions({ name: 'APP' })

const { getPrefixCls } = useDesign()
const prefixCls = getPrefixCls('app')
const appStore = useAppStore()
const route = useRoute()
const standalone = computed(
  () => route.matched.length > 0 &&
    !route.matched.some((record) => record.components?.default?.name === 'Layout')
)
const currentSize = computed(() => appStore.getCurrentSize)
const greyMode = computed(() => appStore.getGreyMode)

appStore.setIsDark(appStore.getIsDark)
let stopTactile: (() => void) | undefined
onMounted(() => { stopTactile = bindTactile() })
onBeforeUnmount(() => stopTactile?.())
</script>
<template>
  <ConfigGlobal :size="currentSize">
    <RouterView :class="greyMode ? `${prefixCls}-grey-mode` : ''" />
    <HistoryBackButton v-if="standalone" class="fm-standalone-back" />
    <routerSearch />
  </ConfigGlobal>
</template>
<style lang="scss">
$prefix-cls: #{$namespace}-app;

.size {
  width: 100%;
  height: 100%;
}

html,
body {
  @extend .size;

  padding: 0 !important;
  margin: 0;
  overflow: hidden;

  #app {
    @extend .size;
  }
}

.fm-standalone-back {
  position: fixed;
  inset-inline-start: max(12px, env(safe-area-inset-left));
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 10;
  background: var(--fm-popover, var(--el-bg-color-overlay));
  border: 1px solid var(--el-border-color);
}

.#{$prefix-cls}-grey-mode {
  filter: grayscale(100%);
}
</style>
