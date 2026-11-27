const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.join(__dirname, '../src')
const assistant = path.join(root, 'views/mes/assistant')
function load(file, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  })
  const exports = {}
  new Function('exports', 'require', compiled.outputText)(
    exports,
    (id) => dependencies[id] || require(id)
  )
  return exports
}
const works = load(path.join(assistant, 'fanWorksRecords.ts'), {
  '@/utils/mesQuantity': load(path.join(root, 'utils/mesQuantity.ts')),
  './assistantTime': load(path.join(assistant, 'assistantTime.ts')),
  './workflowRunway': load(path.join(assistant, 'workflowRunway.ts'))
})

const { kittingRun, journeyRun } = works

test('shortages light only their matching fan sections and preserve the original quantities', () => {
  const material = (name, quantity) => ({
    itemName: name,
    itemCode: name,
    unitName: '件',
    requiredQuantity: '10',
    outstandingQuantity: '10',
    availableQuantity: '0',
    physicalQuantity: '10',
    otherReservedQuantity: '10',
    issuedQuantity: '0',
    freeQuantity: '0',
    usableReservedQuantity: '0',
    shortageQuantity: quantity
  })
  const run = kittingRun({
    workOrderCode: 'WO-F',
    status: 'SHORTAGE',
    materials: [
      material('风扇电机', '10'),
      material('扇叶锁帽', '0.000001'),
      material('电机固定螺钉', '3'),
      material('前网罩', '0')
    ]
  })
  assert.deepEqual(run.shortageParts, [2, 5])
  assert.equal(run.steps.find((step) => step.title.includes('电机固定螺钉')).part, undefined)
  assert.match(run.answer, /缺 0\.000001 件/)
  assert.match(run.answer, /本单可用 0，符合条件的实物库存 10，其他工单预占 10/)
})

test('an order without a BOM returns an undetermined kitting result', () => {
  const run = kittingRun({ workOrderCode: 'WO-N', materials: [], status: 'NO_BOM', ready: false })
  assert.deepEqual(run.shortageParts, [])
  assert.match(run.answer, /无法判断齐套/)
  assert.deepEqual(
    run.steps.map((step) => step.title),
    ['定位工单', '齐套结论']
  )
})

test('Dify replay follows only the returned node sequence and keeps failure visible', () => {
  const run = journeyRun({
    origin: 'Dify 运行记录',
    sources: [],
    question: '规程？',
    result: '',
    branch: '',
    trace: {
      runId: 'run-31',
      status: 'failed',
      steps: [
        { title: '读取手册', status: 'succeeded', seconds: 0, detail: '已读' },
        { title: '引用原文', status: 'failed', seconds: 1, detail: '服务超时' }
      ]
    }
  })
  assert.deepEqual(
    run.steps.map((step) => step.title),
    ['读取手册', '引用原文', '工作流结果']
  )
  assert.match(run.steps[1].detail, /执行失败.*服务超时/)
  assert.equal(run.answer, '执行失败')
  assert.match(run.source, /run-31/)
})

test('Broky assembly and component orders locate real SKU shortages without assigning packaging to the fan', () => {
  const order = {
    workOrderCode: 'F',
    status: 'SHORTAGE',
    materials: [
      {
        itemCode: 'BROKY-R16',
        itemName: 'Broky电机采购模块',
        shortageQuantity: '100.000000',
        unitName: '套'
      },
      { itemCode: 'BROKY-R13', itemName: 'Broky外包装纸箱', shortageQuantity: '3', unitName: '个' },
      { itemCode: 'BROKY-R04', itemName: 'Broky扇叶锁帽', shortageQuantity: '0', unitName: '个' }
    ]
  }
  const run = kittingRun(order, 'Broky动力机头组件', 'BROKY-SA-H')
  assert.equal(run.showFan, true)
  assert.deepEqual(run.shortageParts, [2])
  assert.equal(run.materials[0].label, '缺 100 套')
  assert.equal(run.materials[0].modelLabel, '电机采购模块')
  assert.equal(run.materials[1].part, undefined)
  assert.equal(run.materials[2].state, 'ready')
  assert.equal(kittingRun(order, '精密衬套', 'BUSH-01').showFan, false)
})

const routing = load(path.join(assistant, 'fanWorksQuestions.ts'), { './fanWorksRecords': works })
const broky = {
  productId: 1,
  productCode: 'BROKY-FG-V2',
  productName: 'Faze-UP Broky',
  specification: '落地扇 V2',
  unitName: '台'
}
const variant = { productId: 2, productCode: 'FAN-PRO', productName: '静音电风扇', unitName: '台' }
test('general questions and knowledge definitions are not diverted to kitting or the fan', () => {
  for (const q of [
    '什么是库存预占？',
    '请解释知识图谱和向量检索的区别',
    '洗衣机出现异响怎么办',
    '印刷机故障怎么处理',
    '用一句话总结上一条回答',
    '按项目教学手册，风扇出现异响时点检记录应填写哪些信息？'
  ]) {
    assert.equal(routing.intentOf(q, 'auto'), 'knowledge', q)
  }
  for (const [q, expected] of [
    ['风扇有异响怎么办', 'fault'],
    ['这台什么时候可能会坏', 'lifetime'],
    ['风扇如何安装', 'assembly'],
    ['这张工单哪些物料欠料', 'kitting'],
    ['查询全部工单进度', 'business'],
    ['这款卖多少钱', 'price'],
    ['BROKY-FG-V2的参考价是多少？', 'price'],
    ['这款的采购参考价是多少？', 'business']
  ]) {
    assert.equal(routing.intentOf(q, 'auto'), expected, q)
  }
  assert.equal(routing.intentOf('怎么核对工单缺料', 'graph'), 'knowledge')
  assert.equal(routing.intentOf('工单缺料', 'kitting-doc'), 'kitting')
  assert.equal(routing.intentOf('工单缺料', 'dify'), 'kitting')
  assert.equal(routing.intentOf('生产交接流程', 'dify'), 'dify')
  assert.equal(routing.intentOf('这台空压机还能用多久', 'auto'), 'lifetime')
  assert.equal(routing.refersToFan('这台空压机还能用多久'), false)
})
test('price uses an exact code or named model, asks about ambiguous variants, and never prices an unknown SKU', () => {
  const list = [broky, variant]
  for (const q of ['Faze-UP Broky多少钱', 'BROKY-FG-V2的参考价是多少', '那BROKY-FG-V2呢'])
    assert.deepEqual(routing.priceCandidates(list, q), [broky], q)
  assert.deepEqual(routing.priceCandidates(list, '风扇价格多少'), list)
  assert.deepEqual(routing.priceCandidates(list, 'UNKNOWN-FAN-03多少钱', 1), [])
  assert.deepEqual(routing.priceCandidates(list, '小米风扇多少钱', 1), [])
  assert.deepEqual(routing.priceCandidates(list, '这款多少钱', 2), [variant])
})
test('observations highlight model parts, guide the next step and keep both outcomes distinct', () => {
  const key = routing.matchSymptom('我的风扇一直有异响')
  assert.deepEqual(routing.faultGuide(key).display.focusParts, [2])
  assert.match(routing.faultGuide(key, 'review').display.value, /第 2 步/)
  assert.match(routing.faultGuide(key, 'service').display.value, /售后/)
  assert.match(routing.faultGuide(key, 'resolved').display.value, /观察结束/)
  assert.equal(routing.assemblyGuide(6).display.assembledParts, 7)
})
function viewServices(overrides = {}) {
  return load(path.join(assistant, 'fanWorksAnswers.ts'), {
    './fanWorksQuestions': routing,
    '@/api/mes/assistant/evidence': {},
    '@/api/mes/portal': {},
    '@/api/mes/cost': {},
    '@/utils/mesQuantity': load(path.join(root, 'utils/mesQuantity.ts')),
    '@/api/mes/pro/task': {},
    '@/api/mes/pro/workorder': {},
    ...overrides
  })
}
test('an evidence revisit shortens the subject without inventing terms or repeating the same search', () => {
  const { evidenceFollowup } = viewServices()
  assert.equal(evidenceFollowup('请问工单预占的定义是什么？'), '工单预占')
  assert.equal(evidenceFollowup('风扇扇叶的技术手册'), undefined)
  assert.equal(evidenceFollowup('请帮我查一下返工单，具体步骤有哪些？'), '返工单')
  assert.equal(evidenceFollowup('？'), undefined)
})

test('published customer prices stay scoped to the portal, preserve precision, null and zero', async () => {
  let value = '19.125600'
  const svc = viewServices({
    '@/api/mes/portal': {
      CustomerPortalApi: { catalog: async () => [{ ...variant, referenceSalePrice: value }] }
    },
    '@/api/mes/cost': {
      CostApi: {
        getProduct: () => assert.fail('A customer must not use the employee price endpoint')
      }
    }
  })
  const lookup = async (q) => (await svc.priceView(q, true, false)).result
  assert.equal((await lookup('FAN-PRO多少钱')).display.value, '¥19.1256 / 台')
  value = '0.000000'
  assert.equal((await lookup('FAN-PRO多少钱')).display.value, '¥0 / 台')
  value = null
  assert.equal((await lookup('FAN-PRO多少钱')).display.value, '需询价')
  assert.equal((await lookup('BROKY-FG-V2多少钱')).display.value, '需询价')
})
test('selected order progress shows the recorded production count and only tasks belonging to that order', async () => {
  const svc = viewServices({
    '@/api/mes/pro/workorder': {
      ProWorkOrderApi: {
        getWorkOrder: async () => ({
          code: 'WO-1',
          productName: '风扇',
          quantity: 100,
          quantityProduced: '31.000000',
          quantityScheduled: 60,
          unitMeasureName: '台'
        })
      }
    },
    '@/api/mes/pro/task': {
      ProTaskApi: {
        getTaskPage: async (params) => {
          assert.equal(params.workOrderId, 7)
          return {
            total: 1,
            list: [
              {
                workOrderId: 7,
                processName: '总装',
                code: 'T-1',
                quantity: 60,
                producedQuantity: 31
              },
              { workOrderId: 8, processName: '其他工单', code: 'T-2' }
            ]
          }
        }
      }
    }
  })
  const view = await svc.orderProgressView(7, true)
  assert.match(view.answer, /已生产 31台 \/ 计划 100台/)
  assert.equal(view.steps.length, 2)
  assert.match(view.steps[1].title, /总装/)
})
test('knowledge answer uses current retrieval mode and shows original citations and insufficient-evidence status', async () => {
  const svc = viewServices()
  const scope = { knowledgeBaseIds: [9], mode: 'HYBRID', hops: 1, documentStrategy: 'COMBINED' }
  const reply = await svc.knowledgeView('比较两种检索方法', scope, async (q, mode) => {
    assert.equal(q, '比较两种检索方法')
    assert.equal(mode, 'HYBRID')
    return {
      status: 'ANSWERED',
      answer: '按本轮证据归纳。',
      citations: [{ title: '资料A', content: '实际引用', pageNumber: 4, version: 2 }]
    }
  })
  assert.equal(reply.answer, '按本轮证据归纳。')
  assert.match(reply.steps[0].detail, /第 4 页[\s\S]+实际引用/)
  const empty = await svc.knowledgeView('缺少证据', scope, async () => ({
    status: 'NO_EVIDENCE',
    answer: null,
    message: '没有可用证据',
    citations: []
  }))
  assert.equal(empty.stage, '证据不足')
  assert.equal(empty.answer, '没有可用证据')
})
