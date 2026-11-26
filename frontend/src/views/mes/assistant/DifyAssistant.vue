<template>
  <el-button plain @click="visible = true">项目手册问答 · Dify</el-button>
  <el-dialog v-model="visible" title="项目手册问答 · Dify" width="min(720px, 94vw)" append-to-body>
    <p v-if="studioUrl"
      ><a :href="studioUrl" target="_blank" rel="noopener noreferrer"
        >在 Dify 中查看编排画布 ↗</a
      ></p
    >
    <p>可查电风扇异常、工单排产、仓储质检、成本和报表等项目教学手册。企业规则与现场上传的文档请在知识助手中选择对应的 FazeMES 知识库检索。</p>
    <el-input
      v-model="question"
      type="textarea"
      :rows="2"
      maxlength="300"
      show-word-limit
      aria-label="手册问题"
      placeholder="电风扇会出现哪些异常？"
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
