<script lang="ts" setup>
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
    <span
      class="fold-glyph"
      :class="{ 'is-expanded': !collapse }"
      :style="{ color }"
      aria-hidden="true"
    >
      <i></i><i></i><i></i>
    </span>
  </button>
</template>
<style scoped>
.fold-glyph {
  position: relative;
  width: 18px;
  height: 16px;
}
.fold-glyph i {
  position: absolute;
  left: 2px;
  top: 7px;
  width: 15px;
  height: 1.5px;
  border-radius: 2px;
  background: currentColor;
  transform-origin: left center;
  transition: transform 0.28s var(--fm-spring);
}
.fold-glyph i:first-child {
  transform: translateY(-5px);
}
.fold-glyph i:last-child {
  transform: translateY(5px);
}
.fold-glyph.is-expanded i:first-child {
  transform: rotate(-40deg) scaleX(0.56);
}
.fold-glyph.is-expanded i:last-child {
  transform: rotate(40deg) scaleX(0.56);
}
@media (prefers-reduced-motion: reduce) {
  .fold-glyph i {
    transition: none;
  }
}
</style>
