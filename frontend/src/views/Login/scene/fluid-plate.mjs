// A still of airflow around the fan. It keeps the same palette when the live ink dissipates.
export function drawAirflow(canvas, dark) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight
  if (!w || !h) return
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const g = canvas.getContext('2d')
  if (!g) return
  g.scale(dpr, dpr)
  const film = g.createLinearGradient(0, 0, w, h * 0.72)
  const colors = dark ? ['#060910', '#0e1627', '#080a10'] : ['#d6deee', '#eef2fa', '#d5dfef']
  colors.forEach((c, i) => film.addColorStop(i * 0.5, c))
  g.fillStyle = film
  g.fillRect(0, 0, w, h)
  const wash = (x, y, r, color) => {
    const halo = g.createRadialGradient(w * x, h * y, 0, w * x, h * y, r)
    halo.addColorStop(0, color)
    halo.addColorStop(1, color.replace(/,[.\d]+\)$/, ',0)'))
    g.fillStyle = halo
    g.fillRect(0, 0, w, h)
  }
  wash(0.04, 0.58, w * 0.4, dark ? 'rgba(36,80,174,.43)' : 'rgba(107,146,217,.45)')
  wash(0.51, 0.13, w * 0.41, dark ? 'rgba(52,86,159,.25)' : 'rgba(224,234,255,.52)')
  const gradient = g.createLinearGradient(0, h * 0.68, w * 0.8, 0)
  const ink = dark ? ['#356fe0', '#79a4fc', '#4778c4'] : ['#7193c9', '#658ac4', '#89a5d0']
  ink.forEach((c, i) => gradient.addColorStop(i * 0.5, c))
  g.strokeStyle = gradient
  g.lineCap = 'round'
  function ribbon(count, draw) {
    for (let i = 0; i < count; i++) {
      const t = (i / (count - 1)) * 2 - 1
      g.globalAlpha = (dark ? 0.27 : 0.21) * (0.33 + 0.67 * Math.pow(Math.cos(t * 1.57), 2))
      g.lineWidth = i % 6 === 0 ? 1.25 : 0.63
      g.beginPath()
      draw(t)
      g.stroke()
    }
  }
  ribbon(48, (t) => {
    g.moveTo(-0.07 * w, (0.2 + 0.17 * t) * h)
    g.bezierCurveTo(
      0.12 * w,
      (0.11 + 0.07 * t) * h,
      0.2 * w,
      (0.8 - 0.19 * t) * h,
      0.38 * w,
      (0.58 + 0.06 * t) * h
    )
    g.bezierCurveTo(
      0.52 * w,
      (0.42 + 0.16 * t) * h,
      0.54 * w,
      (0.08 + 0.06 * t) * h,
      0.77 * w,
      (-0.07 + 0.07 * t) * h
    )
  })
  ribbon(40, (t) => {
    g.moveTo(-0.1 * w, (1 + 0.08 * t) * h)
    g.bezierCurveTo(
      0.05 * w,
      (0.68 + 0.12 * t) * h,
      0.12 * w,
      (0.65 + 0.09 * t) * h,
      0.18 * w,
      (0.7 + 0.04 * t) * h
    )
    g.bezierCurveTo(
      0.34 * w,
      (0.85 - 0.07 * t) * h,
      0.43 * w,
      (1.03 - 0.17 * t) * h,
      0.71 * w,
      (0.64 - 0.1 * t) * h
    )
  })
  g.globalAlpha = 1
}
