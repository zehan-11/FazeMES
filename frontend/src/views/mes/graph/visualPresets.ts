import { STYLE_PRESETS } from '@/vendor/galaxy-view/render/stylePresets'
import { COLOR_THEMES } from '@/vendor/galaxy-view/render/colorThemes'
import type { LayoutParams } from '@/vendor/galaxy-view/types'
import { kindColors } from './graphData'
export { STYLE_PRESETS }
export function getVisualPreset(id: string) {
  return STYLE_PRESETS.find((p) => p.id === id) || STYLE_PRESETS[0]
}
export function presetColors(id: string): Record<string, string> {
  const preset = getVisualPreset(id),
    colors = COLOR_THEMES.find((t) => t.id === preset.theme)!.colors
  return Object.fromEntries(
    Object.keys(kindColors).map((kind, i) => [kind, colors[i % colors.length]])
  )
}
export function presetPhysics(id: string): LayoutParams {
  const p = getVisualPreset(id).physics
  return {
    charge: -p.repel,
    linkDistance: p.linkDistance,
    linkStrength: p.linkStrength,
    centerPull: p.centerPull,
    flatten: p.flatten,
    coreGravity: p.coreGravity,
    spiral: p.spiral,
    velocityDecay: 0.35
  }
}
