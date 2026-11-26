<script setup lang="ts" generic="T extends string | number">
import { computed, useId } from 'vue'

const props = defineProps<{
  label: string
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  disabled?: boolean
}>()
const model = defineModel<T>({ required: true })
const group = useId()
const selected = computed(() => props.options.findIndex((option) => option.value === model.value))
</script>

<template>
  <div class="fm-segmented" role="radiogroup" :aria-label="label">
    <div
      class="fm-segmented__track"
      :class="{ 'has-selection': selected >= 0 }"
      :style="{ '--count': Math.max(1, options.length), '--selected': selected }"
    >
      <label v-for="option in options" :key="option.value" class="fm-segmented__option">
        <input
          type="radio"
          :name="group"
          :value="option.value"
          :checked="model === option.value"
          :disabled="disabled || option.disabled"
          @change="model = option.value"
        />
        <span>{{ option.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.fm-segmented {
  display: inline-flex;
  max-width: 100%;
  padding: 3px;
  border: 1px solid var(--fm-strong-line);
  border-radius: 999px;
  background: var(--fm-slot);
}
.fm-segmented__track {
  display: grid;
  position: relative;
  width: 100%;
  grid-template-columns: repeat(var(--count), minmax(0, 1fr));
}
.fm-segmented__track::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: calc(100% / var(--count));
  border-radius: 999px;
  background: linear-gradient(120deg, var(--el-color-primary), #2048ba);
  box-shadow:
    inset 0 1px rgb(255 255 255 / 20%),
    0 2px 9px rgb(37 99 235 / 28%);
  transform: translateX(calc(100% * var(--selected)));
  transition: transform 220ms var(--fm-ease);
  pointer-events: none;
  opacity: 0;
}
.fm-segmented__track.has-selection::before {
  opacity: 1;
}
.fm-segmented__option {
  position: relative;
  min-width: 0;
  cursor: pointer;
}
.fm-segmented__option input {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
}
.fm-segmented__option span {
  display: block;
  padding: 7px 11px;
  color: var(--fm-secondary);
  border-radius: 999px;
  font-size: 13px;
  line-height: 18px;
  text-align: center;
  overflow-wrap: anywhere;
}
.fm-segmented__option input:checked + span {
  color: white;
}
.fm-segmented__option input:focus-visible + span {
  outline: 2px solid var(--fm-focus);
  outline-offset: 2px;
}
.fm-segmented__option input:disabled + span {
  opacity: 0.62;
  cursor: not-allowed;
}
@media (pointer: coarse) {
  .fm-segmented__option span {
    padding-block: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fm-segmented__track::before {
    transition: none;
  }
}
</style>
