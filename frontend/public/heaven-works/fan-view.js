/* Local adapter for the WORKS theme. Business records stay inside this iframe's lifetime. */
(() => {
  'use strict'
  const host = document.getElementById('host-works')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(document.getElementById('tpl-loom').content.cloneNode(true))
  const embeddedRecord = new URLSearchParams(location.search).get('view') === 'record'
  if (embeddedRecord) host.setAttribute('data-record', '')
  mountLoom(host, shadow)

  const byId = id => shadow.getElementById(id)
  const panel = shadow.querySelector('.rec-layout')
  const inspector = shadow.querySelector('.part-inspector')
  const example = {
    source: '示例问答 · 齐套验收场景改编',
    shortageParts: [2],
    question: '电风扇工单需 10 台电机，仓库有 10 台，为什么仍然缺料？',
    answer: '这 10 台电机已被其他工单预占。本单可用 0 台，缺 10 台。请核对预占记录后跟进补料。',
    steps: [
      { title: '问题解析', detail: '本轮要查的是这张工单可领用的电机数量。' },
      { title: '齐套数据', detail: '尚需 10 台，实物 10 台，其他工单预占 10 台，本单可用 0 台。', part: 2 },
      { title: '规程证据', detail: '《齐套缺料与线边领退料》建议核对工单预占、仓库、批次和可用状态。', part: 2 },
      { title: '缺料研判', detail: '核对尚需量与本单可用量，电机缺口为 10 台。', part: 2 },
      { title: '交付答复', detail: '缺料分析已完成。电风扇仍缺电机，显示的是分析进度。' }
    ]
  }
  let record
  let current = 0
  let selectedPart = 0
  function setStep(index) {
    current = index
    const step = record.steps[current]
    byId('record-title').textContent = step.title
    byId('record-detail').textContent = step.detail
    byId('record-prev').disabled = current === 0
    byId('record-next').disabled = current === record.steps.length - 1
    Array.from(byId('record-steps').children).forEach((button, position) => {
      if (position === current) button.setAttribute('aria-current', 'step')
      else button.removeAttribute('aria-current')
    })
    let progress = (current + 1) / record.steps.length
    for (let i = 0; i <= current; i++) {
      const part = record.steps[i].part
      if (Number.isInteger(part) && part >= 0 && part < fanProject.secs.length) {
        progress = Math.max(progress, (part + 1) / fanProject.secs.length)
      }
    }
    host.showFanProgress(progress, step.part)
  }
  function showRecord(value) {
    if (!value || typeof value.source !== 'string' || typeof value.question !== 'string' ||
        typeof value.answer !== 'string' || !Array.isArray(value.steps) || !value.steps.length ||
        !value.steps.every(step => step && typeof step.title === 'string' && typeof step.detail === 'string')) return
    record = value
    host.setAttribute('data-record', '')
    inspector.hidden = true
    panel.hidden = false
    shadow.querySelector('.m-title i').textContent = '天工开物 · 任务回放'
    const shortages = Array.isArray(value.shortageParts) ? value.shortageParts : []
    host.setFanShortages(shortages)
    byId('record-source').textContent = value.source + (shortages.length ? ' · 橙色部件有缺口' : '')
    byId('record-question').textContent = value.question
    byId('record-answer').textContent = value.answer
    byId('record-return').hidden = embeddedRecord
    const choices = value.steps.map((step, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = (index + 1) + '  ' + step.title
      button.addEventListener('click', () => setStep(index))
      return button
    })
    byId('record-steps').replaceChildren(...choices)
    setStep(0)
    host.layoutFan()
  }
  function inspectPart(index) {
    if (record) return
    selectedPart = Math.max(0, Math.min(fanProject.secs.length - 1, index))
    const part = fanProject.secs[selectedPart]
    inspector.hidden = false
    byId('part-caption').textContent = (selectedPart + 1) + ' / 7　' + part.n + ' · ' + part.task
    byId('part-prev').disabled = selectedPart === 0
    byId('part-next').disabled = selectedPart === fanProject.secs.length - 1
    host.showFanProgress((selectedPart + 1) / fanProject.secs.length, selectedPart)
  }
  shadow.querySelectorAll('[data-act="parts"]').forEach(button =>
    button.addEventListener('click', () => inspectPart(0)))
  shadow.querySelectorAll('[data-act="sample"]').forEach(button =>
    button.addEventListener('click', () => showRecord(example)))
  shadow.querySelectorAll('[data-act="inspect"]').forEach(button =>
    button.addEventListener('click', () => { inspector.hidden = true }))
  host.addEventListener('fan-part', event => inspectPart(event.detail))
  byId('part-prev').addEventListener('click', () => inspectPart(selectedPart - 1))
  byId('part-next').addEventListener('click', () => inspectPart(selectedPart + 1))
  byId('part-close').addEventListener('click', () => {
    inspector.hidden = true
    host.startFanAssembly()
  })
  byId('record-prev').addEventListener('click', () => setStep(current - 1))
  byId('record-next').addEventListener('click', () => setStep(current + 1))
  byId('record-return').addEventListener('click', () => {
    record = undefined
    host.setFanShortages([])
    panel.hidden = true
    host.removeAttribute('data-record')
    shadow.querySelector('.m-title i').textContent = '天工开物 · 示例数据'
    host.startFanAssembly()
    host.layoutFan()
  })
  if (embeddedRecord && parent !== window) {
    window.addEventListener('message', event => {
      if (event.source === parent && event.origin === location.origin && event.data?.type === 'fazemes:works-run') {
        showRecord(event.data.run)
      }
    })
  }
})()
