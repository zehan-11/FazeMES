<script lang="ts" setup>
import { FullScreen, ScaleToOriginal } from '@element-plus/icons-vue'
import { useFullscreen } from '@vueuse/core'
import { propTypes } from '@/utils/propTypes'
import { useDesign } from '@/hooks/web/useDesign'

defineOptions({ name: 'ScreenFull' })

const { getPrefixCls } = useDesign()

const prefixCls = getPrefixCls('screenfull')

defineProps({
  color: propTypes.string.def('')
})

const { toggle, isFullscreen } = useFullscreen()

const toggleFullscreen = () => {
  toggle()
}
</script>

<template>
  <button
    type="button"
    :class="prefixCls"
    :aria-label="isFullscreen ? '退出全屏' : '进入全屏'"
    :title="isFullscreen ? '退出全屏' : '进入全屏'"
    @click="toggleFullscreen"
  >
    <ElIcon :color="color" :size="18" aria-hidden="true">
      <ScaleToOriginal v-if="isFullscreen" /><FullScreen v-else />
    </ElIcon>
  </button>
</template>
