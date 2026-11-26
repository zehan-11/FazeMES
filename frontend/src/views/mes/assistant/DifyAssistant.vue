<template>
  <el-button plain @click="visible = true">设备手册问答 · Dify</el-button>
  <el-dialog v-model="visible" title="设备手册问答 · Dify" width="min(720px, 94vw)" append-to-body>
    <p v-if="studioUrl"
      ><a :href="studioUrl" target="_blank" rel="noopener noreferrer"
        >在 Dify 中查看编排画布 ↗</a
      ></p
    >
    <p>检索范围为 Dify 的设备点检示例手册。命中片段后，由本机 Qwen 生成回答。</p>
    <el-input
      v-model="question"
      type="textarea"
      :rows="2"
      maxlength="300"
      show-word-limit
      aria-label="设备问题"
      placeholder="巡检发现设备异响时记录哪些信息？"
      :disabled="busy"
      @keydown.ctrl.enter.prevent="ask"
    />
    <el-button
      class="mt-12px"
      type="primary"
      :loading="busy"
      :disabled="!question.trim() || busy"
      @click="ask"
    >
      {{ busy ? '工作流运行中' : '运行 Dify 问答' }}
    </el-button>
    <el-alert v-if="error" class="mt-12px" :title="error" type="error" :closable="false" />
    <article v-if="result" class="mt-16px" aria-live="polite">
      <h3>{{ result.question }}</h3>
      <p v-if="result.status === 'succeeded'" class="answer">{{ result.answer }}</p>
      <el-alert
        v-else
        :title="'Dify 运行未成功 · ' + result.status"
        type="warning"
        :closable="false"
      />
      <details v-for="(source, i) in result.sources" :key="i">
        <summary>[{{ i + 1 }}] {{ source.title }}</summary
        ><p class="answer">{{ source.text }}</p>
      </details>
      <el-button
        v-if="result.steps.length"
        class="mt-12px"
        @click="$emit('journey', difyJourney(result))"
        >查看本次执行流程</el-button
      >
    </article>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onDeactivated } from 'vue'
import { runDify, type DifyRun } from '@/api/mes/assistant/dify'
import { difyJourney, type Journey } from './workflowJourney'
defineEmits<{ journey: [data: Journey] }>()
const studioUrl = import.meta.env.VITE_DIFY_STUDIO_URL
const visible = ref(false)
const question = ref('')
const busy = ref(false)
const error = ref('')
const result = ref<DifyRun>()
onDeactivated(() => {
  visible.value = false
})

async function ask() {
  const input = question.value.trim()
  if (!input || busy.value) return
  busy.value = true
  error.value = ''
  result.value = undefined
  try {
    result.value = await runDify(input)
  } catch (cause) {
    error.value =
      typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : 'Dify 请求失败'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.answer {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
details {
  margin-top: 8px;
}
summary {
  cursor: pointer;
}
</style>
