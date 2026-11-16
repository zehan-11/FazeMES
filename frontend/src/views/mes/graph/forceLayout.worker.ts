import { MainThreadForceLayout } from '@/vendor/galaxy-view/layout/MainThreadForceLayout'
import type { GraphData, LayoutParams } from '@/vendor/galaxy-view/types'
type Input =
  | {
      type: 'init'
      data: GraphData
      positions: Float32Array
      finalOnly: boolean
      paused: boolean
      params: LayoutParams
    }
  | { type: 'pause'; value: boolean }
  | { type: 'params'; params: LayoutParams }
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<Input>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}
const layout = new MainThreadForceLayout()
let timer: ReturnType<typeof setTimeout> | undefined,
  paused = false,
  finalOnly = false
function schedule() {
  if (!paused && !layout.isSettled() && timer === undefined) timer = setTimeout(run, 16)
}
function run() {
  timer = undefined
  if (paused || layout.isSettled()) return
  const start = performance.now()
  // Yield after an 8 ms budget (one tick minimum), keeping controls and messages responsive.
  do {
    layout.step()
  } while (!layout.isSettled() && performance.now() - start < 8)
  if (!finalOnly || layout.isSettled()) {
    const positions = layout.positions.slice()
    ctx.postMessage({ positions, settled: layout.isSettled() }, [positions.buffer])
  }
  schedule()
}
ctx.onmessage = ({ data }) => {
  if (data.type === 'init') {
    clearTimeout(timer)
    timer = undefined
    paused = data.paused
    finalOnly = data.finalOnly
    layout.init(data.data, data.positions, data.params)
  } else if (data.type === 'params') {
    layout.updateParams(data.params)
  } else {
    paused = data.value
    if (paused) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  schedule()
}
