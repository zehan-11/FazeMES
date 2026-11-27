import * as T from 'three'
import { drawingAmount } from './art-direction.mjs'

const lineParts = new Set(['end-bell', 'motor-casing', 'pedestal', 'base-shell', 'bottom-cover'])
const printFragment = `
  #include <colorspace_fragment>
  // The engraved surface is mixed in display space to retain an actual blue
  // ink and a paper white in both the warm and cool halves of the light rig.
  float frontness = abs(normal.z);
  float aa = fwidth(frontness);
  float silhouette = 1.0 - smoothstep(0.012, clamp(0.056 + 1.6*aa, 0.06, 0.21), frontness);
  float shade = 1.0 - smoothstep(-0.5, 0.86, dot(normal,normalize(vec3(-0.55,0.67,0.52))));
  float h = dot(engravingPoint,vec3(10.6,14.3,8.1));
  float pixel = max(fwidth(h),0.002);
  float dist = abs(fract(h + 0.5) - 0.5);
  float hatch = (1.0-smoothstep(0.016,0.026+pixel,dist)) * (1.0-smoothstep(0.23,0.61,pixel));
  float coverage = min(0.95, 0.045 + 0.11*shade + 0.23*shade*hatch + 0.83*silhouette);
  vec3 inkSurface = mix(sheetTint, inkTint, coverage);
  vec3 inkWire = mix(inkTint, sheetTint, 0.075 + 0.10*(1.0-shade));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(inkSurface, inkWire, isInkStroke), inkAmount);
`
const srgb = (v) => new T.Vector3(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255)

export function finishPart(root, isStroke) {
  const amount = { value: 0 },
    ink = { value: srgb(0x294f86) },
    paper = { value: srgb(0xf1f5fc) }
  const ownMaterials = [],
    detailLayers = []
  let currentTheme
  // The guard tubes already trace the actual steel wires. Adding edge geometry
  // to them would double every stroke and produce moire on small screens.
  const solids = [...root.children]
  const edges = new T.LineBasicMaterial({
    color: 0x234b63,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false
  })
  const edgeObjects = []
  for (const solid of solids) {
    const original = solid.material
    const material = original.clone()
    const stroke = isStroke(root.name, original) ? 1 : 0
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        inkAmount: amount,
        inkTint: ink,
        sheetTint: paper,
        isInkStroke: { value: stroke },
        wireInset: { value: root.name.endsWith('guard') && stroke ? 0.0038 : 0 }
      })
      shader.vertexShader =
        'varying vec3 engravingPoint;\nuniform float inkAmount; uniform float wireInset;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n engravingPoint = position;\n transformed -= normal * inkAmount * wireInset;'
        )
      shader.fragmentShader =
        'varying vec3 engravingPoint;\nuniform float inkAmount;\nuniform vec3 inkTint;\nuniform vec3 sheetTint;\nuniform float isInkStroke;\n' +
        shader.fragmentShader.replace('#include <colorspace_fragment>', printFragment)
    }
    material.customProgramCacheKey = () => 'fan-ink-hatching-v1'
    solid.material = material
    ownMaterials.push(material)
    if (solid.userData.detail) {
      material.transparent = true
      material.depthWrite = false
      detailLayers.push(solid)
    }
    if (lineParts.has(root.name) && !stroke && !solid.userData.detail) {
      const lines = new T.LineSegments(new T.EdgesGeometry(solid.geometry, 22), edges)
      material.polygonOffset = true
      material.polygonOffsetFactor = 1
      material.polygonOffsetUnits = 1
      lines.visible = false
      lines.renderOrder = 2
      root.add(lines)
      edgeObjects.push(lines)
    }
  }
  return {
    update(progress, pixelsPerUnit, night) {
      amount.value = drawingAmount(root.name, progress)
      if (currentTheme !== night) {
        ink.value.copy(srgb(night ? 0x9abfff : 0x294f86))
        paper.value.copy(srgb(night ? 0x314366 : 0xf1f5fc))
        edges.color.set(night ? 0xb7d2ff : 0x294f86)
        currentTheme = night
      }
      edges.opacity = 0.94 * amount.value
      for (const line of edgeObjects) line.visible = amount.value > 0.01
      for (const layer of detailLayers) {
        const [start, end] = layer.userData.detail === 'alternate-wire' ? [32, 61] : [44, 92]
        const t = Math.max(0, Math.min(1, (pixelsPerUnit - start) / (end - start)))
        layer.material.opacity = t * t * (3 - 2 * t)
        layer.visible = t > 0.001
      }
    },
    dispose() {
      edges.dispose()
      for (const mat of ownMaterials) mat.dispose()
    }
  }
}

export function contactShadow() {
  const material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { strength: { value: 1 } },
    vertexShader: `varying vec2 floorUv;void main(){floorUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 floorUv;uniform float strength;
      void main(){
        vec2 p=(floorUv-0.5)*vec2(5.,4.);
        vec2 q=abs(p-vec2(.03,-.025))-vec2(.52,.31);
        float rim=max(0.,length(max(q,0.))+min(max(q.x,q.y),0.)-.19);
        float contact=.26*exp(-6.8*rim);
        vec2 soft=(p-vec2(.21,-.12))/vec2(1.19,.71);
        float penumbra=.15*exp(-dot(soft,soft)*1.7);
        float fade=smoothstep(0.,.08,min(min(floorUv.x,floorUv.y),min(1.-floorUv.x,1.-floorUv.y)));
        gl_FragColor=vec4(.14,.20,.23,(contact+penumbra)*strength*fade);
      }`
  })
  const plane = new T.Mesh(new T.PlaneGeometry(5, 4), material)
  plane.rotation.x = -Math.PI / 2
  plane.position.set(0, -2.301, -0.15)
  plane.renderOrder = -1
  return plane
}
