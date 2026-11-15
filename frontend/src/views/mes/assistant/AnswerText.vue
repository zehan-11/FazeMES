<template>
  <div class="answer-text"
    ><template v-for="(part, index) in parts" :key="index"
      ><button
        v-if="part.citation"
        type="button"
        class="answer-citation"
        :aria-label="`查看引用 ${part.text}`"
        @click="$emit('citation', part.citation)"
        >{{ part.text }}</button
      ><span v-else>{{ part.text }}</span></template
    ></div
  >
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { Citation } from '@/api/mes/assistant'
const props = defineProps<{ content: string; citations: Citation[] }>()
defineEmits<{ citation: [value: Citation] }>()
const parts = computed(() =>
  props.content.split(/(\[\d+\])/g).map((text) => {
    const match = /^\[(\d+)\]$/.exec(text)
    return { text, citation: match ? props.citations[Number(match[1]) - 1] : undefined }
  })
)
</script>
<style scoped>
.answer-text {
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.answer-citation {
  padding: 2px 5px;
  margin: 0 2px;
  color: var(--el-color-primary);
  cursor: pointer;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 4px;
}

.answer-citation:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
