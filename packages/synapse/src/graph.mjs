/**
 * Synapse graph data layer.
 *
 * Turns the DSH session list plus the projected workspace store into a plain
 * node/edge graph for the Obsidian-style map: dots are conversations, links are
 * relationships. Links come from three sources:
 *
 *   fork  - DSH lineage (a forked/child session of another session)
 *   topic - local lexical similarity between session titles + opening questions
 *   ai    - a chat model asked to name the genuinely related session pairs
 *
 * The AI pass is optional and cached; every failure falls back to the local
 * graph so the map always renders.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const PROJECT_PALETTE = [
  '#4f7cff', '#e5563e', '#17a673', '#a855f7', '#e59f0b',
  '#0e9bb5', '#d946a0', '#6b7f99', '#7c9b2f', '#b45309',
]

const MAX_QUESTIONS = 4
const MAX_QUESTION_CHARS = 180
const TOPIC_EDGE_MIN = 0.34
const TOPIC_EDGES_PER_NODE = 2
const AI_TIMEOUT_MS = 60_000

export const AI_PRESETS = {
  deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKeyEnv: 'DEEPSEEK_API_KEY' },
  zhipu: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash', apiKeyEnv: 'ZHIPU_API_KEY' },
  xiaomi: { baseURL: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', apiKeyEnv: 'XIAOMI_API_KEY' },
}
// Cheapest-first order, tuned for latency: the 智谱 `*-flash` tier bills least
// but its reasoning models regularly take 40-80s on this prompt, so the fast
// (non-reasoning, ~1-2s) DeepSeek chat model leads and the rest are fallbacks.
const PRESET_ORDER = ['deepseek', 'zhipu', 'xiaomi']

/** Read the `refs:` map out of a DSH credentials file (tiny YAML subset). */
export async function readCredentialRefs(file) {
  try {
    const text = await readFile(file, 'utf8')
    const refs = {}
    let inRefs = false
    for (const line of text.split(/\r?\n/)) {
      if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
      if (!inRefs) continue
      if (/^\S/.test(line)) break
      const match = /^\s{2,}([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/.exec(line)
      if (match === null) continue
      const value = match[2].replace(/^["']|["']$/g, '')
      if (value !== '' && value !== 'null') refs[match[1]] = value
    }
    return refs
  } catch {
    return {}
  }
}

/**
 * Resolve the AI options once at plugin start. Returns null when no provider
 * key can be found, which makes the graph local-only.
 */
export async function resolveAiConfig(config, { dataFile }) {
  const configured = config ?? {}
  if (configured.enabled === false) return null
  const credentialsFile = typeof configured.credentialsFile === 'string' && configured.credentialsFile.trim() !== ''
    ? configured.credentialsFile.trim()
    : (typeof dataFile === 'string' && dataFile.length > 0 ? join(dirname(dataFile), '..', '.credentials.yaml') : null)
  const refs = credentialsFile === null ? {} : await readCredentialRefs(credentialsFile)
  const keyFor = name => {
    const fromEnv = typeof process.env[name] === 'string' ? process.env[name].trim() : ''
    if (fromEnv !== '') return fromEnv
    return typeof refs[name] === 'string' ? refs[name].trim() : ''
  }
  const explicit = typeof configured.provider === 'string' ? configured.provider.trim().toLowerCase() : ''
  const order = explicit !== '' && AI_PRESETS[explicit] !== undefined ? [explicit] : PRESET_ORDER
  for (const provider of order) {
    const preset = AI_PRESETS[provider]
    if (preset === undefined) continue
    const apiKey = typeof configured.apiKey === 'string' && configured.apiKey.trim() !== ''
      ? configured.apiKey.trim()
      : keyFor(configured.apiKeyEnv ?? preset.apiKeyEnv)
    if (apiKey === '') continue
    return {
      provider,
      apiKey,
      baseURL: String(configured.baseURL ?? preset.baseURL).replace(/\/+$/, ''),
      model: configured.model ?? preset.model,
    }
  }
  return null
}

const contentText = content => {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content.flatMap(block => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return []
    if (block?.type === 'tool-result') return contentText(block.content)
    return []
  }).filter(value => typeof value === 'string' && value.trim() !== '').join('\n')
}

const clip = (text, max) => {
  const flat = String(text ?? '').replaceAll(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const isRuntimeContext = text => {
  const trimmed = String(text ?? '').trimStart()
  return trimmed.startsWith('Current runtime context.') || trimmed.startsWith('<system-reminder')
}

const projectOf = cwd => {
  if (typeof cwd !== 'string' || cwd.trim() === '') return '未分组'
  const segment = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1)
  return segment === undefined || segment === '' ? '未分组' : segment
}

const nodeSize = msgs => Math.min(16, 4.5 + Math.sqrt(Math.max(msgs, 1)) * 1.6)

/**
 * Reduce one live Session to the plain facts the map needs. Reads only the
 * fields DSH already exposes; never throws on a partial session.
 */
export function sessionFacts(session) {
  const id = typeof session?.id === 'string' ? session.id : null
  if (id === null) return null
  let events = []
  try { events = [...session.snapshotEvents()] } catch { events = [] }
  const header = session?.header ?? {}
  const cwd = typeof header.cwd === 'string' && header.cwd !== ''
    ? header.cwd
    : (typeof header.meta?.cwd === 'string' ? header.meta.cwd : null)
  const parentId = typeof header.parentSession === 'string' ? header.parentSession : null
  // Subagent sessions (DSH delegation children) are execution detail behind a
  // user turn, not conversations the user talks to. DSH marks them with
  // `origin: "subagent"`; the map must never show them.
  const subagent = header.origin === 'subagent'
  let title = typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : null
  const questions = []
  let userCount = 0
  let assistantCount = 0
  let createdAt = Number.isFinite(header.createdAt) ? header.createdAt : null
  let lastAt = createdAt
  for (const event of events) {
    const at = Number.isFinite(event?.time) ? event.time : null
    if (at !== null) lastAt = lastAt === null ? at : Math.max(lastAt, at)
    if (event.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim() !== '') title = event.data.title.trim()
    if (event.type === 'user/message') {
      const text = contentText(event.data?.content)
      if (isRuntimeContext(text)) continue
      userCount += 1
      if (questions.length < MAX_QUESTIONS && text.trim() !== '') questions.push(clip(text, MAX_QUESTION_CHARS))
    }
    if (event.type === 'assistant/message') assistantCount += 1
  }
  return { id, sessionId: id, cwd, project: projectOf(cwd), parentId, subagent, title, questions, userCount, assistantCount, events: events.length, createdAt: createdAt ?? lastAt ?? null, lastAt: lastAt ?? null }
}

/**
 * A projected store thread is a subagent when it was flagged at projection time,
 * or — for data written before that flag existed — when its DSH session id
 * lacks the `session-` prefix every user-facing session id carries.
 */
const isSubagentThread = thread =>
  thread?.subagent === true
  || (typeof thread?.dshSessionId === 'string' && thread.dshSessionId !== '' && !thread.dshSessionId.startsWith('session-'))

/**
 * Merge live session facts with the projected store so a session that has not
 * streamed a title yet still gets one, and never loses the store's richer text.
 * Empty sessions (no message, no question) are dropped as noise.
 */
export function collectNodes(sessions, store) {
  const facts = []
  for (const session of sessions) {
    const fact = sessionFacts(session)
    if (fact !== null && !fact.subagent) facts.push(fact)
  }
  const factById = new Map(facts.map(fact => [fact.sessionId, fact]))
  const projectColors = new Map()
  const colorFor = project => {
    if (!projectColors.has(project)) projectColors.set(project, PROJECT_PALETTE[projectColors.size % PROJECT_PALETTE.length])
    return projectColors.get(project)
  }
  const nodes = []
  const seen = new Set()
  const add = input => {
    const msgs = (input.userCount ?? 0) + (input.assistantCount ?? 0)
    const title = (input.title ?? '').trim()
    // Drop blank shells: a session with no message at all is not a conversation.
    if (msgs === 0) return
    const sessionId = input.sessionId ?? null
    nodes.push({
      id: sessionId ?? input.threadId,
      sessionId,
      threadId: input.threadId ?? null,
      title: title || '未命名对话',
      project: input.project,
      cwd: input.cwd ?? null,
      parentId: input.parentId ?? null,
      questions: input.questions ?? [],
      userCount: input.userCount ?? 0,
      assistantCount: input.assistantCount ?? 0,
      msgs,
      createdAt: input.createdAt ?? null,
      lastAt: input.lastAt ?? null,
      color: colorFor(input.project),
      size: nodeSize(msgs),
    })
    if (sessionId !== null) seen.add(sessionId)
  }
  for (const workspace of store?.state?.workspaces ?? []) {
    for (const thread of workspace.threads ?? []) {
      if (isSubagentThread(thread)) continue
      const sessionId = typeof thread.dshSessionId === 'string' ? thread.dshSessionId : null
      if (sessionId === null) continue
      const fact = factById.get(sessionId) ?? null
      const messages = Array.isArray(thread.messages) ? thread.messages : []
      const storeQuestions = messages
        .filter(message => message.kind === 'user' && !isRuntimeContext(message.text))
        .slice(0, MAX_QUESTIONS)
        .map(message => clip(message.text, MAX_QUESTION_CHARS))
      add({
        sessionId,
        threadId: thread.id,
        title: fact?.title ?? thread.title,
        project: workspace.cwd === undefined || workspace.cwd === null ? '未分组' : projectOf(workspace.cwd),
        cwd: fact?.cwd ?? workspace.cwd ?? null,
        parentId: fact?.parentId ?? thread.parentId ?? null,
        questions: fact !== null && fact.questions.length > 0 ? fact.questions : storeQuestions,
        userCount: fact !== null && fact.userCount > 0 ? fact.userCount : messages.filter(message => message.kind === 'user').length,
        assistantCount: fact !== null && fact.assistantCount > 0 ? fact.assistantCount : messages.filter(message => message.kind === 'assistant').length,
        createdAt: fact?.createdAt ?? (Date.parse(thread.createdAt ?? '') || null),
        lastAt: fact?.lastAt ?? (Date.parse(thread.updatedAt ?? '') || null),
      })
    }
  }
  for (const fact of facts) {
    if (seen.has(fact.sessionId)) continue
    add({ sessionId: fact.sessionId, title: fact.title, project: fact.project, cwd: fact.cwd, parentId: fact.parentId, questions: fact.questions, userCount: fact.userCount, assistantCount: fact.assistantCount, createdAt: fact.createdAt, lastAt: fact.lastAt })
  }
  return { nodes, projects: [...projectColors.entries()].map(([name, color]) => ({ name, color })) }
}

/** Tokenize CJK as character bigrams and latin/digit runs as words. */
const tokenize = text => {
  const tokens = []
  const lower = String(text ?? '').toLowerCase()
  for (const run of lower.matchAll(/[a-z0-9_]{2,}/g)) tokens.push(run[0])
  for (const run of lower.matchAll(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g)) {
    const chars = [...run[0]]
    if (chars.length === 1) tokens.push(chars[0])
    for (let i = 0; i + 1 < chars.length; i += 1) tokens.push(`${chars[i]}${chars[i + 1]}`)
  }
  return tokens
}

/** Lexical similarity over titles + opening questions, idf-weighted cosine. */
export function localEdges(nodes) {
  const docs = nodes.map(node => {
    const counts = new Map()
    for (const token of tokenize([node.title, ...node.questions].join('\n'))) counts.set(token, (counts.get(token) ?? 0) + 1)
    return counts
  })
  const df = new Map()
  for (const counts of docs) for (const token of counts.keys()) df.set(token, (df.get(token) ?? 0) + 1)
  const total = Math.max(nodes.length, 1)
  const vectors = docs.map(counts => {
    const vector = new Map()
    let norm = 0
    for (const [token, count] of counts) {
      const weight = (1 + Math.log(count)) * Math.log(1 + total / (1 + (df.get(token) ?? 1)))
      vector.set(token, weight)
      norm += weight * weight
    }
    const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0
    for (const [token, weight] of vector) vector.set(token, weight * scale)
    return vector
  })
  const pairs = []
  for (let i = 0; i < nodes.length; i += 1) {
    const scored = []
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue
      const [small, large] = vectors[i].size <= vectors[j].size ? [vectors[i], vectors[j]] : [vectors[j], vectors[i]]
      let dot = 0
      for (const [token, weight] of small) {
        const other = large.get(token)
        if (other !== undefined) dot += weight * other
      }
      if (dot >= TOPIC_EDGE_MIN) scored.push([j, dot])
    }
    scored.sort((a, b) => b[1] - a[1])
    for (const [j, score] of scored.slice(0, TOPIC_EDGES_PER_NODE)) {
      if (j < i) continue
      pairs.push({ source: nodes[i].id, target: nodes[j].id, kind: 'topic', weight: Math.min(1, (score - TOPIC_EDGE_MIN) / (1 - TOPIC_EDGE_MIN) + 0.2) })
    }
  }
  return pairs
}

/** Lineage links straight from DSH's parentSession metadata. */
export function forkEdges(nodes) {
  const ids = new Set(nodes.map(node => node.id))
  return nodes
    .filter(node => typeof node.parentId === 'string' && ids.has(node.parentId))
    .map(node => ({ source: node.parentId, target: node.id, kind: 'fork', weight: 1 }))
}

const edgeKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

export const mergeEdges = (...lists) => {
  const merged = new Map()
  for (const list of lists) {
    for (const edge of list) {
      const key = edgeKey(edge.source, edge.target)
      const existing = merged.get(key)
      if (existing === undefined) { merged.set(key, { ...edge }); continue }
      if (edge.kind === 'fork') { merged.set(key, { ...existing, ...edge, weight: 1 }); continue }
      if (edge.kind === 'ai' && existing.kind !== 'fork') { merged.set(key, { ...existing, ...edge, weight: Math.max(existing.weight, edge.weight) }); continue }
      existing.weight = Math.max(existing.weight, edge.weight)
    }
  }
  return [...merged.values()]
}

const AI_SYSTEM_PROMPT = [
  '你在为一张“对话关系图”判断对话之间的关联。',
  '输入是若干条对话（id、所属项目、标题、开头提问）。',
  '输出严格为 JSON：{"links":[{"a":"<id>","b":"<id>","reason":"不超过12字的关系，如“同一课的前后两讲”","strength":1-3}]}',
  '只连接确实在讨论同一主题、同一课程、同一任务的对话；宁缺毋滥。',
  '不要连接仅因为属于同一项目的无关对话。最多给出 40 条，a/b 必须是输入里出现过的 id。',
].join('\n')

/**
 * One AI pass over the whole node set. Never throws: returns null so the caller
 * keeps the local graph.
 */
export async function aiEdges(nodes, ai) {
  if (ai === null || nodes.length < 2) return null
  const payload = nodes.map(node => ({
    id: node.id,
    project: node.project,
    title: clip(node.title, 60),
    q: node.questions.slice(0, 2).map(text => clip(text, 90)),
  }))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const url = `${ai.baseURL}/${/\/v\d+$/.test(ai.baseURL) ? '' : 'v1/'}chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ sessions: payload }) },
        ],
      }),
    })
    if (!response.ok) return null
    const body = await response.json()
    const text = body?.choices?.[0]?.message?.content
    if (typeof text !== 'string') return null
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    const parsed = JSON.parse(text.slice(start, end + 1))
    const ids = new Set(nodes.map(node => node.id))
    const edges = []
    for (const link of Array.isArray(parsed?.links) ? parsed.links : []) {
      const a = typeof link?.a === 'string' ? link.a : null
      const b = typeof link?.b === 'string' ? link.b : null
      if (a === null || b === null || a === b || !ids.has(a) || !ids.has(b)) continue
      const strength = Number.isFinite(Number(link.strength)) ? Math.min(3, Math.max(1, Number(link.strength))) : 2
      edges.push({ source: a, target: b, kind: 'ai', weight: 0.45 + (strength - 1) * 0.2, reason: typeof link.reason === 'string' ? clip(link.reason, 24) : undefined })
    }
    if (edges.length === 0) return null
    return { edges, model: `${ai.provider}/${ai.model}` }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Builds the payload the map renders. Nodes/links are recomputed only when the
 * session set actually moved; the AI pass additionally caches to disk so a
 * restart does not re-ask the model for an unchanged conversation set.
 */
export class GraphService {
  constructor({ store, ai, cacheFile }) {
    this.store = store
    this.ai = ai
    this.cacheFile = typeof cacheFile === 'string' && cacheFile !== '' ? cacheFile : null
    this.memory = null
    this.aiCache = undefined
    this.inflight = null
  }

  signature(sessions) {
    return sessions.map(session => {
      let seq = 0
      try { seq = Number(session?.seq ?? 0) } catch { seq = 0 }
      return `${session?.id ?? '?'}:${seq}:${session?.header?.cwd ?? ''}:${session?.header?.parentSession ?? ''}`
    }).sort().join('|')
  }

  async aiCacheRead() {
    if (this.aiCache !== undefined) return this.aiCache
    this.aiCache = null
    if (this.cacheFile !== null) {
      try { this.aiCache = JSON.parse(await readFile(this.cacheFile, 'utf8')) } catch { this.aiCache = null }
    }
    return this.aiCache
  }

  async aiCacheWrite(record) {
    this.aiCache = record
    if (this.cacheFile === null) return
    try {
      await mkdir(dirname(this.cacheFile), { recursive: true })
      const temporary = `${this.cacheFile}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(record)}\n`, 'utf8')
      await rename(temporary, this.cacheFile)
    } catch { /* the map still works without a warm cache */ }
  }

  async build(sessions, { connect = false } = {}) {
    const signature = this.signature(sessions)
    if (this.memory !== null && this.memory.signature === signature) return this.memory.payload
    return this.buildInner(sessions, signature, connect)
  }

  async buildInner(sessions, signature, connect) {
    try { await this.store?.ready } catch { /* fall through with an empty store */ }
    const { nodes, projects } = collectNodes(sessions, this.store)
    const idSet = new Set(nodes.map(node => node.id))
    // Lineage (a forked session -> its parent) is factual structure, so it is
    // always drawn. Topical/AI links are the "connections" the user asks for by
    // pressing the button, so a plain page load never computes or invents them.
    const lineage = forkEdges(nodes)
    const fingerprint = createHash('sha1')
      .update(nodes.map(node => `${node.id}|${node.title}|${node.msgs}|${node.lastAt ?? 0}`).sort().join('\n'))
      .digest('hex')
      .slice(0, 16)
    let edges = lineage
    let source = 'local'
    let model = null
    if (connect) {
      // Manual connect: the user asked for relationships now.
      let related = localEdges(nodes)
      if (this.ai !== null && nodes.length >= 2) {
        const result = await aiEdges(nodes, this.ai)
        if (result !== null) {
          related = mergeEdges(related, result.edges)
          model = result.model ?? null
          source = 'ai'
        }
      }
      edges = mergeEdges(lineage, related)
      await this.aiCacheWrite({ ids: [...idSet], model, generatedAt: Date.now(), edges: related })
    } else {
      // Plain load: only show the last manual result, never ask the provider.
      // Drop links that name a node which is gone now (e.g. a removed subagent
      // session) instead of discarding the whole cached set over one stale link.
      const cached = await this.aiCacheRead()
      const cachedEdges = cached !== null && Array.isArray(cached.edges)
        ? cached.edges.filter(edge => idSet.has(edge.source) && idSet.has(edge.target))
        : []
      if (cachedEdges.length > 0) {
        edges = mergeEdges(lineage, cachedEdges)
        source = 'ai-cached'
        model = cached.model ?? null
      }
    }
    const payload = {
      nodes,
      edges,
      projects,
      meta: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        source,
        model,
        aiEnabled: this.ai !== null,
        fingerprint,
        generatedAt: Date.now(),
      },
    }
    this.memory = { signature, payload }
    return payload
  }
}
