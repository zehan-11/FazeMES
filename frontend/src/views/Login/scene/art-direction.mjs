// Each interval begins as the part clears its seat. The main motor and the
// ballast keep their physical finish so the drawing has a visual focal point.
const timings = {
  'front-guard': [0.12, 0.31, 0.95],
  spinner: [0.23, 0.42, 0.85],
  impeller: [0.3, 0.49, 0.92],
  'guard-collar': [0.34, 0.5, 0.92],
  'rear-guard': [0.35, 0.51, 0.94],
  'end-bell': [0.43, 0.555, 0.975],
  bearing: [0.51, 0.65, 0.77],
  'end-screw': [0.43, 0.55, 0.8],
  'motor-casing': [0.7, 0.86, 0.62],
  pedestal: [0.775, 0.94, 0.72],
  'base-shell': [0.82, 0.985, 0.92],
  'bottom-cover': [0.88, 1, 0.77],
  'tilt-bolt': [0.75, 0.93, 0.72],
  'base-screw': [0.84, 0.99, 0.66]
}
const illustratedParts = {
  front: 'front-guard',
  knob: 'spinner',
  blades: 'impeller',
  collar: 'guard-collar',
  rear: 'rear-guard',
  end: 'end-bell',
  screw: 'end-screw',
  stator: 'motor-casing',
  neck: 'pedestal',
  cover: 'base-shell',
  foot: 'bottom-cover',
  pivot: 'tilt-bolt'
}
export function drawingAmount(name, progress) {
  const id = name.startsWith('end-screw-')
    ? 'end-screw'
    : name.startsWith('base-screw-')
      ? 'base-screw'
      : illustratedParts[name] || name
  const timing = timings[id]
  if (!timing) return 0
  const t = Math.max(0, Math.min(1, (progress - timing[0]) / (timing[1] - timing[0])))
  return timing[2] * t * t * (3 - 2 * t)
}
