<template>
  <iframe
    v-if="active"
    ref="frame"
    :src="url"
    title="天工开物 · 电风扇织造台"
    class="fan-works-frame"
    allowfullscreen
    referrerpolicy="no-referrer"
    @load="sendRun"
  ></iframe>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import type { WorksRun } from './fanWorksRecords'

const props = defineProps<{ run?: WorksRun }>()
const frame = ref<HTMLIFrameElement>()
const active = ref(true)
const url = computed(
  () => `${import.meta.env.BASE_URL}heaven-works/index.html${props.run ? '?view=record' : ''}`
)
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
function sendRun() {
  if (!props.run || !frame.value?.contentWindow) return
  const { source, question, answer, steps, shortageParts } = props.run
  frame.value.contentWindow.postMessage(
    {
      type: 'fazemes:works-run',
      run: {
        source,
        question,
        answer,
        shortageParts: [...(shortageParts || [])],
        steps: steps.map((step) => ({ ...step }))
      }
    },
    window.location.origin
  )
}
watch(() => props.run, sendRun, { flush: 'post' })
</script>

<style scoped>
.fan-works-frame {
  display: block;
  width: 100%;
  height: clamp(440px, 74vh, 1080px);
  border: 0;
  background: #04060a;
}
</style>
