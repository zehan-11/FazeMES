<template>
  <section v-loading="loading" class="workspace-orders" aria-label="工单进度">
    <header class="order-header">
      <h2><Icon icon="ep:tickets" />工单进度</h2>
      <el-link
        v-if="allOrdersPath"
        type="primary"
        underline="never"
        @click="emit('navigate', allOrdersPath)"
        >全部工单 <Icon icon="ep:arrow-right" :size="13"
      /></el-link>
    </header>
    <p v-if="failed" class="orders-message" role="status">
      工单加载失败
      <el-button link type="primary" @click="emit('retry')">重试</el-button>
    </p>
    <template v-else-if="rows.length">
      <div class="order-columns column-headings" aria-hidden="true">
        <span>产品 / 工单号</span><span>已产 / 计划</span><span>完成进度</span><span>状态</span>
      </div>
      <div class="order-list" aria-label="选择工单">
        <button
          v-for="{ order, percent } in rows"
          :key="order.id"
          type="button"
          class="order-columns order-row"
          :aria-pressed="order.id === selected?.id"
          @click="selectedId = order.id"
        >
          <span class="order-identity">
            <strong :title="$catalogLabel(order.productName)">{{
              $catalogLabel(order.productName) || '未指定产品'
            }}</strong>
            <small :title="order.code">{{ order.code }}</small>
          </span>
          <span
            class="quantity"
            :title="`${formatQuantity(order.quantityProduced)} / ${formatQuantity(order.quantity)}`"
          >
            {{ formatQuantity(order.quantityProduced) }} / {{ formatQuantity(order.quantity) }}
          </span>
          <span class="completion">
            <span class="track" aria-hidden="true">
              <i :style="{ width: Math.min(percent ?? 0, 100) + '%' }"></i>
            </span>
            {{ percent === undefined ? '—' : percent + '%' }}
          </span>
          <span
            class="order-status"
            :class="{ draft: order.status === MesProWorkOrderStatusEnum.PREPARE }"
          >
            {{ getDictLabel(DICT_TYPE.MES_PRO_WORK_ORDER_STATUS, order.status) || '—' }}
          </span>
          <Icon
            v-if="order.id === selected?.id"
            class="selected-arrow"
            icon="ep:arrow-right"
            :size="13"
          />
        </button>
      </div>
    </template>
    <p v-else-if="!loading" class="orders-message">暂无生产工单</p>
  </section>
  <WorkspaceProduct :order="failed ? undefined : selected" :loading="loading" :failed="failed" />
</template>

<script setup lang="ts">
import type { ProWorkOrderVO } from '@/api/mes/pro/workorder'
import { DICT_TYPE, getDictLabel } from '@/utils/dict'
import { formatQuantity, quantityUnits } from '@/utils/mesQuantity'
import { MesProWorkOrderStatusEnum } from '@/views/mes/utils/constants'
import WorkspaceProduct from './WorkspaceProduct.vue'

const props = defineProps<{
  orders: ProWorkOrderVO[]
  loading: boolean
  failed: boolean
  allOrdersPath?: string
}>()
const emit = defineEmits<{ navigate: [path: string]; retry: [] }>()
const selectedId = ref<number>()
watch(
  () => props.orders,
  (orders) => {
    if (orders.length && !orders.some((order) => order.id === selectedId.value)) {
      selectedId.value = orders[0].id
    }
  },
  { immediate: true }
)
const selected = computed(() => props.orders.find((order) => order.id === selectedId.value))
const rows = computed(() =>
  props.orders.map((order) => {
    const actual = quantityUnits(order.quantityProduced)
    const plan = quantityUnits(order.quantity)
    const percent =
      actual !== undefined && plan !== undefined && plan > 0n
        ? Number((actual * 1000n) / plan) / 10
        : undefined
    return { order, percent }
  })
)
</script>

<style scoped lang="scss">
.workspace-orders {
  height: 228px;
  min-width: 0;
  padding: 14px 18px 12px;
  color: var(--fm-text);
  background: var(--fm-card-glass);
  border: 1px solid var(--fm-line);
  border-radius: var(--fm-panel-radius);
  box-shadow:
    inset 0 1px var(--fm-highlight),
    var(--fm-shadow);
  box-sizing: border-box;
  container-type: inline-size;
}

.order-header,
.order-header h2,
.orders-message,
.completion {
  display: flex;
  align-items: center;
}

.order-header {
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.order-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
  gap: 8px;
}

.order-header h2 :deep(.iconify) {
  color: var(--fm-blue-ink);
}

.orders-message {
  min-height: 120px;
  justify-content: center;
  gap: 8px;
  color: var(--fm-secondary);
}

.order-columns {
  display: grid;
  grid-template-columns:
    minmax(0, 1.9fr) minmax(0, 0.93fr) minmax(0, 1.38fr) minmax(46px, 0.54fr)
    13px;
  align-items: center;
  gap: 12px;
  padding: 0 10px 0 13px;
}

.column-headings {
  height: 27px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--fm-secondary);
  background: var(--fm-table-head);
  border-radius: 4px;
}

.order-list {
  max-height: 134px;
  overflow: auto;
  scrollbar-width: thin;
}

.order-row {
  position: relative;
  width: 100%;
  min-height: 54px;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--fm-divider);
}

.order-row:hover {
  background: var(--fm-table-hover);
}

.order-row[aria-pressed='true'] {
  background: var(--fm-table-hover);
  border-radius: 6px;
}

.order-row[aria-pressed='true']::before {
  position: absolute;
  width: 3px;
  background: var(--fm-focus);
  border-radius: 2px;
  content: '';
  inset: 6px auto 6px 0;
}

.order-row:focus-visible {
  outline: 2px solid var(--fm-focus);
  outline-offset: -2px;
}

.order-identity {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding-block: 6px;
}

.order-identity > *,
.quantity {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-identity strong {
  font-size: 14px;
  font-weight: 600;
}

.order-identity small,
.completion {
  font-size: 12px;
  color: var(--fm-secondary);
}

.quantity,
.completion {
  font-variant-numeric: tabular-nums;
}

.quantity {
  font-size: 14px;
}

.completion {
  gap: 8px;
  white-space: nowrap;
}

.track {
  height: 5px;
  overflow: hidden;
  background: var(--fm-strong-line);
  border-radius: 4px;
  flex: 1;
}

.track i {
  display: block;
  height: 100%;
  background: var(--fm-focus);
  border-radius: inherit;
}

.order-status {
  padding: 3px 7px;
  font-size: 12px;
  color: var(--fm-blue-ink);
  white-space: nowrap;
  background: var(--fm-table-head);
  border-radius: 5px;
  justify-self: start;
}

.draft {
  color: var(--fm-tone-warning);
  background: color-mix(in srgb, var(--fm-tone-warning) 13%, transparent);
}

.selected-arrow {
  color: var(--fm-blue-ink);
}

@container (max-width: 490px) {
  .order-columns {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 45px 46px;
    gap: 5px;
    padding-inline: 6px;
  }

  .track,
  .selected-arrow {
    display: none;
  }

  .order-status {
    padding-inline: 4px;
  }
}
</style>
