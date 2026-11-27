import type { PortalProduct } from '@/api/mes/portal'
import type {
  DisplayChoice,
  DisplayKind,
  SceneCommand,
  WorksDisplay,
  WorksStep
} from './fanWorksRecords'
import { isFanProduct } from './fanWorksRecords'

type Intent = DisplayKind | 'kitting' | 'dify'
const fanWord = /风扇|电扇|台扇|落地扇|循环扇|broky/i
const otherEquipment =
  /空压机|压缩机|机床|机台|水泵|输送机|注塑机|生产线|机器人|变频器|空调|冰箱|洗衣机|电脑|打印机|印刷机|车床|设备群|其他设备/
const concept =
  /什么意思|是什么|什么是|怎么理解|如何理解|如何计算|怎么计算|原理|定义|制度|操作规程|手册里|手册中|区别|依据是什么|图谱|知识库|文档中|文档里|知识图谱|检索|故障树|失效分析/
export function refersToFan(q: string, current = true) {
  if (fanWord.test(q)) return true
  if (!current || otherEquipment.test(q)) return false
  return /^(?:请问|请帮我|我想问|我家|我的|我这|这台|这款|这个|它|那|什么时候|多久|还有|还能|一般|大概|故障|异响|不转|有|不能|风|最近|声音|出现|转|机头|电机|扇叶|怎么|如何|逐件|演示|装配|完整|摆头|如果|可能|帮我排查)/.test(
    q
  )
}
export function intentOf(
  question: string,
  reference: SceneCommand['reference'],
  fanContext = true
): Intent {
  const q = question.trim()
  const fan = refersToFan(q, fanContext)
  const lifetime =
    /(?:何时|什么时候|多久|多长时间|几天|几个月|哪天).{0,12}(?:故障|出问题|坏|失效)|(?:还能|可以|能)(?:再)?用多久|剩余寿命|(?:预测|预计).{0,8}(?:故障时间|多久会坏)|寿命(?:还剩|还有|多久|多长)/
  if (lifetime.test(q) && !/原理|算法|怎么预测|如何预测|模型如何/.test(q)) return 'lifetime'
  if (
    reference === 'evidence' ||
    reference === 'knowledge' ||
    reference === 'graph' ||
    reference === 'hybrid'
  )
    return 'knowledge'
  if (reference === 'kitting-doc') return 'kitting'
  if (reference === 'dify' && !/缺料|欠料|齐套|预占/.test(q)) return 'dify'
  const asksForSource =
    /(?:按|依据|根据|查阅|查一下|参考).{0,20}(?:手册|说明书|规程|文档|制度)|(?:手册|说明书|文档|规范)(?:里|中|上|要求|规定|怎么说)|(?:点检|维修|异常)记录.{0,12}(?:填|写|包含|哪些|什么)|应(?:该)?记录什么|如何记录/.test(
      q
    )
  if (concept.test(q) || asksForSource) return 'knowledge'
  if (/采购价|采购单价|采购参考价|成本|毛利/.test(q)) return 'business'
  if (
    /多少钱|什么价|售价|卖多少|价格|参考价|报价|价钱|多少元/.test(q) &&
    !/定价规则|价格策略|维修费|维修价格|修.{0,4}多少钱/.test(q)
  )
    return 'price'
  if (
    /(?:工单|订单|本单|这单|物料|仓库).{0,25}(?:缺|欠|齐套|预占)|缺料|欠料|齐套|有货.*(?:缺|开工)|其他工单预占/.test(
      q
    )
  )
    return 'kitting'
  if (
    fan &&
    /异响|噪[音声]|有杂音|响声|太吵|声音.{0,3}大|嗡嗡|嘎吱|晃|抖|振动|震动|不转|转不动|启动不了|不能启动|风[量力小弱]|风变小|不摇头|不摆头|摆头失效|发热|发烫|温升|故障|异常现象|排查|坏了|怎么修/.test(
      q
    )
  )
    return 'fault'
  if (
    fan &&
    /(?:逐件|怎么|怎样|如何|演示|看看|播放|完整|顺序).{0,8}(?:组装|装配|拼装)|装配(?:顺序|步骤|演示|动画|过程)|怎么安?装|如何安?装/.test(
      q
    )
  )
    return 'assembly'
  if (reference === 'dify') return 'dify'
  if (
    reference === 'business' ||
    /(?:查询|查看|现在|当前|今天|本月|上月|本周|哪些|哪张|这张|本单|全部|多少).{0,18}(?:工单|库存|设备状态|成本|单据|质量|产量|交付风险|报工|排产)|(?:工单|订单|生产|库存|设备|交付|质检|单据|仓库).{0,18}(?:进度|多少|还有|数量|风险|状态|情况|做到哪|延期|超期|明细|流水)|生产到哪|做了多少|月度收发存/.test(
      q
    )
  )
    return 'business'
  return 'knowledge'
}

export function isSelectedProgress(question: string, code: string) {
  if (
    !/进度|做到哪|生产到哪|做了多少|完成多少|生产了多少|多少台/.test(question) ||
    /全部|所有|哪些|哪几张/.test(question)
  )
    return false
  const codes = question.match(/[a-z0-9]+(?:[-_][a-z0-9]+)+/gi)
  if (codes?.length) return codes.length === 1 && codes[0].toLowerCase() === code.toLowerCase()
  return /这张|本单|本工单|这单|现在生产到哪/.test(question)
}

export function fanProduct(p: PortalProduct) {
  return (
    isFanProduct(p.productName, p.productCode) ||
    /风扇|落地扇|台扇|循环扇/.test(p.specification || '')
  )
}

// An explicitly named SKU always wins, including when it does not exist.
export function priceCandidates(products: PortalProduct[], question: string, previous?: number) {
  const q = question.toLowerCase().trim()
  const codes = q.match(/[a-z0-9]+(?:[-_][a-z0-9]+)+/g)
  if (codes?.length) {
    const byCode = products.filter((p) => codes.includes(p.productCode.toLowerCase()))
    if (byCode.length) return byCode
    return products.filter(
      (p) =>
        q.includes(p.productName.toLowerCase()) &&
        codes.every((code) => p.productName.toLowerCase().includes(code))
    )
  }
  const named = products.filter((p) =>
    [p.productName, p.productCode, p.specification].some((s) => s && q.includes(s.toLowerCase()))
  )
  if (named.length) return named
  const term = q.replace(
    /(?:请问|麻烦|请查一下|查一下|请查|帮我查|这个|这台|这款|那个|一台|一件|整机|大概|参考价|参考|未税|含税|的|卖多少(?:钱)?|多少(?:钱|元)?|什么价(?:格)?|报价|价钱|价格|售价|请|呢|啊|呀|是|为|[？?。，！\s])/g,
    ''
  )
  if (!term) return previous ? products.filter((p) => p.productId === previous) : products
  if (/^(?:(?:台式|落地)?(?:电?风扇|电扇)|台扇|落地扇|broky)$/.test(term)) {
    return products.filter((p) => fanProduct(p) && !/组件|配件|子组件/.test(p.productName))
  }
  return products.filter((p) =>
    [p.productName, p.productCode, p.specification].some((s) => s?.toLowerCase().includes(term))
  )
}

type Symptom = {
  key: string
  name: string
  matches: RegExp
  parts: number[]
  observe: string
  detail: string
}
const symptoms: Symptom[] = [
  {
    key: 'noise',
    name: '有异响',
    matches: /异响|噪[音声]|杂音|响声|太吵|声音.{0,3}大|嗡嗡|嘎吱/,
    parts: [2],
    observe: '声音来自机头附近，还是底座附近？请记录何时出现、有无伴随振动。',
    detail: '项目维护关系把运行异响与轴承检查相联。图中电机标的是轴承所在区域，具体原因需检查确认。'
  },
  {
    key: 'vibration',
    name: '机身晃动',
    matches: /晃|抖|震动|振动/,
    parts: [0, 2],
    observe: '晃动出现在底座还是机头？记下部位，以及它是否只出现在某个档位。',
    detail: '维护关系记录了异常振动、固定连接和电机之间的联系。'
  },
  {
    key: 'stopped',
    name: '不能启动',
    matches: /不转|转不动|启动不了|不能启动/,
    parts: [4],
    observe: '记下扇叶是否完全静止，以及当时使用的档位。',
    detail: '扇叶是观察转动的位置。仅凭不转这一现象无法确定电机损坏。'
  },
  {
    key: 'air',
    name: '风量变小',
    matches: /风[量力小弱]|风变小/,
    parts: [4, 6],
    observe: '请从网罩外观察扇叶转动是否平稳，记录风量变化出现在一个还是所有档位。',
    detail: '手册把风小归为风量减弱。模型标出气流经过的扇叶与前网罩。'
  },
  {
    key: 'swing',
    name: '不能摆头',
    matches: /不摇头|不摆头|摆头失效/,
    parts: [2],
    observe: '记录机头能否左右摆动，以及扇叶是否仍在转动。',
    detail: '手册把不摇头归为摆头失效。机头标记指向观察区域。'
  },
  {
    key: 'heat',
    name: '机头发热',
    matches: /发烫|发热|温升/,
    parts: [2],
    observe: '停止使用，记录发热部位和出现时间，交由售后检查。',
    detail: '维护关系把电机温升异常与通风条件相联。'
  }
]
export function matchSymptom(question: string) {
  return symptoms.find((s) => s.matches.test(question))?.key
}
const partNames = ['底座', '立柱', '电机', '后网罩', '扇叶', '锁帽', '前网罩']
export function namedParts(text: string) {
  const words = [
    /底座/,
    /立柱/,
    /电机|马达|轴承|机头/,
    /后网罩/,
    /扇叶|风叶|叶片/,
    /锁帽/,
    /前网罩/
  ]
  return words.flatMap((word, i) => (word.test(text) ? [i] : []))
}
export type Guide = { answer: string; display: WorksDisplay; steps: WorksStep[] }
export const symptomChoices: DisplayChoice[] = symptoms.map((s) => ({
  label: s.name,
  value: 'symptom:' + s.key
}))
export function faultGuide(key?: string, stage = 'observe'): Guide {
  const symptom = symptoms.find((s) => s.key === key)
  const source: WorksStep = {
    agent: 'evidence',
    title: '电风扇常见异常与点检记录',
    detail:
      '项目点检教材按异响、振动、不能启动、风量减弱和摆头失效记录现场现象。请记录时间、运行状态、部位及现象。'
  }
  if (!symptom)
    return {
      answer: '你观察到了哪种现象？选择后可在模型上查看对应位置。',
      display: { kind: 'fault', title: '选择观察到的现象', choices: symptomChoices },
      steps: [source]
    }
  const reference: WorksStep = {
    agent: 'evidence',
    title: '电风扇维护关系 · ' + symptom.name,
    detail: symptom.detail
  }
  const choices = (pairs: string[][]) =>
    pairs.map(([value, label]) => ({ label, value: 'guide:' + key + ':' + value }))
  const base: WorksDisplay = {
    kind: 'fault',
    title: symptom.name,
    focusParts: symptom.parts,
    caption: '观察位置 · ' + symptom.parts.map((i) => partNames[i]).join('、')
  }
  if (stage === 'resolved' || stage === 'service') {
    const done = stage === 'resolved'
    return {
      answer: done
        ? '已记录现象消失。如果再次出现，保留当时的档位、时间和现象。'
        : '请提供型号、出现时间、部位和已观察到的现象，交由售后核查。',
      display: {
        ...base,
        value: done ? '观察结束' : '联系售后核查',
        choices: [{ label: '选择其他现象', value: 'symptoms' }]
      },
      steps: [source, reference]
    }
  }
  const follow = stage === 'review'
  return {
    answer: follow ? symptom.detail + ' 请根据实际观察选择下一步。' : symptom.observe,
    display: {
      ...base,
      value: follow ? '第 2 步 · 核对现象' : '第 1 步 · 定位观察',
      choices: follow
        ? choices([
            ['resolved', '现象已消失'],
            ['service', '仍有异常']
          ])
        : choices([
            ['review', '已观察，继续'],
            ['service', '需要售后协助']
          ])
    },
    steps: [source, reference]
  }
}
export function assemblyGuide(index: number): Guide {
  const tasks = [
    '放置底座',
    '连接立柱与底座',
    '定位电机与转轴',
    '安装后网罩',
    '将扇叶定位到转轴',
    '锁定扇叶',
    '合上前网罩'
  ]
  const choices: DisplayChoice[] = []
  if (index > 0) choices.push({ label: '上一件', value: 'assembly:' + (index - 1) })
  if (index < 6) choices.push({ label: '下一件', value: 'assembly:' + (index + 1) })
  return {
    answer: tasks[index] + '。这是七部件模型的装配示意。',
    display: {
      kind: 'assembly',
      title: '逐件装配',
      value: index + 1 + ' / 7 · ' + partNames[index],
      assembledParts: index + 1,
      focusParts: [index],
      choices
    },
    steps: []
  }
}
