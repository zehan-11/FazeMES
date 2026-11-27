// Time and assembly position. The long intervals around the motor and the base give each detail time on screen.
const beats = [
  [0, 0],
  [0.16, 0.27],
  [0.29, 0.43],
  [0.51, 0.565],
  [0.61, 0.7],
  [0.84, 0.865],
  [0.95, 0.974],
  [1, 1]
]
const secants = beats.slice(1).map(([time, pose], i) => (pose - beats[i][1]) / (time - beats[i][0]))
const slopes = beats.map((_, i) =>
  i === 0 || i === beats.length - 1 ? 0 : 2 / (1 / secants[i - 1] + 1 / secants[i])
)
export const durationMs = 11800
export const rates = [0.5, 1, 1.5, 2]
export const stops = [0, 0.27, 0.55, 0.66, 0.85, 1]
export const clamp = (v) => Math.max(0, Math.min(1, v))

export function poseAtTime(clock) {
  if (clock <= 0 || clock >= 1) return clamp(clock)
  const i = beats.findIndex(([time]) => time > clock) - 1
  const [start, a] = beats[i],
    [end, b] = beats[i + 1]
  const span = end - start,
    t = (clock - start) / span,
    u = 1 - t
  return (
    u * u * (1 + 2 * t) * a +
    t * t * (3 - 2 * t) * b +
    span * t * u * (u * slopes[i] - t * slopes[i + 1])
  )
}

export function timeAtPose(pose) {
  if (pose <= 0 || pose >= 1) return clamp(pose)
  let low = 0,
    high = 1
  for (let i = 0; i < 28; i++) {
    const middle = (low + high) / 2
    if (poseAtTime(middle) < pose) low = middle
    else high = middle
  }
  return (low + high) / 2
}

export function reducedPose(candidate, previous, direction) {
  if (direction > 0) return Math.max(previous, ...stops.filter((step) => step <= candidate))
  return Math.min(previous, ...stops.filter((step) => step >= candidate))
}
