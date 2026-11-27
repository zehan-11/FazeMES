<template>
  <iframe
    v-if="active"
    ref="frame"
    :src="url"
    title="FazeMES 生产智能协同中心"
    class="fan-works-frame"
    allowfullscreen
    referrerpolicy="no-referrer"
    @load="send"
  ></iframe>
</template>
<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { WorksRun, WorkspaceAccess, SceneCommand } from './fanWorksRecords'
const props = defineProps<{ run?: WorksRun; access?: WorkspaceAccess }>()
const emit = defineEmits<{ command: [command: SceneCommand] }>()
const frame = ref<HTMLIFrameElement>()
const active = ref(true)
const url = import.meta.env.BASE_URL + 'heaven-works/index.html'
function send() {
  if (!active.value || !frame.value?.contentWindow) return
  // Vue proxies cannot be posted. The payload contains only display data for this turn.
  const snapshot = JSON.parse(
    JSON.stringify({ run: props.run || null, access: props.access || null })
  )
  frame.value.contentWindow.postMessage(
    { type: 'fazemes:session', ...snapshot },
    window.location.origin
  )
}
function receive(event: MessageEvent) {
  if (
    !active.value ||
    event.origin !== window.location.origin ||
    event.source !== frame.value?.contentWindow
  )
    return
  if (event.data?.type === 'fazemes:ready') send()
  if (props.access && event.data?.type === 'fazemes:command' && event.data.command)
    emit('command', event.data.command)
}
onMounted(() => window.addEventListener('message', receive))
onBeforeUnmount(() => window.removeEventListener('message', receive))
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
watch([() => props.run, () => props.access], send, { flush: 'post' })
</script>
<style scoped>
.fan-works-frame {
  display: block;
  width: 100%;
  height: clamp(540px, 78vh, 1100px);
  border: 0;
  background: #04060a;
}
</style>
