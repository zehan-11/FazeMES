export type Vec3 = [number, number, number]
export interface CameraPose {
  position: Vec3
  target: Vec3
}
export function interpolateCamera(from: CameraPose, to: CameraPose, progress: number): CameraPose {
  const t = Math.min(1, Math.max(0, progress)),
    eased = t * t * (3 - 2 * t)
  const vector = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v + (b[i] - v) * eased) as Vec3
  return { position: vector(from.position, to.position), target: vector(from.target, to.target) }
}
/** Frame-time based, interruptible flight. Hidden time does not advance the animation. */
export class CameraFlight {
  private flight?: { from: CameraPose; to: CameraPose; elapsed: number; duration: number }
  begin(from: CameraPose, to: CameraPose, duration = 0.8) {
    this.flight = {
      from: structuredClone(from),
      to: structuredClone(to),
      elapsed: 0,
      duration: Math.max(0.01, duration)
    }
  }
  retarget(to: CameraPose) {
    if (this.flight) this.flight.to = to
  }
  step(delta: number): CameraPose | undefined {
    const flight = this.flight
    if (!flight) return
    flight.elapsed += Math.max(0, Math.min(delta, 0.05))
    const progress = Math.min(1, flight.elapsed / flight.duration)
    const pose = interpolateCamera(flight.from, flight.to, progress)
    if (progress === 1) this.flight = undefined
    return pose
  }
  get active() {
    return !!this.flight
  }
  cancel() {
    this.flight = undefined
  }
}
