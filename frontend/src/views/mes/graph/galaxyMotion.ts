import type { PerspectiveCamera } from 'three'
import { Vector3 } from 'three'
import { hash32 } from '@/vendor/galaxy-view/data/seed'
import type { GraphData } from '@/vendor/galaxy-view/types'

export interface ScreenPoint {
  x: number
  y: number
}

export interface Neighborhood {
  nodes: Set<number>
  links: number[]
}

export function indexNeighborhoods(data: GraphData): Neighborhood[] {
  const neighborhoods = data.nodes.map((_, i): Neighborhood => ({ nodes: new Set([i]), links: [] }))
  data.links.forEach(({ source, target }, i) => {
    neighborhoods[source].nodes.add(target)
    neighborhoods[target].nodes.add(source)
    neighborhoods[source].links.push(i)
    if (source !== target) neighborhoods[target].links.push(i)
  })
  return neighborhoods
}

export function repulsionScale(distance: number, radius: number, strength: number): number {
  if (distance < 0.01 || distance >= radius) return 0
  const falloff = 1 - distance / radius
  return (strength * falloff * falloff) / distance
}

interface Frame {
  base: Readonly<Float32Array>
  camera: PerspectiveCamera
  width: number
  height: number
  delta: number
  still: boolean
  pointer: ScreenPoint | null
  hover: number
  halo: ReadonlySet<number> | undefined
}

/** Apply motion after layout so pointer effects never disturb the device anchors or the force worker. */
export class GalaxyMotion {
  readonly offsets: Float32Array
  private readonly layout: Float32Array
  private readonly response: Float32Array
  private readonly phases: number[]
  private readonly ids: string[]
  private readonly center = new Vector3()
  private readonly focusRight = new Vector3()
  private readonly focusUp = new Vector3()
  private readonly view = new Vector3()
  private readonly slots = new Map<number, ScreenPoint>()
  private root = -1
  private clock = 0

  constructor(
    data: GraphData,
    private readonly entries: ReadonlySet<number>,
    previous?: GalaxyMotion
  ) {
    this.ids = data.nodes.map((node) => node.id)
    this.phases = this.ids.map((id) => (hash32(id) / 0xffffffff) * 2 * Math.PI)
    const size = data.nodes.length * 3
    this.offsets = new Float32Array(size)
    this.layout = new Float32Array(size)
    this.response = new Float32Array(size)
    if (!previous) return
    this.clock = previous.clock
    const indices = new Map(previous.ids.map((id, i) => [id, i * 3]))
    this.ids.forEach((id, i) => {
      const from = indices.get(id)
      if (from === undefined) return
      this.offsets.set(previous.offsets.subarray(from, from + 3), i * 3)
      this.layout.set(previous.layout.subarray(from, from + 3), i * 3)
      this.response.set(previous.response.subarray(from, from + 3), i * 3)
    })
  }

  centerOn(root: number, neighbors: ReadonlySet<number> | undefined, camera: PerspectiveCamera) {
    this.root = root
    this.slots.clear()
    if (!neighbors) return
    this.focusRight.setFromMatrixColumn(camera.matrixWorld, 0)
    this.focusUp.setFromMatrixColumn(camera.matrixWorld, 1)
    const leaves = [...neighbors]
      .filter((i) => i !== root)
      .sort((a, b) => this.phases[a] - this.phases[b])
    const rings = leaves.length <= 12 ? 1 : leaves.length <= 28 ? 2 : 3
    leaves.forEach((i, index) => {
      const ring = index % rings
      const count = Math.ceil((leaves.length - ring) / rings)
      const angle = (Math.floor(index / rings) / count) * 2 * Math.PI + ring * 0.39 + 0.3
      const radius =
        rings === 1
          ? leaves.length === 1
            ? 66
            : 84 + (index % 2) * 14
          : 43 + (50 * ring) / (rings - 1)
      this.slots.set(i, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
    })
  }

  step({ base, camera, width, height, delta, still, pointer, hover, halo }: Frame) {
    const cameraWorld = camera.matrixWorld.elements
    const rightX = cameraWorld[0],
      rightY = cameraWorld[1],
      rightZ = cameraWorld[2]
    const upX = cameraWorld[4],
      upY = cameraWorld[5],
      upZ = cameraWorld[6]
    const fitWidth = Math.min(1.4, Math.max(0.55, width / height))
    const unitAtDepth = (2 * Math.tan((camera.fov * Math.PI) / 360)) / height
    const settle = still ? 1 : 1 - Math.exp(-delta * 8)
    const respond = still ? 1 : 1 - Math.exp(-delta * 13)
    this.clock += still ? 0 : delta
    const rootOffset = this.root * 3
    if (this.root >= 0) this.center.fromArray(base, rootOffset)

    for (let i = 0; i < this.ids.length; i++) {
      const at = i * 3
      const x = base[at],
        y = base[at + 1],
        z = base[at + 2]
      const slot = this.slots.get(i)
      const sx = slot ? slot.x * fitWidth : 0
      const sy = slot?.y ?? 0
      const targetX = slot ? this.center.x + this.focusRight.x * sx + this.focusUp.x * sy - x : 0
      const targetY = slot ? this.center.y + this.focusRight.y * sx + this.focusUp.y * sy - y : 0
      const targetZ = slot ? this.center.z + this.focusRight.z * sx + this.focusUp.z * sy - z : 0
      this.layout[at] += (targetX - this.layout[at]) * settle
      this.layout[at + 1] += (targetY - this.layout[at + 1]) * settle
      this.layout[at + 2] += (targetZ - this.layout[at + 2]) * settle

      const isEntry = this.entries.has(i)
      const close = halo?.has(i) ?? false
      const sway = still || i === this.root || i === hover ? 0 : isEntry ? 2.6 : close ? 9 : 5
      const phase = this.phases[i]
      const driftX = Math.sin(this.clock * 0.82 + phase) * sway
      const driftY = Math.sin(this.clock * 0.59 + phase * 1.9) * sway * 0.38
      const driftZ = Math.cos(this.clock * 0.71 + phase * 1.5) * sway
      const wx = x + this.layout[at] + driftX
      const wy = y + this.layout[at + 1] + driftY
      const wz = z + this.layout[at + 2] + driftZ
      let dx = driftX,
        dy = driftY,
        dz = driftZ

      if (!still && close && hover >= 0 && i !== hover && i !== this.root) {
        const h = hover * 3
        const awayX = wx - base[h] - this.layout[h]
        const awayY = wy - base[h + 1] - this.layout[h + 1]
        const awayZ = wz - base[h + 2] - this.layout[h + 2]
        const distance = Math.hypot(awayX, awayY, awayZ)
        const spread = distance > 0.01 ? (isEntry ? 4 : 11) / distance : 0
        dx += awayX * spread
        dy += awayY * spread
        dz += awayZ * spread
      }
      if (!still && pointer && i !== hover && i !== this.root && (this.root < 0 || slot)) {
        this.view.set(wx, wy, wz).applyMatrix4(camera.matrixWorldInverse)
        const depth = -this.view.z
        if (depth > camera.near) {
          this.view.applyMatrix4(camera.projectionMatrix)
          const awayX = ((this.view.x + 1) * width) / 2 - pointer.x
          const awayY = ((1 - this.view.y) * height) / 2 - pointer.y
          const distance = Math.hypot(awayX, awayY)
          const push = repulsionScale(distance, 92, isEntry ? 11 : 37) * depth * unitAtDepth
          dx += (rightX * awayX - upX * awayY) * push
          dy += (rightY * awayX - upY * awayY) * push
          dz += (rightZ * awayX - upZ * awayY) * push
        }
      }

      this.response[at] += (dx - this.response[at]) * respond
      this.response[at + 1] += (dy - this.response[at + 1]) * respond
      this.response[at + 2] += (dz - this.response[at + 2]) * respond
      this.offsets[at] = this.layout[at] + this.response[at]
      this.offsets[at + 1] = this.layout[at + 1] + this.response[at + 1]
      this.offsets[at + 2] = this.layout[at + 2] + this.response[at + 2]
    }
  }
}
