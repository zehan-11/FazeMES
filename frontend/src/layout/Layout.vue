<script lang="tsx">
import { computed, defineComponent, unref } from 'vue'
import { useAppStore } from '@/store/modules/app'
import { Backtop } from '@/components/Backtop'
import AmbientParticles from './components/AmbientParticles.vue'
import FloatingAssistant from './components/FloatingAssistant.vue'
import { Setting } from '@/layout/components/Setting'
import { useRenderLayout } from './components/useRenderLayout'
import { useDesign } from '@/hooks/web/useDesign'
import { getLayoutRenderMode } from '@/utils/layout'

const { getPrefixCls } = useDesign()

const prefixCls = getPrefixCls('layout')

const appStore = useAppStore()

// 是否是移动端
const mobile = computed(() => appStore.getMobile)

// 菜单折叠
const collapse = computed(() => appStore.getCollapse)

const layout = computed(() => appStore.getLayout)

const handleClickOutside = () => {
  appStore.setCollapse(true)
}

const renderLayout = () => {
  switch (getLayoutRenderMode(unref(layout))) {
    case 'classic':
      const { renderClassic } = useRenderLayout()
      return renderClassic()
    case 'topLeft':
      const { renderTopLeft } = useRenderLayout()
      return renderTopLeft()
    case 'top':
      const { renderTop } = useRenderLayout()
      return renderTop()
    case 'cutMenu':
      const { renderCutMenu } = useRenderLayout()
      return renderCutMenu()
    default:
      break
  }
}

export default defineComponent({
  name: 'Layout',
  setup() {
    return () => (
      <section
        class={[
          prefixCls,
          `${prefixCls}__${layout.value}`,
          `${prefixCls}__${getLayoutRenderMode(layout.value)}`,
          'w-[100%] h-[100%] relative'
        ]}
      >
        <div class="fazemes-ambient-backdrop" aria-hidden="true">
          <i class="aurora-blue" />
          <i class="aurora-cyan" />
          <AmbientParticles />
        </div>
        <div class="fm-layout-frame">
          {mobile.value && !collapse.value ? (
            <div
              class="absolute left-0 top-0 z-99 h-full w-full bg-[var(--el-color-black)] opacity-30"
              onClick={handleClickOutside}
            ></div>
          ) : undefined}

          {renderLayout()}

          <Backtop></Backtop>
          <FloatingAssistant />

          <Setting></Setting>
        </div>
      </section>
    )
  }
})
</script>

<style lang="scss" scoped>
$prefix-cls: #{$namespace}-layout;

.#{$prefix-cls} {
  isolation: isolate;
  background-color: var(--fm-base);
}
</style>
