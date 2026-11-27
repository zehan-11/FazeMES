<script setup lang="ts">
import { Moon, Sunny } from '@element-plus/icons-vue'
import { useAppStore } from '@/store/modules/app'

const app = useAppStore()
const label = computed(() => (app.getIsDark ? '切换到浅色主题' : '切换到深蓝主题'))
</script>

<template>
  <button
    type="button"
    class="fm-icon-button"
    :aria-label="label"
    :title="label"
    @click="app.setIsDark(!app.getIsDark)"
  >
    <ElIcon :size="18" aria-hidden="true"><Sunny v-if="app.getIsDark" /><Moon v-else /></ElIcon>
  </button>
</template>
