<template>
  <el-button plain size="small" @click="openReplay">天工开物回放</el-button>
  <el-dialog
    v-if="visible"
    v-model="visible"
    title="天工开物 · 本轮回放"
    fullscreen
    append-to-body
    destroy-on-close
    :body-style="{ padding: '0' }"
  >
    <FanWorksFrame v-if="visible && run" class="full-frame" :run="run" />
  </el-dialog>
</template>

<script setup lang="ts">
import { onDeactivated, ref, shallowRef } from 'vue'
import type { KittingAnalysis } from '@/api/mes/pro/kitting'
import type { BusinessTurn } from '@/api/mes/insight/business'
import type { Journey } from './workflowJourney'
import { businessRun, journeyRun, kittingRun, type WorksRun } from './fanWorksRecords'
import FanWorksFrame from './FanWorksFrame.vue'

const props = defineProps<{ record: Journey | BusinessTurn | KittingAnalysis }>()
const visible = ref(false)
const run = shallowRef<WorksRun>()
function openReplay() {
  const value = props.record
  run.value =
    'materials' in value
      ? kittingRun(value)
      : 'origin' in value
        ? journeyRun(value)
        : businessRun(value)
  visible.value = true
}
onDeactivated(() => {
  visible.value = false
})
</script>

<style scoped>
.full-frame {
  height: calc(100dvh - 72px);
}
</style>
