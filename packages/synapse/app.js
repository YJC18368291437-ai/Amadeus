/*
 * Synapse — conversation graph.
 *
 * Every conversation is a dot. Links between dots are drawn automatically from
 * three sources (fork lineage, lexical similarity, and a model pass that names
 * genuinely related conversations). Click a dot to jump into that conversation,
 * type to search. Nothing else.
 */
(() => {
  'use strict'

  const SVG_NS = 'http://www.w3.org/2000/svg'
  const GRAPH_URL = '/synapse/api/graph'
  const REFRESH_INTERVAL_MS = 30_000

  const el = (tag, attrs = {}, parent = null) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue
      if (key === 'text') node.textContent = value
      else node.setAttribute(key, value)
    }
    if (parent !== null) parent.appendChild(node)
    return node
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  // ---------------------------------------------------------------- state ----

  const state = {
    nodes: [],
    edges: [],
    projects: [],
    meta: {},
    byId: new Map(),
    neighbors: new Map(),
    hiddenProjects: new Set(),
    matched: new Set(),
    active: null,
    current: null,
    query: '',
    view: { x: 0, y: 0, k: 1 },
    width: window.innerWidth,
    height: window.innerHeight,
    alpha: 1,
    running: false,
    fitPending: false,
    seeded: false,
    dragging: null,
    panning: null,
    suppressClick: false,
    suppressClickTimer: null,
    hovered: null,
    theme: 'light',
  }

  // --------------------------------------------------------------- chrome ---

  const app = document.getElementById('app')
  app.innerHTML = ''

  const shell = el('div', { class: 'graph-shell' }, app)

  const header = el('header', { class: 'graph-header' }, shell)
  const brand = el('div', { class: 'graph-brand' }, header)
  el('span', { class: 'graph-brand-dot', 'aria-hidden': 'true' }, brand)
  el('span', { class: 'graph-brand-name', text: '关系图' }, brand)

  const searchWrap = el('div', { class: 'graph-search' }, header)
  const searchIcon = el('span', { class: 'graph-search-icon', text: '⌕', 'aria-hidden': 'true' }, searchWrap)
  void searchIcon
  const searchInput = el('input', {
    class: 'graph-search-input',
    type: 'search',
    placeholder: '搜索对话…   (/ 聚焦)',
    autocomplete: 'off',
    spellcheck: 'false',
  }, searchWrap)
  const searchClear = el('button', { class: 'graph-search-clear', type: 'button', title: '清除', text: '×' }, searchWrap)
  const results = el('div', { class: 'graph-results', hidden: 'hidden' }, searchWrap)

  const status = el('div', { class: 'graph-status' }, header)
  const statusCount = el('span', { class: 'graph-status-count' }, status)
  const statusSource = el('span', { class: 'graph-status-source' }, status)

  const actions = el('div', { class: 'graph-actions' }, header)
  const arrangeButton = el('button', { class: 'graph-button', type: 'button', title: '重新铺开布局' }, actions)
  arrangeButton.append(el('span', { text: '重排' }))
  const aiButton = el('button', { class: 'graph-button', type: 'button', title: '让 AI 判断关系并连线' }, actions)
  aiButton.append(el('span', { text: 'AI 连线' }))
  const fitButton = el('button', { class: 'graph-button', type: 'button', title: '缩放到全部对话' }, actions)
  fitButton.append(el('span', { text: '全览' }))

  const legend = el('div', { class: 'graph-legend' }, shell)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'graph-canvas')
  shell.appendChild(svg)
  const defs = el('defs', {}, svg)
  void defs
  const viewport = document.createElementNS(SVG_NS, 'g')
  viewport.setAttribute('class', 'graph-viewport')
  svg.appendChild(viewport)
  const linkLayer = document.createElementNS(SVG_NS, 'g')
  linkLayer.setAttribute('class', 'graph-links')
  viewport.appendChild(linkLayer)
  const nodeLayer = document.createElementNS(SVG_NS, 'g')
  nodeLayer.setAttribute('class', 'graph-nodes')
  viewport.appendChild(nodeLayer)

  const tooltip = el('div', { class: 'graph-tooltip', hidden: 'hidden' }, shell)
  const emptyState = el('div', { class: 'graph-empty' }, shell)
  emptyState.append(el('p', { class: 'graph-empty-title', text: '还没有可显示的对话' }))
  emptyState.append(el('p', { class: 'graph-empty-hint', text: '在 Amadeus 里聊几句，关掉再打开这个标签页，对话就会出现在这里。' }))
  const toast = el('div', { class: 'graph-toast', hidden: 'hidden' }, shell)

  let toastTimer = null
  const say = (message) => {
    toast.textContent = message
    toast.hidden = false
    if (toastTimer !== null) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.hidden = true }, 2600)
  }

  // --------------------------------------------------------------- bridge ---

  const post = (type, payload = {}) => {
    try { window.parent?.postMessage({ source: 'dsh-synapse', type, ...payload }, window.location.origin) } catch { /* parent gone */ }
  }

  const openSession = node => {
    if (typeof node.sessionId !== 'string' || node.sessionId === '') {
      say('这个节点还没有关联到 DSH 会话')
      return
    }
    post('synapse:open-session', { sessionId: node.sessionId })
  }

  // ----------------------------------------------------------------- data ---

  const buildIndex = () => {
    state.byId = new Map(state.nodes.map(node => [node.id, node]))
    state.neighbors = new Map(state.nodes.map(node => [node.id, new Set()]))
    for (const edge of state.edges) {
      state.neighbors.get(edge.source)?.add(edge.target)
      state.neighbors.get(edge.target)?.add(edge.source)
    }
  }

  const fetchGraph = async ({ refresh = false } = {}) => {
    try {
      const response = await fetch(refresh ? `${GRAPH_URL}?refresh=1` : GRAPH_URL, { method: refresh ? 'POST' : 'GET' })
      if (!response.ok) throw new Error(String(response.status))
      const payload = await response.json()
      applyGraph(payload, { rearrange: refresh })
      return true
    } catch {
      return false
    }
  }

  const applyGraph = (payload, { rearrange = false } = {}) => {
    const changed = payload.nodes.length !== state.nodes.length
      || payload.edges.length !== state.edges.length
      || payload.meta?.fingerprint !== state.meta?.fingerprint
    state.projects = Array.isArray(payload.projects) ? payload.projects : []
    state.meta = payload.meta ?? {}
    const previous = new Map(state.nodes.map(node => [node.id, node]))
    state.nodes = payload.nodes.map(node => {
      const old = previous.get(node.id)
      return {
        ...node,
        x: old?.x ?? 0,
        y: old?.y ?? 0,
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
        pinned: old?.pinned ?? false,
      }
    })
    state.edges = payload.edges
    buildIndex()
    renderLegend()
    // Layout only moves when the user asks: the first paint, an explicit "重排",
    // or a manual "AI 连线" (which re-arranges after it connects). A background
    // refresh from new messages only settles the physics, it never re-seeds.
    if (!state.seeded && state.nodes.length > 0) {
      state.seeded = true
      seedPositions()
      reheat()
    } else if (rearrange) {
      seedPositions()
      reheat()
    } else if (changed) {
      reheat()
    }
    paint()
    updateStatus()
    emptyState.hidden = state.nodes.length > 0
    if (state.pendingFocus !== undefined && state.pendingFocus !== null) {
      const node = state.byId.get(state.pendingFocus)
      state.pendingFocus = null
      if (node !== undefined) centerOn(node)
    }
  }

  // ------------------------------------------------------------ simulation --

  const projectAnchors = () => {
    const anchors = new Map()
    const names = [...new Set(state.nodes.map(node => node.project))]
    const radius = Math.max(120, Math.min(state.width, state.height) * 0.18)
    names.forEach((name, index) => {
      const angle = names.length === 1 ? 0 : (index / names.length) * Math.PI * 2
      anchors.set(name, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
    })
    return anchors
  }

  const seedPositions = () => {
    const anchors = projectAnchors()
    const used = new Map()
    for (const node of state.nodes) {
      const anchor = anchors.get(node.project) ?? { x: 0, y: 0 }
      const count = used.get(node.project) ?? 0
      used.set(node.project, count + 1)
      const angle = count * 2.399963
      const radius = 42 + Math.sqrt(count) * 30
      node.x = anchor.x + Math.cos(angle) * radius
      node.y = anchor.y + Math.sin(angle) * radius
      node.vx = 0
      node.vy = 0
      node.pinned = false
    }
    state.fitPending = true
    state.view = { x: state.width / 2, y: state.height / 2, k: 1 }
  }

  const reheat = () => {
    state.alpha = 1
    state.targetAlpha = 0
    startLoop()
  }

  let loopHandle = null
  const startLoop = () => {
    if (loopHandle !== null) return
    loopHandle = requestAnimationFrame(tick)
  }

  const tick = () => {
    loopHandle = null
    step()
    paintPositions()
    if (state.alpha > 0.012) {
      loopHandle = requestAnimationFrame(tick)
      return
    }
    if (state.fitPending === true) {
      state.fitPending = false
      fit()
    }
  }

  const segmentCross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const segmentsCross = (a, b, c, d) => {
    const d1 = segmentCross(c, d, a)
    const d2 = segmentCross(c, d, b)
    const d3 = segmentCross(a, b, c)
    const d4 = segmentCross(a, b, d)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  }

  // Layout forces keep the map readable: a dot never sits on a line that is not
  // its own, and two lines that would cross are pushed apart. An arbitrary graph
  // is not always fully planar, but these get most of the way there.
  const NODE_EDGE_RADIUS = 54
  const NODE_EDGE_FORCE = 1.1
  const CROSSING_FORCE = 26

  const step = () => {
    const nodes = state.nodes
    if (nodes.length === 0) return
    const anchors = projectAnchors()
    const repulsion = 2400
    for (const node of nodes) {
      node.fx = 0
      node.fy = 0
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distSq = dx * dx + dy * dy
        if (distSq < 0.01) { dx = 0.4; dy = 0.4; distSq = 0.32 }
        const strength = repulsion / distSq
        const dist = Math.sqrt(distSq)
        const fx = (dx / dist) * strength
        const fy = (dy / dist) * strength
        a.fx -= fx; a.fy -= fy
        b.fx += fx; b.fy += fy
      }
    }
    for (const edge of state.edges) {
      const a = state.byId.get(edge.source)
      const b = state.byId.get(edge.target)
      if (a === undefined || b === undefined) continue
      const rest = edge.kind === 'fork' ? 96 : 150
      const spring = edge.kind === 'fork' ? 0.05 : 0.02 * (0.6 + edge.weight)
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist = Math.hypot(dx, dy) || 0.001
      const force = (dist - rest) * spring
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.fx += fx; a.fy += fy
      b.fx -= fx; b.fy -= fy
    }
    // Push a dot off any line it is not an endpoint of.
    for (const edge of state.edges) {
      const a = state.byId.get(edge.source)
      const b = state.byId.get(edge.target)
      if (a === undefined || b === undefined) continue
      const abx = b.x - a.x, aby = b.y - a.y
      const lenSq = abx * abx + aby * aby || 0.001
      for (const n of nodes) {
        if (n === a || n === b || n.dragging === true) continue
        const t = Math.max(0, Math.min(1, ((n.x - a.x) * abx + (n.y - a.y) * aby) / lenSq))
        const px = a.x + abx * t, py = a.y + aby * t
        const dx = n.x - px, dy = n.y - py
        const dist = Math.hypot(dx, dy) || 0.001
        if (dist >= NODE_EDGE_RADIUS) continue
        const push = (NODE_EDGE_RADIUS - dist) * NODE_EDGE_FORCE
        const ux = dx / dist, uy = dy / dist
        n.fx += ux * push; n.fy += uy * push
        a.fx -= ux * push * 0.4; a.fy -= uy * push * 0.4
        b.fx -= ux * push * 0.4; b.fy -= uy * push * 0.4
      }
    }
    // Push two crossing lines apart.
    for (let i = 0; i < state.edges.length; i += 1) {
      const e1 = state.edges[i]
      const a = state.byId.get(e1.source), b = state.byId.get(e1.target)
      if (a === undefined || b === undefined) continue
      for (let j = i + 1; j < state.edges.length; j += 1) {
        const e2 = state.edges[j]
        const c = state.byId.get(e2.source), d = state.byId.get(e2.target)
        if (c === undefined || d === undefined) continue
        if (a === c || a === d || b === c || b === d) continue
        if (!segmentsCross(a, b, c, d)) continue
        const m1x = (a.x + b.x) / 2, m1y = (a.y + b.y) / 2
        const m2x = (c.x + d.x) / 2, m2y = (c.y + d.y) / 2
        const dx = m1x - m2x, dy = m1y - m2y
        const dist = Math.hypot(dx, dy) || 1
        const push = CROSSING_FORCE / (dist + 20)
        const ux = dx / dist, uy = dy / dist
        a.fx += ux * push; a.fy += uy * push
        b.fx += ux * push; b.fy += uy * push
        c.fx -= ux * push; c.fy -= uy * push
        d.fx -= ux * push; d.fy -= uy * push
      }
    }
    for (const node of nodes) {
      const anchor = anchors.get(node.project) ?? { x: 0, y: 0 }
      node.fx += (anchor.x - node.x) * 0.011
      node.fy += (anchor.y - node.y) * 0.011
      node.fx -= node.x * 0.012
      node.fy -= node.y * 0.012
    }
    const damping = 0.85
    for (const node of nodes) {
      if (node.dragging === true) { node.vx = 0; node.vy = 0; continue }
      if (node.pinned === true) { node.vx = 0; node.vy = 0; continue }
      node.vx = (node.vx + node.fx * 0.35) * damping
      node.vy = (node.vy + node.fy * 0.35) * damping
      const speed = Math.hypot(node.vx, node.vy)
      const cap = 24
      if (speed > cap) { node.vx = (node.vx / speed) * cap; node.vy = (node.vy / speed) * cap }
      node.x += node.vx * state.alpha
      node.y += node.vy * state.alpha
    }
    state.alpha *= 0.978
  }

  // -------------------------------------------------------------- painting --

  const nodeScreenRadius = node => node.size * 0.5 * (0.55 + 0.45 * clamp(state.view.k, 0.3, 2.4))

  const paint = () => {
    linkLayer.textContent = ''
    nodeLayer.textContent = ''
    for (const edge of state.edges) {
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('class', `graph-link graph-link-${edge.kind}`)
      line.dataset.source = edge.source
      line.dataset.target = edge.target
      linkLayer.appendChild(line)
    }
    for (const node of state.nodes) {
      const group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('class', 'graph-node')
      group.dataset.id = node.id
      const halo = document.createElementNS(SVG_NS, 'circle')
      halo.setAttribute('class', 'graph-node-halo')
      const dot = document.createElementNS(SVG_NS, 'circle')
      dot.setAttribute('class', 'graph-node-dot')
      const label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('class', 'graph-node-label')
      label.setAttribute('text-anchor', 'middle')
      label.textContent = node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title
      group.append(halo, dot, label)
      group.addEventListener('pointerenter', () => { state.hovered = node.id; hover(node, group) })
      group.addEventListener('pointerleave', () => { state.hovered = null; unhover(); hideTooltip() })
      group.addEventListener('pointerdown', event => beginNodeDrag(event, node))
      group.addEventListener('click', event => {
        if (state.suppressClick === true) { state.suppressClick = false; return }
        if (state.dragMoved === true) { state.dragMoved = false; return }
        event.stopPropagation()
        openSession(node)
      })
      nodeLayer.appendChild(group)
      node.group = group
      node.halo = halo
      node.dot = dot
      node.label = label
    }
    paintPositions()
  }

  const paintPositions = () => {
    const k = state.view.k
    viewport.setAttribute('transform', `translate(${state.view.x} ${state.view.y}) scale(${k})`)
    for (const node of state.nodes) {
      if (node.group === undefined) continue
      const r = nodeScreenRadius(node) / k
      node.group.setAttribute('transform', `translate(${node.x} ${node.y})`)
      node.dot.setAttribute('r', r.toFixed(2))
      node.dot.setAttribute('fill', node.color)
      node.halo.setAttribute('r', (r + 7 / k).toFixed(2))
      const showLabel = k > 0.75 || state.hovered === node.id || state.matched.has(node.id) || state.active === node.id
      node.label.setAttribute('font-size', (12 / k).toFixed(2))
      node.label.setAttribute('y', (r + 15 / k).toFixed(2))
      node.label.style.display = showLabel && !state.hiddenProjects.has(node.project) ? '' : 'none'
    }
    for (const line of linkLayer.childNodes) {
      const a = state.byId.get(line.dataset.source)
      const b = state.byId.get(line.dataset.target)
      if (a === undefined || b === undefined) continue
      line.setAttribute('x1', a.x.toFixed(2))
      line.setAttribute('y1', a.y.toFixed(2))
      line.setAttribute('x2', b.x.toFixed(2))
      line.setAttribute('y2', b.y.toFixed(2))
      line.setAttribute('stroke-width', ((line.classList.contains('graph-link-fork') ? 1.7 : 1.1) / k).toFixed(3))
    }
    updateEmphasis()
  }

  const visible = node => !state.hiddenProjects.has(node.project)

  const updateEmphasis = () => {
    const focus = state.matched.size > 0 ? state.matched : (state.hovered !== null ? new Set([state.hovered]) : null)
    const related = new Set()
    if (focus !== null) {
      for (const id of focus) {
        related.add(id)
        for (const neighbor of state.neighbors.get(id) ?? []) related.add(neighbor)
      }
    }
    for (const node of state.nodes) {
      const show = visible(node)
      node.group.style.display = show ? '' : 'none'
      if (!show) continue
      const dim = focus !== null && !related.has(node.id)
      node.group.classList.toggle('is-dim', dim)
      node.group.classList.toggle('is-match', state.matched.has(node.id))
      node.group.classList.toggle('is-active', state.active === node.id)
      node.group.classList.toggle('is-current', state.current === node.id)
      node.group.classList.toggle('is-pinned', node.pinned === true)
      if (dim) node.label.style.display = 'none'
      else if (k0() > 0.75 || state.hovered === node.id || state.matched.has(node.id) || state.active === node.id) node.label.style.display = ''
    }
    for (const line of linkLayer.childNodes) {
      const a = state.byId.get(line.dataset.source)
      const b = state.byId.get(line.dataset.target)
      if (a === undefined || b === undefined) continue
      const show = visible(a) && visible(b)
      line.style.display = show ? '' : 'none'
      if (focus !== null) {
        const hot = (focus.has(a.id) && related.has(b.id)) || (focus.has(b.id) && related.has(a.id))
        line.classList.toggle('is-hot', hot)
        line.style.opacity = hot ? '1' : '0.12'
      } else {
        line.classList.remove('is-hot')
        line.style.opacity = ''
      }
    }
  }

  const k0 = () => state.view.k

  const hover = (node, group) => {
    if (group !== undefined) group.classList.add('is-hover')
    updateEmphasis()
    showTooltip(node)
  }

  const unhover = () => {
    for (const node of state.nodes) node.group?.classList.remove('is-hover')
    updateEmphasis()
  }

  // -------------------------------------------------------------- tooltip ---

  const showTooltip = node => {
    const last = node.lastAt === null || node.lastAt === undefined ? '' : new Date(node.lastAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    tooltip.innerHTML = ''
    tooltip.append(el('div', { class: 'graph-tooltip-title', text: node.title }))
    const metaRow = el('div', { class: 'graph-tooltip-meta' }, tooltip)
    const dot = el('span', { class: 'graph-tooltip-dot' }, metaRow)
    dot.style.background = node.color
    metaRow.append(el('span', { text: node.project }))
    metaRow.append(el('span', { class: 'graph-tooltip-sep', text: '·' }))
    metaRow.append(el('span', { text: `${node.msgs} 条消息` }))
    if (last !== '') {
      metaRow.append(el('span', { class: 'graph-tooltip-sep', text: '·' }))
      metaRow.append(el('span', { text: last }))
    }
    if (node.questions.length > 0) tooltip.append(el('div', { class: 'graph-tooltip-q', text: node.questions[0] }))
    const reasons = state.edges
      .filter(edge => edge.reason !== undefined && (edge.source === node.id || edge.target === node.id))
      .map(edge => edge.reason)
    if (reasons.length > 0) tooltip.append(el('div', { class: 'graph-tooltip-link', text: `关联：${reasons.slice(0, 2).join(' / ')}` }))
    tooltip.append(el('div', { class: 'graph-tooltip-hint', text: '点击打开这个对话' }))
    tooltip.hidden = false
  }

  const hideTooltip = () => { tooltip.hidden = true }

  const moveTooltip = event => {
    if (tooltip.hidden) return
    const rect = shell.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const width = tooltip.offsetWidth
    const height = tooltip.offsetHeight
    tooltip.style.left = `${clamp(x + 14, 8, rect.width - width - 8)}px`
    tooltip.style.top = `${clamp(y - height - 12, 8, rect.height - height - 8)}px`
  }

  // --------------------------------------------------------------- search ---

  const scoreNode = (node, needle) => {
    const title = node.title.toLowerCase()
    if (title.startsWith(needle)) return 100
    if (title.includes(needle)) return 80
    if (node.project.toLowerCase().includes(needle)) return 55
    for (const question of node.questions) if (question.toLowerCase().includes(needle)) return 40
    return 0
  }

  const runSearch = () => {
    const needle = state.query.trim().toLowerCase()
    state.matched = new Set()
    if (needle === '') {
      results.hidden = true
      results.textContent = ''
      updateEmphasis()
      return
    }
    const scored = state.nodes
      .filter(node => visible(node))
      .map(node => ({ node, score: scoreNode(node, needle) }))
      .filter(hit => hit.score > 0)
      .sort((a, b) => b.score - a.score)
    for (const hit of scored) state.matched.add(hit.node.id)
    results.textContent = ''
    for (const hit of scored.slice(0, 8)) {
      const row = el('button', { class: 'graph-result', type: 'button' }, results)
      const marker = el('span', { class: 'graph-result-dot' }, row)
      marker.style.background = hit.node.color
      row.append(el('span', { class: 'graph-result-title', text: hit.node.title }))
      row.append(el('span', { class: 'graph-result-project', text: hit.node.project }))
      row.addEventListener('click', () => { openSession(hit.node) })
    }
    results.hidden = scored.length === 0
    if (scored.length === 0) results.append(el('div', { class: 'graph-result-empty', text: '没有匹配的对话' }))
    updateEmphasis()
    if (scored.length > 0 && state.matched.size <= 12) {
      // keep the view put; Enter recenters on the best hit
    }
  }

  // --------------------------------------------------------------- legend ---

  const renderLegend = () => {
    legend.textContent = ''
    if (state.projects.length === 0) { legend.hidden = true; return }
    legend.hidden = false
    for (const project of state.projects) {
      const count = state.nodes.filter(node => node.project === project.name).length
      const chip = el('button', { class: 'graph-chip', type: 'button', title: `只看/隐藏「${project.name}」` }, legend)
      const marker = el('span', { class: 'graph-chip-dot' }, chip)
      marker.style.background = project.color
      chip.append(el('span', { class: 'graph-chip-name', text: project.name }))
      chip.append(el('span', { class: 'graph-chip-count', text: String(count) }))
      chip.classList.toggle('is-off', state.hiddenProjects.has(project.name))
      chip.addEventListener('click', () => {
        if (state.hiddenProjects.has(project.name)) state.hiddenProjects.delete(project.name)
        else state.hiddenProjects.add(project.name)
        renderLegend()
        runSearch()
        updateEmphasis()
      })
    }
  }

  const updateStatus = () => {
    statusCount.textContent = `${state.nodes.length} 个对话 · ${state.edges.length} 条连线`
    const source = state.meta?.source
    statusSource.className = 'graph-status-source'
    if (source === 'ai' || source === 'ai-cached') {
      statusSource.textContent = source === 'ai' ? 'AI 已连线' : 'AI 连线（缓存）'
      statusSource.classList.add('is-ai')
    } else if (state.meta?.aiEnabled === true) {
      statusSource.textContent = '未连线 · 点「AI 连线」'
    } else {
      statusSource.textContent = '未连线 · 点「连线」'
    }
  }

  // ------------------------------------------------------------ interaction --

  const setView = (view) => {
    state.view = {
      x: view.x,
      y: view.y,
      k: clamp(view.k, 0.18, 5),
    }
    paintPositions()
  }

  const centerOn = node => {
    setView({ x: state.width / 2 - node.x * state.view.k, y: state.height / 2 - node.y * state.view.k, k: Math.max(state.view.k, 1.05) })
  }

  const fit = () => {
    if (state.nodes.length === 0) return
    const xs = state.nodes.map(node => node.x)
    const ys = state.nodes.map(node => node.y)
    const minX = Math.min(...xs); const maxX = Math.max(...xs)
    const minY = Math.min(...ys); const maxY = Math.max(...ys)
    const padX = 96
    const padTop = 96
    const padBottom = 84
    const k = clamp(Math.min(
      (state.width - padX * 2) / Math.max(maxX - minX, 1),
      (state.height - padTop - padBottom) / Math.max(maxY - minY, 1),
    ), 0.25, 1.4)
    setView({
      k,
      x: state.width / 2 - ((minX + maxX) / 2) * k,
      y: padTop + (state.height - padTop - padBottom) / 2 - ((minY + maxY) / 2) * k,
    })
  }

  const localPoint = event => {
    const rect = svg.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const screenToWorld = point => ({
    x: (point.x - state.view.x) / state.view.k,
    y: (point.y - state.view.y) / state.view.k,
  })

  // Two-finger pinch zoom + pan. `.graph-shell` sets `touch-action: none`, so the
  // browser never handles these gestures; we do, from the raw touch points. The
  // single-pointer handlers below bail out while a pinch owns the gesture.
  let pinch = null
  const touchDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  const touchMidpoint = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 })

  svg.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return
    event.preventDefault()
    // Take over from any single-pointer pan or node drag already running.
    state.panning = null
    if (state.dragging !== null) { state.dragging.dragging = false; state.dragging = null }
    svg.classList.remove('is-panning')
    state.suppressClick = true
    const [a, b] = event.touches
    const rect = svg.getBoundingClientRect()
    const mid = touchMidpoint(a, b)
    pinch = {
      distance: Math.max(touchDistance(a, b), 1),
      mid: { x: mid.x - rect.left, y: mid.y - rect.top },
      viewX: state.view.x,
      viewY: state.view.y,
      k: state.view.k,
    }
  }, { passive: false })

  svg.addEventListener('touchmove', event => {
    if (pinch === null || event.touches.length !== 2) return
    event.preventDefault()
    const [a, b] = event.touches
    const rect = svg.getBoundingClientRect()
    const distance = Math.max(touchDistance(a, b), 1)
    const mid = touchMidpoint(a, b)
    const local = { x: mid.x - rect.left, y: mid.y - rect.top }
    const k = clamp(pinch.k * (distance / pinch.distance), 0.18, 5)
    // Anchor the world point under the first midpoint, then let the midpoint's
    // own movement translate the view (this is the two-finger pan).
    const world = { x: (pinch.mid.x - pinch.viewX) / pinch.k, y: (pinch.mid.y - pinch.viewY) / pinch.k }
    setView({ k, x: local.x - world.x * k, y: local.y - world.y * k })
  }, { passive: false })

  const endPinch = event => {
    if (pinch === null) return
    if (event.touches.length < 2) {
      pinch = null
      // Swallow the stray click that a multi-touch release can synthesize.
      clearTimeout(state.suppressClickTimer)
      state.suppressClickTimer = setTimeout(() => { state.suppressClick = false }, 400)
    }
  }
  svg.addEventListener('touchend', endPinch, { passive: true })
  svg.addEventListener('touchcancel', endPinch, { passive: true })

  svg.addEventListener('wheel', event => {
    event.preventDefault()
    const point = localPoint(event)
    const factor = Math.exp((event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY) * -0.0016)
    const nextK = clamp(state.view.k * factor, 0.18, 5)
    const world = screenToWorld(point)
    setView({ k: nextK, x: point.x - world.x * nextK, y: point.y - world.y * nextK })
  }, { passive: false })

  svg.addEventListener('pointerdown', event => {
    if (pinch !== null) return
    if (event.target.closest?.('.graph-node') !== null && event.target.closest?.('.graph-node') !== undefined) return
    state.panning = { startX: event.clientX, startY: event.clientY, viewX: state.view.x, viewY: state.view.y }
    svg.setPointerCapture(event.pointerId)
    svg.classList.add('is-panning')
  })

  svg.addEventListener('pointermove', event => {
    if (pinch !== null) return
    moveTooltip(event)
    if (state.panning !== null) {
      setView({ k: state.view.k, x: state.panning.viewX + (event.clientX - state.panning.startX), y: state.panning.viewY + (event.clientY - state.panning.startY) })
      return
    }
    if (state.dragging !== null) {
      const world = screenToWorld(localPoint(event))
      const node = state.dragging
      node.x = world.x
      node.y = world.y
      node.vx = 0
      node.vy = 0
      if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) state.dragMoved = true
      paintPositions()
    }
  })

  const endPointer = event => {
    if (state.panning !== null) {
      state.panning = null
      svg.classList.remove('is-panning')
      try { svg.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    }
    if (state.dragging !== null) {
      state.dragging.dragging = false
      state.dragging.pinned = true
      state.dragging = null
      reheat()
      setTimeout(() => { state.dragMoved = false }, 0)
    }
  }
  svg.addEventListener('pointerup', endPointer)
  svg.addEventListener('pointercancel', endPointer)

  const beginNodeDrag = (event, node) => {
    if (pinch !== null) return
    event.stopPropagation()
    state.dragging = node
    node.dragging = true
    node.pinned = false
    state.dragMoved = false
    try { svg.setPointerCapture(event.pointerId) } catch { /* ignore */ }
    updateEmphasis()
  }

  svg.addEventListener('click', event => {
    if (event.target.closest?.('.graph-node') !== undefined && event.target.closest?.('.graph-node') !== null) return
    state.active = null
    updateEmphasis()
  })

  svg.addEventListener('dblclick', () => fit())

  // ------------------------------------------------------------- controls ---

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value
    runSearch()
  })

  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const needle = state.query.trim().toLowerCase()
      if (needle === '') return
      const best = state.nodes
        .filter(node => visible(node))
        .map(node => ({ node, score: scoreNode(node, needle) }))
        .sort((a, b) => b.score - a.score)[0]
      if (best !== undefined && best.score > 0) { state.active = best.node.id; centerOn(best.node); updateEmphasis() }
      else say('没有匹配的对话')
    }
    if (event.key === 'Escape') {
      searchInput.value = ''
      state.query = ''
      runSearch()
      searchInput.blur()
    }
  })

  searchClear.addEventListener('click', () => {
    searchInput.value = ''
    state.query = ''
    runSearch()
    searchInput.focus()
  })

  arrangeButton.addEventListener('click', () => {
    seedPositions()
    reheat()
    paintPositions()
  })

  fitButton.addEventListener('click', () => fit())

  aiButton.addEventListener('click', async () => {
    aiButton.disabled = true
    aiButton.classList.add('is-busy')
    say(state.meta?.aiEnabled === true ? '正在让 AI 判断关系…' : '正在按标题相似度连线…')
    const ok = await fetchGraph({ refresh: true })
    aiButton.disabled = false
    aiButton.classList.remove('is-busy')
    if (!ok) say('连线失败，请稍后再试')
    else if (state.meta?.source === 'ai') say('AI 连线完成')
    else if (state.meta?.source === 'ai-cached') say('连线完成（用缓存）')
    else say(state.meta?.aiEnabled === true ? 'AI 没能给出新的关系' : '已按标题相似度连线')
  })

  window.addEventListener('keydown', event => {
    if (event.key === '/' && document.activeElement !== searchInput) {
      event.preventDefault()
      searchInput.focus()
      searchInput.select()
    }
    if (event.key === 'Escape') hideTooltip()
  })

  window.addEventListener('resize', () => {
    state.width = shell.clientWidth
    state.height = shell.clientHeight
    paintPositions()
  })

  window.addEventListener('focus', () => { void fetchGraph() })

  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (data?.source !== 'dsh-synapse') return
    if (data.type === 'synapse:theme') {
      state.theme = data.dark === true ? 'dark' : 'light'
      document.documentElement.dataset.theme = state.theme
      return
    }
    if (data.type === 'synapse:current-session') {
      const id = data.session?.id
      state.current = typeof id === 'string' ? id : null
      updateEmphasis()
      return
    }
    if (data.type === 'synapse:workspaces' || data.type === 'synapse:created-session' || data.type === 'synapse:forked-session') {
      if (data.type !== 'synapse:workspaces') {
        const id = data.session?.id
        if (typeof id === 'string') state.pendingFocus = id
      }
      scheduleRefresh()
    }
  })

  let refreshTimer = null
  const scheduleRefresh = () => {
    if (refreshTimer !== null) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { refreshTimer = null; void fetchGraph() }, 1200)
  }

  // ---------------------------------------------------------------- boot ----

  const init = async () => {
    state.width = shell.clientWidth || window.innerWidth
    state.height = shell.clientHeight || window.innerHeight
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches === true) {
      state.theme = 'dark'
      document.documentElement.dataset.theme = 'dark'
    }
    const ok = await fetchGraph()
    if (!ok) say('读不到对话数据，请稍后重试')
    emptyState.hidden = state.nodes.length > 0
    post('synapse:map-ready')
    post('synapse:request-current')
    setInterval(() => { if (document.visibilityState === 'visible') void fetchGraph() }, REFRESH_INTERVAL_MS)
  }

  void init()
})()
