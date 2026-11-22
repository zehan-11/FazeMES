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

/** Keep existing world coordinates. Place newly fetched neighbors around their entry node. */
export function placeExplorationNodes(
  data: GraphData,
  previous?: GraphData,
  previousPositions?: Float32Array,
  anchorId?: string | null
): Float32Array {
  const positions = new Float32Array(data.nodes.length * 3)
  const previousIndex = new Map(previous?.nodes.map((node, i) => [node.id, i * 3]))
  const retained = new Set<number>()
  data.nodes.forEach((node, i) => {
    const offset = previousIndex.get(node.id)
    if (offset === undefined || !previousPositions) return
    positions.set(previousPositions.subarray(offset, offset + 3), i * 3)
    retained.add(i)
  })

  const anchor = data.nodes.findIndex((node) => node.id === anchorId)
  const center = retained.has(anchor) ? positions.subarray(anchor * 3, anchor * 3 + 3) : [0, 0, 0]
  if (anchor >= 0) retained.add(anchor)
  let slot = 0
  const count = data.nodes.length - retained.size
  data.nodes.forEach((_, i) => {
    if (retained.has(i)) return
    let x: number, z: number
    do {
      const radius = previous ? 58 + Math.floor(slot / 12) * 24 : count > 1 ? 90 : 0
      const angle = (slot++ * 2 * Math.PI) / (previous ? 12 : Math.max(1, count))
      x = center[0] + Math.sin(angle) * radius
      z = center[2] + Math.cos(angle) * radius
    } while (
      previous &&
      [...retained].some((j) => Math.hypot(x - positions[j * 3], z - positions[j * 3 + 2]) < 26)
    )
    positions.set([x, center[1], z], i * 3)
    retained.add(i)
  })
  return positions
}

/** Place a small radial neighborhood around each entry using only returned graph edges. */
export function deviceOverviewPositions(
  data: GraphData,
  entryIds: readonly string[],
  aspect: number
): Float32Array {
  const entries = new Set(entryIds)
  const roots = data.nodes.flatMap((node, index) => (entries.has(node.id) ? [index] : []))
  if (!roots.length) return placeExplorationNodes(data)

  const branches = new Map(roots.map((root) => [root, [] as number[]]))
  const placed = new Set(roots)
  for (const { source, target } of data.links) {
    const root = branches.has(source) ? source : target
    const child = root === source ? target : source
    if (placed.has(child)) continue
    const branch = branches.get(root)
    if (!branch) continue
    branch.push(child)
    placed.add(child)
  }

  const positions = new Float32Array(data.nodes.length * 3)
  const columns = Math.min(roots.length, aspect > 1.08 ? 3 : 2)
  const rows = Math.ceil(roots.length / columns)
  roots.forEach((root, index) => {
    const row = Math.floor(index / columns)
    const rowSize = Math.min(columns, roots.length - row * columns)
    const column = index % columns
    const phase = (index * Math.PI * 2) / roots.length
    const x = (column - (rowSize - 1) / 2) * 148 + Math.sin(phase) * 9
    const z = (row - (rows - 1) / 2) * 131 + Math.cos(phase) * (rows > 1 ? 12 : 4)
    positions.set([x, 0, z], root * 3)
    const leaves = branches.get(root)!
    leaves.forEach((node, slot) => {
      const variation = hash32(data.nodes[node].id) / 0xffffffff
      const angle = phase + (slot / leaves.length) * 2 * Math.PI + (variation - 0.5) * 0.24
      const radius = 38 + variation * 21
      positions.set(
        [x + Math.sin(angle) * radius, (variation - 0.5) * 11, z + Math.cos(angle) * radius],
        node * 3
      )
    })
  })

  data.nodes.forEach((node, index) => {
    if (placed.has(index)) return
    const angle = (hash32(node.id) / 0xffffffff) * 2 * Math.PI
    positions.set([Math.sin(angle) * 94, 0, Math.cos(angle) * 94], index * 3)
  })
  return positions
}
