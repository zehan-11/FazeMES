import type { GraphData, LayoutParams } from '@/vendor/galaxy-view/types'
import { hash32 } from '@/vendor/galaxy-view/data/seed'
export const FORCE_PARAMS: LayoutParams = {
  charge: -160,
  linkDistance: 60,
  linkStrength: 1,
  centerPull: 0.009,
  flatten: 0.015,
  coreGravity: 0.12,
  spiral: 0,
  velocityDecay: 0.35
}
/** Stable random seed only; link/repulsion forces determine the final coordinates. */
export function seedPositions(data: GraphData): Float32Array {
  const positions = new Float32Array(data.nodes.length * 3)
  const radius = 40 + Math.cbrt(data.nodes.length) * 25
  data.nodes.forEach((node, i) => {
    for (let axis = 0; axis < 3; axis++)
      positions[i * 3 + axis] = ((hash32(`${node.id}:${axis}`) / 0xffffffff) * 2 - 1) * radius
  })
  return positions
}
