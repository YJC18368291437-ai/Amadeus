import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFacts, collectNodes } from '../packages/synapse/src/graph.mjs';

/** Minimal stand-in for a live DSH session: just the fields the graph reads. */
const session = (id, { origin, parentSession, cwd = '/mnt/d/学习/c', title, users = [], assistants = 0 } = {}) => ({
  id,
  title,
  header: {
    version: 4,
    id,
    cwd,
    ...(origin === undefined ? {} : { origin }),
    ...(parentSession === undefined ? {} : { parentSession }),
  },
  snapshotEvents() {
    return [
      ...users.map((text, i) => ({ type: 'user/message', seq: i + 1, time: 1000 + i, data: { content: [{ type: 'text', text }] } })),
      ...Array.from({ length: assistants }, (_, i) => ({ type: 'assistant/message', seq: 100 + i, time: 2000 + i, data: {} })),
    ];
  },
});

const thread = (dshSessionId, patch = {}) => ({
  id: `thread-${dshSessionId}`,
  dshSessionId,
  title: '线程',
  parentId: null,
  messages: [
    { kind: 'user', text: '问题' },
    { kind: 'assistant', text: '回答' },
  ],
  ...patch,
});

test('sessionFacts flags a subagent-origin session', () => {
  const parent = session('session-1', { users: ['hi'] });
  const child = session('222c0dde', { origin: 'subagent', parentSession: 'session-1', users: ['delegate'] });
  assert.equal(sessionFacts(parent).subagent, false);
  assert.equal(sessionFacts(child).subagent, true);
});

test('collectNodes drops live subagent sessions from the map', () => {
  const sessions = [
    session('session-1', { title: '正常对话', users: ['你好'], assistants: 1 }),
    session('222c0dde', { origin: 'subagent', parentSession: 'session-1', title: '子智能体', users: ['干活'], assistants: 1 }),
  ];
  const { nodes } = collectNodes(sessions, { state: { workspaces: [] } });
  assert.deepEqual(nodes.map(node => node.id), ['session-1']);
});

test('collectNodes drops store threads flagged as subagent', () => {
  const store = { state: { workspaces: [{ cwd: '/mnt/d/学习/c', threads: [
    thread('session-1'),
    thread('41c2e5d2', { subagent: true }),
  ] }] } };
  const { nodes } = collectNodes([], store);
  assert.deepEqual(nodes.map(node => node.id), ['session-1']);
});

test('collectNodes drops legacy subagent threads by the missing session- prefix', () => {
  const store = { state: { workspaces: [{ cwd: '/mnt/d/学习/c', threads: [
    thread('session-1'),
    thread('aab6ec37'), // written before the subagent flag existed
  ] }] } };
  const { nodes } = collectNodes([], store);
  assert.deepEqual(nodes.map(node => node.id), ['session-1']);
});
