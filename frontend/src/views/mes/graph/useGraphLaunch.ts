import { onBeforeUnmount, onDeactivated, type Ref } from 'vue'
import { DOCK_DURATION, DOCK_MS, LAUNCH_MS } from './starScene'

const skipFadeMs = 180

/** One compositor animation supplies both the drawer transform and the camera's visible inset. */
export function useGraphLaunch(
  panel: Ref<HTMLElement | undefined>,
  initiallyOpen: boolean,
  skipButton?: Ref<HTMLElement | undefined>
) {
  let movement: Animation | undefined
  let fading: Animation | undefined
  let to = Number(initiallyOpen)
  let from = to

  function visibleFraction() {
    if (!movement) return to
    const progress = movement.effect?.getComputedTiming().progress ?? 0
    return from + (to - from) * progress
  }

  function finish(open = true) {
    movement?.cancel()
    movement = undefined
    fading?.cancel()
    fading = undefined
    to = Number(open)
  }

  function slide(
    open: boolean,
    delay = 0,
    start = Number(document.timeline.currentTime ?? performance.now())
  ) {
    const current = delay ? 0 : visibleFraction()
    finish(open)
    const el = panel.value
    if (
      !el?.animate ||
      current === to ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return
    from = current
    const transform = (fraction: number) => 'translateX(' + 100 * (1 - fraction) + '%)'
    const animation = el.animate([{ transform: transform(from) }, { transform: transform(to) }], {
      delay,
      duration: delay ? DOCK_DURATION : 520,
      endDelay: delay ? LAUNCH_MS - DOCK_MS - DOCK_DURATION : 0,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both'
    })
    animation.startTime = start
    movement = animation
    const finished = animation.finished
    void finished.then(
      () => {
        if (movement === animation) finish(open)
      },
      () => {
        /* A reversal or skip replaces this animation. */
      }
    )
    return finished
  }

  async function play(reveal: (start: number) => void) {
    const start = Number(document.timeline.currentTime ?? performance.now())
    const finished = slide(true, DOCK_MS, start)
    if (!finished) return
    fading = skipButton?.value?.animate?.(
      [
        { opacity: 1, visibility: 'visible' },
        { opacity: 0, visibility: 'hidden' }
      ],
      { delay: DOCK_MS - skipFadeMs, duration: skipFadeMs, easing: 'ease-out', fill: 'both' }
    )
    if (fading) fading.startTime = start
    reveal(start)
    try {
      await finished
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    }
  }

  onBeforeUnmount(() => finish())
  onDeactivated(() => finish())
  return { play, slide, finish, visibleFraction }
}
