import * as T from 'three'
import { finishPart, contactShadow } from './print-finish.mjs'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const TAU = 2 * Math.PI,
  V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z)
const smooth = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}
const mix = (a, b, t) => a + (b - a) * t
const at = (radius, angle, z) => V(radius * Math.cos(angle), radius * Math.sin(angle), z)
const standard = (color, metalness, roughness) =>
  new T.MeshStandardMaterial({ color, metalness, roughness })
const enamel = (color, roughness) =>
  new T.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0.16,
    clearcoat: 0.3,
    clearcoatRoughness: 0.25,
    envMapIntensity: 0.83
  })
const graphiteEnamel = enamel(0x29354c, 0.3),
  blueEnamel = enamel(0x3564a9, 0.32)
const rim = standard(0xc6cede, 0.65, 0.3),
  wire = standard(0x7d8fa8, 0.69, 0.31)
const shadow = standard(0x202d41, 0.48, 0.45),
  metal = standard(0xa7b5bb, 0.81, 0.33)
const brass = standard(0xb68d57, 0.67, 0.4),
  copper = standard(0xbd713f, 0.7, 0.3)
const rubber = standard(0x2f363a, 0.03, 0.82),
  lam = standard(0x66747e, 0.66, 0.51)
const ballastSteel = standard(0x4c5860, 0.62, 0.65)
function threadOrWire(name, material) {
  if (name.endsWith('guard')) return material !== graphiteEnamel
  if (name === 'impeller') return material === rim
  if (name === 'end-bell' && material === metal) return true
  if (name.includes('screw') || name === 'tilt-bolt') return material === rubber
  return material === shadow || material === rubber
}
function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geo, mat)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}
function lathe(parent, profile, mat, x = 0, y = 0, z = 0) {
  // Orient the closed section consistently so opaque outer surfaces face the viewer.
  let area = 0
  for (let i = 1; i < profile.length; i++)
    area += profile[i - 1][0] * profile[i][1] - profile[i][0] * profile[i - 1][1]
  const poly = area < 0 ? [...profile].reverse() : profile
  const g = new T.LatheGeometry(
    poly.map(([r, h]) => new T.Vector2(Math.max(0.00001, r), h)),
    72
  )
  g.rotateX(Math.PI / 2)
  return mesh(parent, g, mat, x, y, z)
}
function cyl(parent, r, h, mat, x = 0, y = 0, z = 0) {
  const g = new T.CylinderGeometry(r, r, h, 56)
  g.rotateX(Math.PI / 2)
  return mesh(parent, g, mat, x, y, z)
}
function ring(parent, r, t, mat, z = 0, x = 0, y = 0) {
  return mesh(parent, new T.TorusGeometry(r, t, 8, 72), mat, x, y, z)
}
function tube(parent, pts, r, mat, closed = false) {
  const path = new T.CatmullRomCurve3(pts, closed, 'centripetal')
  return mesh(parent, new T.TubeGeometry(path, Math.max(12, pts.length * 2), r, 6, closed), mat)
}
function roundRect(w, h, r, cx = 0, cy = 0) {
  const s = new T.Shape(),
    l = cx - w / 2,
    rr = cx + w / 2,
    b = cy - h / 2,
    t = cy + h / 2
  s.moveTo(l + r, b)
  s.lineTo(rr - r, b)
  s.quadraticCurveTo(rr, b, rr, b + r)
  s.lineTo(rr, t - r)
  s.quadraticCurveTo(rr, t, rr - r, t)
  s.lineTo(l + r, t)
  s.quadraticCurveTo(l, t, l, t - r)
  s.lineTo(l, b + r)
  s.quadraticCurveTo(l, b, l + r, b)
  s.closePath()
  return s
}
function hole(s, x, y, r) {
  const p = new T.Path()
  p.absarc(x, y, r, 0, TAU, true)
  s.holes.push(p)
}
function extrude(s, h, b = 0.012) {
  return new T.ExtrudeGeometry(s, {
    depth: h,
    curveSegments: 20,
    bevelEnabled: b > 0,
    bevelSegments: 3,
    bevelThickness: b,
    bevelSize: b,
    steps: 1
  })
}
function washer(parent, outer, inner, h, mat, z = 0) {
  return lathe(
    parent,
    [
      [inner, -h / 2],
      [outer - 0.006, -h / 2],
      [outer, -h / 2 + 0.006],
      [outer, h / 2 - 0.006],
      [outer - 0.006, h / 2],
      [inner, h / 2],
      [inner, -h / 2]
    ],
    mat,
    0,
    0,
    z
  )
}
function beadScrew(g, len = 0.19, r = 0.031) {
  cyl(g, r * 0.72, len, metal, 0, 0, -len * 0.5)
  const pt = Array.from({ length: 60 }, (_, i) =>
    at(r * 0.73, (i / 59) * TAU * 5, -len + (i / 59) * len * 0.91)
  )
  tube(g, pt, r * 0.13, metal).userData.detail = 'thread'
  lathe(
    g,
    [
      [0, 0],
      [r, 0],
      [r * 1.42, 0.008],
      [r * 1.48, 0.023],
      [r * 1.24, 0.032],
      [0, 0.034],
      [0, 0]
    ],
    metal
  )
  for (const angle of [0, Math.PI / 2]) {
    const line = mesh(g, new T.BoxGeometry(r * 1.65, r * 0.26, 0.0025), rubber, 0, 0, 0.034)
    line.rotation.z = angle
  }
}
function guard(g, front) {
  const R = 1.53,
    sgn = front ? 1 : -1,
    deep = front ? 0.44 : 0.34,
    cols = front ? 46 : 34,
    wm = front ? wire : metal
  const z = (r) => sgn * deep * (1 - Math.pow(r / R, 2.25))
  for (let i = 0; i < cols; i++) {
    const a = (TAU * i) / cols
    const p = []
    for (let j = 0; j <= 9; j++) {
      const t = j / 9,
        r = 0.195 + (R - 0.195) * t
      p.push(at(r, a + sgn * 0.17 * (1 - t), z(r)))
    }
    const strand = tube(g, p, front ? 0.0088 : 0.0092, wm)
    if (i % 2 === 1) strand.userData.detail = 'alternate-wire'
  }
  for (const r of [0.38, 0.75, 1.13, 1.41]) ring(g, r, 0.0075, wm, z(r))
  ring(g, R, 0.027, rim)
  ring(g, R - 0.005, 0.0105, shadow, sgn * 0.033)
  if (front) {
    lathe(
      g,
      [
        [0, -0.025],
        [0.18, -0.025],
        [0.205, 0],
        [0.197, 0.029],
        [0.16, 0.044],
        [0, 0.05],
        [0, -0.025]
      ],
      graphiteEnamel,
      0,
      0,
      deep
    )
    ring(g, 0.19, 0.009, metal, deep + 0.027)
  } else washer(g, 0.266, 0.14, 0.044, metal, -deep)
  if (front)
    for (const a of [0.58, 2.68, 4.72]) {
      const q = at(R, a, 0)
      const tab = mesh(g, new T.BoxGeometry(0.105, 0.05, 0.104), rim, q.x, q.y, -0.014)
      tab.rotation.z = a + Math.PI / 2
      const b = cyl(g, 0.017, 0.009, shadow, q.x, q.y, 0.042)
      b.rotation.z = a
    }
}
function impeller(g) {
  for (let n = 0; n < 3; n++) {
    const pos = [],
      idx = []
    const sweep = (n * TAU) / 3 - 0.4
    const span = 34,
      chord = 14
    for (let i = 0; i <= span; i++)
      for (let j = 0; j <= chord; j++) {
        const u = i / span,
          v = j / chord
        const bell = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.65)
        const r = 0.15 + 1.2 * u - 0.078 * (2 * v - 1) ** 2 * u ** 3
        const a = sweep + 0.69 * u + (0.045 + 0.56 * bell + 0.13 * u) * (2 * v - 1)
        const z =
          0.15 * (1 - u) + (0.23 - 0.085 * u) * (v - 0.5) + 0.085 * bell * Math.sin(v * Math.PI)
        const p = at(r, a, z)
        pos.push(p.x, p.y, p.z)
        if (i < span && j < chord) {
          const k = i * (chord + 1) + j
          idx.push(k, k + chord + 1, k + 1, k + 1, k + chord + 1, k + chord + 2)
        }
      }
    const geo = new T.BufferGeometry()
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    blueEnamel.side = T.DoubleSide
    mesh(g, geo, blueEnamel)
    const edgeIndices = []
    for (let i = 0; i <= span; i++) edgeIndices.push(i * (chord + 1))
    for (let j = 1; j <= chord; j++) edgeIndices.push(span * (chord + 1) + j)
    for (let i = span - 1; i >= 0; i--) edgeIndices.push(i * (chord + 1) + chord)
    tube(
      g,
      edgeIndices.map((k) => V(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2])),
      0.0075,
      rim,
      true
    )
  }
  washer(g, 0.205, 0.063, 0.17, graphiteEnamel, 0.077)
  ring(g, 0.183, 0.009, rim, 0.163)
}
function makeKnob(g, outer, inner, len, material) {
  washer(g, outer, inner, len, material)
  for (let i = 0; i < 36; i++) {
    const a = (i * TAU) / 36
    const pt = at(outer, a, 0)
    cyl(g, 0.005, len * 0.81, material, pt.x, pt.y, pt.z).userData.detail = 'knurl'
  }
  ring(g, outer - 0.016, 0.005, shadow, len / 2 + 0.001)
}
function motorShell(g) {
  lathe(
    g,
    [
      [0.47, -0.53],
      [0.53, -0.53],
      [0.59, -0.5],
      [0.628, -0.43],
      [0.63, 0.36],
      [0.62, 0.4],
      [0.553, 0.4],
      [0.548, 0.36],
      [0.548, -0.38],
      [0.47, -0.44],
      [0.47, -0.53]
    ],
    graphiteEnamel
  )
  ring(g, 0.614, 0.014, metal, 0.39)
  ring(g, 0.609, 0.011, metal, -0.45)
  cyl(g, 0.52, 0.045, graphiteEnamel, 0, 0, -0.51)
  // Rounded longitudinal vent openings are inset within an enamel lip.
  for (const side of [1, -1])
    for (let i = -1; i <= 1; i++) {
      const a = (side === 1 ? 0 : Math.PI) + i * 0.245
      const plate = (long, wide, rad, mat) => {
        const geo = new T.ShapeGeometry(roundRect(long, wide, wide / 2), 20)
        geo.rotateY(Math.PI / 2)
        const m = mesh(g, geo, mat, Math.cos(a) * rad, Math.sin(a) * rad, -0.09)
        m.rotation.z = a
        return m
      }
      plate(0.59, 0.075, 0.6315, metal)
      plate(0.553, 0.047, 0.633, shadow)
    }
  const switchG = new T.Group()
  switchG.position.set(0, 0.59, -0.29)
  switchG.rotation.x = -Math.PI / 2
  g.add(switchG)
  cyl(switchG, 0.067, 0.11, metal, 0, 0, 0.055)
  cyl(switchG, 0.097, 0.046, graphiteEnamel, 0, 0, 0.125)
}
function stator(g) {
  washer(g, 0.531, 0.356, 0.47, lam)
  for (let j = 0; j <= 10; j++)
    ring(g, 0.529, 0.006, shadow, -0.231 + j * 0.0465).userData.detail = 'lamination'
  for (let i = 0; i < 10; i++) {
    const angle = (i * TAU) / 10,
      cos = Math.cos(angle),
      sin = Math.sin(angle)
    const tooth = mesh(g, new T.BoxGeometry(0.122, 0.157, 0.424), lam, 0.418 * cos, 0.418 * sin, 0)
    tooth.rotation.z = angle
    const shoe = new T.Shape(),
      halfArc = 0.207
    shoe.absarc(0, 0, 0.369, angle - halfArc, angle + halfArc, false)
    shoe.absarc(0, 0, 0.314, angle + halfArc, angle - halfArc, true)
    shoe.closePath()
    mesh(g, extrude(shoe, 0.442, 0.004), lam, 0, 0, -0.221)
    for (let j = -3; j <= 3; j++) {
      const arc = Array.from({ length: 7 }, (_, k) =>
        at(0.312, angle - halfArc + (k * halfArc) / 3, j * 0.056)
      )
      tube(g, arc, 0.0024, shadow).userData.detail = 'lamination'
    }
    // A single enamelled wire wraps around this radial pole tooth. Its end
    // turns remain visible around the bore even before the stator is released.
    const pts = [],
      turns = 9,
      samples = 24
    for (let k = 0; k <= turns * samples; k++) {
      const u = k / (turns * samples),
        cycle = (k * TAU) / samples,
        r = 0.349 + 0.16 * u
      const c = Math.cos(cycle),
        s = Math.sin(cycle)
      const tangent = 0.105 * Math.sign(c) * Math.pow(Math.abs(c), 0.63)
      const axial = 0.295 * Math.sign(s) * Math.pow(Math.abs(s), 0.58)
      pts.push(V(cos * r - sin * tangent, sin * r + cos * tangent, axial))
    }
    tube(g, pts, 0.0093, copper)
  }
}
function rotor(g) {
  cyl(g, 0.267, 0.48, lam)
  for (let j = 0; j <= 15; j++)
    ring(g, 0.267, 0.004, shadow, -0.225 + j * 0.03).userData.detail = 'lamination'
  for (let i = 0; i < 17; i++) {
    const a = (i * TAU) / 17
    tube(
      g,
      [at(0.269, a, -0.229), at(0.272, a + 0.075, 0), at(0.269, a + 0.15, 0.229)],
      0.01,
      metal
    )
  }
  cyl(g, 0.268, 0.032, metal, 0, 0, 0.252)
  cyl(g, 0.268, 0.032, metal, 0, 0, -0.252)
  lathe(
    g,
    [
      [0, -0.43],
      [0.059, -0.43],
      [0.069, -0.38],
      [0.069, 0.43],
      [0.059, 0.44],
      [0.059, 1.14],
      [0.044, 1.16],
      [0, 1.16],
      [0, -0.43]
    ],
    metal
  )
  ring(g, 0.065, 0.006, shadow, 0.38)
  ring(g, 0.054, 0.004, shadow, 1.095)
}
const boltsAt = [0.4, 2.5, 4.59]
function endCap(g) {
  const s = new T.Shape()
  s.absarc(0, 0, 0.598, 0, TAU, false)
  hole(s, 0, 0, 0.134)
  for (const a of boltsAt) hole(s, 0.48 * Math.cos(a), 0.48 * Math.sin(a), 0.043)
  mesh(g, extrude(s, 0.052, 0.012), graphiteEnamel)
  ring(g, 0.58, 0.012, metal, 0.061)
  washer(g, 0.2, 0.134, 0.052, metal, 0.073)
}
function bearing(g) {
  washer(g, 0.138, 0.104, 0.08, metal)
  washer(g, 0.083, 0.06, 0.08, metal)
  for (let j = 0; j < 9; j++) {
    const p = at(0.093, (j * TAU) / 9, 0.002)
    mesh(g, new T.SphereGeometry(0.016, 9, 7), metal, p.x, p.y, p.z)
  }
}
function basePlate(g, w, d, h, material, aperture) {
  const s = roundRect(w, d, 0.29)
  if (aperture) {
    const hshape = roundRect(0.32, 0.24, 0.06, 0, -0.04)
    const p = new T.Path(hshape.getPoints(12))
    s.holes.push(p)
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) hole(s, sx * w * 0.34, sz * d * 0.32, 0.035)
  const geo = extrude(s, h, 0.026)
  geo.rotateX(-Math.PI / 2)
  mesh(g, geo, material)
}
function upperBase(g) {
  // A hollow bottom and a raised top lip let the steel ballast nest into the foot.
  const outline = roundRect(1.55, 1.16, 0.31),
    inner = roundRect(1.46, 1.07, 0.275)
  outline.holes.push(new T.Path(inner.getPoints(12)))
  const shell = extrude(outline, 0.11, 0.021)
  shell.rotateX(-Math.PI / 2)
  mesh(g, shell, graphiteEnamel)
  const lid = roundRect(1.51, 1.12, 0.29)
  const socket = roundRect(0.43, 0.28, 0.06)
  lid.holes.push(new T.Path(socket.getPoints(12)))
  const top = extrude(lid, 0.041, 0.025)
  top.rotateX(-Math.PI / 2)
  mesh(g, top, graphiteEnamel, 0, 0.123, 0)
}
function neck(g) {
  const s = new T.Shape()
  s.moveTo(-0.32, -1.32)
  s.lineTo(0.31, -1.32)
  s.quadraticCurveTo(0.16, -0.72, 0.14, -0.12)
  s.quadraticCurveTo(0.15, 0.17, 0, 0.19)
  s.quadraticCurveTo(-0.16, 0.18, -0.17, 0.02)
  s.lineTo(-0.18, -0.62)
  s.quadraticCurveTo(-0.19, -1.04, -0.32, -1.32)
  hole(s, 0, 0, 0.064)
  const geo = extrude(s, 0.21, 0.035)
  geo.translate(0, 0, -0.105)
  geo.rotateY(Math.PI / 2)
  mesh(g, geo, graphiteEnamel)
  const fl = extrude(roundRect(0.48, 0.57, 0.075), 0.055, 0.014)
  fl.rotateX(-Math.PI / 2)
  mesh(g, fl, graphiteEnamel, 0, -1.34, 0)
}
function mergePart(g) {
  const batches = new Map()
  g.updateWorldMatrix(true, true)
  const inverse = g.matrixWorld.clone().invert()
  g.traverse((m) => {
    if (!m.isMesh) return
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
    geo.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, m.matrixWorld))
    if (!geo.attributes.normal) geo.computeVertexNormals()
    for (const key of Object.keys(geo.attributes))
      if (key !== 'position' && key !== 'normal') geo.deleteAttribute(key)
    const detail = m.userData.detail || '',
      key = m.material.uuid + detail
    if (!batches.has(key)) batches.set(key, { mat: m.material, detail, geos: [] })
    batches.get(key).geos.push(geo)
    m.geometry.dispose()
  })
  g.clear()
  for (const { mat, detail, geos } of batches.values()) {
    const merged = mesh(g, mergeGeometries(geos, false), mat)
    merged.userData.detail = detail
    for (const geo of geos) geo.dispose()
  }
}
function stripCard(studio, x, y, z, width, height, intensity) {
  const card = new T.Mesh(
    new T.PlaneGeometry(width, height),
    new T.MeshBasicMaterial({ color: new T.Color().setScalar(intensity), side: T.DoubleSide })
  )
  card.position.set(x, y, z)
  card.lookAt(0, 0, 0)
  studio.add(card)
}
export function createFan(canvas, onLost) {
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power'
  })
  renderer.setClearColor(0, 0)
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  const scene = new T.Scene(),
    environment = new RoomEnvironment()
  stripCard(environment, -3, 4.5, 5.5, 1.5, 6, 5)
  stripCard(environment, 4, 2.5, -3, 0.8, 4, 2.8)
  const pm = new T.PMREMGenerator(renderer),
    env = pm.fromScene(environment, 0.036)
  scene.environment = env.texture
  environment.dispose()
  pm.dispose()
  scene.add(new T.HemisphereLight(0xe5edff, 0x485d80, 0.8))
  const key = new T.DirectionalLight(0xf1f4ff, 1.72)
  key.position.set(-3.5, 5.2, 4.1)
  scene.add(key)
  const edgeLight = new T.DirectionalLight(0xa7c4ff, 1.04)
  edgeLight.position.set(4, 2, -3)
  scene.add(edgeLight)
  const footShadow = contactShadow()
  scene.add(footShadow)
  const pieces = []
  function part(name, builder, base, offset, a, b, group) {
    const root = new T.Group()
    builder(root)
    mergePart(root)
    const bounds = new T.Box3().setFromObject(root),
      corners = []
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) corners.push(V(x, y, z))
    root.name = name
    root.position.copy(base)
    scene.add(root)
    const finish = finishPart(root, threadOrWire)
    pieces.push({ root, base, offset, a, b, group, corners, finish })
    return root
  }
  part('front-guard', (g) => guard(g, true), V(0, 0, 1.04), V(0, 0, 9.73), 0, 0.31, 'outer')
  part(
    'spinner',
    (g) => makeKnob(g, 0.152, 0.055, 0.105, brass),
    V(0, 0, 1.23),
    V(0, 0, 7.97),
    0.05,
    0.34,
    'outer'
  )
  part('impeller', impeller, V(0, 0, 0.94), V(0, 0, 6.73), 0.105, 0.38, 'outer')
  part(
    'guard-collar',
    (g) => makeKnob(g, 0.188, 0.11, 0.095, graphiteEnamel),
    V(0, 0, 0.756),
    V(0, 0, 5.36),
    0.17,
    0.44,
    'outer'
  )
  part('rear-guard', (g) => guard(g, false), V(0, 0, 0.985), V(0, 0, 3.95), 0.19, 0.455, 'outer')
  for (let i = 0; i < 3; i++) {
    const a = boltsAt[i]
    part(
      'end-screw-' + i,
      (g) => beadScrew(g, 0.15, 0.034),
      at(0.48, a, 0.475),
      V(0, 0, 2.64),
      0.3 + i * 0.01,
      0.52 + i * 0.014,
      'motor'
    )
  }
  part('bearing', bearing, V(0, 0, 0.47), V(0, 0, 2.43), 0.36, 0.555, 'motor')
  part('end-bell', endCap, V(0, 0, 0.385), V(0, 0, 2.04), 0.34, 0.53, 'motor')
  part('rotor-and-shaft', rotor, V(0, 0, -0.01), V(0, 0, 1.4), 0.42, 0.6, 'motor')
  part('stator-and-windings', stator, V(0, 0, -0.01), V(0, 0, 0.36), 0.59, 0.705, 'motor')
  part('motor-casing', motorShell, V(), V(0, 0.1, -0.52), 0.59, 0.735, 'motor')
  part(
    'tilt-bolt',
    (g) => {
      const bolt = new T.Group()
      beadScrew(bolt, 0.26, 0.08)
      bolt.rotation.y = Math.PI / 2
      g.add(bolt)
    },
    V(0.17, -0.61, -0.15),
    V(0.64, -0.36, 0.14),
    0.625,
    0.79,
    'base'
  )
  part('pedestal', neck, V(0, -0.61, -0.15), V(0, -0.38, -0.04), 0.665, 0.82, 'base')
  part('base-shell', upperBase, V(0, -2.14, -0.15), V(0, -0.88, -0.02), 0.7, 0.86, 'base')
  part(
    'ballast',
    (g) => basePlate(g, 1.4, 1.01, 0.085, ballastSteel, true),
    V(0, -2.16, -0.15),
    V(0, -1.43, -0.02),
    0.74,
    0.93,
    'base'
  )
  part(
    'bottom-cover',
    (g) => basePlate(g, 1.5, 1.095, 0.047, graphiteEnamel, false),
    V(0, -2.23, -0.15),
    V(0, -1.91, -0.02),
    0.77,
    0.96,
    'base'
  )
  for (const side of [-1, 1])
    for (const depth of [-1, 1]) {
      const id = side + '-' + depth
      part(
        'rubber-foot-' + id,
        (g) => {
          mesh(g, new T.CylinderGeometry(0.096, 0.082, 0.048, 32), rubber)
          mesh(g, new T.CylinderGeometry(0.033, 0.034, 0.028, 24), rubber, 0, 0.031, 0)
        },
        V(side * 0.537, -2.258, -0.15 + depth * 0.355),
        V(side * 0.055, -2.11, depth * 0.045 - 0.02),
        0.8,
        0.975,
        'base'
      )
      part(
        'base-screw-' + id,
        (g) => {
          const q = new T.Group()
          beadScrew(q, 0.13, 0.034)
          q.rotation.x = Math.PI / 2
          g.add(q)
        },
        V(side * 0.51, -2.275, -0.15 + depth * 0.35),
        V(side * 0.15, -2.35, depth * 0.07 - 0.02),
        0.78,
        0.99,
        'base'
      )
    }
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 100),
    up = V(0, 1, 0),
    right = V(),
    vertical = V(),
    view = V()
  let p = 0,
    night = false,
    w = 1,
    h = 1
  function bounds(group) {
    let l = Infinity,
      r = -Infinity,
      b = Infinity,
      t = -Infinity
    for (const q of pieces) {
      if (group && q.group !== group) continue
      for (const c of q.corners) {
        const px = c.dot(right) + q.root.position.dot(right),
          py = c.dot(vertical) + q.root.position.dot(vertical)
        l = Math.min(l, px)
        r = Math.max(r, px)
        b = Math.min(b, py)
        t = Math.max(t, py)
      }
    }
    return { x: (l + r) / 2, y: (t + b) / 2, size: Math.max((t - b) / 2, (r - l) / ((2 * w) / h)) }
  }
  function update(val = p, dark = night) {
    p = val
    night = dark
    const motor = smooth(0.32, 0.48, p) * (1 - smooth(0.59, 0.69, p)),
      baseDetail = smooth(0.65, 0.785, p) * (1 - smooth(0.864, 0.988, p))
    const swing = smooth(0.02, 0.3, p)
    const overview = smooth(0.86, 0.985, p)
    view
      .set(
        0.64 + 0.22 * swing - 0.135 * motor + 0.065 * overview,
        0.24 + 0.09 * baseDetail,
        0.757 - 0.217 * swing + 0.18 * motor - 0.102 * overview
      )
      .normalize()
    right.crossVectors(up, view).normalize()
    vertical.crossVectors(view, right).normalize()
    // Nested offsets preserve the ordering of all base layers throughout the movement.
    const neckDrop = 0.38 * smooth(0.665, 0.82, p)
    const shellDrop = neckDrop + 0.5 * smooth(0.76, 0.94, p)
    const weightDrop = shellDrop + 0.79 * smooth(0.735, 0.89, p)
    const lowerDrop = weightDrop + 0.67 * smooth(0.7, 0.87, p)
    const footDrop = lowerDrop + 0.25 * smooth(0.68, 0.87, p)
    const screwDrop = footDrop + 0.25 * smooth(0.65, 0.85, p)
    for (const q of pieces) {
      const e = smooth(q.a, q.b, p)
      q.root.position.copy(q.base).addScaledVector(q.offset, e)
      const name = q.root.name
      if (name === 'base-shell') q.root.position.y = q.base.y - shellDrop
      if (name === 'ballast') q.root.position.y = q.base.y - weightDrop
      if (name === 'bottom-cover') q.root.position.y = q.base.y - lowerDrop
      if (name.startsWith('rubber-foot')) q.root.position.y = q.base.y - footDrop
      if (name.startsWith('base-screw')) q.root.position.y = q.base.y - screwDrop
      if (name === 'spinner' || name === 'guard-collar' || name.startsWith('end-screw')) {
        // The thread breaks free while the fastener is still close to its seat.
        const release = smooth(q.a, q.a + (q.b - q.a) * 0.43, p)
        const lift = smooth(q.a + (q.b - q.a) * 0.09, q.b, p)
        q.root.position.copy(q.base).addScaledVector(q.offset, 0.12 * e + 0.88 * lift)
        q.root.rotation.z =
          (name === 'spinner' ? 3.2 : name === 'guard-collar' ? 4.4 : Math.PI * 3.5) *
          (0.9 * release + 0.1 * e)
      }
      if (name.startsWith('base-screw'))
        q.root.rotation.y = -Math.PI * 2.7 * smooth(0.643, 0.746, p)
      if (name === 'tilt-bolt') q.root.rotation.x = -Math.PI * 1.9 * smooth(0.618, 0.705, p)
      if (name === 'rotor-and-shaft') q.root.rotation.z = 0.48 * e
      if (name === 'impeller') q.root.rotation.z = 0.19 - 0.24 * e
    }
    const fit = bounds(),
      m = bounds('motor'),
      f = bounds('base')
    for (const [detail, weight] of [
      [m, motor * 0.84],
      [f, baseDetail * 0.85]
    ]) {
      fit.x = mix(fit.x, detail.x, weight)
      fit.y = mix(fit.y, detail.y, weight)
      fit.size = mix(fit.size, detail.size, weight)
    }
    const target = right.clone().multiplyScalar(fit.x).addScaledVector(vertical, fit.y)
    const half = Math.max(0.72, fit.size * 1.065)
    camera.left = (-half * w) / h
    camera.right = -camera.left
    camera.top = half
    camera.bottom = -half
    camera.position.copy(target).addScaledVector(view, 24)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    const pixelScale = h / (2 * half)
    for (const piece of pieces) piece.finish.update(p, pixelScale, dark)
    footShadow.material.uniforms.strength.value = (dark ? 0.62 : 1) * (1 - smooth(0.08, 0.36, p))
    footShadow.visible = footShadow.material.uniforms.strength.value > 0.002
    renderer.toneMappingExposure = dark ? 0.95 : 0.94
    renderer.render(scene, camera)
  }
  const resize = () => {
    w = Math.max(1, canvas.clientWidth)
    h = Math.max(1, canvas.clientHeight)
    renderer.setSize(w, h, false)
    update()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  const lost = (e) => {
    e.preventDefault()
    onLost?.()
  }
  canvas.addEventListener('webglcontextlost', lost)
  resize()
  return {
    update,
    dispose() {
      ro.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
      })
      for (const q of pieces) q.finish.dispose()
      footShadow.material.dispose()
      env.dispose()
      renderer.dispose()
    }
  }
}
