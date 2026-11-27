// ECharts paints on canvas. Supply concrete colors here instead of CSS variables.
export function glassChartTheme(dark: boolean) {
  const ink = dark ? '#e6edf5' : '#162438'
  const label = dark ? '#94a3b8' : '#536780'
  const line = dark ? 'rgba(96,165,250,.28)' : 'rgba(62,101,155,.28)'
  const grid = dark ? 'rgba(96,165,250,.10)' : 'rgba(62,101,155,.12)'
  const axis = {
    nameTextStyle: { color: label },
    axisLabel: { color: label },
    axisTick: { lineStyle: { color: line } },
    axisLine: { lineStyle: { color: line } },
    splitLine: { lineStyle: { color: grid } },
    minorSplitLine: { lineStyle: { color: grid } }
  }
  return {
    darkMode: dark,
    backgroundColor: 'transparent',
    textStyle: { color: ink },
    title: { textStyle: { color: ink }, subtextStyle: { color: label } },
    legend: { textStyle: { color: label }, pageTextStyle: { color: label } },
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
    logAxis: axis,
    axisPointer: { lineStyle: { color: line }, crossStyle: { color: line } },
    tooltip: {
      backgroundColor: dark ? 'rgba(13,25,46,.94)' : 'rgba(249,252,255,.96)',
      borderColor: line,
      borderWidth: 1,
      textStyle: { color: ink },
      extraCssText: 'border-radius:10px;backdrop-filter:blur(14px);'
    }
  }
}
