import type { ObjectDirective } from 'vue'

const cleanups = new WeakMap<HTMLElement, () => void>()
const limit = (n: number) => Math.max(-1, Math.min(1, n))

export const vTechCard: ObjectDirective<HTMLElement> = {
  mounted(card) {
    const optics = document.createElement('span')
    optics.className = 'fm-card-optics'
    optics.setAttribute('aria-hidden', 'true')
    optics.appendChild(document.createElement('i'))
    if (card.classList.contains('fm-auto-scan')) optics.appendChild(document.createElement('b'))
    card.appendChild(optics)
    card.classList.add('fm-tech-card')
    const motion = matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
    )
    let x = 0,
      y = 0,
      frame = 0
    function paint() {
      frame = 0
      const bounds = card.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const px = x - bounds.left,
        py = y - bounds.top
      const nearest = Math.min(px, bounds.width - px, py, bounds.height - py)
      let edgeX = px,
        edgeY = py
      if (nearest === px) edgeX = 0
      else if (nearest === bounds.width - px) edgeX = bounds.width
      else if (nearest === py) edgeY = 0
      else edgeY = bounds.height
      card.style.setProperty('--edge-x', edgeX + 'px')
      card.style.setProperty('--edge-y', edgeY + 'px')
      card.style.setProperty('--spot-x', px + 'px')
      card.style.setProperty('--spot-y', py + 'px')
      card.style.setProperty('--tilt-x', -3.5 * limit((2 * py) / bounds.height - 1) + 'deg')
      card.style.setProperty('--tilt-y', 3.5 * limit((2 * px) / bounds.width - 1) + 'deg')
      card.classList.add('is-lit')
    }
    function move(e: PointerEvent) {
      if (!motion.matches || e.pointerType === 'touch' || card.matches(':disabled, .is-disabled'))
        return
      x = e.clientX
      y = e.clientY
      if (!frame) frame = requestAnimationFrame(paint)
    }
    function reset() {
      cancelAnimationFrame(frame)
      frame = 0
      card.classList.remove('is-lit')
    }
    card.addEventListener('pointerenter', move)
    card.addEventListener('pointermove', move, { passive: true })
    card.addEventListener('pointerleave', reset)
    card.addEventListener('pointercancel', reset)
    motion.addEventListener('change', reset)
    cleanups.set(card, () => {
      reset()
      optics.remove()
      card.removeEventListener('pointerenter', move)
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerleave', reset)
      card.removeEventListener('pointercancel', reset)
      motion.removeEventListener('change', reset)
    })
  },
  unmounted(card) {
    cleanups.get(card)?.()
    cleanups.delete(card)
  }
}
