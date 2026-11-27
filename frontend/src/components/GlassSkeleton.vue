<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'list' | 'cards' | 'dashboard'; label: string }>(), {
  variant: 'list'
})
</script>
<template>
  <div class="fm-skeleton" :class="'fm-skeleton--' + variant" role="status" aria-live="polite">
    <span class="sr-only">{{ label }}</span>
    <div
      v-for="i in variant === 'dashboard' ? 6 : 4"
      :key="i"
      class="fm-skeleton__block"
      aria-hidden="true"
    >
      <i></i><i></i><i></i>
    </div>
  </div>
</template>
<style scoped>
.fm-skeleton {
  display: grid;
  gap: 10px;
  width: 100%;
  padding: 8px;
}
.fm-skeleton--cards,
.fm-skeleton--dashboard {
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
}
.fm-skeleton--dashboard {
  min-height: 55vh;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 20px;
}
.fm-skeleton__block {
  display: grid;
  gap: 10px;
  align-content: center;
  padding: 18px;
  position: relative;
  overflow: hidden;
  background: var(--fm-card-glass);
  border: 1px solid var(--fm-line);
  border-radius: 12px;
  box-shadow: inset 0 1px var(--fm-highlight);
}
.fm-skeleton__block i {
  display: block;
  height: 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--fm-blue-ink) 14%, transparent);
}
.fm-skeleton__block i:nth-child(2) {
  width: 74%;
}
.fm-skeleton__block i:last-child {
  width: 45%;
}
.fm-skeleton--list .fm-skeleton__block {
  grid-template-columns: 2fr 1.3fr 1fr;
  padding: 10px 14px;
}
.fm-skeleton__block::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 27%, rgba(84, 219, 253, 0.16), transparent 70%);
  animation: fm-shimmer 1.6s ease-in-out infinite;
}
@keyframes fm-shimmer {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}
@media (max-width: 620px) {
  .fm-skeleton--dashboard {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .fm-skeleton__block::after {
    animation: none;
    opacity: 0;
  }
}
</style>
