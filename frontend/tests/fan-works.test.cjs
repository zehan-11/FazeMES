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
const { kittingRun, journeyRun } = load(path.join(assistant, 'fanWorksRecords.ts'), {
  '@/utils/mesQuantity': load(path.join(root, 'utils/mesQuantity.ts')),
  './assistantTime': load(path.join(assistant, 'assistantTime.ts')),
  './workflowRunway': load(path.join(assistant, 'workflowRunway.ts'))
})

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
