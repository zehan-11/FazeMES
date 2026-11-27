// Gather particles sampled from the actual heading glyphs, then hand the text back to the browser.
export function mountParticleText(container, canvas, text, compact = false) {
  const motion = matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)')
  if (motion.matches || document.hidden) return
  const ctx = canvas.getContext('2d')
  const mask = document.createElement('canvas')
  const sample = mask.getContext('2d', { willReadFrequently: true })
  if (!ctx || !sample) return
  const source = container.querySelector('.type-source')
  const width = container.clientWidth,
    height = container.clientHeight
  if (!width || !height) return
  const style = getComputedStyle(source)
  const sourceRect = source.getBoundingClientRect(),
    box = container.getBoundingClientRect()
  const pixelRatio = Math.min(devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  ctx.scale(pixelRatio, pixelRatio)
  mask.width = width
  mask.height = height
  sample.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily
  if ('letterSpacing' in sample && style.letterSpacing !== 'normal')
    sample.letterSpacing = style.letterSpacing
  const bounds = sample.measureText(text)
  const baseline =
    sourceRect.top -
    box.top +
    (sourceRect.height + bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2
  sample.fillText(text, sourceRect.left - box.left, baseline)
  const pixels = sample.getImageData(0, 0, width, height).data
  const step = compact ? 1 : 2,
    dots = []
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      if (pixels[(y * width + x) * 4 + 3] < 68) continue
      const seed = ((x * 109 + y * 73) % 251) / 251
      const angle = seed * Math.PI * 2
      const spread = (compact ? 13 : 35) * (0.4 + ((x * 13 + y * 43) % 89) / 89)
      dots.push({
        x,
        y,
        dx: Math.cos(angle) * spread,
        dy: Math.sin(angle) * spread,
        delay: seed * 0.16
      })
    }
  if (!dots.length) return
  const duration = compact ? 790 : 1150
  const accent =
    getComputedStyle(container).getPropertyValue('--particle-accent').trim() || '#66a5ff'
  const begin = performance.now()
  let raf = 0
  function finish() {
    cancelAnimationFrame(raf)
    container.removeAttribute('data-gathering')
    container.style.removeProperty('--native-opacity')
    motion.removeEventListener('change', finish)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('resize', finish)
  }
  function visibility() {
    if (document.hidden) finish()
  }
  function draw(now) {
    const elapsed = Math.min(1, Math.max(0, (now - begin) / duration))
    if (elapsed >= 1) {
      finish()
      return
    }
    const nativeOpacity = Math.min(1, Math.max(0, (elapsed - 0.72) / 0.28))
    container.style.setProperty('--native-opacity', String(nativeOpacity))
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = elapsed < 0.57 ? accent : style.color
    ctx.globalAlpha = 1 - nativeOpacity
    ctx.beginPath()
    for (const dot of dots) {
      const progress = Math.min(1, Math.max(0, (elapsed - dot.delay) / 0.72))
      const offset = (1 - progress) ** 3
      const size = (compact ? 0.9 : 1.65) * (0.67 + 0.33 * progress)
      ctx.rect(dot.x + dot.dx * offset, dot.y + dot.dy * offset, size, size)
    }
    ctx.fill()
    raf = requestAnimationFrame(draw)
  }
  container.setAttribute('data-gathering', '')
  motion.addEventListener('change', finish)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('resize', finish, { once: true })
  draw(begin)
  return finish
}
