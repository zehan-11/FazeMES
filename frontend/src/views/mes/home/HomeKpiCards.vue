<template>
  <section aria-label="生产指标" class="kpi-grid">
    <component
      :is="item.path ? 'button' : 'div'"
      v-for="item in cards"
      :key="item.label"
      class="kpi fm-panel"
      :type="item.path ? 'button' : undefined"
      @click="item.path && emit('navigate', item.path)"
    >
      <span class="kpi-label">{{ item.label }}</span>
      <Icon class="kpi-icon" :icon="item.icon" :size="19" :color="item.color" />
      <span class="kpi-data">
        <strong><AnimatedNumber :value="item.value" /></strong>
        <span class="kpi-hint">{{ item.hint }}</span>
      </span>
    </component>
  </section>
</template>

<script setup lang="ts">
import AnimatedNumber from '@/components/AnimatedNumber.vue'
import type { MesHomeSummaryVO } from '@/api/mes/home'
import { formatQuantity, quantityUnits } from '@/utils/mesQuantity'

defineOptions({ name: 'HomeKpiCards' })

const props = defineProps<{
  summary: MesHomeSummaryVO
  destinations: Record<string, string>
  feedbackTotal?: number
}>()
const emit = defineEmits<{ navigate: [path: string] }>()

const cards = computed(() => {
  const data = props.summary
  const qualified = quantityUnits(data.todayQualifiedQuantity)
  const unqualified = quantityUnits(data.todayUnqualifiedQuantity)
  const total = (qualified ?? 0n) + (unqualified ?? 0n)
  const known = qualified !== undefined && unqualified !== undefined
  return [
    {
      label: '待排产工单',
      icon: 'ep:tickets',
      color: 'var(--fm-tone-warning)',
      value: data.workOrderPrepareCount + ' 张',
      hint: '工单草稿',
      path: props.destinations.MesProWorkOrder
    },
    {
      label: '今日报工产量',
      icon: 'ep:data-analysis',
      color: 'var(--fm-tone-success)',
      value: formatQuantity(data.todayOutput),
      hint:
        props.feedbackTotal === 0 ? '今日暂无报工' : '昨日 ' + formatQuantity(data.yesterdayOutput),
      path: props.destinations.MesProFeedback
    },
    {
      label: '报工合格率',
      icon: 'ep:circle-check',
      color: 'var(--fm-tone-warning)',
      value:
        known && total > 0n
          ? (Number((qualified * 1000n + total / 2n) / total) / 10).toFixed(1) + '%'
          : '—',
      hint:
        known && total > 0n
          ? '今日合格 ' +
            formatQuantity(data.todayQualifiedQuantity) +
            ' · 不良 ' +
            formatQuantity(data.todayUnqualifiedQuantity)
          : '暂无质量数据',
      path: props.destinations.MesProFeedback
    },
    {
      label: '运行中设备',
      icon: 'ep:cpu',
      color: 'var(--fm-blue-ink)',
      value: data.machineryProducing + ' / ' + data.machineryTotal,
      hint: data.machineryTotal
        ? '停机 ' + data.machineryStop + ' · 维护 ' + data.machineryMaintenance
        : '设备台账为空',
      path: props.destinations.MesDvMachinery
    }
  ]
})
</script>

<style scoped lang="scss">
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.kpi {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 81px;
  padding: 9px 16px;
  font: inherit;
  color: var(--fm-text);
  text-align: left;
  box-sizing: border-box;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 3px;
}

button.kpi {
  cursor: pointer;
}

button.kpi:focus-visible {
  outline: 2px solid var(--fm-focus);
  outline-offset: 1px;
}

.kpi-label {
  padding-right: 23px;
  font-size: 13px;
  color: var(--fm-secondary);
}

.kpi-icon {
  position: absolute;
  inset: 13px 14px auto auto;
}

.kpi-data {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 12px;
}

.kpi-data strong {
  max-width: 100%;
  font-size: clamp(22px, 2vw, 28px);
  font-weight: 650;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.kpi-hint {
  font-size: 12px;
  line-height: 1.4;
  color: var(--fm-secondary);
}

@container (max-width: 870px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container (max-width: 420px) {
  .kpi-grid {
    gap: 8px;
  }

  .kpi {
    padding: 10px;
  }

  .kpi-icon {
    top: 10px;
    right: 9px;
  }

  .kpi-data {
    column-gap: 6px;
  }
}
</style>
