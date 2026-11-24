import { seed, type Mark } from './starScene'
import { blendInk } from './starInk'

const formats = [
  [22, 15],
  [15, 20],
  [18, 18]
] as const
type Surface = OffscreenCanvas | HTMLCanvasElement
type Brush = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type Family = 'paper' | 'solid' | 'night' | 'split'
type Subject = 'bearing' | 'press' | 'display' | 'rolls' | 'pump' | 'impeller'
type Design = readonly [
  family: Family,
  ground: string,
  body: string,
  accent: string,
  subject: Subject
]

// In each four-card run the first three are paper, warm and cool.
// Dealing this sequence to hash-sorted leaves also balances small clusters across the whole graph.
const designs: readonly Design[] = [
  ['paper', '#FFFFFF', '#111827', '#1D4ED8', 'bearing'],
  ['solid', '#B83227', '#FFF1DD', '#F2B99B', 'press'],
  ['night', '#090D1A', '#2563EB', '#173D91', 'display'],
  ['split', '#FFFFFF', '#123CC8', '#EA580C', 'bearing'],

  ['paper', '#F5F7FB', '#111827', '#DC2626', 'press'],
  ['night', '#090D1A', '#E03E36', '#8B1E24', 'pump'],
  ['solid', '#0D6E59', '#FCF6DF', '#A8D7BA', 'impeller'],
  ['split', '#F5F7FB', '#B83227', '#123CC8', 'rolls'],

  ['paper', '#FFFFFF', '#111827', '#EA580C', 'display'],
  ['solid', '#B45309', '#FFF2D7', '#EBC384', 'rolls'],
  ['night', '#090D1A', '#10B981', '#09604E', 'bearing'],
  ['split', '#E6C49F', '#111827', '#DA4931', 'press'],

  ['paper', '#F5F7FB', '#111827', '#1D4ED8', 'pump'],
  ['night', '#090D1A', '#E89B2D', '#9A4B14', 'rolls'],
  ['solid', '#123CC8', '#F5F7FB', '#B6C8F7', 'display'],
  ['split', '#CDE7DB', '#123D50', '#D27234', 'impeller'],

  ['paper', '#FFFFFF', '#111827', '#DC2626', 'impeller'],
  ['night', '#090D1A', '#E46D36', '#903E27', 'press'],
  ['solid', '#4C2898', '#F6F1EB', '#CAAFDA', 'bearing'],
  ['night', '#090D1A', '#7C3AED', '#482687', 'impeller']
]

function surface(w: number, h: number): Surface | undefined {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

function polygon(ctx: Brush, points: readonly number[]) {
  ctx.beginPath()
  ctx.moveTo(points[0], points[1])
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
  ctx.closePath()
  ctx.fill()
}

function disc(ctx: Brush, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Original industrial silhouettes drawn on a 22 by 20 design grid. */
function subject(ctx: Brush, motif: Subject, ink: string, cut: string) {
  ctx.fillStyle = ink
  switch (motif) {
    case 'bearing':
      disc(ctx, 11, 9.5, 6.6)
      ctx.fillStyle = cut
      disc(ctx, 11, 9.5, 3)
      ctx.fillRect(10.2, 3, 1.6, 1.5)
      break
    case 'press':
      polygon(
        ctx,
        [3, 3, 19, 3, 19, 6, 13, 6, 13, 11, 9, 11, 9, 6, 6, 6, 6, 14, 18, 14, 18, 16.5, 3, 16.5]
      )
      ctx.fillRect(8.3, 11.9, 6.5, 1.4)
      break
    case 'display':
      ctx.fillRect(3, 3.4, 16, 10.7)
      ctx.fillRect(10, 14, 2, 1.8)
      ctx.fillRect(6.6, 15.6, 8.8, 1.4)
      ctx.fillStyle = cut
      ctx.fillRect(4.8, 5, 12.4, 6.2)
      ctx.fillStyle = ink
      ctx.fillRect(6, 6.4, 3.4, 3.6)
      ctx.fillRect(10.7, 6.4, 4.7, 1)
      break
    case 'rolls':
      polygon(ctx, [3, 7.6, 14.8, 4, 19.2, 7, 19.2, 12.7, 7, 16.2, 3, 13.2])
      ctx.fillStyle = cut
      disc(ctx, 7, 11, 2.2)
      disc(ctx, 15, 8.5, 1.5)
      break
    case 'pump':
      disc(ctx, 10.8, 10, 5.4)
      ctx.fillRect(2.8, 8, 6, 3.6)
      ctx.fillRect(12.4, 3.2, 5.2, 4.3)
      ctx.fillRect(6.2, 14.4, 10.5, 1.7)
      ctx.fillStyle = cut
      disc(ctx, 10.8, 10, 2.2)
      break
    case 'impeller':
      polygon(ctx, [11, 9.5, 11, 4.5, 13.3, 2.5, 17, 3.7, 16.4, 6.5, 13, 9.5])
      polygon(ctx, [11, 9.5, 15.3, 12, 15.9, 15, 13, 17.6, 10.9, 15.7, 10, 11.2])
      polygon(ctx, [11, 9.5, 6.7, 12, 3.8, 11, 3, 7.2, 5.7, 6.3, 10, 7.8])
      disc(ctx, 11, 9.5, 1.8)
      break
  }
}

function artwork(ctx: Brush, [family, bg, body, accent, motif]: Design) {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 22, 20)
  if (family === 'night') {
    const light = ctx.createLinearGradient(3, 3, 18, 17)
    light.addColorStop(0, body)
    light.addColorStop(0.53, body)
    light.addColorStop(1, accent)
    ctx.fillStyle = light
    polygon(ctx, [1.6, 6, 6, 2.1, 18, 2.1, 20.5, 4.6, 20.5, 14.3, 16.3, 17.7, 3.2, 17.7, 1.6, 15])
    ctx.fillStyle = accent
    polygon(ctx, [16.3, 6.1, 20.5, 4.6, 20.5, 14.3, 16.3, 17.7])
    ctx.save()
    ctx.translate(3.2, 2.5)
    ctx.scale(0.64, 0.68)
    subject(ctx, motif, accent, body)
    ctx.restore()
    ctx.fillStyle = '#FFF6E8'
    ctx.fillRect(5.2, 3.9, 6.4, 0.9)
    return
  }
  if (family === 'split') {
    const horizontal = motif === 'press' || motif === 'impeller'
    ctx.fillStyle = body
    if (horizontal) ctx.fillRect(0, 9, 22, 11)
    else ctx.fillRect(10, 0, 12, 20)
    ctx.save()
    ctx.translate(horizontal ? 7 : 8.2, horizontal ? 5.3 : 1.8)
    ctx.scale(0.66, 0.7)
    subject(ctx, motif, bg, body)
    ctx.restore()
    ctx.fillStyle = accent
    polygon(
      ctx,
      horizontal ? [1.8, 3.9, 10, 3.9, 7.8, 6.4, 1.8, 6.4] : [2, 13.6, 7.5, 7.6, 7.5, 11.2, 2, 17.1]
    )
    return
  }
  subject(ctx, motif, body, bg)
  ctx.fillStyle = accent
  if (family === 'paper') ctx.fillRect(2, 17, 5.7, 1.8)
  else ctx.fillRect(15.7, 17.2, 4.2, 1.15)
}

function bakeDesign(design: Design, w: number, h: number) {
  const tile = surface(2 * w, 2 * h)
  const ctx = tile?.getContext('2d')
  if (!ctx) return
  ctx.scale(w / 11, h / 10)
  artwork(ctx, design)
  return tile
}

interface Photo {
  tiles: (Surface | undefined)[]
}
function loadPhoto(url: string): Photo {
  const photo: Photo = { tiles: [] }
  if (typeof Image === 'undefined') return photo
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) return
    // Crop once per aspect ratio. A bitmap of the original photo never enters the live draw loop.
    photo.tiles = formats.map(([w, h]) => {
      const tile = surface(2 * w, 2 * h)
      const ctx = tile?.getContext('2d')
      if (!ctx || !tile) return
      const cover = Math.max(tile.width / image.naturalWidth, tile.height / image.naturalHeight)
      const sw = tile.width / cover,
        sh = tile.height / cover
      ctx.drawImage(
        image,
        (image.naturalWidth - sw) / 2,
        (image.naturalHeight - sh) / 2,
        sw,
        sh,
        0,
        0,
        tile.width,
        tile.height
      )
      return tile
    })
  }
  image.src = url
  return photo
}

export interface StarThumbnail {
  width: number
  height: number
  format: number
  design: Design
  image?: Surface
  photo?: Photo
}

export class StarThumbnails {
  private atlas?: (Surface | undefined)[][]
  private photos = new Map<string, Photo>()

  prepare(marks: Iterable<Mark>) {
    const cards = new Map<string, StarThumbnail>()
    const photos = new Map<string, Photo>()
    const candidates: { mark: Mark; url: string }[] = []
    for (const mark of marks) {
      if (mark.role !== 'leaf') continue
      const supplied = 'thumbnailUrl' in mark.entity ? mark.entity.thumbnailUrl : null
      const url = typeof supplied === 'string' ? supplied.trim() : ''
      if (url || mark.seed >= 0.75) candidates.push({ mark, url })
    }
    if (!candidates.length) {
      this.photos = photos
      return cards
    }
    this.atlas ??= designs.map((design) => formats.map(([w, h]) => bakeDesign(design, w, h)))
    const byCluster = new Map<string, Mark[]>()
    for (const { mark, url } of candidates) {
      if (url) continue
      const group = byCluster.get(mark.parent) ?? []
      group.push(mark)
      byCluster.set(mark.parent, group)
    }
    const assigned = new Map<string, number>()
    const clusters = [...byCluster.keys()].sort((a, b) => seed(a) - seed(b) || a.localeCompare(b))
    for (const cluster of clusters) {
      const group = byCluster.get(cluster)!
      group.sort(
        (a, b) => seed(a.key + '/poster') - seed(b.key + '/poster') || a.key.localeCompare(b.key)
      )
      for (const mark of group) assigned.set(mark.key, assigned.size % designs.length)
    }
    for (const { mark, url } of candidates) {
      const id = mark.entity.id
      const format = Math.floor(seed(id + 'card') * formats.length)
      const motif = assigned.get(mark.key) ?? Math.floor(seed(id + '/thumbnail') * designs.length)
      const [width, height] = formats[format]
      let photo: Photo | undefined
      if (url) {
        photo = photos.get(url) ?? this.photos.get(url) ?? loadPhoto(url)
        photos.set(url, photo)
      }
      cards.set(mark.key, {
        width,
        height,
        format,
        design: designs[motif],
        image: this.atlas[motif][format],
        photo
      })
    }
    this.photos = photos
    return cards
  }
}

export function paintThumbnail(
  ctx: CanvasRenderingContext2D,
  card: StarThumbnail,
  x: number,
  y: number,
  w: number,
  h: number,
  family: number,
  leaf: number
) {
  const image = card.photo?.tiles[card.format] ?? card.image
  const left = x - w / 2,
    top = y - h / 2
  if (image) ctx.drawImage(image, left, top, w, h)
  else {
    // Canvas-only host without an offscreen surface.
    ctx.save()
    ctx.translate(left, top)
    ctx.scale(w / 22, h / 20)
    artwork(ctx, card.design)
    ctx.restore()
  }
  const opacity = ctx.globalAlpha
  const emphasis = Math.max(family, leaf)
  ctx.globalAlpha = opacity * (0.48 + 0.52 * emphasis)
  ctx.strokeStyle = blendInk(blendInk('#CDDCF8', '#2EE89A', family), '#FFFFFF', leaf)
  ctx.lineWidth = 0.85 + 0.2 * family * (1 - leaf) + 0.25 * leaf
  ctx.strokeRect(left, top, w, h)
  ctx.globalAlpha = opacity
}
