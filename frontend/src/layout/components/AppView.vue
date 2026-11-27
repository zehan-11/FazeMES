<script lang="ts" setup>
import { defineComponent, type Component, type VNode } from 'vue'
import { useTagsViewStore } from '@/store/modules/tagsView'
import { useAppStore } from '@/store/modules/app'
import { restoreWorkspaceScroll } from '@/layout/workspaceScroll'
import { Footer } from '@/layout/components/Footer'

defineOptions({ name: 'AppView' })

const appStore = useAppStore()

const footer = computed(() => appStore.getFooter)

const tagsViewStore = useTagsViewStore()

const getCaches = computed((): string[] => {
  return tagsViewStore.getCachedViews
})

// Transition needs one DOM root even when a routed view renders fragments or teleported dialogs.
// Give its existing workspace section the view's component name so KeepAlive uses the same cache policy.
const frames = new WeakMap<Component, Component>()
function frameFor(view: VNode) {
  const type = view.type as Component & { name?: string; __name?: string }
  let frame = frames.get(type)
  if (!frame) {
    frame = defineComponent({
      name: type.name || type.__name,
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.()[0]
    })
    frames.set(type, frame)
  }
  return frame
}

//region 无感刷新
const routerAlive = ref(true)
// 无感刷新，防止出现页面闪烁白屏
const reload = () => {
  routerAlive.value = false
  nextTick(() => (routerAlive.value = true))
}
// 为组件后代提供刷新方法
provide('reload', reload)
//endregion
</script>

<template>
  <router-view v-if="routerAlive" v-slot="{ Component, route }">
    <Transition name="glass-page" mode="out-in" @after-enter="restoreWorkspaceScroll">
      <KeepAlive :include="getCaches">
        <component
          v-if="Component"
          :is="frameFor(Component)"
          :key="route.meta.viewKey || route.fullPath"
        >
          <section
            :data-workspace-path="route.fullPath"
            @vue:mounted="restoreWorkspaceScroll()"
            :class="[
              'fm-workspace p-[var(--app-content-padding)] w-full',
              {
                '!min-h-[calc(100vh-var(--top-tool-height)-var(--tags-view-height)-var(--app-footer-height))] pb-0':
                  footer
              }
            ]"
          >
            <component :is="Component" :key="route.meta.viewKey || route.fullPath" />
          </section>
        </component>
      </KeepAlive>
    </Transition>
  </router-view>
  <Footer v-if="footer" />
</template>
