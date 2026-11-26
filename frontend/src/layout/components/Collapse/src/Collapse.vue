<script lang="ts" setup>
import { Expand, Fold } from '@element-plus/icons-vue'
import { useAppStore } from '@/store/modules/app'
import { propTypes } from '@/utils/propTypes'
import { useDesign } from '@/hooks/web/useDesign'

defineOptions({ name: 'Collapse' })

const { getPrefixCls } = useDesign()

const prefixCls = getPrefixCls('collapse')

defineProps({
  color: propTypes.string.def('')
})

const appStore = useAppStore()

const collapse = computed(() => appStore.getCollapse)

const toggleCollapse = () => {
  const collapsed = unref(collapse)
  appStore.setCollapse(!collapsed)
}
</script>

<template>
  <button
    type="button"
    :class="[prefixCls, 'fm-icon-button']"
    :aria-expanded="!collapse"
    :aria-label="collapse ? '展开导航' : '收起导航'"
    @click="toggleCollapse"
  >
    <ElIcon :color="color" :size="18" aria-hidden="true">
      <Expand v-if="collapse" /><Fold v-else />
    </ElIcon>
  </button>
</template>
