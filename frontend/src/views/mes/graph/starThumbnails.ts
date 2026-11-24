import { seed, type Mark } from './starScene'
import { blendInk } from './starInk'

const formats = [
  [22, 15],
  [15, 20],
  [18, 18]
] as const
type Surface = OffscreenCanvas | HTMLCanvasElement
type Brush = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type Rect = readonly [x: number, y: number, width: number, height: number]
interface Layout {
  solid: readonly Rect[]
  detail: readonly Rect[]
  accent: Rect
  trace?: readonly (readonly [number, number])[]
}

// Each miniature has a distinct layout on a shared 22 × 20 grid. Fine rules and gutters
// survive rasterization at 2× in all three aspect ratios.
const layouts = {
  article: {
    solid: [[0, 0, 22, 2], [3, 5, 11, 1.5]],
    detail: [[3, 9, 5, 7], [10, 9, 9, 0.8], [10, 11, 7, 0.8], [10, 13, 8, 0.8], [10, 15, 5, 0.8]],
    accent: [16, 5, 3, 1.5]
  },
  catalog: {
    solid: [[2, 3, 10, 1.5], [2, 14, 7, 1], [12, 14, 8, 1]],
    detail: [[2, 7, 8, 5.5], [12, 7, 8, 5.5], [2, 16.5, 5, 0.8], [12, 16.5, 6, 0.8]],
    accent: [16, 3, 4, 1.5]
  },
  invoice: {
    solid: [[3, 3, 8, 1.6], [14, 15.5, 5, 1.4]],
    detail: [[3, 7, 16, 0.8], [3, 10, 9, 0.8], [15, 10, 4, 0.8], [3, 12.5, 6, 0.8], [15, 12.5, 4, 0.8]],
    accent: [16, 3, 3, 2]
  },
  handbook: {
    solid: [[0, 0, 22, 2], [9, 5, 9, 1.3], [9, 11.5, 7, 1.1]],
    detail: [[2, 5, 4.5, 12], [9, 8, 10.5, 0.8], [9, 14, 10, 0.8], [9, 16, 8, 0.8]],
    accent: [2, 6, 4.5, 1.3]
  },
  brief: {
    solid: [[2.5, 3, 10, 1.5], [2.5, 6, 6, 1.2]],
    detail: [[13, 6, 6.5, 7], [2.5, 10, 8, 0.8], [2.5, 12, 6.5, 0.8], [2.5, 15.5, 17, 0.8], [2.5, 17.5, 12, 0.8]],
    accent: [13, 11.5, 6.5, 1.5]
  },
  schedule: {
    solid: [[2, 3, 10, 1.5], [2, 7, 18, 0.8]],
    detail: [[3, 10, 3, 1], [8, 10, 10, 1.4], [3, 13, 3, 1], [3, 16, 3, 1], [8, 16, 8, 1.4]],
    accent: [8, 13, 6, 1.5]
  },
  windows: {
    solid: [[3, 4, 9, 7], [10, 11, 9, 5]],
    detail: [[3, 12.5, 5, 0.9], [14, 6, 5, 1.1], [10, 17.5, 6, 0.7]],
    accent: [3, 4, 9, 1.8]
  },
  ticker: {
    solid: [[2, 3, 8, 2], [2, 8, 2, 2], [2, 12, 2, 2], [2, 16, 2, 2]],
    detail: [[6, 8.5, 10, 1], [6, 12.5, 7, 1], [6, 16.5, 12, 1]],
    accent: [16, 3, 4, 1.6]
  },
  twinBars: {
    solid: [[5, 10, 4, 6.5], [10.5, 6, 4, 10.5]],
    detail: [[2, 3, 8, 1], [3, 17.5, 16, 0.8]],
    accent: [10.5, 6, 4, 2]
  },
  console: {
    solid: [[2, 3, 4, 14], [8, 4, 10, 1.4], [8, 8, 6.5, 5]],
    detail: [[16, 8, 4, 1], [16, 10.5, 3, 1], [8, 15, 9, 0.9]],
    accent: [2, 6, 4, 2]
  },
  lineChart: {
    solid: [[2, 3, 8, 1.5], [16, 3, 3, 1.5]],
    detail: [[2, 16.5, 18, 0.8]],
    accent: [16, 3, 3, 1.5],
    trace: [[3, 14], [7, 10], [10, 12], [15, 7.5], [19, 9]]
  },
  strips: {
    solid: [[2, 4, 10, 2.5], [5, 9, 13, 2.5]],
    detail: [[8, 14, 12, 2], [2, 14, 4, 0.9]],
    accent: [15, 4, 4, 2.5]
  },
  tiles: {
    solid: [[2, 3, 7.5, 6], [12, 3, 7.5, 6]],
    detail: [[2, 11, 5, 1], [12, 11, 7, 1], [2, 15, 10, 1.2]],
    accent: [15, 14.5, 4.5, 2.3]
  },
  columns: {
    solid: [[3, 3, 7, 1.5], [3, 7, 8, 9]],
    detail: [[13, 7, 6, 1.3], [13, 10, 5, 1], [13, 13, 3.5, 1]],
    accent: [13, 15.5, 5, 1.2]
  },
  tracks: {
    solid: [[2.5, 3, 8, 1.4], [2.5, 7, 2, 2], [2.5, 12, 2, 2]],
    detail: [[6, 7, 12.5, 2], [6, 12, 8, 2], [6, 16, 11, 0.8]],
    accent: [6, 12, 5, 2]
  },
  kiosk: {
    solid: [[3, 4, 15, 8], [9.5, 12, 2, 2], [7, 14, 7, 1.5]],
    detail: [[3, 17, 7, 0.7]],
    accent: [5, 6, 9, 1.3]
  },
  folio: {
    solid: [[6, 3, 12, 13]],
    detail: [[3.5, 6, 1, 12], [3.5, 17, 11.5, 1]],
    accent: [8, 6, 7, 1.5]
  },
  storefront: {
    solid: [[3, 5, 16, 3], [4, 10, 6, 5], [12, 10, 6, 5]],
    detail: [[3, 17, 16, 0.8]],
    accent: [3, 5, 4, 1.2]
  },
  parcel: {
    solid: [[5, 5, 12, 10.5]],
    detail: [[3, 17.5, 7, 0.7], [12, 17.5, 4, 0.7]],
    accent: [10, 5, 2, 4]
  },
  stack: {
    solid: [[3, 4, 13, 4], [6, 10, 13, 4]],
    detail: [[3, 16, 5, 0.8], [10, 16, 9, 0.8]],
    accent: [8, 11.5, 6, 1]
  }
} as const satisfies Record<string, Layout>

type Design = readonly [
  family: 'paper' | 'interface' | 'poster',
  background: string,
  layout: keyof typeof layouts,
  accent: string
]

// Interleave families so a partial deck also stays close to 30% paper, 45% dark, 25% color.
const designs: readonly Design[] = [
  ['interface', '#0B1020', 'windows', '#3B82F6'],
  ['paper', '#FFFFFF', 'article', '#2563EB'],
  ['poster', '#1A46CC', 'kiosk', '#1A46CC'],
  ['interface', '#0B1020', 'ticker', '#10B981'],
  ['paper', '#F6F8FC', 'catalog', '#D9413A'],
  ['interface', '#0B1020', 'twinBars', '#E59A38'],
  ['poster', '#9C3535', 'folio', '#9C3535'],
  ['interface', '#0B1020', 'console', '#3B82F6'],
  ['paper', '#FFFFFF', 'invoice', '#0F9D8A'],
  ['poster', '#126B5D', 'storefront', '#126B5D'],
  ['interface', '#0B1020', 'lineChart', '#10B981'],
  ['paper', '#F6F8FC', 'handbook', '#2563EB'],
  ['interface', '#0B1020', 'strips', '#D64545'],
  ['poster', '#A46224', 'parcel', '#A46224'],
  ['interface', '#0B1020', 'tiles', '#E59A38'],
  ['paper', '#FFFFFF', 'brief', '#D9413A'],
  ['interface', '#0B1020', 'columns', '#3B82F6'],
  ['poster', '#4B2F8E', 'stack', '#4B2F8E'],
  ['paper', '#F6F8FC', 'schedule', '#0F9D8A'],
  ['interface', '#0B1020', 'tracks', '#10B981']
]
function surface(w: number, h: number): Surface | undefined {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

function getBrush(tile: Surface | undefined) {
  const ctx = tile?.getContext('2d')
  return ctx && 'drawImage' in ctx ? ctx : undefined
}

function artwork(ctx: Brush, [family, background, name, accent]: Design) {
  const layout: Layout = layouts[name]
  ctx.fillStyle = background
  ctx.fillRect(0, 0, 22, 20)
  ctx.fillStyle = family === 'paper' ? '#334155' : family === 'poster' ? '#FFFFFF' : '#EDF2FA'
  for (const rect of layout.solid) ctx.fillRect(...rect)
  ctx.fillStyle = family === 'paper' ? '#BCC8D6' : '#CBD5E1'
  for (const rect of layout.detail) ctx.fillRect(...rect)
  if (layout.trace) {
    ctx.beginPath()
    ctx.moveTo(...layout.trace[0])
    for (const point of layout.trace.slice(1)) ctx.lineTo(...point)
    ctx.strokeStyle = '#EDF2FA'
    ctx.lineWidth = 1.1
    ctx.stroke()
  }
  ctx.fillStyle = accent
  ctx.fillRect(...layout.accent)
}

function bakeDesign(design: Design, w: number, h: number) {
  const tile = surface(2 * w, 2 * h)
  const ctx = getBrush(tile)
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
      const ctx = getBrush(tile)
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

function thumbnailFormat(id: string) {
  return Math.floor(seed(id + 'card') * formats.length)
}

export function thumbnailSize(id: string): readonly [number, number] {
  return formats[thumbnailFormat(id)]
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
    for (const { mark } of candidates) {
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
      const format = thumbnailFormat(id)
      const motif = assigned.get(mark.key)!
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
  leaf: number,
  dpr = 1
) {
  const image = card.photo?.tiles[card.format] ?? card.image
  const framed = !!card.photo || card.design[0] !== 'interface'
  const left = framed ? Math.round((x - w / 2) * dpr) / dpr : x - w / 2
  const top = framed ? Math.round((y - h / 2) * dpr) / dpr : y - h / 2
  // A one-pixel dark gap keeps a white frame distinguishable even on white artwork.
  // Contain the entire cached tile at its original aspect ratio inside the existing hit box.
  const scale = framed ? Math.max(0, 1 - 4 / Math.min(w, h)) : 1
  const imageW = w * scale,
    imageH = h * scale
  const imageX = left + (w - imageW) / 2,
    imageY = top + (h - imageH) / 2
  if (framed) {
    ctx.fillStyle = '#0B1020'
    ctx.fillRect(left, top, w, h)
  }
  if (image) ctx.drawImage(image, imageX, imageY, imageW, imageH)
  else {
    ctx.save()
    ctx.translate(imageX, imageY)
    ctx.scale(imageW / 22, imageH / 20)
    artwork(ctx, card.design)
    ctx.restore()
  }
  const opacity = ctx.globalAlpha
  const emphasis = Math.max(family, leaf)
  ctx.globalAlpha = framed ? opacity : opacity * (0.45 + 0.55 * emphasis)
  ctx.strokeStyle = blendInk(framed ? '#FFFFFF' : '#B9CEF0', '#2EE89A', emphasis)
  ctx.lineWidth = framed ? 1 : 0.85 + 0.15 * emphasis
  const inset = framed ? 0.5 : 0
  ctx.strokeRect(left + inset, top + inset, w - 2 * inset, h - 2 * inset)
  ctx.globalAlpha = opacity
}
