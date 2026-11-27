<script lang="tsx">
import { defineComponent, computed } from 'vue'
import { ElIcon, ElPopover } from 'element-plus'
import { Setting as SettingsIcon } from '@element-plus/icons-vue'
import { ThemeSwitch } from '@/layout/components/ThemeSwitch'
import router from '@/router'
import { Message } from '@/layout/components/Message'
import HistoryBackButton from '@/components/HistoryBackButton.vue'
import { UserInfo } from '@/layout/components/UserInfo'
import { Screenfull } from '@/layout/components/Screenfull'
import { Breadcrumb } from '@/layout/components/Breadcrumb'
import { SizeDropdown } from '@/layout/components/SizeDropdown'
import { LocaleDropdown } from '@/layout/components/LocaleDropdown'
import RouterSearch from '@/components/RouterSearch/index.vue'
import TenantVisit from '@/layout/components/TenantVisit/index.vue'
import FmsAccountSetSwitch from '@/views/fms/components/account-set/FmsAccountSetSwitch.vue'
import { useSetting } from '@/layout/components/Setting'
import { useAppStore } from '@/store/modules/app'
import { useDesign } from '@/hooks/web/useDesign'
import { Icon } from '@/components/Icon'
import { checkPermi } from '@/utils/permission'
import { isHorizontalMenuLayout, isMixedNavLayout, isTwoColumnLayout } from '@/utils/layout'

const { getPrefixCls, variables } = useDesign()

const prefixCls = getPrefixCls('tool-header')

const appStore = useAppStore()

// 面包屑
const breadcrumb = computed(() => appStore.getBreadcrumb)

// 折叠图标
const hamburger = computed(() => appStore.getHamburger)

// 全屏图标
const screenfull = computed(() => appStore.getScreenfull)

// 搜索图片
const search = computed(() => appStore.search)

// 尺寸图标
const size = computed(() => appStore.getSize)

// 布局
const layout = computed(() => appStore.getLayout)

// 多语言图标
const locale = computed(() => appStore.getLocale)

// 消息图标
const message = computed(() => appStore.getMessage)

// IM即时通讯图标
const im = computed(() => appStore.getIm)

// 租户切换权限
const hasTenantVisitPermission = computed(
  () => import.meta.env.VITE_APP_TENANT_ENABLE === 'true' && checkPermi(['system:tenant:visit'])
)

// 顶部聊天入口：用路由 name resolve 出完整 URL，在新标签页打开 IM 主页
// 场景考虑：IM 是全屏沉浸式壳，如果在当前页 push 会把原来在用的后台管理界面挤掉；开新 Tab 更符合用户预期
const goToChat = () => {
  // 用路由 name resolve 出完整 URL，在新标签页打开 IM 主页
  const { href } = router.resolve({ name: 'ImHome' })
  window.open(href, '_blank')
}

export default defineComponent({
  name: 'ToolHeader',
  setup() {
    const { t } = useI18n()
    const { openSetting } = useSetting()
    const showSidebarControl = computed(
      () => hamburger.value && !isTwoColumnLayout(layout.value) &&
        (!isHorizontalMenuLayout(layout.value) || isMixedNavLayout(layout.value))
    )
    const showBreadcrumb = computed(() => !isHorizontalMenuLayout(layout.value))

    return () => (
      <div
        id={`${variables.namespace}-tool-header`}
        class={[prefixCls, 'h-[var(--top-tool-height)] relative flex items-center justify-between']}
      >
        <div class="fm-header-path">
          <HistoryBackButton />
          {appStore.getMobile && showSidebarControl.value ? (
            <button
              type="button"
              class="fm-icon-button"
              aria-label={appStore.getCollapse ? '展开导航' : '收起导航'}
              aria-expanded={!appStore.getCollapse}
              onClick={() => appStore.setCollapse(!appStore.getCollapse)}
            >
              <Icon icon="ep:menu" size={18} />
            </button>
          ) : undefined}
          {showBreadcrumb.value && breadcrumb.value ? <Breadcrumb /> : undefined}
        </div>
        <div class="fm-header-actions">
          <ThemeSwitch />
          {screenfull.value ? <Screenfull class="fm-icon-button" /> : undefined}
          <ElPopover trigger="click" placement="bottom-end" width={300} persistent>
            {{
              reference: () => (
                <button
                  type="button"
                  class="fm-icon-button"
                  aria-label="工作台工具与设置"
                  title="工作台工具与设置"
                >
                  <ElIcon size={18}>
                    <SettingsIcon />
                  </ElIcon>
                </button>
              ),
              default: () => (
                <div class="fm-workbench-tools">
                  <FmsAccountSetSwitch />
                  {!appStore.getMobile && showSidebarControl.value ? (
                    <button
                      type="button"
                      class="fm-tools-setting"
                      aria-expanded={!appStore.getCollapse}
                      onClick={() => appStore.setCollapse(!appStore.getCollapse)}
                    >
                      <Icon icon="ep:menu" size={16} />
                      {appStore.getCollapse ? '展开导航' : '收起导航'}
                    </button>
                  ) : undefined}
                  {hasTenantVisitPermission.value ? <TenantVisit /> : undefined}
                  <button type="button" class="fm-tools-setting" onClick={openSetting}>
                    <Icon size={16} icon="ep:operation" />
                    {t('setting.projectSetting')}
                  </button>
                  {search.value ? (
                    <RouterSearch isModal={false} color="var(--top-header-text-color)" />
                  ) : undefined}
                  {size.value ? (
                    <SizeDropdown
                      title={t('setting.sizeIcon')}
                      class="custom-hover"
                      color="var(--top-header-text-color)"
                    ></SizeDropdown>
                  ) : undefined}
                  {locale.value ? (
                    <LocaleDropdown
                      title={t('setting.localeIcon')}
                      class="custom-hover"
                      color="var(--top-header-text-color)"
                    ></LocaleDropdown>
                  ) : undefined}
                  {message.value ? (
                    <Message
                      title={t('setting.messageIcon')}
                      class="custom-hover"
                      color="var(--top-header-text-color)"
                    ></Message>
                  ) : undefined}
                  {/* IM 聊天入口 */}
                  {im.value ? (
                    <button
                      type="button"
                      title="即时通讯"
                      class="fm-icon-button"
                      onClick={goToChat}
                    >
                      <Icon
                        color="var(--top-header-text-color)"
                        size={18}
                        icon="ep:chat-dot-round"
                      />
                    </button>
                  ) : undefined}
                </div>
              )
            }}
          </ElPopover>
          <UserInfo></UserInfo>
        </div>
      </div>
    )
  }
})
</script>

<style lang="scss" scoped>
$prefix-cls: #{$namespace}-tool-header;

.#{$prefix-cls} {
  transition: left var(--transition-time-02);
}
</style>
