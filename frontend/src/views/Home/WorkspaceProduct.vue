<template>
  <section class="workspace-product" aria-label="工单产品">
    <h2><Icon icon="ep:goods" />工单产品</h2>
    <template v-if="order">
      <div class="product-body">
        <div class="product-copy">
          <strong :title="productName">{{ productName }}</strong>
          <span :title="caption">{{ caption }}</span>
        </div>
        <div class="product-visual">
          <img v-if="hasFanImage" :src="fanIllustration" :alt="productName + '风扇整机示意图'" />
          <figure v-else-if="parts.length" class="bom">
            <figcaption>物料构成</figcaption>
            <ul :aria-label="productName + '物料构成'">
              <li v-for="part in parts" :key="part.id ?? part.bomItemId">
                <span :title="$catalogLabel(part.bomItemName)">
                  {{ $catalogLabel(part.bomItemName) || part.bomItemCode || '未命名物料' }}
                </span>
                <small>× {{ formatQuantity(part.quantity) }} {{ part.unitMeasureName }}</small>
              </li>
            </ul>
          </figure>
          <div v-else class="no-image" role="status">
            <Icon icon="ep:box" :size="26" />
            <span>{{ partsLoading ? '读取物料构成…' : '暂无产品图' }}</span>
            <el-button v-if="partsFailed" link type="primary" @click="reload++"
              >重试物料构成</el-button
            >
          </div>
        </div>
      </div>
      <div class="product-footer">
        <span>关联工单</span>
        <strong>{{ order.code }}</strong>
      </div>
    </template>
    <p v-else class="product-empty" role="status">
      {{ failed ? '无法读取工单产品' : loading ? '正在读取工单…' : '暂无关联工单' }}
    </p>
  </section>
</template>

<script setup lang="ts">
import type { ProWorkOrderVO } from '@/api/mes/pro/workorder'
import { MdProductBomApi, type MdProductBomVO } from '@/api/mes/md/item/productBom'
import fanIllustration from '@/assets/imgs/broky-workspace-fan.png'
import { catalogLabel } from '@/utils/catalogLabel'
import { formatQuantity } from '@/utils/mesQuantity'
import { checkPermi } from '@/utils/permission'

const props = defineProps<{ order?: ProWorkOrderVO; loading: boolean; failed: boolean }>()
const productName = computed(() => catalogLabel(props.order?.productName) || '未指定产品')
// The bundled illustration depicts the assembled Broky, not its subassemblies or other fans.
const hasFanImage = computed(() => props.order?.productCode === 'BROKY-FG-V2')
const caption = computed(() =>
  hasFanImage.value
    ? '台式电风扇 · 装配示意'
    : catalogLabel(props.order?.productSpecification) || props.order?.productCode || ''
)
const parts = ref<MdProductBomVO[]>([])
const partsLoading = ref(false)
const partsFailed = ref(false)
const reload = ref(0)
const canReadParts = computed(() => checkPermi(['mes:md-item:query']))

watch(
  [() => props.order, canReadParts, reload],
  async ([order, allowed], _old, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
    })
    parts.value = []
    partsLoading.value = false
    partsFailed.value = false
    if (!order?.productId || hasFanImage.value || !allowed) return

    partsLoading.value = true
    try {
      const result: MdProductBomVO[] = await MdProductBomApi.getProductBomListByItemId(
        order.productId
      )
      if (current) parts.value = result.filter((part) => part.status === 0)
    } catch {
      if (current) partsFailed.value = true
    } finally {
      if (current) partsLoading.value = false
    }
  },
  { immediate: true }
)
</script>

<style scoped lang="scss">
.workspace-product {
  position: relative;
  display: flex;
  height: 228px;
  min-width: 0;
  padding: 14px 18px 12px;
  overflow: hidden;
  color: var(--fm-text);
  background: var(--fm-card-glass);
  border: 1px solid var(--fm-line);
  border-radius: var(--fm-panel-radius);
  box-shadow:
    inset 0 1px var(--fm-highlight),
    var(--fm-shadow);
  box-sizing: border-box;
  isolation: isolate;
  flex-direction: column;
}

.workspace-product::before {
  position: absolute;
  z-index: -1;
  inset: 7px 0 38px 48%;
  background-image:
    linear-gradient(var(--fm-divider) 1px, transparent 1px),
    linear-gradient(90deg, var(--fm-divider) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: linear-gradient(90deg, transparent, black 18%, black 90%, transparent);
  content: '';
}

.workspace-product h2 {
  display: flex;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
  gap: 8px;
  align-items: center;
}

.workspace-product h2 :deep(.iconify) {
  color: var(--fm-blue-ink);
}

.product-body {
  display: grid;
  grid-template-columns: 0.92fr 1.08fr;
  flex: 1;
  min-height: 0;
  gap: 6px;
}

.product-copy {
  align-self: center;
  overflow: hidden;
}

.product-copy strong,
.product-copy > span {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.product-copy strong {
  max-width: 10ch;
  font-size: clamp(20px, 2.1vw, 27px);
  line-height: 1.14;
}

.product-copy > span {
  margin-top: 8px;
  font-size: 13px;
  color: var(--fm-secondary);
}

.product-visual {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  align-items: center;
}

.product-visual img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.product-footer {
  display: flex;
  padding-top: 8px;
  font-size: 12px;
  border-top: 1px solid var(--fm-divider);
  gap: 12px;
  align-items: baseline;
}

.product-footer > span {
  color: var(--fm-secondary);
  flex-shrink: 0;
}

.product-footer strong {
  overflow-wrap: anywhere;
  font-weight: 500;
  color: var(--fm-blue-ink);
}

.product-empty,
.no-image {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fm-secondary);
}

.product-empty {
  flex: 1;
}

.no-image {
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
}

.bom {
  display: flex;
  max-height: 138px;
  min-width: 0;
  margin: 0;
  flex-direction: column;
}

.bom figcaption {
  margin-bottom: 5px;
  font-size: 12px;
  color: var(--fm-secondary);
}

.bom ul {
  padding: 0;
  margin: 0;
  overflow: auto;
  list-style: none;
  scrollbar-width: thin;
}

.bom li {
  display: flex;
  padding: 5px 0 5px 7px;
  font-size: 12px;
  background: var(--fm-card);
  border-left: 2px solid var(--fm-button-edge);
  justify-content: space-between;
  gap: 6px;
}

.bom li + li {
  margin-top: 3px;
}

.bom li span {
  overflow-wrap: anywhere;
}

.bom li small {
  font-size: 12px;
  color: var(--fm-blue-ink);
  white-space: nowrap;
}
</style>
