import type { ThemeTypes } from '@/types/theme'

// Keep the existing preference keys. Only blue-family tints carry forward into the glass theme.
export const accentColors = ['#2563eb', '#1d4ed8', '#2445d6', '#0033cc']
export const headerColors = ['#14294a', '#19365a', '#233457', '#1c4052']
export const sidebarColors = ['#0d1526', '#101c36', '#12243c', '#102936']

function savedColor(value: string | undefined, choices: string[]) {
  const color = typeof value === 'string' ? value.toLowerCase() : ''
  return choices.includes(color) ? color : choices[0]
}

export function glassPreferences(saved?: ThemeTypes | null) {
  return {
    elColorPrimary: savedColor(saved?.elColorPrimary, accentColors),
    topHeaderBgColor: savedColor(saved?.topHeaderBgColor, headerColors),
    leftMenuBgColor: savedColor(saved?.leftMenuBgColor, sidebarColors)
  }
}
