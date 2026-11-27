import type { ObjectDirective } from 'vue'

export const vTactile: ObjectDirective<HTMLElement> = {
  mounted(el) {
    el.dataset.tactile = ''
  }
}
export const vMagnetic: ObjectDirective<HTMLElement> = {
  mounted(el) {
    el.dataset.magnetic = ''
  }
}

const buttons = '.el-button, .ai-trigger, .fm-icon-button, [data-tactile], [data-magnetic]'

// Delegation includes popups teleported to body and leaves each control's native click intact.
export function bindTactile() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const fine = matchMedia('(hover: hover) and (pointer: fine)')
  let active: HTMLElement | null = null
  let frame = 0,
    x = 0,
    y = 0
  let magnetic = false
  function button(target: EventTarget | null) {
    if (!(target instanceof Element) || target.closest('.knowledge-graph, .v-login')) return null
    const el = target.closest<HTMLElement>(buttons)
    if (el && document.querySelector('.v-login') && !el.closest('.fm-face-login-dialog'))
      return null
    return el && !el.matches(':disabled, .is-disabled, .is-loading, [aria-disabled="true"]')
      ? el
      : null
  }
  function layer(el: HTMLElement) {
    let node = el.querySelector<HTMLElement>(':scope > .fm-tactile-layer')
    if (!node) {
      node = document.createElement('i')
      node.className = 'fm-tactile-layer'
      node.setAttribute('aria-hidden', 'true')
      el.appendChild(node)
    }
    return node
  }
  function reset() {
    if (active) {
      active.classList.remove('fm-tracking')
      active.style.removeProperty('--mag-x')
      active.style.removeProperty('--mag-y')
    }
    active = null
    cancelAnimationFrame(frame)
    frame = 0
  }
  function paint() {
    frame = 0
    if (!active || !active.isConnected) return
    const r = active.getBoundingClientRect()
    if (!r.width || !r.height) return
    active.style.setProperty('--rx', x - r.left + 'px')
    active.style.setProperty('--ry', y - r.top + 'px')
    if (magnetic) {
      const drift = (fraction: number) => Math.max(-6, Math.min(6, 12 * (fraction - 0.5))) + 'px'
      active.style.setProperty('--mag-x', drift((x - r.left) / r.width))
      active.style.setProperty('--mag-y', drift((y - r.top) / r.height))
    }
  }
  function move(e: PointerEvent) {
    const el = button(e.target)
    if (el !== active) {
      reset()
      if (!el || e.pointerType === 'touch' || !fine.matches || reduced.matches) return
      active = el
      magnetic =
        el.hasAttribute('data-magnetic') ||
        (!el.closest('.el-table') &&
          (Boolean(el.querySelector('[data-icon="ep:plus"]')) ||
            /^(?:\+\s*)?(?:新增|添加|新建|Add\b|Create\b)/iu.test(el.textContent?.trim() || '')))
      layer(el)
      el.classList.add('fm-tracking')
    }
    if (!active) return
    x = e.clientX
    y = e.clientY
    if (!frame) frame = requestAnimationFrame(paint)
  }
  function out(e: PointerEvent) {
    if (active && (!(e.relatedTarget instanceof Node) || !active.contains(e.relatedTarget))) reset()
  }
  function ripple(e: MouseEvent) {
    const el = button(e.target)
    if (!el || reduced.matches || e.button !== 0) return
    const r = el.getBoundingClientRect()
    const center = e.type === 'click'
    const span = document.createElement('span')
    span.className = 'fm-ripple'
    span.style.left = (center ? r.width / 2 : e.clientX - r.left) + 'px'
    span.style.top = (center ? r.height / 2 : e.clientY - r.top) + 'px'
    span.style.width = Math.ceil(2 * Math.hypot(r.width, r.height)) + 'px'
    layer(el).appendChild(span)
    window.setTimeout(() => span.remove(), 650)
  }
  function keyboardClick(e: MouseEvent) {
    if (e.detail === 0) ripple(e)
  }
  function drawCheckbox(e: AnimationEvent) {
    if (e.animationName !== 'fm-check-pop' || !(e.target instanceof HTMLElement)) return
    if (e.target.querySelector('.fm-checkmark')) return
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    const path = document.createElementNS(ns, 'path')
    svg.setAttribute('class', 'fm-checkmark')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('aria-hidden', 'true')
    path.setAttribute('d', 'M3 8.2 6.3 11.3 13 4.8')
    path.setAttribute('pathLength', '1')
    svg.appendChild(path)
    e.target.appendChild(svg)
  }
  const controller = new AbortController()
  const opts = { passive: true, signal: controller.signal }
  document.addEventListener('pointermove', move, opts)
  document.addEventListener('pointerout', out, opts)
  document.addEventListener('pointercancel', reset, opts)
  document.addEventListener('pointerdown', ripple, opts)
  document.addEventListener('click', keyboardClick, opts)
  document.addEventListener('animationstart', drawCheckbox, opts)
  window.addEventListener('blur', reset, opts)
  reduced.addEventListener('change', reset, opts)
  return () => {
    reset()
    controller.abort()
  }
}
