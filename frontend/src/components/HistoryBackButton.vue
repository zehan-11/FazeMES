<script setup lang="ts">
import { Back } from '@element-plus/icons-vue'
import { getAccessToken } from '@/utils/auth'

defineProps<{ withLabel?: boolean }>()
const router = useRouter()
const destination = ref<string>()
// Vue Router supplies the previous SPA entry. Full-page links can instead have
// a browser history entry or a same-origin referrer from a different tab.
const navigation = (window as Window & {
  navigation?: { currentEntry: { index: number } | null; entries(): { url: string | null }[] }
}).navigation

function appPath(href?: string | null) {
  if (!href || href === location.href) return ''
  const source = new URL(href)
  const base = router.options.history.base.replace(/\/$/, '')
  if (source.origin !== location.origin ||
      (source.pathname !== base && !source.pathname.startsWith(base + '/'))) return ''
  return (source.pathname.slice(base.length) || '/') + source.search + source.hash
}

watch(router.currentRoute, () => {
  const back = router.options.history.state.back
  const index = navigation?.currentEntry?.index ?? -1
  const preceding = index > 0 ? navigation?.entries()[index - 1]?.url : undefined
  const nativePath = typeof back === 'string' && back ? back : appPath(preceding)
  const previous = nativePath || appPath(document.referrer)
  if (!previous || (previous.split(/[?#]/)[0] === '/login' && getAccessToken())) {
    destination.value = undefined
    return
  }
  destination.value = nativePath ? 'history' : previous
}, { immediate: true })

function goBack() {
  if (destination.value === 'history') router.back()
  else if (destination.value) void router.replace(destination.value)
}
</script>

<template>
  <button
    type="button"
    class="fm-history-back fm-icon-button"
    aria-label="返回上一页"
    :title="destination ? '返回上一页' : '当前标签页没有上一页'"
    :disabled="!destination"
    @click="goBack"
  >
    <el-icon :size="20" aria-hidden="true"><Back /></el-icon>
    <span v-if="withLabel">返回</span>
  </button>
</template>

<style scoped>
.fm-history-back {
  flex: none;
  gap: 4px;
}
.fm-history-back:disabled {
  opacity: 0.45;
  cursor: default;
  transform: none;
}
</style>
