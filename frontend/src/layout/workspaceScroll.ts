import type { Router, RouterScrollBehavior } from 'vue-router'

const scroller = '.v-layout-content-scrollbar > .el-scrollbar__wrap'
type Bookmark = { path: string; left: number; top: number }
const key = (entry: number) => 'fazemes:workspace-scroll:' + entry
let pending: Bookmark | undefined
let stopWaiting: (() => void) | undefined

// The workspace scrolls inside Element Plus; browser history normally saves only the window.
export function trackWorkspaceScroll(router: Router) {
  let entry: number | undefined
  function remember(path: string) {
    const wrap = document.querySelector<HTMLElement>(scroller)
    const frame = wrap?.querySelector<HTMLElement>('[data-workspace-path]')
    if (entry === undefined || !wrap || frame?.dataset.workspacePath !== path) return
    try {
      const place: Bookmark = { path, left: wrap.scrollLeft, top: wrap.scrollTop }
      sessionStorage.setItem(key(entry), JSON.stringify(place))
    } catch { /* Storage can be disabled in a private tab. */ }
  }
  router.afterEach((_to, from, failure) => {
    if (failure) return
    remember(from.fullPath)
    stopWaiting?.()
    pending = undefined
    entry = Number(router.options.history.state.position)
  })
  window.addEventListener('pagehide', () => remember(router.currentRoute.value.fullPath))
}

export const workspaceScrollBehavior: RouterScrollBehavior = (to, _from, saved) => {
  let place: Bookmark = { path: to.fullPath, left: 0, top: 0 }
  if (saved) {
    try {
      const stored = sessionStorage.getItem(key(window.history.state.position))
      const previous: Bookmark | null = stored ? JSON.parse(stored) : null
      if (previous?.path === to.fullPath) place = previous
    } catch { /* Nothing to restore. */ }
  }
  pending = place
  restoreWorkspaceScroll()
  return saved ?? { left: 0, top: 0 }
}

export function restoreWorkspaceScroll() {
  const place = pending
  const wrap = document.querySelector<HTMLElement>(scroller)
  const frame = wrap?.querySelector<HTMLElement>('[data-workspace-path]')
  if (!place || !wrap || !frame || frame.dataset.workspacePath !== place.path || stopWaiting) return

  const apply = () => {
    wrap.scrollTo(place.left, place.top)
    return Math.abs(wrap.scrollTop - place.top) < 1 && Math.abs(wrap.scrollLeft - place.left) < 1
  }
  if (apply()) {
    pending = undefined
    return
  }
  const controller = new AbortController()
  const observer = new ResizeObserver(() => {
    if (apply()) finish()
  })
  function finish() {
    observer.disconnect()
    controller.abort()
    stopWaiting = undefined
    pending = undefined
  }
  // A list can mount before its data arrives. Yield immediately if the user starts scrolling.
  stopWaiting = finish
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    wrap.addEventListener(event, finish, { passive: true, signal: controller.signal })
  }
  observer.observe(frame)
}
