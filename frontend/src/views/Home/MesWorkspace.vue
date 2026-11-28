<template>
  <div class="mes-workspace">
    <header class="welcome fm-panel">
      <div>
        <div class="eyebrow">FazeMES / 生产执行</div>
        <div class="welcome-title">
          <h1>生产工作台</h1>
          <span>{{ userStore.getUser.nickname }}，欢迎回来</span>
        </div>
      </div>
      <div class="welcome-actions">
        <el-button
          v-if="checkPermi(['mes:insight:query'])"
          type="primary"
          @click="router.push('/mes/insight')"
          >进入生产决策中心</el-button
        >
        <el-button v-if="canLoadData" :loading="loading" @click="refreshWorkspace"
          >刷新数据</el-button
        >
      </div>
    </header>

    <el-alert
      v-if="loadFailed"
      title="部分统计加载失败，请刷新数据重试。"
      type="warning"
      show-icon
      :closable="false"
    />
    <template v-if="canQueryHomeStatistics">
      <HomeKpiCards
        v-if="summary"
        :summary="summary"
        :feedback-total="counts.feedback"
        :destinations="destinations"
        @navigate="navigate"
      />
      <el-skeleton v-else-if="loading" :rows="2" animated />
    </template>

    <div v-if="canQueryWorkOrders" class="workspace-columns">
      <WorkspaceOrders
        :orders="workOrders"
        :loading="loading"
        :failed="workOrdersFailed"
        :all-orders-path="destinations.MesProWorkOrder"
        @navigate="navigate"
        @retry="loadData"
      />
    </div>

    <div
      v-if="canQueryHomeStatistics || shortcuts.length"
      class="workspace-columns"
      :class="{ 'one-column': !canQueryHomeStatistics || !shortcuts.length }"
    >
      <HomeProductionTrend
        v-if="canQueryHomeStatistics && refreshToken"
        :refresh-token="refreshToken"
        :feedback-path="destinations.MesProFeedback"
        @navigate="navigate"
      />
      <HomeShortcuts v-if="shortcuts.length" :items="shortcuts" @navigate="navigate" />
    </div>

    <CapabilityCards ref="capabilityCards" />

    <footer v-if="statistics.length || canQueryHomeStatistics" class="workspace-footer">
      <div v-if="statistics.length" class="total-section">
        <span class="totals-title">累计概况</span>
        <dl class="totals" aria-label="当前企业累计概况">
          <div v-for="stat in statistics" :key="stat.key" :title="stat.hint">
            <dt>{{ stat.label }}</dt>
            <dd><AnimatedNumber :value="counts[stat.key]" /></dd>
          </div>
        </dl>
      </div>
      <button
        v-if="canQueryHomeStatistics"
        type="button"
        class="details-toggle"
        :aria-expanded="showDetails"
        aria-controls="workspace-detail-panels"
        @click="showDetails = !showDetails"
      >
        待办与工单分布
        <Icon :icon="showDetails ? 'ep:arrow-up' : 'ep:arrow-down'" :size="12" />
      </button>
    </footer>
    <div
      v-if="canQueryHomeStatistics && showDetails"
      id="workspace-detail-panels"
      class="workspace-columns"
      :class="{ 'one-column': !(summary && hasAlerts) }"
    >
      <HomeAlertPanel
        v-if="summary && hasAlerts"
        :summary="summary"
        :destinations="destinations"
        @navigate="navigate"
      />
      <HomeWorkOrderChart v-if="refreshToken" :refresh-token="refreshToken" />
    </div>
  </div>
</template>

<script setup lang="ts">
import AnimatedNumber from '@/components/AnimatedNumber.vue'
import { MdItemApi } from '@/api/mes/md/item'
import { MesHomeStatisticsApi, type MesHomeSummaryVO } from '@/api/mes/home'
import { ProFeedbackApi } from '@/api/mes/pro/feedback'
import { ProWorkOrderApi, type ProWorkOrderVO } from '@/api/mes/pro/workorder'
import { usePermissionStore } from '@/store/modules/permission'
import { useUserStore } from '@/store/modules/user'
import { checkPermi } from '@/utils/permission'
import { collectNavigationPages } from '@/utils/mesNavigation'
import HomeKpiCards from '@/views/mes/home/HomeKpiCards.vue'
import HomeAlertPanel from '@/views/mes/home/HomeAlertPanel.vue'
import HomeProductionTrend from '@/views/mes/home/HomeProductionTrend.vue'
import HomeWorkOrderChart from '@/views/mes/home/HomeWorkOrderChart.vue'
import HomeShortcuts from '@/views/mes/home/HomeShortcuts.vue'
import CapabilityCards from './CapabilityCards.vue'
import WorkspaceOrders from './WorkspaceOrders.vue'

defineOptions({ name: 'Index' })

const router = useRouter()
const userStore = useUserStore()
const permissionStore = usePermissionStore()
const loading = ref(false)
const loadFailed = ref(false)
const refreshToken = ref(0)
const summary = ref<MesHomeSummaryVO>()
const workOrders = ref<ProWorkOrderVO[]>([])
const workOrdersFailed = ref(false)
const showDetails = ref(false)
const canQueryWorkOrders = computed(() => checkPermi(['mes:pro-work-order:query']))
// 三个首页统计接口使用同一权限，缺少该权限时不挂载图表或请求汇总。
const canQueryHomeStatistics = computed(() => checkPermi(['mes:home:query']))

const statisticDefinitions = [
  {
    key: 'item',
    label: '物料 / 产品',
    hint: '已维护的物料与产品总数',
    permission: 'mes:md-item:query'
  },
  {
    key: 'workOrder',
    label: '生产工单',
    hint: '当前企业的工单总数',
    permission: 'mes:pro-work-order:query'
  },
  {
    key: 'feedback',
    label: '生产报工',
    hint: '当前企业的报工单总数',
    permission: 'mes:pro-feedback:query'
  }
]
const counts = reactive<Record<string, number | undefined>>({})
const statistics = computed(() =>
  statisticDefinitions.filter((stat) => checkPermi([stat.permission]))
)
const canLoadData = computed(() => statistics.value.length > 0 || canQueryHomeStatistics.value)

const authorizedPages = computed(() => collectNavigationPages(permissionStore.getRouters))
const destinations = computed<Record<string, string>>(() =>
  Object.fromEntries(
    authorizedPages.value.filter((page) => page.name).map((page) => [String(page.name), page.path])
  )
)
const hasAlerts = computed(() =>
  ['MesProAndonRecord', 'MesDvRepair', 'MesProWorkOrder'].some((name) => destinations.value[name])
)

// 优先提供现场操作、质检、计划和仓储入口；每一项都来自当前账号的可见页面。
const shortcutPriority = [
  'MesProWorkbench',
  'MesQualityWorkbench',
  'MesProWorkOrder',
  'MesWmMaterialStock',
  'MesProFeedback',
  'MesQcPendingInspect',
  'MesDvMachinery',
  'MesProTask',
  'MesQcIqc',
  'MesDvRepair'
]
const shortcuts = computed(() => {
  const businessPages = authorizedPages.value.filter((page) => page.path.startsWith('/mes/'))
  const prioritized = shortcutPriority.flatMap((name) =>
    businessPages.filter((page) => page.name === name)
  )
  const selected = [
    ...prioritized,
    ...businessPages.filter((page) => !shortcutPriority.includes(String(page.name)))
  ]
  return selected.slice(0, 5).map((page) => ({
    name: String(page.meta?.title || page.name || ''),
    path: page.path,
    icon: page.meta?.icon || 'ep:right'
  }))
})

// 汇总卡片和快捷入口只接受展示树中已经授权的页面地址。
const navigate = (path: string) => {
  if (authorizedPages.value.some((page) => page.path === path)) router.push(path)
}

const loadData = async () => {
  if (loading.value || !canLoadData.value) return
  loading.value = true
  loadFailed.value = false
  refreshToken.value++
  const requests: Promise<void>[] = []
  if (checkPermi(['mes:md-item:query'])) {
    counts.item = undefined
    requests.push(
      MdItemApi.getItemPage({ pageNo: 1, pageSize: 1 }).then((page) => {
        counts.item = page.total
      })
    )
  }
  if (canQueryWorkOrders.value) {
    counts.workOrder = undefined
    workOrdersFailed.value = false
    requests.push(
      ProWorkOrderApi.getWorkOrderPage({ pageNo: 1, pageSize: 5 })
        .then((page) => {
          counts.workOrder = page.total
          workOrders.value = page.list
        })
        .catch(() => {
          workOrdersFailed.value = true
          workOrders.value = []
        })
    )
  }
  if (checkPermi(['mes:pro-feedback:query'])) {
    counts.feedback = undefined
    requests.push(
      ProFeedbackApi.getFeedbackPage({ pageNo: 1, pageSize: 1 }).then((page) => {
        counts.feedback = page.total
      })
    )
  }
  if (canQueryHomeStatistics.value) {
    requests.push(
      MesHomeStatisticsApi.getHomeSummary()
        .then((data) => {
          summary.value = data
        })
        .catch((error) => {
          summary.value = undefined
          throw error
        })
    )
  }
  try {
    const results = await Promise.allSettled(requests)
    loadFailed.value = results.some((result) => result.status === 'rejected')
  } finally {
    loading.value = false
  }
}

const capabilityCards = ref<InstanceType<typeof CapabilityCards>>()
function refreshWorkspace() {
  void capabilityCards.value?.refresh()
  void loadData()
}
onMounted(loadData)
</script>

<style scoped lang="scss">
.mes-workspace {
  display: grid;
  gap: 12px;
  container-type: inline-size;
  color: var(--fm-text);
}

.welcome,
.welcome-title,
.welcome-actions,
.workspace-footer,
.total-section,
.totals,
.totals > div,
.details-toggle {
  display: flex;
  align-items: center;
}

.welcome {
  min-height: 73px;
  padding: 10px 18px;
  box-sizing: border-box;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  margin-bottom: 3px;
  font-size: 12px;
  color: var(--fm-blue-ink);
}

.welcome-title {
  flex-wrap: wrap;
  gap: 2px 22px;
}

.welcome-title h1 {
  margin: 0;
  font-size: 25px;
  line-height: 1.35;
}

.welcome-title span {
  font-size: 13px;
  color: var(--fm-secondary);
}

.welcome-actions {
  flex-shrink: 0;
}

.workspace-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
  gap: 12px 16px;
}

.workspace-columns > * {
  min-width: 0;
}

.workspace-columns.one-column {
  grid-template-columns: minmax(0, 1fr);
}

.workspace-footer {
  padding: 4px 0 8px;
  font-size: 12px;
  color: var(--fm-secondary);
  flex-wrap: wrap;
  gap: 6px 28px;
}

.totals {
  gap: 5px 20px;
  flex-wrap: wrap;
  margin: 0;
}

.totals > div {
  gap: 6px;
}

.totals dd {
  margin: 0;
  color: var(--fm-text);
}

.total-section {
  flex-wrap: wrap;
  gap: 4px 16px;
}

.totals-title {
  font-weight: 600;
}

.details-toggle {
  min-height: 30px;
  font: inherit;
  color: var(--fm-blue-ink);
  cursor: pointer;
  background: transparent;
  border: 0;
  gap: 5px;
}

.details-toggle:hover {
  text-decoration: underline;
}

@container (max-width: 870px) {
  .workspace-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container (max-width: 560px) {
  .welcome {
    flex-wrap: wrap;
    padding: 12px 14px;
  }

  .welcome-title {
    column-gap: 12px;
  }
}
</style>
