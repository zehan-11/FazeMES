const smooth = (x) => {
  x = Math.max(0, Math.min(1, x))
  return x * x * (3 - 2 * x)
}
export const phase = (p, a, b) => smooth((p - a) / (b - a))
// Each pair of coordinates is a mounting point in the same projected assembly.
const item = (asset, scale, closed, open, timing, options = {}) => ({
  asset,
  scale,
  closed,
  open,
  timing,
  ...options
})
export const assembly = [
  item('foot', 0.45, [61, 178], [107, 445], [0.71, 0.97]),
  item('ballast', 0.46, [62, 169], [105, 343], [0.7, 0.93], { reveal: [0.71, 0.81] }),
  item('cover', 0.46, [65, 148], [102, 250], [0.69, 0.86]),
  item('neck', 0.34, [67, 51], [121, 120], [0.63, 0.83]),
  item('stator', 0.408, [0, 0], [6, -12], [0.62, 0.76]),
  item('rotor', 0.374, [-4, 1], [-125, 27], [0.44, 0.66]),
  item('end', 0.49, [-11, 3], [-254, 59], [0.35, 0.57]),
  item('screw', 0.102, [-35, -42], [-284, 21], [0.3, 0.48], { id: 'screw-top' }),
  item('screw', 0.102, [13, -2], [-248, 72], [0.31, 0.49], { id: 'screw-side' }),
  item('screw', 0.102, [-22, 43], [-270, 125], [0.33, 0.52], { id: 'screw-bottom' }),
  item('pivot', 0.115, [71, 53], [181, 132], [0.57, 0.78], { reveal: [0.56, 0.62] }),
  item('rear', 0.62, [-31, 7], [-411, 100], [0.22, 0.47]),
  item('collar', 0.28, [-38, 9], [-510, 126], [0.17, 0.41]),
  item('blades', 0.63, [-48, 12], [-641, 158], [0.11, 0.37]),
  item('knob', 0.55, [-64, 15], [-790, 194], [0.055, 0.29]),
  item('front', 0.62, [-94, 22], [-946, 233], [0, 0.27])
]
export function project(p, assets) {
  const parts = assembly.map((def) => {
    const a = assets[def.asset],
      u = phase(p, ...def.timing),
      x = def.closed[0] + (def.open[0] - def.closed[0]) * u,
      y = def.closed[1] + (def.open[1] - def.closed[1]) * u
    return {
      key: def.id || def.asset,
      asset: def.asset,
      x: x - a.anchor[0] * def.scale,
      y: y - a.anchor[1] * def.scale,
      w: a.width * def.scale,
      h: a.height * def.scale,
      alpha: def.reveal ? phase(p, ...def.reveal) : 1
    }
  })
  const visible = parts.filter((q) => q.alpha > 0.025),
    left = Math.min(...visible.map((q) => q.x)),
    top = Math.min(...visible.map((q) => q.y)),
    right = Math.max(...visible.map((q) => q.x + q.w)),
    bottom = Math.max(...visible.map((q) => q.y + q.h))
  let x = (left + right) / 2,
    y = (top + bottom) / 2,
    zoom = Math.min(1.52, 984 / (right - left), 555 / (bottom - top))
  const closeup = (weight, cx, cy, z) => {
    x += (cx - x) * weight
    y += (cy - y) * weight
    zoom += (z - zoom) * weight
  }
  closeup(phase(p, 0.32, 0.46) * (1 - phase(p, 0.56, 0.67)), -120, 27, 1.47)
  closeup(phase(p, 0.635, 0.77) * (1 - phase(p, 0.84, 0.98)), 94, 216, 1.23)
  return {
    parts,
    transform: 'translate(520 300) scale(' + zoom + ') translate(' + -x + ' ' + -y + ')'
  }
}
