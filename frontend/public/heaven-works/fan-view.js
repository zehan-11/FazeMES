/* FazeMES scene adapter. The parent supplies read-only snapshots; examples stay local. */
;(() => {
  'use strict'
  const host = document.getElementById('host-works')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(document.getElementById('tpl-loom').content.cloneNode(true))
  const el = (id) => shadow.getElementById(id)
  mountLoom(host, shadow)
  let access,
    run,
    selection,
    sample = false,
    partIndex = 0
  let timeouts = []
  const parts = fanProject.secs
  const flow = mountQuestionFlow(host, el,
    (index) => focus('step', index, true),
    (value, runId) => command('choice', { choice: value, runId }))

  function command(action, extra = {}) {
    if (parent !== window && location.origin !== 'null') {
      parent.postMessage(
        { type: 'fazemes:command', command: { action, ...extra } },
        location.origin
      )
    }
  }
  function clearTimers() {
    timeouts.forEach(clearTimeout)
    timeouts = []
  }
  function later(ms, fn) {
    timeouts.push(setTimeout(fn, ms))
  }
  function togglePanel(id) {
    const panel = el(id),
      open = !panel.classList.contains('open')
    el('chat').classList.remove('open')
    el('evidence').classList.remove('open')
    panel.classList.toggle('open', open)
  }
  function detail(title, text) {
    el('detail-heading').textContent = title
    el('detail').textContent = text
  }
  function focus(type, index, open = false) {
    selection = { type, index }
    if (open && (type === 'part' || type === 'material')) flow.showModel()
    if (open && matchMedia('(max-width:860px),(max-aspect-ratio:1/1)').matches) {
      el('chat').classList.remove('open')
      el('evidence').classList.add('open')
    }
    host.focusPart(
      type === 'part' ? index : type === 'material' ? run?.materials?.[index]?.part : -1
    )
    if (type === 'agent') {
      const agent = projectAgents[index]
      if (!agent) return
      const records = (run?.steps || []).filter((s) => s.agent === agent.id)
      detail(
        agent.name,
        [
          agent.role,
          run?.trace ? flow.agentStatus(agent.id) : run?.agents?.[agent.id] || '待命',
          ...records.map((s) => s.title + '\n' + s.detail)
        ].join('\n\n')
      )
    } else if (type === 'part') {
      const matches = (run?.materials || []).filter((m) => m.part === index)
      detail(
        parts[index].n,
        run
          ? run.display
            ? [
                run.display.focusParts?.includes(index)
                  ? run.display.kind === 'assembly'
                    ? '装配位置'
                    : '待观察部位'
                  : '模型部件',
                parts[index].task,
                run.answer
              ]
                .filter(Boolean)
                .join('\n')
            : matches.map((m) => m.code + ' · ' + m.label + '\n' + m.detail).join('\n\n') ||
              '本轮暂无该部件的齐套数据。'
          : parts[index].task
      )
    } else if (type === 'material') {
      const row = run?.materials?.[index]
      if (row) detail(row.name + ' · ' + row.label, row.code + '\n' + row.detail)
    } else if (type === 'step') {
      const step = run?.steps[index]
      if (step) detail(step.title, step.detail)
    } else {
      detail(
        '生产协同调度 Agent',
        run
          ? [flow.title() || run.stage, run.source].filter(Boolean).join('\n')
          : '接收你的问题，按需调取产品目录、工单数据、业务工具或知识助手。'
      )
    }
  }
  function rowButton(name, sub, callback, isShort) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'row-btn' + (isShort ? ' short' : '')
    b.textContent = name
    if (sub) {
      const small = document.createElement('small')
      small.textContent = sub
      b.append(small)
    }
    b.addEventListener('click', callback)
    return b
  }
  function modelRows(materials) {
    return parts.map((_, i) => {
      const matched = materials.filter((m) => m.part === i)
      if (!matched.length) return null
      const short = matched.filter((m) => m.state === 'short')
      if (short.length === 1)
        return { state: 'short', label: short[0].label, name: short[0].modelLabel || parts[i].n }
      if (short.length > 1)
        return { state: 'short', label: short.length + ' 项缺料', name: parts[i].n + '区域' }
      return matched.every((m) => m.state === 'ready')
        ? { state: 'ready', label: '已齐套' }
        : { state: 'unknown', label: '待核对' }
    })
  }
  const online = () =>
    !!(
      access &&
      (access.canQuery ||
        access.canKnowledge ||
        access.canBusiness ||
        access.canPrice ||
        access.customer)
    )
  function askText(question, reference) {
    if (!online() || run?.busy) return
    const text = question.trim() || (access.orderCode ? '这张工单缺哪些物料？' : '')
    if (!text) {
      el('question').focus()
      return
    }
    el('question').value = ''
    command('ask', { question: text, reference: reference || el('reference').value })
  }
  function displayView(view) {
    el('view-card').hidden = !view
    host.toggleAttribute('data-view', !!view)
    host.toggleAttribute('data-product-view', !!view && !!run?.showFan)
    if (!view) return
    el('view-heading').textContent = view.title
    const textAnswer = (run.answer || '').trim()
    const reading = !run.showFan && (view.kind === 'knowledge' || view.kind === 'business')
    el('view-value').textContent =
      reading && textAnswer
        ? textAnswer.slice(0, 92) + (textAnswer.length > 92 ? '…' : '')
        : view.value || (run.busy ? '查询中…' : view.title)
    el('view-caption').textContent = ['fault', 'assembly'].includes(view.kind)
      ? textAnswer || view.caption || ''
      : view.caption || ''
    const buttons = (view.choices || []).map((c) => {
      const b = rowButton(c.label, '', () => command('choice', { choice: c.value, runId: run.id }))
      b.className = 'chip'
      return b
    })
    if (reading && textAnswer.length > 92) {
      const b = rowButton('读完整回答', '', () => {
        if (matchMedia('(max-width:860px),(max-aspect-ratio:1/1)').matches) {
          el('evidence').classList.remove('open')
          el('chat').classList.add('open')
        }
        el('answer').scrollIntoView({ block: 'nearest' })
        el('answer').focus({ preventScroll: true })
      })
      b.className = 'chip'
      buttons.push(b)
    }
    el('view-choices').replaceChildren(...buttons)
  }
  function syncReading() {
    if (!run?.trace?.length) return
    const arrived = host.dataset.flowPhase === 'report'
    el('answer').textContent = arrived ? run.answer || '' : ''
    el('report-section').hidden = !arrived || !run.report
    el('run-stage').textContent = [arrived ? run.stage : flow.title() || '接收本轮提问', run.source].filter(Boolean).join(' · ')
    if (!selection || selection.type === 'master' || selection.type === 'agent')
      focus(selection?.type || 'master', selection?.index)
  }
  host.addEventListener('flow-change', syncReading)
  function show(record) {
    const outgoing = flow.departing(record)
    const old = run?.id
    run = record
    if (old !== run?.id) selection = undefined
    const items = run?.materials || [],
      steps = run?.steps || []
    host.toggleAttribute('data-run', !!run)
    el('offline-note').hidden = online() || !!run
    el('back').hidden = !run
    el('report').hidden =
      !run?.stockOK || !!run.report || (!sample && !access?.canQuery) || !!run.busy
    el('review').hidden = !run?.orderCode || sample || !access?.canQuery || !!run.busy
    el('resolve').hidden = !sample || !items.some((i) => i.state === 'short')
    el('report-section').hidden = !run?.report
    el('report-text').textContent = run?.report || ''
    el('context-title').textContent = sample
      ? '演示问答'
      : run
        ? run.orderCode || '本轮问答'
        : '装配演示'
    el('run-question').textContent = run?.question || '台式电风扇 · 七部件装配'
    el('run-stage').textContent = run
      ? [run.stage, run.source].filter(Boolean).join(' · ')
      : '示例模型'
    el('answer').textContent = run?.answer || ''
    displayView(run?.display)
    const links = modelRows(items).flatMap((part, index) => {
      if (part?.state !== 'short' || !run?.showFan) return []
      const b = rowButton(
        (part.name || parts[index].n) + ' · ' + part.label,
        '',
        () => focus('part', index, true),
        true
      )
      b.className = 'chip short-text'
      return [b]
    })
    el('answer-links').replaceChildren(...links)
    el('ask').disabled = !!run?.busy
    el('choose').disabled = !!run?.busy
    el('materials-title').textContent = run?.display ? '本轮依据' : run ? '本轮物料' : '装配部件'
    if (run?.display) {
      const rows = steps.flatMap((s, i) =>
        s.agent === 'evidence' || s.agent === 'assess'
          ? [rowButton(s.title, '', () => focus('step', i, true))]
          : []
      )
      el('materials').replaceChildren(...rows)
      if (!rows.length)
        el('materials').textContent = run.busy
          ? '正在查询…'
          : run.display.caption || run.source || run.stage
    } else if (!run) {
      el('materials').replaceChildren(
        ...parts.map((p, i) => rowButton(p.n, p.task, () => inspect(i)))
      )
    } else if (items.length) {
      el('materials').replaceChildren(
        ...items.map((m, i) =>
          rowButton(
            m.name + ' · ' + m.label,
            m.code,
            () => focus('material', i),
            m.state === 'short'
          )
        )
      )
    } else {
      el('materials').textContent = run.busy
        ? '等待齐套数据。'
        : run.stockOK
          ? '本工单没有物料明细。'
          : '本轮没有工单物料记录。'
    }
    const events = steps.map((s, i) => {
      const li = document.createElement('li'),
        b = rowButton(s.title, projectAgents.find((a) => a.id === s.agent)?.name, () =>
          focus('step', i, true)
        )
      li.append(b)
      return li
    })
    el('events').replaceChildren(...events)
    if (!steps.length)
      el('events').textContent = run ? '等待返回。' : '提问后可查看总 Agent 调用了哪些工具。'
    el('history-panel').hidden = !run || !steps.length
    const quotes = steps
      .map((s, i) => rowButton(s.title, undefined, () => focus('step', i)))
      .filter((_, i) => steps[i].agent === 'evidence' || !steps[i].agent)
    el('history').replaceChildren(...quotes)
    el('history-panel').hidden = !!run?.display || !quotes.length
    if (run) {
      el('part-inspector').hidden = true
      host.applyRun({ ...run, parts: modelRows(items), showFan: !!run.showFan })
    }
    flow.update(run, outgoing)
    syncReading()
    focus(selection?.type || 'master', selection?.index)
  }
  function demo() {
    clearTimers()
    sample = false
    selection = undefined
    el('part-inspector').hidden = true
    host.startFanAssembly()
    show(null)
  }
  function inspect(index) {
    if (run) {
      focus('part', index, true)
      return
    }
    partIndex = Math.max(0, Math.min(parts.length - 1, index))
    el('part-inspector').hidden = false
    el('part-caption').textContent = partIndex + 1 + ' / 7 · ' + parts[partIndex].n
    el('prev').disabled = partIndex === 0
    el('next').disabled = partIndex === parts.length - 1
    host.showFanProgress((partIndex + 1) / parts.length, partIndex)
    focus('part', partIndex)
  }
  function exampleMaterials(short) {
    return parts.map((p, part) => {
      const missing = short && part === 2
      return {
        code: 'FAN-' + String(part + 1).padStart(2, '0'),
        part,
        name: p.n,
        state: missing ? 'short' : 'ready',
        label: missing ? '缺 10 台' : '已齐套',
        detail: missing
          ? '尚需 10 台，符合条件的实物库存 10 台，其他工单预占 10 台，本单可用 0 台。'
          : '示例工单尚需 10 件，本单可用 10 件，缺口 0。'
      }
    })
  }
  function sampleData() {
    if (access) command('reset')
    clearTimers()
    sample = true
    selection = undefined
    const q = {
      id: 'sample-' + Date.now(),
      orderCode: 'FAN-DEMO',
      source: '模拟工单',
      showFan: true,
      busy: true,
      question: '这张风扇工单的电机在库 10 台，为什么还缺料？',
      answer: '',
      stage: '正在解析工单',
      agents: { parse: '运行中' },
      trace: [
        { role: 'dispatch', title: '接收示例工单', code: 'sampleData()\nconst { orderCode, question } = q\n// 工单 FAN-DEMO' },
        { role: 'parse', title: '识别齐套问题', code: 'const { orderCode, question } = q\n// 核对电机实物库存与其他工单预占' }
      ],
      materials: [],
      steps: []
    }
    show(q)
    later(550, () => {
      q.stage = '调取齐套与规程'
      q.trace.push({ role: 'evidence', title: '读取示例物料记录', code: 'const materials = exampleMaterials(true)\nconst motor = materials[2]\n// 模拟库存与预占' })
      q.agents = { parse: '完成', evidence: '运行中' }
      q.steps.push({
        agent: 'parse',
        title: '已定位风扇工单',
        detail: '核对尚需数量、本单可用量与预占。'
      })
      show(q)
    })
    later(1500, () => {
      q.materials = exampleMaterials(true)
      q.stockOK = true
      q.stage = '已发现电机缺料，规程查询中'
      q.agents = { parse: '完成', evidence: '运行中', assess: '运行中' }
      q.steps.push({
        agent: 'evidence',
        title: '工单齐套数据已返回',
        detail: q.materials[2].detail
      })
      show(q)
      focus('part', 2)
    })
    later(3200, () => {
      q.steps.push({ agent: 'assess', title: '已核对缺料原因', detail: q.materials[2].detail })
      q.agents = { parse: '完成', evidence: '完成', assess: '完成' }
      q.busy = false
      q.trace.push({ role: 'assess', title: '核对其他工单预占', code: 'const motor = q.materials[2]\nmotor.detail\n// 本单可用 0 台，缺 10 台' },
        { role: 'report', title: '汇总示例工单', code: 'const { question, answer, materials } = q\nconst short = materials.filter(m => m.state === "short")' })
      q.agents.report = '完成'
      q.stage = '已答复'
      q.answer = '现有 10 台电机已被其他工单预占。本单可用 0 台，仍缺 10 台。'
      show(q)
    })
  }
  // A local worked example reads the dependency by its index, then resolves the actual
  // parent part from the assembly table. Both evidence visits use the same scene pipeline.
  function reportExample() {
    if (access) command('reset')
    clearTimers(); sample = true; selection = undefined
    const q = {
      id: 'example-report-' + Date.now(), source: '模型示例 · 七部件装配表',
      question: '安装锁帽之前，先要装哪个部件？', answer: '', busy: true, showFan: false,
      display: { kind: 'assembly', title: '装配依赖查询' }, agents: {}, steps: [], stage: '定位装配步骤',
      trace: []
    }
    function trace(role, title, ...lines) {
      q.trace.push({ role, title, code: lines.join('\n') })
    }
    trace('dispatch', '接收装配问题',
      'const question = ' + JSON.stringify(q.question), 'const parts = fanProject.secs',
      '// ' + q.source + ' · ' + parts.length + ' 个部件')
    const component = parts.find(part => part.n === '锁帽')
    trace('parse', '定位提问部件',
      'const component = parts.find(', '  part => part.n === "锁帽"', ')',
      '// 命中 ' + component.n + ' · ' + component.en)
    const [dependency] = component.needs
    trace('evidence', '读取锁帽的装配依赖',
      'const dependencies = component.needs', 'const [dependency] = dependencies',
      '// ' + component.n + ' → ' + JSON.stringify(component.needs))
    q.steps.push({ agent: 'evidence', title: '锁帽 · 前置部件编号', detail: String(dependency) })
    trace('assess', '装配表返回编号，需核对部件名称',
      'const key = dependency', '// 前置部件索引 ' + dependency,
      '// 继续核对该索引对应的装配任务')
    const parentPart = parts[dependency]
    trace('evidence', '补查前置部件的记录',
      'const parentPart = parts[dependency]', 'const { n, task } = parentPart',
      '// ' + parentPart.n + ' · ' + parentPart.task)
    q.steps.push({ agent: 'evidence', title: parentPart.n + ' · 装配任务', detail: parentPart.task })
    q.answer = '先装' + parentPart.n + '。装配表中它的任务是“' + parentPart.task + '”，完成后再' + component.task + '。'
    trace('assess', '确认前后装配顺序',
      'const before = parentPart.task', 'const after = component.task',
      '// ' + parentPart.n + ' → ' + component.n)
    trace('report', '生成装配指引报告',
      'const { question, answer, source, steps } = q',
      'const refs = steps.filter(s => s.agent === "evidence")',
      '// ' + q.steps.length + ' 条装配依据')
    q.busy = false; q.stage = '已答复'; q.agents = { parse: '完成', evidence: '完成', assess: '完成', report: '完成' }
    show(q)
  }
  function resolveExample() {
    if (!sample || !run) return
    clearTimers()
    run.busy = false
    run.agents = { parse: '完成', evidence: '完成', assess: '完成' }
    run.materials = exampleMaterials(false)
    run.stage = '已复核'
    run.report = ''
    run.answer = '模拟释放预占后，本单可用 10 台电机，缺口已解除。'
    run.steps.push({ agent: 'assess', title: '模拟复核完成', detail: run.answer })
    show(run)
  }
  host.addEventListener('scene-select', (e) => {
    const { type, index } = e.detail
    if (type === 'part' && !run) inspect(index)
    else focus(type, index, true)
  })
  el('master-label').onclick = () => focus('master', 0, true)
  el('trace-example').onclick = reportExample
  el('sample-top').onclick = sampleData
  el('back').onclick = () => {
    if (access) command('reset')
    demo()
  }
  el('prev').onclick = () => inspect(partIndex - 1)
  el('next').onclick = () => inspect(partIndex + 1)
  el('replay').onclick = demo
  shadow.querySelector('[data-act=parts]').onclick = () => inspect(0)
  shadow.querySelector('[data-act=inspect]').addEventListener('click', () => {
    el('part-inspector').hidden = true
  })
  el('knowledge-settings').onclick = () => command('settings')
  el('choose').onclick = () => command('choose')
  el('ask').onclick = () => askText(el('question').value)
  el('question').onkeydown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el('ask').click()
  }
  el('review').onclick = () => command('refresh')
  el('report').onclick = () => {
    if (!sample) {
      command('report')
      return
    }
    if (!run || run.busy) return
    run.agents.report = '完成'
    run.stage = '报告已生成'
    run.report = 'FAN-DEMO · 缺料报告\n' + run.answer
    run.steps.push({ agent: 'report', title: '缺料报告已生成', detail: run.report })
    show(run)
  }
  el('resolve').onclick = resolveExample
  el('toggle-chat').onclick = () => togglePanel('chat')
  el('toggle-evidence').onclick = () => togglePanel('evidence')
  window.addEventListener('message', (e) => {
    if (
      parent === window ||
      e.source !== parent ||
      e.origin !== location.origin ||
      e.data?.type !== 'fazemes:session'
    )
      return
    const lastAccess = access
    access = e.data.access
    el('online-form').hidden = !online()
    el('choose').hidden = !access?.canQuery
    el('offline-note').hidden = online() || !!run
    el('choose').textContent = access?.orderCode || '选择工单'
    if (!lastAccess && online()) {
      const suggestions = [
        ['问售价', '这台风扇多少钱？'],
        ['排查异响', '风扇一直有异响，怎么办？']
      ]
      if (access.canKnowledge) suggestions.push(['问知识', '什么是工单预占？'])
      if (access.canBusiness || access.customer)
        suggestions.push(['查进度', access.customer ? '查询我的订单进度' : '查询全部工单进度'])
      el('examples').replaceChildren(
        ...suggestions.map(([title, q]) => {
          const b = rowButton(title, '', () => askText(q, 'auto'))
          b.className = 'chip'
          return b
        })
      )
    }
    if (lastAccess?.orderCode !== access?.orderCode && access?.orderCode && !el('question').value)
      el('question').value = '这张工单缺哪些物料？为什么仓库有货仍会缺料？'
    if (access?.preferKnowledge && !el('reference').dataset.scoped) {
      el('reference').value = 'knowledge'
      el('reference').dataset.scoped = 'true'
    }
    el('knowledge-settings').hidden = !access?.canKnowledge
    el('source-settings').hidden = !!access?.customer
    Array.from(el('reference').options).forEach((o) => {
      o.hidden = ['knowledge', 'graph', 'hybrid', 'evidence'].includes(o.value)
        ? !access?.canKnowledge
        : o.value === 'kitting-doc'
          ? !access?.canQuery || !access?.canKnowledge
          : o.value === 'dify'
            ? !access?.canDify
            : o.value === 'business'
              ? !access?.canBusiness && !access?.canQuery
              : false
    })
    const r = e.data.run
    if (r && typeof r.question === 'string' && Array.isArray(r.steps)) {
      clearTimers()
      sample = false
      show({
        ...r,
        id: r.id || r.source + '|' + r.question,
        stage: r.stage || '历史记录',
        agents: r.agents || {},
        showFan: !!r.showFan
      })
    } else if (!sample && run) demo()
  })
  show(null)
  if (parent !== window && location.origin !== 'null')
    parent.postMessage({ type: 'fazemes:ready' }, location.origin)
  const view = new URLSearchParams(location.search).get('demo')
  if (view === 'shortage') sampleData()
  if (view === 'report') reportExample()
})()
