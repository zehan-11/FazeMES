/* The scene plays the actual, ordered tool cues even when several arrive in one Vue update. */
function mountQuestionFlow(host, el, selectEvidence, selectChoice) {
  const stage = el('flow-stage'),
    terminal = el('flow-code'),
    paper = el('flow-paper')
  const toggle = el('stage-mode'),
    ink = el('paper-ink')
  const reduced = matchMedia('(prefers-reduced-motion:reduce)')
  const particles = reportParticles(el('flow-particles'), host, ink, el('paper-body'), reduced)
  const stream = terminalStream(el('terminal-viewport'), el('flow-lines'), reduced)
  const titles = {
    price: '型号参考价',
    fault: '故障排查',
    lifetime: '故障时间评估',
    assembly: '装配指引',
    knowledge: '知识问答',
    business: '业务查询'
  }
  let record = null,
    index = -1,
    phase = 'idle',
    timer = 0,
    onlyModel = false
  let done = [],
    role = '',
    status = '',
    lastPaper = null
  let context = 'standalone'
  if (window !== parent) {
    try {
      context = parent.location.pathname
    } catch {
      context = 'embedded'
    }
  }
  const key = 'fazemes:works:outgoing-paper:' + context

  function setPhase(value) {
    phase = value
    host.dataset.flowPhase = value
  }
  function wait(ms, callback) {
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = 0
      callback()
    }, ms)
  }
  function button(label, handler) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.textContent = label
    b.onclick = handler
    return b
  }
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value
  }
  function modelSwitch() {
    const available = !!record?.showFan
    if (!available) onlyModel = false
    toggle.hidden = !available
    toggle.setAttribute('aria-pressed', String(onlyModel))
    const short = record?.materials?.find((m) => m.state === 'short' && m.part != null)
    toggle.textContent = onlyModel
      ? '返回问答舞台'
      : short
        ? '查看模型 · ' + (short.modelLabel || short.name) + ' ' + short.label
        : '查看零件模型'
    host.setFlowDeck(!!record, onlyModel)
  }
  function showModel() {
    if (record?.showFan) {
      onlyModel = true
      modelSwitch()
    }
  }
  toggle.onclick = () => {
    onlyModel = !onlyModel
    modelSwitch()
  }

  function paintReport() {
    const r = record
    const title = (titles[r.display?.kind] || (r.orderCode ? '工单齐套' : '协同问答')) + '报告'
    const answer = r.report || r.answer
    setText(el('paper-title'), title)
    setText(el('paper-question'), r.question)
    setText(el('paper-status'), r.stage || '本轮结果')
    setText(el('paper-answer'), answer || '本轮没有返回答复。')
    setText(
      el('paper-source'),
      [r.orderCode, r.source].filter(Boolean).join(' · ') || '本轮执行记录'
    )
    const refs = r.steps.flatMap((s, index) => (s.agent === 'evidence' ? [{ ...s, index }] : []))
    const choices = r.display?.choices || []
    const signature = JSON.stringify([r.id, refs.map((s) => [s.index, s.title]), choices])
    if (signature !== lastPaper) {
      lastPaper = signature
      const link = (s) => button(s.title, () => selectEvidence(s.index))
      const citations = el('paper-evidence')
      citations.replaceChildren(...refs.slice(0, 3).map(link))
      if (refs.length > 3) {
        const more = document.createElement('details'),
          label = document.createElement('summary')
        label.textContent = '其余 ' + (refs.length - 3) + ' 条依据'
        const rest = document.createElement('div')
        rest.className = 'actions'
        rest.append(...refs.slice(3).map(link))
        more.append(label, rest)
        citations.append(more)
      }
      el('paper-choices').replaceChildren(
        ...choices.map((c) => button(c.label, () => selectChoice(c.value, r.id)))
      )
    }
  }
  function evidencePreview(r) {
    const missing = r.materials?.find((m) => m.state === 'short')
    const evidence = r.steps.find((s) => s.agent === 'evidence' && s.detail && s.title)
    const excerpt = evidence?.detail.split('\n').filter(Boolean).at(-1) || ''
    return missing
      ? (missing.modelLabel || missing.name) + ' · ' + missing.label
      : evidence
        ? evidence.title + ' · ' + excerpt.slice(0, 44) + (excerpt.length > 44 ? '…' : '')
        : r.display?.value || r.source || ''
  }
  function sheetBox() {
    const b = paper.getBoundingClientRect(),
      frame = host.getBoundingClientRect()
    if (!b.width || !b.height) return null
    return {
      x: (b.left - frame.left) / frame.width,
      y: (b.top - frame.top) / frame.height,
      w: b.width / frame.width,
      h: b.height / frame.height
    }
  }
  function showReport() {
    paintReport()
    terminal.hidden = true
    paper.hidden = false
    el('paper-body').scrollTop = 0
    role = ''
    status = record.stage || '报告已生成'
    host.setFlowCue({ role, title: status, done })
    setPhase('report')
    host.dispatchEvent(new Event('flow-change'))
  }
  function playCue() {
    const cue = record.trace[++index],
      previous = role
    if (previous && !done.includes(previous)) done.push(previous)
    role = cue.role
    status = cue.title
    const agent = projectAgents.find((a) => a.id === role)
    host.dataset.flowRole = role
    stage.style.setProperty('--signal', agent?.c || '#b6dce9')
    host.setFlowCue({
      role,
      title: status,
      done,
      backtrack: previous === 'assess' && role === 'evidence'
    })
    el('flow-agent').textContent = agent?.name || '生产协同调度 Agent'
    el('flow-action').textContent = cue.title
    setPhase('code')
    stage.hidden = false
    terminal.hidden = false
    paper.hidden = true
    const previousAgent = projectAgents.find((a) => a.id === previous)?.name || '生产协同调度 Agent'
    const handoff = previous
      ? previousAgent + ' → ' + el('flow-agent').textContent
      : el('flow-agent').textContent + ' · ' + cue.title
    const example = role === 'report' ? evidencePreview(record) : ''
    const code = cue.code + (example ? '\n// 本轮依据 · ' + example : '')
    stream.play(handoff, code, agent?.c || '#b6dce9', () => wait(reduced.matches ? 180 : 280, pump))
    host.dispatchEvent(new Event('flow-change'))
  }
  function pump() {
    if (timer || stream.busy || !record || phase === 'report' || phase === 'dispersing') return
    if (index + 1 < record.trace.length) playCue()
    else if (!record.busy && role === 'report') {
      if (!done.includes(role)) done.push(role)
      showReport()
    } else if (record.busy) stream.pending(record.steps.filter((step) => step.agent === role))
  }
  function cleared() {
    index = -1
    done = []
    role = ''
    status = ''
    lastPaper = null
    delete host.dataset.flowRole
    host.setFlowCue(null)
    stream.reset()
    stage.hidden = true
    terminal.hidden = true
    paper.hidden = true
  }
  function scatter(sheet) {
    setPhase('dispersing')
    particles.disperse(sheet, () => {
      setPhase('idle')
      pump()
    })
  }
  function departing(next) {
    return record && record.id !== next?.id && !onlyModel && phase === 'report'
      ? particles.snapshot()
      : null
  }
  function update(value, outgoing) {
    const next = value?.trace?.length ? value : null
    if (record?.id !== next?.id) {
      const sheet = outgoing || departing(next)
      if (phase !== 'dispersing') {
        clearTimeout(timer)
        timer = 0
        particles.stop()
        setPhase('idle')
      }
      cleared()
      onlyModel = false
      record = next
      modelSwitch()
      if (sheet) {
        scatter(sheet)
        return
      }
    } else {
      record = next
      modelSwitch()
    }
    if (record && phase === 'report') {
      status = record.stage || '报告已生成'
      host.setFlowCue({ role: '', title: status, done })
      paintReport()
      return
    }
    pump()
  }
  // Browser refresh cannot animate the departing document. Carry only its rectangle to the
  // new document. The old question, report, library scope and credentials are never stored.
  window.addEventListener('pagehide', () => {
    try {
      const box = phase === 'report' && !onlyModel ? sheetBox() : null
      if (box) sessionStorage.setItem(key, JSON.stringify({ box, time: Date.now() }))
      else sessionStorage.removeItem(key)
    } catch {
      /* The embedded scene also works without storage. */
    }
  })
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
    sessionStorage.removeItem(key)
    const nav = (window === parent ? performance : parent.performance).getEntriesByType(
      'navigation'
    )[0]
    const ownNav = performance.getEntriesByType('navigation')[0]
    const age = saved ? Date.now() - saved.time : Infinity
    const freshRemount = window !== parent && age < 3500
    if (
      saved &&
      age >= 0 &&
      age < 120000 &&
      (nav?.type === 'reload' || ownNav?.type === 'reload' || freshRemount) &&
      ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(saved.box?.[k]))
    )
      scatter({ box: saved.box })
  } catch {
    /* Cross-origin parents and privacy modes do not prevent a fresh start. */
  }
  return {
    update,
    departing,
    showModel,
    agentStatus: (id) => (role === id ? '运行中' : done.includes(id) ? '完成' : '待命'),
    title: () => status
  }
}

// Append to one transcript across handoffs. Reading back pauses automatic scrolling until
// the reader returns to the bottom; a new question starts a new transcript.
function terminalStream(view, log, reduced) {
  let frame = 0,
    heartbeat = 0,
    running = false,
    follow = true,
    manual = false
  let block, cursor
  const printedEvents = new Set()
  view.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaY < 0) {
        manual = true
        follow = false
      }
    },
    { passive: true }
  )
  view.addEventListener(
    'touchstart',
    () => {
      manual = true
    },
    { passive: true }
  )
  view.addEventListener('pointerdown', () => {
    manual = true
  })
  view.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) {
      manual = true
      follow = false
    }
    if (e.key === 'End') {
      follow = true
      manual = false
    }
  })
  view.addEventListener(
    'scroll',
    () => {
      if (!manual) return
      follow = view.scrollHeight - view.clientHeight - view.scrollTop < 4
      if (follow) manual = false
    },
    { passive: true }
  )

  function scroll(instant = false) {
    if (!follow) return
    const end = view.scrollHeight - view.clientHeight
    if (end > view.scrollTop)
      view.scrollTop += instant ? end - view.scrollTop : Math.ceil((end - view.scrollTop) * 0.45)
  }
  function row(style = '') {
    cursor?.classList.remove('cursor')
    cursor = document.createElement('span')
    cursor.className = 'trace-row cursor ' + style
    block.append(cursor)
    return cursor
  }
  function highlight(node, line) {
    // Text nodes keep questions, excerpts and tool output literal, including HTML-looking text.
    const tokens =
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:async|await|const|let|if|return|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b/g
    let offset = 0
    const fragment = document.createDocumentFragment()
    for (const match of line.matchAll(tokens)) {
      fragment.append(line.slice(offset, match.index))
      const span = document.createElement('span')
      span.className = /^["']/.test(match[0])
        ? 'trace-literal'
        : /^\d/.test(match[0])
          ? 'trace-number'
          : 'trace-keyword'
      span.textContent = match[0]
      fragment.append(span)
      offset = match.index + match[0].length
    }
    fragment.append(line.slice(offset))
    node.replaceChildren(fragment)
  }
  function reset() {
    cancelAnimationFrame(frame)
    clearInterval(heartbeat)
    heartbeat = 0
    running = false
    log.replaceChildren()
    block = cursor = null
    follow = true
    manual = false
    view.scrollTop = 0
  }
  function play(handoff, code, color, complete) {
    cancelAnimationFrame(frame)
    clearInterval(heartbeat)
    heartbeat = 0
    printedEvents.clear()
    block?.classList.add('past')
    block = document.createElement('span')
    block.className = 'trace-block'
    block.style.setProperty('--tone', color)
    log.append(block)
    while (log.childElementCount > 24) log.firstElementChild.remove()
    const lines = [handoff, ...code.split('\n').filter((line) => line.trim())]
    let index = 0,
      lineStart = performance.now(),
      node,
      printed = 0
    running = true
    function draw(time) {
      while (index < lines.length) {
        const line = lines[index],
          duration = Math.min(580, 92 + line.length * 7)
        const age = Math.max(0, time - lineStart)
        if (!node)
          node = row(index === 0 ? 'handoff' : line.trimStart().startsWith('//') ? 'comment' : '')
        const count = reduced.matches
          ? line.length
          : Math.min(line.length, Math.ceil((line.length * age) / duration))
        if (count > printed) {
          node.append(document.createTextNode(line.slice(printed, count)))
          printed = count
        }
        if (!reduced.matches && age < duration + 95) break
        if (index && !node.classList.contains('comment')) highlight(node, line)
        index++
        node = null
        printed = 0
        lineStart += duration + 95
      }
      scroll(reduced.matches)
      if (index < lines.length) frame = requestAnimationFrame(draw)
      else {
        running = false
        complete()
      }
    }
    draw(lineStart)
  }
  function pending(steps) {
    if (!block) return
    function followTail() {
      cancelAnimationFrame(frame)
      function advance() {
        scroll(reduced.matches)
        if (follow && view.scrollHeight - view.clientHeight - view.scrollTop > 1)
          frame = requestAnimationFrame(advance)
      }
      advance()
    }
    for (const step of steps.slice(-5)) {
      const message = [step.title, step.detail?.split('\n')[0]].filter(Boolean).join(' · ')
      if (!message || printedEvents.has(message)) continue
      printedEvents.add(message)
      row('comment').textContent = '// ' + message.slice(0, 100)
      followTail()
    }
    if (heartbeat) return
    const since = performance.now()
    let line,
      lastEntry = -3
    heartbeat = window.setInterval(() => {
      const seconds = Math.floor((performance.now() - since) / 1000)
      if (seconds - lastEntry >= 3) {
        const waits = block.querySelectorAll('.waiting')
        if (waits.length >= 18) waits[0].remove()
        line = row('comment waiting')
        lastEntry = seconds
      }
      line.textContent = '// 等待本次调用返回 · ' + seconds + ' s'
      followTail()
    }, 1000)
  }
  return {
    reset,
    play,
    pending,
    get busy() {
      return running
    }
  }
}
