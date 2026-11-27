<script setup lang="ts" generic="T extends string | number">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = defineProps<{
  label: string
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  disabled?: boolean
}>()
const model = defineModel<T>({ required: true })
const group = useId()
const selected = computed(() => props.options.findIndex((option) => option.value === model.value))
const track = ref<HTMLElement>()
let observer: ResizeObserver | undefined
function measure() {
  const host = track.value
  const choice = host?.querySelector<HTMLElement>('.fm-segmented__option:has(input:checked)')
  if (!host || !choice?.offsetWidth) return
  host.style.setProperty('--slider-x', choice.offsetLeft + 'px')
  host.style.setProperty('--slider-width', choice.offsetWidth + 'px')
  host.classList.add('is-measured')
}
function observe() {
  const host = track.value
  if (!host || !observer) return
  observer.disconnect()
  observer.observe(host)
  host.querySelectorAll('.fm-segmented__option').forEach((label) => observer!.observe(label))
  measure()
}
onMounted(() => {
  observer = new ResizeObserver(measure)
  observe()
})
watch(() => props.options.map((option) => option.value), observe, { flush: 'post' })
watch(model, measure, { flush: 'post' })
onActivated(measure)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="fm-segmented" role="radiogroup" :aria-label="label">
    <div class="fm-segmented__track" :class="{ 'has-selection': selected >= 0 }" ref="track">
      <span class="fm-segmented__slider" aria-hidden="true"></span>
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
.fm-segmented:focus-within {
  border-color: var(--fm-focus);
  box-shadow: 0 0 0 3px var(--fm-focus-halo);
}
.fm-segmented__track {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
}
.fm-segmented__slider {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--slider-width, 0px);
  pointer-events: none;
  border: 1px solid var(--fm-primary-edge);
  border-radius: 999px;
  background: var(--fm-primary-glass);
  box-shadow:
    inset 0 1px var(--fm-highlight),
    0 0 9px rgb(34 211 238 / 22%);
  transform: translateX(var(--slider-x, 0px));
  opacity: 0;
}
.fm-segmented__track.is-measured.has-selection .fm-segmented__slider {
  opacity: 1;
  transition:
    transform 0.38s var(--fm-spring),
    width 0.38s var(--fm-spring);
}
.fm-segmented__option {
  flex: 1 1 auto;
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
  color: var(--fm-primary-ink);
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
  .fm-segmented__track.is-measured.has-selection .fm-segmented__slider {
    transition: none;
  }
}
</style>
