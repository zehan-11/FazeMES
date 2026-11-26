import type { ObjectDirective } from 'vue'

const cleanups = new WeakMap<HTMLElement, () => void>()

// One delegated listener per grid, regardless of its size. Only the pointed card receives writes.
export const vSpotlight: ObjectDirective<HTMLElement> = {
  mounted(grid) {
    const motion = window.matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
    )
    let active: HTMLElement | null = null
    let frame = 0
    let x = 0
    let y = 0

    function leave() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      active?.classList.remove('is-lit')
      active = null
    }
    function paint() {
      frame = 0
      if (!active || !active.isConnected) return
      const rect = active.getBoundingClientRect()
      active.style.setProperty('--spot-x', x - rect.left + 'px')
      active.style.setProperty('--spot-y', y - rect.top + 'px')
      active.classList.add('is-lit')
    }
    function move(event: PointerEvent) {
      if (event.pointerType === 'touch' || !(event.target instanceof Element)) return
      const card = event.target.closest<HTMLElement>('.fm-spotlight')
      if (!card || !grid.contains(card) || card.matches(':disabled, .is-disabled')) return leave()
      if (active !== card) {
        leave()
        active = card
      }
      x = event.clientX
      y = event.clientY
      if (!frame) frame = requestAnimationFrame(paint)
    }
    function sync() {
      leave()
      grid.removeEventListener('pointermove', move)
      if (motion.matches) grid.addEventListener('pointermove', move, { passive: true })
    }
    sync()
    motion.addEventListener('change', sync)
    grid.addEventListener('pointerleave', leave)
    grid.addEventListener('pointercancel', leave)
    cleanups.set(grid, () => {
      leave()
      grid.removeEventListener('pointermove', move)
      grid.removeEventListener('pointerleave', leave)
      grid.removeEventListener('pointercancel', leave)
      motion.removeEventListener('change', sync)
    })
  },
  unmounted(grid) {
    cleanups.get(grid)?.()
    cleanups.delete(grid)
  }
}
