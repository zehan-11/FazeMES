<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref } from 'vue'
import { usePreferredReducedMotion } from '@vueuse/core'
import { CountTo } from '@/components/CountTo'

const props = defineProps<{ value?: number | string | null }>()
const reduced = usePreferredReducedMotion()
const active = ref(true)
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
const label = computed(() => String(props.value ?? '—'))

// Animate the numeric runs of an already formatted KPI. Keep its units, ratios, placeholders and
// decimal precision. Values outside safe display precision are rendered exactly as received.
const pieces = computed(() =>
  label.value.split(/(-?\d[\d,]*(?:\.\d+)?)/).map((text, index) => {
    const raw = text.replaceAll(',', '')
    const decimals = raw.split('.')[1]?.length || 0
    const end = Number(raw)
    const animate =
      index % 2 === 1 &&
      end !== 0 &&
      decimals <= 6 &&
      Number.isSafeInteger(Number(raw.replace('.', ''))) &&
      end.toFixed(decimals) === raw
    return { text, end, decimals, animate, separator: text.includes(',') ? ',' : '' }
  })
)
</script>

<template>
  <span class="fm-number" :data-final="label">
    <span class="sr-only">{{ label }}</span>
    <span aria-hidden="true" class="fm-number-display">
      <template v-for="(piece, index) in pieces" :key="index + ':' + piece.text">
        <CountTo
          v-if="piece.animate && active && reduced !== 'reduce'"
          :end-val="piece.end"
          :duration="650"
          :decimals="piece.decimals"
          :separator="piece.separator"
        />
        <template v-else>{{ piece.text }}</template>
      </template>
    </span>
  </span>
</template>

<style scoped>
.fm-number {
  display: inline-grid;
  max-width: 100%;
  font-variant-numeric: tabular-nums;
}
.fm-number::before,
.fm-number-display {
  grid-area: 1 / 1;
}
.fm-number::before {
  content: attr(data-final);
  visibility: hidden;
}
</style>
