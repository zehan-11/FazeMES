// Most new particles rise near the edges, leaving the reading area quiet.
function lane(index: number) {
  const x = Math.random()
  if (index % 3 === 0) return x
  return index % 3 === 1 ? x * 0.22 : 1 - x * 0.22
}

// Paint the core and soft halo once. Each particle is one image draw per frame.
function sprite(tint: string) {
  const tile = document.createElement('canvas')
  tile.width = tile.height = 48
  const brush = tile.getContext('2d')!
  const r = tile.width / 2
  const glow = brush.createRadialGradient(r, r, 0, r, r, r)
  glow.addColorStop(0, '#f5fdff')
  glow.addColorStop(0.15, '#defaff')
  glow.addColorStop(0.29, `rgba(${tint},0.8)`)
  glow.addColorStop(0.52, `rgba(${tint},0.19)`)
  glow.addColorStop(1, `rgba(${tint},0)`)
  brush.fillStyle = glow
  brush.fillRect(0, 0, tile.width, tile.height)
  return tile
}

export function createAmbientField(ctx: CanvasRenderingContext2D) {
  const sprites = [sprite('100,228,255'), sprite('125,177,255')]
  const particles = Array.from({ length: 66 }, (_, i) => ({
    x: lane(i),
    y: Math.random(),
    radius: 1.2 + Math.random() * 2,
    speed: 12 + Math.random() * 14,
    sway: 4 + Math.random() * 10,
    phase: Math.random() * Math.PI * 2,
    rate: 0.4 + Math.random() * 0.55
  }))
  let seconds = 0
  let pointing = false
  let pointerX = 0
  let pointerY = 0

  function point(x: number, y: number) {
    pointerX = x
    pointerY = y
    pointing = true
  }

  function release() {
    pointing = false
  }

  function draw(width: number, height: number, dt: number) {
    if (!width || !height) return
    seconds += dt
    ctx.clearRect(0, 0, width, height)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const phase = seconds * p.rate + p.phase
      const x = p.x * width + Math.sin(phase * 0.55) * p.sway
      const y = p.y * height
      const near = pointing ? Math.max(0, 1 - Math.hypot(pointerX - x, pointerY - y) / 140) : 0
      const fade = Math.min(1, p.y / 0.07, (1 - p.y) / 0.05)
      const size = p.radius * 5
      ctx.globalAlpha = Math.min(1, 0.59 + Math.sin(phase) * 0.14 + near * 0.29) * fade
      ctx.drawImage(sprites[i % sprites.length], x - size / 2, y - size / 2, size, size)
      p.y -= (dt * p.speed * (1 + near * 0.55)) / height
      if (p.y <= 0) {
        p.y = 1
        p.x = lane(i)
      }
    }
    ctx.globalAlpha = 1
  }
  return { draw, point, release }
}
