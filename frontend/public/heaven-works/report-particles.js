/* Sample the visible report text when leaving it so the outgoing particles start at its glyphs. */
function reportParticles(canvas, host, ink, body, reduced) {
  const ctx = canvas.getContext('2d')
  const colors = ['#c8f9ec', '#89dad1', '#a9cfeb', '#ecd5af', '#c4b0ee']
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  let frame = 0

  function boxOf(rect) {
    const area = host.getBoundingClientRect()
    return {
      x: (rect.left - area.left) / area.width,
      y: (rect.top - area.top) / area.height,
      w: rect.width / area.width,
      h: rect.height / area.height
    }
  }
  function stop() {
    cancelAnimationFrame(frame)
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.globalAlpha = 1
    }
    delete host.dataset.particlePhase
  }
  function clearFrame() {
    const w = host.clientWidth,
      h = host.clientHeight,
      d = Math.min(devicePixelRatio || 1, 1.6)
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
      canvas.width = Math.round(w * d)
      canvas.height = Math.round(h * d)
    }
    ctx.setTransform(d, 0, 0, d, 0, 0)
    ctx.clearRect(0, 0, w, h)
    return { w, h }
  }
  function snapshot() {
    if (!ctx || reduced.matches) return null
    const rect = ink.getBoundingClientRect(),
      width = rect.width,
      height = rect.height
    if (width < 2 || height < 2) return null
    const stencil = document.createElement('canvas')
    stencil.width = Math.ceil(width)
    stencil.height = Math.ceil(height)
    const pen = stencil.getContext('2d', { willReadFrequently: true })
    if (!pen) return null
    const range = document.createRange(),
      walker = document.createTreeWalker(ink, NodeFilter.SHOW_TEXT)
    const bodyRect = body.getBoundingClientRect()
    pen.fillStyle = '#fff'
    // Jump over the already-scrolled part of a long report without measuring its entire text.
    function firstVisible(node, top) {
      let lo = 0,
        hi = node.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        range.setStart(node, mid)
        range.setEnd(node, mid + 1)
        const r = range.getBoundingClientRect()
        if (r.bottom && r.bottom <= top) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement,
        text = node.data
      if (!text.trim() || !parent?.getClientRects().length) continue
      const viewport = body.contains(parent) ? bodyRect : rect
      const top = Math.max(rect.top, viewport.top),
        bottom = Math.min(rect.bottom, viewport.bottom)
      const parentRect = parent.getBoundingClientRect()
      if (parentRect.bottom <= top || parentRect.top >= bottom) continue
      const style = getComputedStyle(parent)
      pen.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ')
      const metrics = pen.measureText('国Mg'),
        ascent = metrics.fontBoundingBoxAscent || parseFloat(style.fontSize) * 0.86
      const descent = metrics.fontBoundingBoxDescent || parseFloat(style.fontSize) * 0.24
      pen.save()
      pen.beginPath()
      pen.rect(0, top - rect.top, width, bottom - top)
      pen.clip()
      for (let i = parentRect.top < top ? firstVisible(node, top) : 0; i < text.length; ) {
        const start = i
        i += text.codePointAt(i) > 65535 ? 2 : 1
        const glyph = text.slice(start, i)
        if (!glyph.trim()) continue
        range.setStart(node, start)
        range.setEnd(node, i)
        const r = range.getBoundingClientRect()
        if (r.top >= bottom) break
        if (
          !r.width ||
          !r.height ||
          r.bottom <= top ||
          r.right <= rect.left ||
          r.left >= rect.right
        )
          continue
        const x = r.left - rect.left,
          y = r.top - rect.top
        const baseline = y + (r.height - ascent - descent) / 2 + ascent
        pen.fillText(glyph, x, baseline)
      }
      pen.restore()
    }
    const alpha = pen.getImageData(0, 0, stencil.width, stencil.height).data
    const points = []
    for (let y = 0.5; y < height; y += 1.65) {
      for (let x = 0.5; x < width; x += 1.65) {
        if (alpha[(Math.floor(y) * stencil.width + Math.floor(x)) * 4 + 3] > 53) {
          points.push([x / width, y / height])
        }
      }
    }
    return { box: boxOf(rect), points }
  }
  function disperse(sheet, complete) {
    stop()
    if (!ctx || reduced.matches) {
      complete()
      return
    }
    const { box } = sheet,
      outline = []
    for (let i = 0; i <= 100; i++)
      outline.push([i / 100, 0], [i / 100, 1], [0, i / 100], [1, i / 100])
    // Only a page rectangle survives a reload, so redraw a generic page outline for that case.
    if (!sheet.points)
      for (let y = 0.18; y < 0.9; y += 0.13) {
        for (let x = 0.04; x < 0.52 + 0.34 * Math.abs(Math.sin(y * 10)); x += 0.009)
          outline.push([x, y])
      }
    const samples = sheet.points || [],
      step = Math.max(1, samples.length / 2200)
    for (let i = 0; i < samples.length; i += step) outline.push(samples[Math.floor(i)])
    const cloud = outline.map(([x, y]) => {
      const angle = Math.random() * Math.PI * 2
      return {
        x,
        y,
        dx: Math.cos(angle) * (0.15 + Math.random() * 0.65),
        dy: Math.sin(angle) * (0.2 + Math.random()) - 0.1,
        delay: Math.random() * 0.18,
        size: 0.9 + Math.random() * 1.3,
        color: colors[Math.floor(Math.random() * colors.length)]
      }
    })
    const start = performance.now()
    host.dataset.particlePhase = 'dispersing'
    function draw(now) {
      const t = clamp((now - start) / 1000, 0, 1),
        { w, h } = clearFrame()
      for (const p of cloud) {
        const u = clamp((t - p.delay) / (1 - p.delay), 0, 1),
          drift = u * u
        ctx.globalAlpha = 0.9 * (1 - drift)
        ctx.fillStyle = p.color
        ctx.fillRect(
          w * (box.x + box.w * (p.x + p.dx * drift)),
          h * (box.y + box.h * (p.y + p.dy * drift - 0.12 * Math.sin(u * Math.PI))),
          p.size,
          p.size
        )
      }
      ctx.globalAlpha = 1
      if (t >= 1 || reduced.matches) {
        stop()
        complete()
      } else frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
  }
  return { snapshot, disperse, stop }
}
