<template>
  <el-card v-if="canQuery" shadow="never" class="home-trend">
    <div class="trend-heading">
      <h2><Icon icon="ep:data-line" :size="18" />生产趋势</h2>
      <el-radio-group v-model="trendDays" size="small" aria-label="生产趋势统计周期">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
      </el-radio-group>
    </div>
    <div v-if="loading" class="trend-state" role="status">
      <el-skeleton :rows="2" animated aria-label="正在加载生产趋势" />
    </div>
    <div v-else-if="failed" class="trend-state" role="status">
      <Icon icon="ep:warning" :size="26" class="state-icon" />
      <div>
        <strong>生产趋势加载失败</strong>
        <el-button link type="primary" @click="loadData">重试</el-button>
      </div>
    </div>
    <Echart v-else-if="hasReports" :options="trendChartOptions" :height="128" class="trend-chart" />
    <div v-else class="trend-state" role="status">
      <Icon icon="ep:trend-charts" :size="26" class="state-icon" />
      <div>
        <strong>{{ canReadFeedback ? '本期暂无已完成报工' : '本期暂无报工产量' }}</strong>
        <p>完成报工后，这里按日汇总产量。</p>
        <el-button v-if="feedbackPath" link type="primary" @click="emit('navigate', feedbackPath)">
          查看生产报工 <Icon icon="ep:arrow-right" :size="12" />
        </el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import type { EChartsOption } from 'echarts'
import { MesHomeStatisticsApi, type MesHomeProductionTrendVO } from '@/api/mes/home'
import { ProFeedbackApi } from '@/api/mes/pro/feedback'
import { MesProFeedbackStatusEnum } from '@/views/mes/utils/constants'
import { useAppStore } from '@/store/modules/app'
import { formatQuantity } from '@/utils/mesQuantity'
import { checkPermi } from '@/utils/permission'

defineOptions({ name: 'HomeProductionTrend' })

const props = defineProps<{ refreshToken?: number; feedbackPath?: string }>()
const emit = defineEmits<{ navigate: [path: string] }>()
const appStore = useAppStore()
const canQuery = computed(() => checkPermi(['mes:home:query']))
const trendDays = ref(7)
const loading = ref(false)
const failed = ref(false)
const rows = ref<MesHomeProductionTrendVO[]>([])

const canReadFeedback = computed(() => checkPermi(['mes:pro-feedback:query']))
const hasReports = ref(false)

// The trend endpoint fills missing dates with zeros. Only query the report count
// when the aggregates cannot distinguish a zero-output report from no reports.
async function periodHasReports(days: MesHomeProductionTrendVO[]) {
  if (
    days.some((row) =>
      [row.quantity, row.qualifiedQuantity, row.unqualifiedQuantity].some((n) => Number(n) !== 0)
    )
  )
    return true
  if (!days.length || !canReadFeedback.value) return false
  const page = await ProFeedbackApi.getFeedbackPage({
    status: MesProFeedbackStatusEnum.FINISHED,
    feedbackTime: [days[0].date + ' 00:00:00', days[days.length - 1].date + ' 23:59:59'],
    pageNo: 1,
    pageSize: 1
  })
  return page.total > 0
}

const trendChartOptions = computed<EChartsOption>(() => {
  const dark = appStore.getIsDark
  const barColor = dark ? '#87c6ef' : '#417ab6'
  const latestColor = dark ? '#76e6fa' : '#007a94'
  const axisColor = dark ? '#bed5ec' : '#425d77'
  return {
    aria: { enabled: true },
    animation: false,
    grid: { left: 9, right: 14, top: 25, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      formatter: (params) => {
        const point = Array.isArray(params) ? params[0] : params
        const row = point && rows.value[point.dataIndex]
        if (!row) return ''
        return [
          row.date,
          '报工产量  ' + formatQuantity(row.quantity),
          '合格  ' + formatQuantity(row.qualifiedQuantity),
          '不良  ' + formatQuantity(row.unqualifiedQuantity)
        ].join('\n')
      }
    },
    xAxis: {
      type: 'category',
      data: rows.value.map((row) => row.date.slice(5).replace('-', '/')),
      axisLabel: { color: axisColor, hideOverlap: true },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      splitNumber: 2,
      axisLabel: { color: axisColor }
    },
    series: [
      {
        name: '已完成报工产量',
        type: 'bar',
        barMaxWidth: 38,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        label: {
          show: trendDays.value === 7,
          position: 'top',
          color: axisColor,
          formatter: ({ dataIndex }) => {
            const row = rows.value[dataIndex]
            const text = formatQuantity(row.quantity)
            return text.length <= 8 ? text : ''
          }
        },
        data: rows.value.map((row, i, all) => ({
          value: Number(row.quantity),
          itemStyle: { color: i === all.length - 1 ? latestColor : barColor }
        }))
      }
    ]
  }
})

let requestVersion = 0
const loadData = async () => {
  const version = ++requestVersion
  if (!canQuery.value) {
    rows.value = []
    loading.value = false
    failed.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    const data = await MesHomeStatisticsApi.getProductionTrend(trendDays.value)
    if (version !== requestVersion) return
    const present = await periodHasReports(data)
    if (version === requestVersion) {
      rows.value = data
      hasReports.value = present
    }
  } catch {
    if (version === requestVersion) {
      rows.value = []
      failed.value = true
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

watch([canQuery, canReadFeedback, trendDays, () => props.refreshToken], loadData, {
  immediate: true
})
onBeforeUnmount(() => requestVersion++)
</script>

<style scoped lang="scss">
.home-trend {
  min-width: 0;
  min-height: 178px;

  :deep(.el-card__body) {
    padding: 0 18px;
  }
}

.trend-heading,
.trend-heading h2 {
  display: flex;
  align-items: center;
  gap: 9px;
}

.trend-heading {
  min-height: 46px;
  border-bottom: 1px solid var(--fm-divider);
  box-sizing: border-box;
  flex-wrap: wrap;
  justify-content: space-between;
  padding-block: 5px;

  h2 {
    margin: 0;
    font-size: 18px;
    line-height: 1.4;
    color: var(--fm-text);

    :deep(.iconify) {
      color: var(--fm-blue-ink);
    }
  }
}

.trend-chart {
  width: 100%;
}

.trend-state {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px 3px;
  color: var(--fm-text);

  .state-icon {
    padding: 11px;
    color: var(--fm-blue-ink);
    background: var(--fm-table-head);
    border-radius: 11px;
    box-sizing: content-box;
    flex-shrink: 0;
  }

  strong {
    display: block;
    font-size: 16px;
  }

  p {
    margin: 4px 0;
    font-size: 13px;
    color: var(--fm-secondary);
  }

  .el-button {
    padding: 0;
    margin-top: 4px;
  }
}
</style>
