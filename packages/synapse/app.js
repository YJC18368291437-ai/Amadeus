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

  // Link softening: a link fades out as it meets a dot, and where two links
  // cross the lower-priority one is broken with a gap so the higher one reads
  // as passing over it (fork < topic < ai). Toggleable so it can be compared.
  const SOFTEN_KEY = 'dsh-synapse:soften:v1'
  const COLOR_KEY = 'dsh-synapse:colors:v1'
  const LAYERED_KEY = 'dsh-synapse:layered:v1'
  const ENDPOINT_FADE_PX = 30
  const CROSS_GAP_PX = 18
  const GLOW_WIDTH_FACTOR = 3.4
  const GLOW_OPACITY = 0.16
  const EDGE_KIND_RANK = { fork: 0, topic: 1, ai: 2 }
  const LINK_COLORS = {
    light: { topic: 'rgb(100,116,139)', fork: 'rgb(120,132,150)', hot: 'rgb(79,124,255)' },
    dark: { topic: 'rgb(160,168,180)', fork: 'rgb(170,178,192)', hot: 'rgb(120,160,255)' },
  }
  const LINK_ALPHA = {
    light: { topic: 0.45, fork: 0.7, hot: 0.9 },
    dark: { topic: 0.34, fork: 0.55, hot: 0.9 },
  }

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
    soften: true,
    edgeViews: [],
    // Layered mode ("分层聚合 · 渐进披露"): projects collapse into super nodes.
    // Expanding one lays its sessions on a ring (time order, selectable) around
    // a shrunk super node; clicking a session focuses it and reveals its related
    // sessions on small rings in other projects. Positions are computed and the
    // view eases toward them (Obsidian-like motion, not free force).
    layered: true,
    expanded: null,        // name of the single expanded project, or null
    rotation: 0,           // which session sits in the top selection slot
    focusId: null,         // focused session id, or null
    raw: null,
    didInitialFit: false,  // auto "全览" once, the first time nodes appear
    demoOverride: null,    // TEMP: when set, render a synthetic demo graph
    colorOverrides: {},    // project name -> hex, picked by the user
    keepIds: null,         // ring to keep after clearing focus (stay in place)
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
  const layeredButton = el('button', { class: 'graph-button is-layered', type: 'button', title: '分层：项目折成超级点，点开才展开（像 Obsidian 一样动画）' }, actions)
  layeredButton.append(el('span', { text: '分层' }))
  // TEMP: toggle a synthetic 6×30 demo graph for evaluating scale.
  const demoButton = el('button', { class: 'graph-button', type: 'button', title: '加载示例数据：6 个项目 × 每个 30 个对话（临时）' }, actions)
  demoButton.append(el('span', { text: '示例' }))
  const softenButton = el('button', { class: 'graph-button is-soften', type: 'button', title: '连线柔化：交叉处让下层线断开、端点渐隐' }, actions)
  softenButton.append(el('span', { text: '柔化' }))
  const fitButton = el('button', { class: 'graph-button', type: 'button', title: '缩放到全部对话' }, actions)
  fitButton.append(el('span', { text: '全览' }))

  const legend = el('div', { class: 'graph-legend' }, shell)
  const palettePop = el('div', { class: 'graph-palette', hidden: 'hidden' }, shell)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'graph-canvas')
  shell.appendChild(svg)
  const defs = document.createElementNS(SVG_NS, 'defs')
  svg.appendChild(defs)
  const viewport = document.createElementNS(SVG_NS, 'g')
  viewport.setAttribute('class', 'graph-viewport')
  svg.appendChild(viewport)
  const glowLayer = document.createElementNS(SVG_NS, 'g')
  glowLayer.setAttribute('class', 'graph-glows')
  viewport.appendChild(glowLayer)
  const linkLayer = document.createElementNS(SVG_NS, 'g')
  linkLayer.setAttribute('class', 'graph-links')
  viewport.appendChild(linkLayer)
  const boxLayer = document.createElementNS(SVG_NS, 'g')
  boxLayer.setAttribute('class', 'graph-boxes')
  viewport.appendChild(boxLayer)
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

  // TEMP demo: open the map as `/synapse/?demo=10x30` to render a synthetic
  // graph of 10 projects × 30 sessions (exercises the ring's 20-item window).
  const DEMO = (() => {
    const match = /[?&]demo=(\d+)x(\d+)/.exec(window.location.search)
    return match === null ? null : { projects: clamp(Number(match[1]), 1, 40), per: clamp(Number(match[2]), 1, 300) }
  })()
  const DEMO_PALETTE = ['#8aa0c4', '#c0908c', '#7fae97', '#a893c2', '#c2a173', '#7babb4', '#c294ac', '#8b93a3', '#98ab72', '#b3896f']
  const buildDemoPayload = (projects, per) => {
    const nodes = []
    const edges = []
    const list = []
    const now = Date.now()
    for (let p = 0; p < projects; p += 1) {
      const name = `科目 ${p + 1}`
      const color = DEMO_PALETTE[p % DEMO_PALETTE.length]
      list.push({ name, color })
      const ids = []
      for (let k = 0; k < per; k += 1) {
        const id = `demo-${p}-${k}`
        const msgs = 4 + ((p * 31 + k * 7) % 180)
        ids.push(id)
        nodes.push({
          id, sessionId: id, threadId: null, title: `${name} 对话 ${k + 1}`, project: name, color,
          msgs, size: Math.min(16, 4.5 + Math.sqrt(msgs) * 1.6), questions: [], userCount: 2, assistantCount: 2,
          lastAt: now - (k * 5 + p) * 3600 * 1000, parentId: null,
        })
      }
      for (let k = 0; k + 1 < per; k += 1) edges.push({ source: ids[k], target: ids[k + 1], kind: 'topic', weight: 0.5 })
      for (let k = 0; k + 5 < per; k += 7) edges.push({ source: ids[k], target: ids[k + 5], kind: 'fork', weight: 1 })
    }
    for (let p = 0; p < projects; p += 1) {
      edges.push({ source: `demo-${p}-0`, target: `demo-${(p + 3) % projects}-2`, kind: 'ai', weight: 0.85, reason: '同一主题' })
    }
    return {
      nodes, edges, projects: list,
      meta: { nodeCount: nodes.length, edgeCount: edges.length, source: 'ai', model: 'demo', aiEnabled: true, fingerprint: `demo-${projects}x${per}`, generatedAt: Date.now() },
    }
  }

  const fetchGraph = async ({ refresh = false } = {}) => {
    if (state.demoOverride !== null) {
      applyGraph(buildDemoPayload(state.demoOverride.projects, state.demoOverride.per), { rearrange: refresh })
      return true
    }
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

  // ---------------------------------------------------- layered view graph ---

  // -------------------------------------------------- layered ring layout ---

  const rawById = new Map()
  const RING_MAX = 20
  const RELATED_MAX = 19

  const byTimeDesc = list => list.slice().sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  const projectMembers = name => byTimeDesc(state.raw.nodes.filter(node => node.project === name))
  const colorOfProject = name => state.colorOverrides[name] ?? (state.projects.find(project => project.name === name)?.color) ?? '#64748b'
  const saveColors = () => { try { localStorage.setItem(COLOR_KEY, JSON.stringify(state.colorOverrides)) } catch { /* private mode */ } }
  const baseGroupSize = name => 34 + Math.sqrt(projectMembers(name).length) * 6

  const adjacency = () => {
    if (state.adjFor === state.raw && state.adj !== undefined) return state.adj
    const adj = new Map(state.raw.nodes.map(node => [node.id, new Set()]))
    for (const edge of state.raw.edges) {
      adj.get(edge.source)?.add(edge.target)
      adj.get(edge.target)?.add(edge.source)
    }
    state.adjFor = state.raw
    state.adj = adj
    return adj
  }

  /** Sessions in the same project most related to `id` (direct edge, then degree). */
  const relatedInProject = id => {
    const node = rawById.get(id)
    if (node === undefined) return []
    const adj = adjacency()
    const direct = new Map()
    for (const edge of state.raw.edges) {
      if (edge.source === id) direct.set(edge.target, Math.max(direct.get(edge.target) ?? 0, edge.weight ?? 0.5))
      else if (edge.target === id) direct.set(edge.source, Math.max(direct.get(edge.source) ?? 0, edge.weight ?? 0.5))
    }
    return state.raw.nodes
      .filter(other => other.project === node.project && other.id !== id)
      .map(other => ({ id: other.id, score: (direct.has(other.id) ? 100 + direct.get(other.id) * 50 : 0) + (adj.get(other.id)?.size ?? 0) }))
      .filter(hit => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, RELATED_MAX)
      .map(hit => hit.id)
  }

  const edgeKindBetween = (a, b) => {
    const edge = state.raw.edges.find(item => (item.source === a && item.target === b) || (item.source === b && item.target === a))
    return edge === undefined ? 'topic' : edge.kind
  }

  // Curve routing: bend every non-aggregate link into an arc and greedily pick
  // the bend direction that crosses the fewest already-routed links, so lines
  // stop sitting on top of each other and crossings are reduced.
  const CURVE_BOW = 0.16
  const curveSample = (a, b, bow) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const m = bow * CURVE_BOW * len
    const cx = (a.x + b.x) / 2 + (-dy / len) * m
    const cy = (a.y + b.y) / 2 + (dx / len) * m
    const pts = []
    for (let i = 0; i <= 6; i += 1) {
      const t = i / 6
      const u = 1 - t
      pts.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y })
    }
    return pts
  }
  const curvePath = (a, b, bow) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const m = bow * CURVE_BOW * len
    const cx = (a.x + b.x) / 2 + (-dy / len) * m
    const cy = (a.y + b.y) / 2 + (dx / len) * m
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
  }
  const segsProperCross = (p1, p2, p3, p4) => {
    const d = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  }
  const polyCross = (p, q) => {
    let count = 0
    for (let i = 0; i + 1 < p.length; i += 1) {
      for (let j = 0; j + 1 < q.length; j += 1) {
        if (segsProperCross(p[i], p[i + 1], q[j], q[j + 1])) count += 1
      }
    }
    return count
  }
  const routeEdges = (nodes, edges) => {
    const pos = new Map(nodes.map(node => [node.id, { x: node.tx ?? node.x ?? 0, y: node.ty ?? node.y ?? 0 }]))
    const routed = []
    for (const edge of edges) {
      const a = pos.get(edge.source)
      const b = pos.get(edge.target)
      if (a === undefined || b === undefined) { edge.bow = 0; continue }
      if (edge.radial === true) { edge.bow = 0; routed.push(curveSample(a, b, 0)); continue }
      const cw = routed.reduce((sum, q) => sum + polyCross(curveSample(a, b, 1), q), 0)
      const ccw = routed.reduce((sum, q) => sum + polyCross(curveSample(a, b, -1), q), 0)
      edge.bow = ccw < cw ? -1 : 1
      routed.push(curveSample(a, b, edge.bow))
    }
  }

  const layeredAnchors = (expanded, ringRadius) => {
    const names = state.projects.map(project => project.name)
    const anchors = new Map()
    if (expanded === null) {
      const radius = Math.max(150, Math.min(state.width, state.height) * 0.22)
      names.forEach((name, index) => {
        const angle = names.length === 1 ? 0 : (index / names.length) * Math.PI * 2
        anchors.set(name, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
      })
      return anchors
    }
    anchors.set(expanded, { x: 0, y: 0 })
    const others = names.filter(name => name !== expanded)
    const orbit = ringRadius + 175
    others.forEach((name, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(others.length, 1)) * Math.PI * 2
      anchors.set(name, { x: Math.cos(angle) * orbit, y: Math.sin(angle) * orbit })
    })
    return anchors
  }

  const groupNode = (name, { dim = false, scale = 1 } = {}) => {
    const members = projectMembers(name)
    return {
      id: `group:${name}`,
      isGroup: true,
      project: name,
      title: name,
      color: colorOfProject(name),
      count: members.length,
      msgs: members.reduce((sum, node) => sum + node.msgs, 0),
      size: baseGroupSize(name) * scale,
      sessionId: null,
      dim,
    }
  }

  const computeLayered = () => {
    const raw = state.raw
    const adj = adjacency()
    const projects = state.projects.map(project => project.name)
    const focusNode = state.focusId !== null ? rawById.get(state.focusId) : null
    const focusProject = focusNode?.project ?? null
    const expanded = state.expanded

    // Which sessions of the expanded project sit on the ring.
    let displayed = []
    let newestId = null
    const focusing = focusNode !== null && focusNode.project === expanded
    if (expanded !== null) {
      const members = projectMembers(expanded)
      newestId = members[0]?.id ?? null
      if (focusing) {
        displayed = [state.focusId, ...relatedInProject(state.focusId)].map(id => rawById.get(id)).filter(Boolean)
      } else if (state.keepIds !== null) {
        // Just cleared focus: keep the very same ring (and thus positions).
        displayed = state.keepIds.map(id => rawById.get(id)).filter(node => node !== undefined && node.project === expanded)
      }
      if (!focusing && displayed.length === 0) {
        const n = members.length
        const start = n === 0 ? 0 : ((state.rotation % n) + n) % n
        for (let i = 0; i < Math.min(RING_MAX, n); i += 1) displayed.push(members[(start + i) % n])
      }
    }
    const ringRadius = expanded === null ? 0 : Math.max(95, 30 + displayed.length * 17)
    const anchors = layeredAnchors(expanded, ringRadius)

    // Cross-project associations of the focused session (revealed on small rings).
    const associated = new Map()
    if (focusNode !== null) {
      for (const id of adj.get(state.focusId) ?? []) {
        const other = rawById.get(id)
        if (other === undefined || other.project === focusProject) continue
        if (!associated.has(other.project)) associated.set(other.project, [])
        associated.get(other.project).push(other)
      }
      for (const [name, list] of associated) associated.set(name, byTimeDesc(list).map(node => node.id))
    }

    // Nodes.
    const nodes = []
    if (expanded === null) {
      for (const name of projects) {
        const node = groupNode(name)
        const anchor = anchors.get(name)
        node.tx = anchor.x
        node.ty = anchor.y
        nodes.push(node)
      }
    } else {
      // The selected (expanded) super node grows to 1.3× its normal size.
      const hub = groupNode(expanded, { scale: 1.3 })
      hub.tx = 0
      hub.ty = 0
      hub.isHub = true
      nodes.push(hub)
      displayed.forEach((node, index) => {
        const angle = -Math.PI / 2 + (index / Math.max(displayed.length, 1)) * Math.PI * 2
        nodes.push({
          ...node,
          tx: Math.cos(angle) * ringRadius,
          ty: Math.sin(angle) * ringRadius,
          newest: node.id === newestId,
          onRing: true,
          focused: node.id === state.focusId,
        })
      })
      for (const name of projects) {
        if (name === expanded) continue
        const list = associated.get(name) ?? null
        const dim = focusNode !== null && list === null
        const group = groupNode(name, { dim })
        const anchor = anchors.get(name)
        group.tx = anchor.x
        group.ty = anchor.y
        nodes.push(group)
        if (list !== null) {
          const radius = 42 + list.length * 7
          list.forEach((id, index) => {
            const node = rawById.get(id)
            const angle = -Math.PI / 2 + (index / Math.max(list.length, 1)) * Math.PI * 2
            nodes.push({ ...node, tx: anchor.x + Math.cos(angle) * radius, ty: anchor.y + Math.sin(angle) * radius, revealed: true })
          })
        }
      }
    }

    // Edges.
    const edges = []
    if (expanded === null) {
      const agg = new Map()
      for (const edge of raw.edges) {
        const a = rawById.get(edge.source)
        const b = rawById.get(edge.target)
        if (a === undefined || b === undefined || a.project === b.project) continue
        const [x, y] = a.project < b.project ? [a.project, b.project] : [b.project, a.project]
        const key = `${x}|${y}`
        const current = agg.get(key) ?? { source: `group:${x}`, target: `group:${y}`, kind: 'aggregate', count: 0, weight: 0.1 }
        current.count += 1
        current.weight = Math.min(1, 0.15 + Math.log2(current.count + 1) / 4)
        agg.set(key, current)
      }
      for (const edge of agg.values()) edges.push(edge)
    } else {
      // While a super node is expanded, no aggregate lines between super nodes.
      // Only the selected (top-slot / focused) session shows its own lines, so
      // the ring never turns into a web.
      const shown = new Set(displayed.map(node => node.id))
      const activeId = displayed[0]?.id ?? null
      if (activeId !== null) {
        for (const edge of raw.edges) {
          if (edge.source !== activeId && edge.target !== activeId) continue
          if (shown.has(edge.source) && shown.has(edge.target)) edges.push(edge)
        }
      }
      if (focusNode !== null) {
        for (const list of associated.values()) {
          for (const id of list) edges.push({ source: state.focusId, target: id, kind: edgeKindBetween(state.focusId, id), weight: 0.85 })
        }
      }
    }
    routeEdges(nodes, edges)
    return { nodes, edges, ringRadius, hasFocus: focusNode !== null, expanded, topSlotId: displayed[0]?.id ?? null }
  }

  const viewSignature = () => `${state.nodes.map(node => node.id).sort().join(',')}|${state.edges.length}`

  /** Rebuild the on-screen graph: compute target positions, keep each node's
   *  current position (by id) so the view eases into the new layout. */
  const refreshLayout = ({ animate = false } = {}) => {
    state.hovered = null
    hideTooltip()
    const previous = new Map(state.nodes.map(node => [node.id, node]))
    const view = state.layered ? computeLayered() : { nodes: state.raw.nodes, edges: state.raw.edges }
    state.ringRadius = view.ringRadius ?? 0
    state.hasFocus = view.hasFocus ?? false
    state.topSlotId = view.topSlotId ?? null
    state.nodes = view.nodes.map(node => {
      const color = colorOfProject(node.project)
      const old = previous.get(node.id)
      if (old !== undefined) return { ...node, color, x: old.x, y: old.y, vx: 0, vy: 0, pinned: false }
      // A brand new node emerges from where its project's super node was.
      const seed = previous.get(`group:${node.project}`)
      const base = seed !== undefined ? seed : { x: node.tx, y: node.ty }
      return { ...node, color, x: base.x, y: base.y, vx: 0, vy: 0, pinned: false }
    })
    state.edges = view.edges
    buildIndex()
    renderLegend()
    // First time anything is drawn, auto-fit so the map is centred on open.
    if (!state.didInitialFit && state.nodes.length > 0) {
      state.didInitialFit = true
      state.fitPending = true
    }
    paint()
    updateStatus()
    startLoop()
  }

  const setExpanded = (name, { focus = null } = {}) => {
    state.expanded = name
    state.rotation = 0
    state.focusId = focus
    state.keepIds = null
    refreshLayout({ animate: true })
    if (name !== null) centerOnCluster()
    else state.fitPending = true
  }

  const toggleProject = name => {
    if (state.expanded === name) { setExpanded(null); say(`收起「${name}」`); return }
    setExpanded(name)
    say(`展开「${name}」`)
  }

  const focusSession = id => {
    const node = rawById.get(id)
    if (node === undefined) return
    state.expanded = node.project
    state.focusId = id
    state.rotation = 0
    state.keepIds = null
    refreshLayout({ animate: true })
  }

  // Clearing focus must NOT reset the view: keep the current ring (and all node
  // positions) as-is, just drop the revealed dots / focus highlight and put the
  // selection box back on the (previously focused) session.
  const clearFocus = () => {
    if (state.focusId === null) return
    // Point the rotation cursor at the focused session's place in time order, so
    // that rotating afterwards continues from here instead of jumping to newest.
    const node = rawById.get(state.focusId)
    if (node !== undefined) {
      const index = projectMembers(node.project).findIndex(member => member.id === state.focusId)
      if (index >= 0) state.rotation = index
    }
    state.keepIds = state.nodes.filter(item => item.onRing === true).map(item => item.id)
    state.focusId = null
    refreshLayout({ animate: true })
  }

  const rotateSelection = step => {
    if (!state.layered || state.expanded === null || state.focusId !== null) return
    const total = projectMembers(state.expanded).length
    if (total === 0) return
    state.keepIds = null
    state.rotation = (((state.rotation + step) % total) + total) % total
    refreshLayout()
  }

  /** Fit the view to the expanded cluster (hub + ring + orbiting super nodes). */
  const centerOnCluster = () => {
    if (state.expanded === null) return
    const span = (state.ringRadius + 260) * 2
    const k = clamp(Math.min(state.width, state.height) / span, 0.22, 1.15)
    setView({ k, x: state.width / 2, y: state.height / 2 })
  }

  const applyGraph = (payload, { rearrange = false } = {}) => {
    state.raw = {
      nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
      edges: Array.isArray(payload.edges) ? payload.edges : [],
    }
    state.projects = Array.isArray(payload.projects) ? payload.projects : []
    state.meta = payload.meta ?? {}
    rawById.clear()
    for (const node of state.raw.nodes) rawById.set(node.id, node)
    if (state.layered) {
      // A just-created session lives inside a collapsed group: open its project
      // and focus it so the new node is visible.
      if (state.pendingFocus != null) {
        const node = rawById.get(state.pendingFocus)
        if (node !== undefined) {
          state.expanded = node.project
          state.focusId = node.id
          state.keepIds = null
        }
      }
      refreshLayout({ animate: rearrange })
    } else {
      const before = viewSignature()
      const previous = new Map(state.nodes.map(node => [node.id, node]))
      state.nodes = state.raw.nodes.map(node => ({
        ...node,
        color: colorOfProject(node.project),
        x: previous.get(node.id)?.x ?? 0,
        y: previous.get(node.id)?.y ?? 0,
        vx: previous.get(node.id)?.vx ?? 0,
        vy: previous.get(node.id)?.vy ?? 0,
        pinned: previous.get(node.id)?.pinned ?? false,
      }))
      state.edges = state.raw.edges
      buildIndex()
      renderLegend()
      const changed = before !== viewSignature()
      if (!state.seeded && state.nodes.length > 0) { state.seeded = true; seedPositions(); reheat() }
      else if (rearrange) { seedPositions(); reheat() }
      else if (changed) reheat(0.5)
      paint()
      updateStatus()
      emptyState.hidden = state.nodes.length > 0
    }
    if (state.pendingFocus !== undefined && state.pendingFocus !== null) {
      const node = state.byId.get(state.pendingFocus)
      state.pendingFocus = null
      if (node !== undefined) centerOn(node)
    }
  }

  // ------------------------------------------------------------ simulation --

  const projectAnchors = () => {
    const anchors = new Map()
    const names = state.projects.length > 0
      ? state.projects.map(project => project.name)
      : [...new Set(state.nodes.map(node => node.project))]
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

  const reheat = (alpha = 1) => {
    state.alpha = Math.max(state.alpha, alpha)
    state.targetAlpha = 0
    startLoop()
  }

  /** Ease every node toward its computed target (layered mode). */
  const easeStep = () => {
    let moving = false
    for (const node of state.nodes) {
      const tx = node.tx ?? node.x
      const ty = node.ty ?? node.y
      const dx = tx - node.x
      const dy = ty - node.y
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) moving = true
      node.x += dx * 0.2
      node.y += dy * 0.2
    }
    return moving
  }

  let loopHandle = null
  const startLoop = () => {
    if (loopHandle !== null) return
    loopHandle = requestAnimationFrame(tick)
  }

  const tick = () => {
    loopHandle = null
    let moving
    if (state.layered) {
      moving = easeStep()
    } else {
      step()
      moving = state.alpha > 0.012
    }
    paintPositions()
    if (moving) {
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
      const rest = edge.kind === 'fork' ? 96 : edge.kind === 'aggregate' ? 240 : 150
      const spring = edge.kind === 'fork' ? 0.05 : edge.kind === 'aggregate' ? 0.012 : 0.02 * (0.6 + edge.weight)
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
    defs.textContent = ''
    glowLayer.textContent = ''
    linkLayer.textContent = ''
    boxLayer.textContent = ''
    nodeLayer.textContent = ''
    state.edgeViews = state.edges.map((edge, index) => {
      // Each link gets its own user-space gradient so it can fade out at both
      // endpoints. Stops carry the colour; stop-opacity carries the base and
      // the fade (0 at the ends, full a little way in).
      const gradientId = `edge-gradient-${index}`
      const gradient = document.createElementNS(SVG_NS, 'linearGradient')
      gradient.setAttribute('id', gradientId)
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse')
      const stops = [0, 1, 2, 3].map(() => {
        const stop = document.createElementNS(SVG_NS, 'stop')
        gradient.appendChild(stop)
        return stop
      })
      defs.appendChild(gradient)
      const tag = state.layered ? 'path' : 'line'
      const glow = document.createElementNS(SVG_NS, tag)
      glow.setAttribute('class', 'graph-glow')
      glow.dataset.source = edge.source
      glow.dataset.target = edge.target
      if (tag === 'path') glow.setAttribute('fill', 'none')
      glowLayer.appendChild(glow)
      const line = document.createElementNS(SVG_NS, tag)
      line.setAttribute('class', `graph-link graph-link-${edge.kind}`)
      line.dataset.source = edge.source
      line.dataset.target = edge.target
      if (tag === 'path') line.setAttribute('fill', 'none')
      line.style.stroke = `url(#${gradientId})`
      linkLayer.appendChild(line)
      return { edge, line, glow, gradient, stops, gaps: [], curved: tag === 'path' }
    })
    // Selection slot (fixed at the top of the ring while a project is expanded).
    state.boxEl = null
    if (state.layered && state.expanded !== null && state.focusId === null) {
      const box = document.createElementNS(SVG_NS, 'circle')
      box.setAttribute('class', 'graph-ring-box')
      boxLayer.appendChild(box)
      state.boxEl = box
    }
    for (const node of state.nodes) {
      const group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('class', 'graph-node')
      group.dataset.id = node.id
      const newest = document.createElementNS(SVG_NS, 'circle')
      newest.setAttribute('class', 'graph-node-newest')
      newest.style.display = node.newest === true ? '' : 'none'
      const halo = document.createElementNS(SVG_NS, 'circle')
      halo.setAttribute('class', 'graph-node-halo')
      const dot = document.createElementNS(SVG_NS, 'circle')
      dot.setAttribute('class', 'graph-node-dot')
      const label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('class', 'graph-node-label')
      label.setAttribute('text-anchor', 'middle')
      label.textContent = node.isGroup === true
        ? `${node.title} · ${node.count}`
        : (node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title)
      group.append(newest, halo, dot, label)
      group.addEventListener('pointerenter', () => { state.hovered = node.id; hover(node, group) })
      group.addEventListener('pointerleave', () => { state.hovered = null; unhover(); hideTooltip() })
      group.addEventListener('pointerdown', event => beginNodeDrag(event, node))
      group.addEventListener('click', event => {
        if (state.suppressClick === true) { state.suppressClick = false; return }
        if (state.dragMoved === true) { state.dragMoved = false; return }
        event.stopPropagation()
        if (node.isGroup === true) toggleProject(node.project)
        else if (state.layered) focusSession(node.id)
        else openSession(node)
      })
      group.addEventListener('dblclick', event => {
        event.stopPropagation()
        if (node.isGroup !== true) openSession(node)
      })
      nodeLayer.appendChild(group)
      node.group = group
      node.newestMark = newest
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
      node.newestMark.setAttribute('r', (r + 5 / k).toFixed(2))
      node.newestMark.setAttribute('fill', node.color)
      node.group.classList.toggle('is-faded', node.dim === true)
      node.group.classList.toggle('is-focused', node.focused === true)
      const small = node.onRing === true || node.revealed === true
      const hoveredLike = state.hovered === node.id || state.matched.has(node.id) || state.active === node.id
      const showLabel = !state.hiddenProjects.has(node.project) && (node.isGroup === true || hoveredLike || (k > 0.75 && !small))
      node.label.setAttribute('font-size', (12 / k).toFixed(2))
      node.label.setAttribute('y', (r + 15 / k).toFixed(2))
      node.label.style.display = showLabel ? '' : 'none'
    }
    if (state.boxEl !== null) {
      const top = state.byId.get(state.topSlotId)
      if (top !== undefined) {
        const r = nodeScreenRadius(top) / k
        state.boxEl.setAttribute('cx', top.x.toFixed(2))
        state.boxEl.setAttribute('cy', top.y.toFixed(2))
        state.boxEl.setAttribute('r', (r + 6 / k).toFixed(2))
        state.boxEl.setAttribute('stroke-width', (2 / k).toFixed(2))
      }
    }
    const soften = softEnabled()
    for (const view of state.edgeViews) {
      const { edge, line, glow, gradient, stops } = view
      const a = state.byId.get(edge.source)
      const b = state.byId.get(edge.target)
      if (a === undefined || b === undefined) continue
      const width = edge.kind === 'fork' ? 1.7 : edge.kind === 'aggregate' ? 1.2 + Math.sqrt(edge.count ?? 1) * 0.9 : 1.1
      if (view.curved === true) {
        const d = curvePath(a, b, edge.bow ?? 0)
        line.setAttribute('d', d)
        glow.setAttribute('d', d)
      } else {
        line.setAttribute('x1', a.x.toFixed(2))
        line.setAttribute('y1', a.y.toFixed(2))
        line.setAttribute('x2', b.x.toFixed(2))
        line.setAttribute('y2', b.y.toFixed(2))
        glow.setAttribute('x1', a.x.toFixed(2))
        glow.setAttribute('y1', a.y.toFixed(2))
        glow.setAttribute('x2', b.x.toFixed(2))
        glow.setAttribute('y2', b.y.toFixed(2))
      }
      line.setAttribute('stroke-width', (width / k).toFixed(3))
      glow.setAttribute('stroke-width', ((width * GLOW_WIDTH_FACTOR) / k).toFixed(3))
      gradient.setAttribute('x1', a.x.toFixed(2))
      gradient.setAttribute('y1', a.y.toFixed(2))
      gradient.setAttribute('x2', b.x.toFixed(2))
      gradient.setAttribute('y2', b.y.toFixed(2))
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const fade = soften ? clamp(ENDPOINT_FADE_PX / Math.max(length, 1), 0.04, 0.42) : 0
      stops[0].setAttribute('offset', '0')
      stops[0].setAttribute('stop-opacity', '0')
      stops[1].setAttribute('offset', fade.toFixed(4))
      stops[2].setAttribute('offset', (1 - fade).toFixed(4))
      stops[3].setAttribute('offset', '1')
      stops[3].setAttribute('stop-opacity', '0')
    }
    refreshWeave()
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
    for (const view of state.edgeViews) {
      const a = state.byId.get(view.edge.source)
      const b = state.byId.get(view.edge.target)
      if (a === undefined || b === undefined) continue
      const show = visible(a) && visible(b)
      view.line.style.display = show ? '' : 'none'
      view.glow.style.display = show && softEnabled() ? '' : 'none'
      if (focus !== null) {
        const hot = (focus.has(a.id) && related.has(b.id)) || (focus.has(b.id) && related.has(a.id))
        view.line.classList.toggle('is-hot', hot)
        view.line.style.opacity = hot ? '1' : '0.12'
        view.glow.style.opacity = hot ? '' : '0.12'
        setEdgeColor(view, hot)
      } else {
        view.line.classList.remove('is-hot')
        view.line.style.opacity = ''
        view.glow.style.opacity = ''
        setEdgeColor(view, false)
      }
    }
    refreshWeave()
  }

  const k0 = () => state.view.k

  // ------------------------------------------------------- link softening ---

  const softEnabled = () => state.soften !== false

  const refreshSoftenButton = () => {
    softenButton.classList.toggle('is-off', !softEnabled())
    softenButton.setAttribute('aria-pressed', softEnabled() ? 'true' : 'false')
  }

  const refreshLayeredButton = () => {
    layeredButton.classList.toggle('is-off', !state.layered)
    layeredButton.setAttribute('aria-pressed', state.layered ? 'true' : 'false')
  }

  /** Paint one link's gradient stops for its normal or highlighted colour. */
  const setEdgeColor = (view, hot) => {
    const palette = LINK_COLORS[state.theme] ?? LINK_COLORS.light
    const alpha = LINK_ALPHA[state.theme] ?? LINK_ALPHA.light
    const kind = view.edge.kind
    const color = hot ? palette.hot : (kind === 'fork' ? palette.fork : palette.topic)
    const opacity = hot ? alpha.hot : (kind === 'fork' ? alpha.fork : alpha.topic)
    for (const stop of view.stops) stop.setAttribute('stop-color', color)
    view.stops[1].setAttribute('stop-opacity', String(opacity))
    view.stops[2].setAttribute('stop-opacity', String(opacity))
    view.glow.setAttribute('stroke', color)
    view.glow.setAttribute('stroke-opacity', String(GLOW_OPACITY))
  }

  const segmentCrossParam = (a, b, c, d) => {
    const rx = b.x - a.x
    const ry = b.y - a.y
    const sx = d.x - c.x
    const sy = d.y - c.y
    const denom = rx * sy - ry * sx
    if (Math.abs(denom) < 1e-9) return null
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
    return { t, u }
  }

  /** Which of two crossing links gets the gap (the other reads as on top). */
  const underEdge = (v1, v2) => {
    const r1 = EDGE_KIND_RANK[v1.edge.kind] ?? 1
    const r2 = EDGE_KIND_RANK[v2.edge.kind] ?? 1
    if (r1 !== r2) return r1 < r2 ? v1 : v2
    // Same kind: the lighter connection goes under; ties fall to the later one.
    const w1 = Number.isFinite(v1.edge.weight) ? v1.edge.weight : 0.5
    const w2 = Number.isFinite(v2.edge.weight) ? v2.edge.weight : 0.5
    if (w1 < w2) return v1
    if (w2 < w1) return v2
    return v2
  }

  /**
   * Dash pattern for a link: solid links break only at crossings; dashed (AI)
   * links keep their base rhythm and widen it into a gap at each crossing.
   */
  const buildDashPattern = (length, centers, baseDash) => {
    const pattern = []
    let cursor = 0
    const emit = span => {
      if (span <= 0.01) { pattern.push(0); return }
      if (baseDash <= 0) { pattern.push(span); return }
      let pos = 0
      while (pos < span - 0.01) {
        const on = Math.min(baseDash, span - pos)
        pattern.push(on)
        pos += on
        if (pos < span - 0.01) {
          const off = Math.min(baseDash, span - pos)
          pattern.push(off)
          pos += off
        }
      }
    }
    for (const center of centers) {
      const start = Math.max(cursor, center - CROSS_GAP_PX / 2)
      const end = Math.min(length, center + CROSS_GAP_PX / 2)
      if (end <= start) continue
      emit(start - cursor)
      pattern.push(end - start)
      cursor = end
    }
    emit(length - cursor)
    return pattern
  }

  // Break the lower link at each crossing so the map reads as woven, not mashed.
  const refreshWeave = () => {
    if (state.edgeViews.length === 0) return
    // Curved layered links are routed to avoid crossings instead of being
    // broken with weave gaps.
    if (state.layered) return
    for (const view of state.edgeViews) {
      view.gaps = []
      view.line.removeAttribute('stroke-dasharray')
    }
    if (!softEnabled()) return
    const focus = state.matched.size > 0 ? state.matched : (state.hovered !== null ? new Set([state.hovered]) : null)
    const related = new Set()
    if (focus !== null) {
      for (const id of focus) {
        related.add(id)
        for (const neighbor of state.neighbors.get(id) ?? []) related.add(neighbor)
      }
    }
    const active = []
    for (const view of state.edgeViews) {
      const a = state.byId.get(view.edge.source)
      const b = state.byId.get(view.edge.target)
      if (a === undefined || b === undefined) continue
      if (!visible(a) || !visible(b)) continue
      if (focus !== null) {
        const hot = (focus.has(a.id) && related.has(b.id)) || (focus.has(b.id) && related.has(a.id))
        if (!hot) continue
      }
      active.push(view)
    }
    for (let i = 0; i < active.length; i += 1) {
      const v1 = active[i]
      const a = state.byId.get(v1.edge.source)
      const b = state.byId.get(v1.edge.target)
      for (let j = i + 1; j < active.length; j += 1) {
        const v2 = active[j]
        const c = state.byId.get(v2.edge.source)
        const d = state.byId.get(v2.edge.target)
        const hit = segmentCrossParam(a, b, c, d)
        if (hit === null) continue
        const under = underEdge(v1, v2)
        if (under === null) continue
        under.gaps.push(under === v1 ? hit.t : hit.u)
      }
    }
    for (const view of active) {
      if (view.gaps.length === 0) continue
      const a = state.byId.get(view.edge.source)
      const b = state.byId.get(view.edge.target)
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length < 1) continue
      const gaps = view.gaps.map(t => t * length).sort((x, y) => x - y)
      const baseDash = view.edge.kind === 'ai' ? 4 : 0
      const pattern = buildDashPattern(length, gaps, baseDash)
      view.line.setAttribute('stroke-dasharray', pattern.map(value => value.toFixed(2)).join(' '))
    }
  }

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
    const questions = Array.isArray(node.questions) ? node.questions : []
    if (questions.length > 0) tooltip.append(el('div', { class: 'graph-tooltip-q', text: questions[0] }))
    const reasons = state.edges
      .filter(edge => edge.reason !== undefined && (edge.source === node.id || edge.target === node.id))
      .map(edge => edge.reason)
    if (reasons.length > 0) tooltip.append(el('div', { class: 'graph-tooltip-link', text: `关联：${reasons.slice(0, 2).join(' / ')}` }))
    tooltip.append(el('div', { class: 'graph-tooltip-hint', text: node.isGroup === true ? '点击展开 / 收起这个项目' : '点击打开这个对话' }))
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
    for (const question of node.questions ?? []) if (question.toLowerCase().includes(needle)) return 40
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
    const pool = state.layered && state.raw !== null ? state.raw.nodes : state.nodes
    const scored = pool
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
      row.addEventListener('click', () => {
        if (state.layered) focusSession(hit.node.id)
        else openSession(hit.node)
      })
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
      const source = state.layered && state.raw !== null ? state.raw.nodes : state.nodes
      const count = source.filter(node => node.project === project.name).length
      const color = colorOfProject(project.name)
      const chip = el('div', { class: 'graph-chip' }, legend)
      chip.dataset.project = project.name
      chip.classList.toggle('is-off', state.hiddenProjects.has(project.name))
      // Swatch button opens a small palette (preset low-sat colours + custom).
      const dot = el('button', { class: 'graph-chip-dot', type: 'button', title: `给「${project.name}」选颜色` }, chip)
      dot.style.background = color
      dot.addEventListener('click', event => { event.stopPropagation(); openPalette(project.name, dot) })
      const toggle = el('button', { class: 'graph-chip-label', type: 'button', title: `只看/隐藏「${project.name}」` }, chip)
      toggle.append(el('span', { class: 'graph-chip-name', text: project.name }))
      toggle.append(el('span', { class: 'graph-chip-count', text: String(count) }))
      toggle.addEventListener('click', () => {
        if (state.hiddenProjects.has(project.name)) state.hiddenProjects.delete(project.name)
        else state.hiddenProjects.add(project.name)
        renderLegend()
        runSearch()
        updateEmphasis()
      })
    }
  }

  // -------------------------------------------------------------- palette ---

  const PRESET_COLORS = [
    '#8aa0c4', '#7fae97', '#a893c2', '#c2a173', '#c0908c', '#7babb4',
    '#c294ac', '#8b93a3', '#98ab72', '#b3896f', '#7d9e8a', '#b0a06a',
    '#9a8fb0', '#c79a86', '#6f9fae', '#a0a86f', '#bd8f9e', '#9299a8',
  ]
  const setProjectColor = (name, hex) => {
    state.colorOverrides[name] = hex
    saveColors()
    for (const node of state.nodes) node.color = colorOfProject(node.project)
    paintPositions()
    for (const chip of legend.querySelectorAll('.graph-chip')) {
      if (chip.dataset.project === name) {
        const dot = chip.querySelector('.graph-chip-dot')
        if (dot !== null) dot.style.background = colorOfProject(name)
      }
    }
  }
  const closePalette = () => { palettePop.hidden = true }

  const openPalette = (name, anchor) => {
    palettePop.textContent = ''
    for (const hex of PRESET_COLORS) {
      const swatch = el('button', { class: 'graph-swatch', type: 'button', title: hex }, palettePop)
      swatch.style.background = hex
      swatch.addEventListener('click', () => { setProjectColor(name, hex); closePalette() })
    }
    const custom = el('label', { class: 'graph-swatch graph-swatch-custom', title: '自定义颜色…' }, palettePop)
    custom.append(el('span', { text: '＋' }))
    const input = el('input', { type: 'color', class: 'graph-palette-input' }, custom)
    const current = colorOfProject(name)
    input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#888888'
    input.addEventListener('input', () => setProjectColor(name, input.value))
    const reset = el('button', { class: 'graph-swatch graph-swatch-reset', type: 'button', title: '恢复默认色' }, palettePop)
    reset.append(el('span', { text: '↺' }))
    reset.addEventListener('click', () => { delete state.colorOverrides[name]; saveColors(); setProjectColor(name, colorOfProject(name)); closePalette() })

    const shellRect = shell.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    palettePop.hidden = false
    const width = palettePop.offsetWidth
    const height = palettePop.offsetHeight
    const left = clamp(rect.left - shellRect.left, 8, shellRect.width - width - 8)
    let top = rect.top - shellRect.top - height - 8
    if (top < 8) top = rect.bottom - shellRect.top + 8
    palettePop.style.left = `${left}px`
    palettePop.style.top = `${top}px`
  }

  const updateStatus = () => {
    if (state.layered && state.raw !== null) {
      const total = state.raw.nodes.length
      if (state.expanded !== null) {
        const ring = state.nodes.filter(node => node.onRing === true).length
        const revealed = state.nodes.filter(node => node.revealed === true).length
        statusCount.textContent = `${state.expanded}：${ring}/${projectMembers(state.expanded).length}${revealed > 0 ? ` · 关联 ${revealed}` : ''}${state.focusId !== null ? ' · 聚焦中' : ''}`
      } else {
        const groups = state.nodes.filter(node => node.isGroup === true).length
        statusCount.textContent = `${total} 个对话 · ${groups} 个项目`
      }
    } else {
      statusCount.textContent = `${state.nodes.length} 个对话 · ${state.edges.length} 条连线`
    }
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
    // The wheel only zooms; ring rotation is done with the Up/Down arrow keys
    // (a Magic-Keyboard trackpad's two-finger scroll fires wheel events, and we
    // don't want it to spin the ring).
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
    if (state.layered) return // positions are computed; dragging is disabled here
    event.stopPropagation()
    state.dragging = node
    node.dragging = true
    node.pinned = false
    state.dragMoved = false
    // Do NOT capture the pointer on the <svg>: capture retargets the follow-up
    // `click` to the svg, so the node's own click handler would never fire (the
    // canvas already covers the whole shell, so moves still reach it regardless).
    updateEmphasis()
  }

  svg.addEventListener('click', event => {
    if (event.target.closest?.('.graph-node') !== undefined && event.target.closest?.('.graph-node') !== null) return
    state.active = null
    if (state.layered && state.focusId !== null) clearFocus()
    else updateEmphasis()
  })

  svg.addEventListener('dblclick', event => {
    if (event.target.closest?.('.graph-node') === undefined || event.target.closest?.('.graph-node') === null) fit()
  })

  // ------------------------------------------------------------- controls ---

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value
    runSearch()
  })

  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const needle = state.query.trim().toLowerCase()
      if (needle === '') return
      const pool = state.layered && state.raw !== null ? state.raw.nodes : state.nodes
      const best = pool
        .filter(node => visible(node))
        .map(node => ({ node, score: scoreNode(node, needle) }))
        .sort((a, b) => b.score - a.score)[0]
      if (best !== undefined && best.score > 0) {
        if (state.layered) {
          searchInput.blur()
          focusSession(best.node.id)
        } else {
          state.active = best.node.id
          centerOn(best.node)
          updateEmphasis()
        }
      } else say('没有匹配的对话')
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

  softenButton.addEventListener('click', () => {
    state.soften = !softEnabled()
    try { localStorage.setItem(SOFTEN_KEY, state.soften ? '1' : '0') } catch { /* private mode */ }
    refreshSoftenButton()
    paint()
    say(state.soften ? '连线柔化：开' : '连线柔化：关')
  })

  layeredButton.addEventListener('click', () => {
    state.layered = !state.layered
    try { localStorage.setItem(LAYERED_KEY, state.layered ? '1' : '0') } catch { /* private mode */ }
    refreshLayeredButton()
    state.expanded = null
    state.focusId = null
    state.rotation = 0
    state.keepIds = null
    if (!state.layered) { state.seeded = false; seedPositions(); reheat() }
    refreshLayout({ animate: true })
    say(state.layered ? '分层视图：开（项目折成超级点）' : '分层视图：关（显示全部对话）')
  })

  const refreshDemoButton = () => {
    const on = state.demoOverride !== null
    demoButton.classList.toggle('is-off', !on)
    demoButton.querySelector('span').textContent = on ? '退出示例' : '示例'
  }
  demoButton.addEventListener('click', () => {
    const off = state.demoOverride !== null
    state.demoOverride = off ? null : { projects: 6, per: 30 }
    state.expanded = null
    state.focusId = null
    state.rotation = 0
    state.keepIds = null
    state.didInitialFit = false
    refreshDemoButton()
    void fetchGraph()
    say(off ? '已回到真实数据' : '示例数据：6 个项目 × 每个 30 个对话')
  })

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
    const typing = document.activeElement === searchInput
    if (!typing && state.layered && state.expanded !== null) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (state.focusId === null) {
          event.preventDefault()
          rotateSelection(event.key === 'ArrowDown' ? 1 : -1)
          return
        }
      }
      // Enter focuses the selected session; pressing it again clears focus.
      if (event.key === 'Enter') {
        event.preventDefault()
        if (state.focusId !== null) clearFocus()
        else if (state.topSlotId !== null) focusSession(state.topSlotId)
        return
      }
    }
    if (event.key === '/' && document.activeElement !== searchInput) {
      event.preventDefault()
      searchInput.focus()
      searchInput.select()
    }
    if (event.key === 'Escape') {
      if (state.layered && state.focusId !== null) clearFocus()
      closePalette()
      hideTooltip()
    }
  })

  document.addEventListener('pointerdown', event => {
    if (palettePop.hidden) return
    if (palettePop.contains(event.target)) return
    const dot = event.target.closest?.('.graph-chip-dot')
    if (dot !== null && dot !== undefined) return
    closePalette()
  }, true)

  window.addEventListener('resize', () => {
    state.width = shell.clientWidth
    state.height = shell.clientHeight
    // Desktop windows get resized a lot — keep the map centred.
    if (state.layered && state.nodes.length > 0) {
      if (state.expanded !== null) centerOnCluster()
      else { state.fitPending = true; startLoop() }
    }
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
      // Link gradients bake the colours in, so repaint to pick up the theme.
      paint()
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
    try {
      const saved = localStorage.getItem(SOFTEN_KEY)
      if (saved === '0') state.soften = false
      const savedLayered = localStorage.getItem(LAYERED_KEY)
      if (savedLayered === '0') state.layered = false
      const savedColors = localStorage.getItem(COLOR_KEY)
      if (savedColors !== null) state.colorOverrides = JSON.parse(savedColors) ?? {}
    } catch { /* private mode */ }
    if (DEMO !== null) state.demoOverride = { projects: DEMO.projects, per: DEMO.per }
    refreshSoftenButton()
    refreshLayeredButton()
    refreshDemoButton()
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
