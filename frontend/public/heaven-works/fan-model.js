const projectAgents = [
  { id: 'parse', name: '问题解析 Agent', role: '识别问题、型号与查询范围', c: '#8cc8ff' },
  { id: 'evidence', name: '证据检索 Agent', role: '检索知识、图谱、产品与业务记录', c: '#8fe3b9' },
  { id: 'assess', name: '深度研判 Agent', role: '核对依据，定位部件与下一步', c: '#f2b872' },
  { id: 'report', name: '报告生成 Agent', role: '汇总本轮答复、数据与引用，生成报告', c: '#b9a6ff' }
]
/* FazeMES table fan. The order of these parts is also the loom's section order. */
const fanProject = {
  id: 'FAN-07',
  title: '台式电风扇 · 七部件装配',
  kind: 'fan',
  kindName: 'FAN / 电风扇',
  secs: [
    { n: '底座', en: 'BASE', task: '定位防滑底座', c: '#f2b872', needs: [] },
    { n: '立柱', en: 'STAND', task: '锁紧立柱与支架', c: '#72d4d0', needs: [0] },
    { n: '电机', en: 'MOTOR', task: '定位电机与转轴', c: '#8fe3b9', needs: [1] },
    { n: '后网罩', en: 'REAR', task: '固定后网罩', c: '#d6df7c', needs: [2] },
    { n: '扇叶', en: 'BLADES', task: '装入三片弧形扇叶', c: '#b9a6ff', needs: [2, 3] },
    { n: '锁帽', en: 'HUB', task: '旋紧叶轮锁帽', c: '#8cc8ff', needs: [4] },
    { n: '前网罩', en: 'FRONT', task: '合拢防护网圈', c: '#ff9f8c', needs: [3, 5] }
  ]
}

function buildTableFan(mesh) {
  const turn = Math.PI * 2
  const axleHeight = 1.05
  const rimRadius = 0.69

  function loop(segments, sample) {
    return Array.from({ length: segments + 1 }, (_, index) => sample(turn * index / segments))
  }

  function pedestalRing(width, depth, height) {
    return loop(56, angle => [width * Math.cos(angle), height, depth * Math.sin(angle) - 0.025])
  }

  function wheelPoint(radius, angle, depth) {
    return [radius * Math.cos(angle), axleHeight + radius * Math.sin(angle), depth]
  }

  function wheelRing(radius, depth) {
    return loop(68, angle => wheelPoint(radius, angle, depth))
  }

  function shell(rings) {
    rings.forEach((ring, index) => {
      mesh.pl(ring)
      if (index > 0) mesh.strip(rings[index - 1], ring)
    })
  }

  mesh.s(0, 0.007)
  shell([pedestalRing(0.44, 0.35, 0.025), pedestalRing(0.46, 0.36, 0.065),
    pedestalRing(0.41, 0.32, 0.12), pedestalRing(0.11, 0.11, 0.16)])
  for (let key = 0; key < 4; key++) {
    const left = (key - 1.5) * 0.082 - 0.028
    mesh.box(left, 0.115, 0.13, left + 0.055, 0.144, 0.19)
  }

  mesh.s(1, 0.008)
  const collar = (radius, height, depth) =>
    loop(32, angle => [radius * Math.cos(angle), height, depth + radius * Math.sin(angle)])
  shell([collar(0.106, 0.15, -0.09), collar(0.09, 0.28, -0.12),
    collar(0.055, 0.77, -0.22), collar(0.068, 0.89, -0.24)])
  mesh.ln([-0.065, 0.84, -0.24], [-0.155, 1.03, -0.22])
  mesh.ln([0.065, 0.84, -0.24], [0.155, 1.03, -0.22])

  mesh.s(2, 0.006)
  shell([wheelRing(0.065, -0.43), wheelRing(0.15, -0.38),
    wheelRing(0.174, -0.26), wheelRing(0.163, -0.10), wheelRing(0.072, -0.07)])
  for (let vent = 0; vent < 16; vent++) {
    const angle = turn * vent / 16
    mesh.ln(wheelPoint(0.143, angle, -0.38), wheelPoint(0.159, angle, -0.30))
  }
  mesh.ln([0, axleHeight, -0.08], [0, axleHeight, 0.15])

  function grille(front) {
    const outerDepth = 0.058
    const bulge = front ? 0.152 : -0.185
    const depthAt = fraction => outerDepth + bulge * (1 - fraction * fraction)
    const count = front ? 28 : 18
    for (const fraction of (front ? [0.18, 0.61, 0.93, 1] : [0.24, 0.70, 1])) {
      mesh.pl(wheelRing(rimRadius * fraction, depthAt(fraction)))
    }
    for (let wire = 0; wire < count; wire++) {
      const start = turn * wire / count + (front ? 0 : 0.05)
      mesh.curve(t => {
        const fraction = 0.18 + 0.82 * t
        return wheelPoint(fraction * rimRadius, start + (front ? 0.2 : -0.15) * t, depthAt(fraction))
      }, 13)
    }
  }

  mesh.s(3, 0.003)
  grille(false)

  mesh.s(4, 0.009)
  for (let blade = 0; blade < 3; blade++) {
    const angle = turn * blade / 3 + 0.26
    const edge = side => Array.from({ length: 25 }, (_, index) => {
      const t = index / 24
      const radius = 0.086 + 0.524 * Math.sin(t * Math.PI / 2)
      const width = 0.075 + 0.56 * Math.pow(Math.sin(Math.PI * t), 0.7)
      return wheelPoint(radius, angle + 0.97 * t + side * width, 0.045 + side * 0.05 * Math.sin(Math.PI * t))
    })
    const leading = edge(-1), trailing = edge(1)
    mesh.pl(leading).pl(trailing).ln(leading[24], trailing[24]).strip(leading, trailing)
    mesh.curve(t => wheelPoint(0.11 + 0.46 * t, angle + 0.91 * t, 0.055), 18)
  }

  mesh.s(5, 0.007)
  shell([wheelRing(0.135, 0.065), wheelRing(0.14, 0.103),
    wheelRing(0.108, 0.145), wheelRing(0.026, 0.172)])
  mesh.face(wheelRing(0.027, 0.172).slice(0, -1))

  mesh.s(6, 0.003)
  grille(true)
  mesh.pl(wheelRing(rimRadius + 0.008, 0.045))
}
