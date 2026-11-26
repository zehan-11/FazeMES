<script lang="ts" setup>
import { ElMessage } from 'element-plus'
import { useClipboard } from '@vueuse/core'

import { CACHE_KEY, useCache } from '@/hooks/web/useCache'

import { accentColors, headerColors, sidebarColors } from '@/styles/glassTheme'
import { useAppStore } from '@/store/modules/app'
import { ThemeSwitch } from '@/layout/components/ThemeSwitch'
import ColorRadioPicker from './components/ColorRadioPicker.vue'
import InterfaceDisplay from './components/InterfaceDisplay.vue'
import LayoutRadioPicker from './components/LayoutRadioPicker.vue'
import { isHeaderNavLayout } from '@/utils/layout'
import { useSetting } from './useSetting'

defineOptions({ name: 'Setting' })

const { t } = useI18n()
const appStore = useAppStore()
const layout = computed(() => appStore.getLayout)
const { drawerVisible } = useSetting()

// 拷贝
const copyConfig = async () => {
  const { copy, copied, isSupported } = useClipboard({
    legacy: true,
    source: `
      // 面包屑
      breadcrumb: ${appStore.getBreadcrumb},
      // 面包屑图标
      breadcrumbIcon: ${appStore.getBreadcrumbIcon},
      // 折叠图标
      hamburger: ${appStore.getHamburger},
      // 全屏图标
      screenfull: ${appStore.getScreenfull},
      // 尺寸图标
      size: ${appStore.getSize},
      // 多语言图标
      locale: ${appStore.getLocale},
      // 消息图标
      message: ${appStore.getMessage},
      // IM 即时通讯图标
      im: ${appStore.getIm},
      // 标签页
      tagsView: ${appStore.getTagsView},
      // 标签页
      tagsViewImmerse: ${appStore.getTagsViewImmerse},
      // 标签页图标
      tagsViewIcon: ${appStore.getTagsViewIcon},
      // logo
      logo: ${appStore.getLogo},
      // 菜单手风琴
      uniqueOpened: ${appStore.getUniqueOpened},
      // 固定header
      fixedHeader: ${appStore.getFixedHeader},
      // 页脚
      footer: ${appStore.getFooter},
      // 灰色模式
      greyMode: ${appStore.getGreyMode},
      // layout布局
      layout: '${appStore.getLayout}',
      // 暗黑模式
      isDark: ${appStore.getIsDark},
      // 组件尺寸
      currentSize: '${appStore.getCurrentSize}',
      // 主题相关
      theme: ${JSON.stringify(appStore.getTheme, null, 2)}
    `
  })
  if (!isSupported) {
    ElMessage.error(t('setting.copyFailed'))
  } else {
    await copy()
    if (unref(copied)) {
      ElMessage.success(t('setting.copySuccess'))
    }
  }
}

// 清空缓存
const clear = () => {
  const { wsCache } = useCache()
  wsCache.delete(CACHE_KEY.LAYOUT)
  wsCache.delete(CACHE_KEY.THEME)
  wsCache.delete(CACHE_KEY.IS_DARK)
  window.location.reload()
}
</script>

<template>
  <ElDrawer v-model="drawerVisible" direction="rtl" size="min(350px, 100vw)">
    <template #header>
      <span class="text-16px font-700">{{ t('setting.projectSetting') }}</span>
    </template>

    <div class="text-center">
      <!-- 主题 -->
      <ElDivider>{{ t('setting.theme') }}</ElDivider>
      <ThemeSwitch />

      <!-- 布局 -->
      <ElDivider>{{ t('setting.layout') }}</ElDivider>
      <LayoutRadioPicker />

      <!-- 系统主题 -->
      <ElDivider>{{ t('setting.systemTheme') }}</ElDivider>
      <ColorRadioPicker
        :model-value="appStore.getTheme.elColorPrimary"
        :schema="accentColors"
        @change="(color) => appStore.setTheme({ elColorPrimary: color })"
      />

      <!-- 头部主题 -->
      <ElDivider>{{ t('setting.headerTheme') }}</ElDivider>
      <ColorRadioPicker
        :model-value="appStore.getTheme.topHeaderBgColor"
        :schema="headerColors"
        @change="(color) => appStore.setTheme({ topHeaderBgColor: color })"
      />

      <!-- 菜单主题 -->
      <template v-if="!isHeaderNavLayout(layout)">
        <ElDivider>{{ t('setting.menuTheme') }}</ElDivider>
        <ColorRadioPicker
          :model-value="appStore.getTheme.leftMenuBgColor"
          :schema="sidebarColors"
          @change="(color) => appStore.setTheme({ leftMenuBgColor: color })"
        />
      </template>
    </div>

    <!-- 界面显示 -->
    <ElDivider>{{ t('setting.interfaceDisplay') }}</ElDivider>
    <InterfaceDisplay />

    <ElDivider />
    <div>
      <el-button class="w-full" type="primary" @click="copyConfig">
        {{ t('setting.copy') }}
      </el-button>
    </div>
    <div class="mt-5px">
      <el-button class="w-full" type="danger" @click="clear">
        {{ t('setting.clearAndReset') }}
      </el-button>
    </div>
  </ElDrawer>
</template>
