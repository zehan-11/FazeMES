import type { Journey } from './workflowJourney'

const defaultStations = [
  { id: 'input', name: '提出问题', label: 'INPUT', color: '#344acd', light: '#a7baff' },
  { id: 'retrieval', name: '检索证据', label: 'RETRIEVAL', color: '#852e88', light: '#ffa4eb' },
  { id: 'branch', name: '判断分支', label: 'ROUTING', color: '#ad4b25', light: '#ffc69d' },
  { id: 'result', name: '核对结果', label: 'OUTPUT', color: '#126d56', light: '#92f2c4' }
]
// The event stream supplies identity and order. Only the palette and short labels are presentational.
const nodeStyles: Record<string, { label: string; color: string; light: string }> = {
  start: defaultStations[0],
  'knowledge-retrieval': { ...defaultStations[1], label: 'SEARCH' },
  'if-else': { ...defaultStations[2], label: 'BRANCH' },
  code: { label: 'CODE', color: '#394b87', light: '#b7c9ff' },
  'http-request': { label: 'HTTP', color: '#146770', light: '#a4eced' },
  'template-transform': { label: 'TEXT', color: '#6a435f', light: '#f1c2e1' },
  end: defaultStations[3]
}

export const stepStatus = (status: string) =>
  (
    ({
      succeeded: '执行成功',
      failed: '执行失败',
      started: '已开始',
      stopped: '已停止',
      exception: '发生异常',
      retry: '重试中'
    }) as Record<string, string>
  )[status] || status

export function journeyStations(run: Journey) {
  if (!run.trace) return defaultStations
  return run.trace.steps.map((step) => {
    const style = nodeStyles[step.type] ?? { ...defaultStations[0], label: step.type.toUpperCase() }
    return { ...style, id: step.id, name: step.title }
  })
}

type Point = [number, number]
type World = [number, number, number]
const pitch = 540
const halfWidth = 325

export function stationAt(
  x: number,
  y: number,
  progress: number,
  count: number
): number | undefined {
  const k = (y - 0.085) / 0.835
  if (k <= 0 || Math.abs(x - 0.5) > (halfWidth * k) / 880) return
  const z = progress * pitch + 460 / k - 460
  const i = Math.floor((z + 75) / pitch)
  return i >= 0 && i < count ? i : undefined
}

export function paintRunway(
  canvas: HTMLCanvasElement,
  progress: number,
  run: Journey,
  stations: ReturnType<typeof journeyStations>
) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const ctx = canvas.getContext('2d')
  if (!ctx || !width || !height) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.fillStyle = '#101418'
  ctx.fillRect(0, 0, width, height)
  const camera = progress * pitch
  const depth = (z: number) => 460 / Math.max(90, 460 + z - camera)
  function project(x: number, z: number, altitude = 0): Point {
    const k = depth(z)
    return [width * (0.5 + (x * k) / 880), height * (0.085 + k * (0.835 - altitude / 490))]
  }
  function path(points: Point[], stroke: string, fill = '') {
    ctx!.beginPath()
    points.forEach(([x, y], i) => (i ? ctx!.lineTo(x, y) : ctx!.moveTo(x, y)))
    if (fill) {
      ctx!.closePath()
      ctx!.fillStyle = fill
      ctx!.fill()
    }
    ctx!.strokeStyle = stroke
    ctx!.stroke()
  }
  function wire(a: World, b: World, ink: string) {
    path([project(...a), project(...b)], ink)
  }
  function plate(
    left: number,
    right: number,
    front: number,
    back: number,
    ink: string,
    fill: string
  ) {
    path(
      [project(left, front), project(right, front), project(right, back), project(left, back)],
      ink,
      fill
    )
  }
  function title(
    value: string,
    x: number,
    z: number,
    size: number,
    ink: string,
    bold = false,
    maxSize = Infinity
  ) {
    const [px, py] = project(x, z)
    ctx!.fillStyle = ink
    ctx!.font =
      (bold ? '700 ' : '500 ') +
      Math.min(maxSize, Math.max(4, size * depth(z) * Math.min(width / 780, 1.28))) +
      'px "Segoe UI","Microsoft YaHei",sans-serif'
    ctx!.fillText(value, px, py)
  }
  const near = camera - 115
  const far = pitch * (stations.length + 1.8)
  for (let x = -2400; x <= 2400; x += 100) wire([x, near, 0], [x, far, 0], '#293139')
  for (let z = Math.floor(near / 100) * 100; z < far; z += 100)
    wire([-2200, z, 0], [2200, z, 0], '#293139')

  // Wireframe machine housings and shaft rings give the camera a fixed scale beside the track.
  for (let n = 11; n >= 0; n--) {
    const z = n * 220 + 120
    if (z < near) continue
    const x = (n % 2 ? -1 : 1) * (397 + (n % 3) * 21)
    const ring = (offset: number): Point[] =>
      Array.from({ length: 29 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2
        return project(x + 43 * Math.cos(a), z + offset, 56 + 43 * Math.sin(a))
      })
    const face = ring(0),
      back = ring(74)
    path(back, '#45515b')
    path(face, '#62707c')
    path(ring(8), '#3c4851')
    for (let i = 0; i < 28; i += 4) path([face[i], back[i]], '#44515b')
    wire([x - 55, z - 7, 0], [x + 55, z - 7, 0], '#66737d')
    wire([x - 37, z - 7, 0], [x - 17, z, 22], '#66737d')
    wire([x + 37, z - 7, 0], [x + 17, z, 22], '#66737d')
  }

  for (let i = stations.length - 1; i >= 0; i--) {
    const station = stations[i]
    const start = i * pitch - 75
    const end = start + pitch
    if (end <= near) continue
    const front = Math.max(start, near)
    plate(-halfWidth, halfWidth, front, end, '#ffffff68', station.color)
    for (const x of [-310, 0, 310]) wire([x, front, 0], [x, end, 0], '#ffffff32')
    for (let z = start + 54; z < end; z += 54) {
      if (z < near) continue
      wire([-325, z, 0], [-311, z, 0], '#ffffff8a')
      wire([311, z, 0], [325, z, 0], '#ffffff8a')
    }
    const z = i * pitch
    const bandHeight = project(0, front)[1] - project(0, end)[1]
    const titleGap = project(0, z + 7)[1] - project(0, z + 75)[1]
    // Perspective compresses the vertical space between lines faster than the text shrinks.
    if (titleGap >= 20) {
      title(station.label, -287, z + 7, 53, '#fff', true, titleGap)
      title(station.name, -283, z + 75, 18, '#fff')
    } else if (bandHeight >= 18) {
      title(station.name, -283, z + 38, 26, '#fff', true, bandHeight * 0.34)
    }
    const cardFront = z + 132,
      cardBack = z + 335
    if (cardBack < near) continue
    plate(-278, -13, Math.max(near, cardFront), cardBack, '#ffffff61', '#ffffff14')
    plate(9, 277, Math.max(near, cardFront), cardBack, '#ffffff61', '#101725')
    const step = run.trace?.steps[i]
    if (titleGap >= 20) {
      title(
        step ? '节点状态' : ['用户输入', '来源片段', '分支条件', '结果输出'][i],
        -255,
        z + 210,
        21,
        '#fff',
        true
      )
      const note = step
        ? stepStatus(step.status)
        : [run.question, run.sources[0]?.title || '没有返回片段', run.branch, run.origin][i]
      const characters = Array.from(note)
      const excerpt = characters.length > 13 ? characters.slice(0, 13).join('') + '…' : note
      title(excerpt, -255, z + 155, 13, '#fff')
    }
    // A node diagram is projected onto the dark inset on each band.
    const nodes: Array<[number, number]> =
      !step && i === 2
        ? [
            [42, 225],
            [130, 225],
            [214, 170],
            [214, 280]
          ]
        : [
            [40, 225],
            [130, 225],
            [215, 225]
          ]
    const pairs =
      !step && i === 2
        ? [
            [0, 1],
            [1, 2],
            [1, 3]
          ]
        : [
            [0, 1],
            [1, 2]
          ]
    for (const [a, b] of pairs)
      wire([nodes[a][0], z + nodes[a][1], 0], [nodes[b][0], z + nodes[b][1], 0], station.light)
    for (const [x, d] of nodes) {
      const [px, py] = project(x, z + d)
      ctx.fillStyle = station.light
      ctx.beginPath()
      ctx.arc(px, py, Math.max(2, 5 * depth(z + d)), 0, Math.PI * 2)
      ctx.fill()
    }
    if (titleGap >= 20) title('FAZEMES   /   ' + station.label, -282, z + 405, 13, '#ffffffb8')
  }
}
