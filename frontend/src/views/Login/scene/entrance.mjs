// Take one snapshot of the mounted controls. Changing tabs or locale cannot replay the sequence.
export function enterLogin(root) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  if (reduce.matches || !Element.prototype.animate || document.hidden) return
  const sequence = [
    ['.brand, .utilities', 0, 460, 4],
    ['.signin-head', 35, 540, 6],
    ['.fan-panel', 65, 900, 12],
    ['.modes', 160, 510, 8],
    ['.field:first-child', 210, 510, 8],
    ['.field:nth-child(2)', 265, 510, 8],
    ['.field:nth-child(3)', 320, 510, 8],
    ['.el-checkbox', 360, 450, 6],
    ['.submit', 405, 500, 7],
    ['.portal, .speed', 465, 500, 6]
  ]
  const animations = []
  for (const [selector, delay, duration, offset] of sequence) {
    for (const element of root.querySelectorAll(selector)) {
      animations.push(
        element.animate(
          [
            {
              opacity: element.matches('.fan-panel') ? 0.08 : 0.38,
              transform: 'translateY(' + offset + 'px)'
            },
            { opacity: 1, transform: 'translateY(0)' }
          ],
          { delay, duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' }
        )
      )
    }
  }
  function finish() {
    for (const animation of animations) animation.cancel()
    root.removeEventListener('focusin', finish)
    root.removeEventListener('pointerdown', finish)
    reduce.removeEventListener('change', finish)
  }
  root.addEventListener('focusin', finish, { once: true })
  root.addEventListener('pointerdown', finish, { once: true })
  reduce.addEventListener('change', finish, { once: true })
  Promise.allSettled(animations.map((a) => a.finished)).then(finish)
  return finish
}
