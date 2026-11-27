// Display names for the catalogs shipped with FazeMES. Submitted values and document sources keep their original text.
const captions: Record<string, string> = {
  'OA 示例': 'OA 办公',
  '接入示例': '接入参考',
  '教学试制车间': '试制车间',
  '合成单工序演练，每件消耗一件试制毛坯': '单工序试制，每件消耗一件试制毛坯',
  'FazeMES 项目教学资料，含问答、可核对的关系与文档来源。': 'FazeMES 操作资料，包含业务问答、关联关系和文档来源。',
  '生产大屏合成演练；非真实生产。历史业务日期回填，审批与库存审计时间保持实际执行时间。':
    '本地测试数据。报工按业务日期记录，审批与库存保留实际操作时间。'
}

const stationActivities: Record<string, string> = {
  大屏演练: '衬套试制',
  大屏演练工位: '试制工位',
  演练加工台: '加工台'
}

export function catalogLabel(value: unknown): string {
  if (typeof value !== 'string') return value == null ? '' : String(value)
  if (!value) return ''
  if (Object.hasOwn(captions, value)) return captions[value]
  if (value.startsWith('项目教学 · ')) return value.slice('项目教学 · '.length)
  if (value.startsWith('大屏演练·')) return value.slice('大屏演练·'.length)
  if (/^示例(帮助入口\d+|联系人(查询|创建|更新|删除|导出)|分类(查询|创建|更新|删除|导出))$/.test(value)) {
    return value.slice(2)
  }
  const station = /^(.*车间)·(大屏演练|大屏演练工位|演练加工台)$/.exec(value)
  if (station) {
    return (captions[station[1]] ?? station[1]) + ' · ' + stationActivities[station[2]]
  }
  return value
}

export function catalogCell(_row: unknown, _column: unknown, value: unknown): string {
  return catalogLabel(value)
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $catalogLabel: typeof catalogLabel
    $catalogCell: typeof catalogCell
  }
}
