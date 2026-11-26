<script lang="ts">
export interface PromptIdea {
  title: string
  detail: string
  question: string
}
</script>
<script setup lang="ts">
import {
  ArrowRight,
  Connection,
  DataAnalysis,
  Document,
  Files,
  Reading,
  Search
} from '@element-plus/icons-vue'
defineProps<{ items: PromptIdea[]; disabled?: boolean }>()
const emit = defineEmits<{ pick: [question: string] }>()
const icons = [Reading, Connection, Search, Files, Document, DataAnalysis]
</script>

<template>
  <div class="prompt-gallery">
    <div v-spotlight class="prompt-grid">
      <button
        v-for="(item, i) in items"
        :key="item.question"
        class="prompt-card fm-spotlight"
        type="button"
        :disabled="disabled"
        @click="emit('pick', item.question)"
      >
        <span class="prompt-icon"
          ><el-icon><component :is="icons[i % icons.length]" /></el-icon
        ></span>
        <span class="prompt-copy"
          ><strong>{{ item.title }}</strong
          ><small>{{ item.detail }}</small></span
        >
        <el-icon class="prompt-arrow"><ArrowRight /></el-icon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.prompt-gallery {
  width: 100%;
  container-type: inline-size;
}
.prompt-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.prompt-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 9px;
  padding: 14px 11px;
  border: 1px solid var(--fm-line);
  border-radius: 12px;
  background: var(--fm-card-glass);
  color: var(--fm-text);
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  box-shadow: inset 0 1px var(--fm-highlight);
  transition:
    transform var(--fm-motion),
    border-color var(--fm-motion);
}
.prompt-card:hover:not(:disabled),
.prompt-card:focus-visible {
  border-color: var(--fm-focus);
}
.prompt-icon,
.prompt-arrow {
  color: var(--fm-blue-ink);
}
.prompt-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--fm-hover);
}
.prompt-copy {
  display: grid;
  gap: 5px;
}
.prompt-copy strong {
  font-size: 14px;
  line-height: 1.45;
}
.prompt-copy small {
  color: var(--fm-muted);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}
.prompt-arrow {
  align-self: center;
  transition: transform var(--fm-motion);
}
.prompt-card:hover .prompt-arrow {
  transform: translateX(2px);
}
.prompt-card:disabled {
  opacity: 0.55;
  cursor: default;
}
@container (max-width: 670px) {
  .prompt-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 360px) {
  .prompt-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .prompt-card:hover .prompt-arrow {
    transform: none;
  }
}
</style>
