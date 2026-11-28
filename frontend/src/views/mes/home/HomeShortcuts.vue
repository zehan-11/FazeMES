<template>
  <section class="shortcuts-panel fm-panel" aria-label="岗位常用入口">
    <h2><Icon icon="ep:grid" :size="18" />岗位常用入口</h2>
    <div class="shortcuts">
      <el-button
        v-for="item in items"
        :key="item.path"
        class="shortcut"
        @click="emit('navigate', item.path)"
      >
        <Icon :icon="item.icon" :size="16" />
        <span>{{ item.name }}</span>
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
defineOptions({ name: 'HomeShortcuts' })
defineProps<{ items: { name: string; path: string; icon: string }[] }>()
const emit = defineEmits<{ navigate: [path: string] }>()
</script>

<style scoped lang="scss">
.shortcuts-panel {
  padding: 14px 18px 18px;
  box-sizing: border-box;
}

.shortcuts-panel h2 {
  display: flex;
  margin: 0 0 16px;
  font-size: 18px;
  line-height: 1.4;
  color: var(--fm-text);
  align-items: center;
  gap: 9px;
}

.shortcuts-panel h2 :deep(.iconify) {
  color: var(--fm-blue-ink);
}

.shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 96px), 1fr));
  gap: 9px;
}

.shortcut {
  height: auto;
  min-height: 38px;
  padding: 7px;
  margin: 0;
  font-size: 13px;
  white-space: normal;
  justify-content: flex-start;
}

.shortcut :deep(> span) {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
