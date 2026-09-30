import React, { useEffect, useRef } from 'react';

/** Synapse client half: mounts the non-linear conversation map as a native
 *  `conversation.view` tab (between 对话 and 轨迹) and bridges it to DSH's
 *  client services over the iframe's postMessage protocol. */

export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'fileUpload', 'uiConversation'];

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// While the map view is mounted, hide DSH's native chat composer so the canvas
// fills the whole conversation area (the map has its own per-card composer).
const SYNAPSE_ACTIVE_ATTR = 'data-amadeus-synapse-active';
const COMPOSER_HIDE_STYLE_ID = 'amadeus-synapse-hide-composer';

const ensureComposerHideStyle = () => {
  if (typeof document === 'undefined' || document.getElementById(COMPOSER_HIDE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = COMPOSER_HIDE_STYLE_ID;
  style.textContent = `html[${SYNAPSE_ACTIVE_ATTR}] [data-conversation-region="composer"]{display:none!important}`;
  (document.head || document.documentElement).append(style);
};

const isDark = () => document.body?.hasAttribute?.('data-ds-dark-theme') === true;

/** The session the main view currently holds (DSH 0.1.7 has no list `current`). */
const currentSession = ctx => {
  const snapshot = ctx.sessions.list.getSnapshot();
  const id = Object.values(snapshot.byId).find(summary => (summary?.retainedBy?.mainView ?? 0) > 0)?.id;
  if (id === undefined) return null;
  const session = snapshot.byId[id];
  return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null };
};

const sessionSnapshot = ctx => {
  const snapshot = ctx.sessions.list.getSnapshot();
  return snapshot.ids.map(id => {
    const session = snapshot.byId[id];
    return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null, blank: session.blank };
  }).filter(Boolean);
};

const workspaceSnapshot = ctx => {
  const sessions = ctx.sessions.list.getSnapshot();
  const snapshot = ctx.workspaces.list.getSnapshot();
  const accounted = new Set(snapshot.items.flatMap(workspace => workspace.sessionIds));
  return [
    ...snapshot.items.map(workspace => ({ id: workspace.workspaceId, title: workspace.title, path: workspace.path, sessionIds: [...workspace.sessionIds] })),
    { id: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: sessions.ids.filter(id => !accounted.has(id)) },
  ];
};

const fileToBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    const comma = text.indexOf(',');
    resolve(comma === -1 ? '' : text.slice(comma + 1));
  };
  reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
  reader.readAsDataURL(file);
});

export function apply(ctx) {
  let frame = null;
  const origin = window.location.origin;
  const send = (type, payload) => {
    const target = frame?.contentWindow;
    if (target) target.postMessage({ source: 'dsh-synapse', type, ...payload }, origin);
  };

  const prompt = async (sessionId, text, files = []) => {
    const scope = ctx.sessions.scope(sessionId);
    const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope);
    if (session === undefined) throw new Error('关联的 DSH 会话已不可用');
    const content = [];
    for (const file of files) {
      if (IMAGE_TYPES.has(file.type)) {
        const data = await fileToBase64(file);
        content.push({ type: 'image', mediaType: file.type, data, ...(file.name ? { name: file.name } : {}) });
      } else {
        const uploaded = await ctx.fileUpload.upload(sessionId, file, file.name ? file.name : undefined);
        if (!uploaded.ok) throw new Error(uploaded.error?.message ?? '文件上传失败');
        content.push({ type: 'file', receiptId: uploaded.value.receiptId });
      }
    }
    if (text !== '') content.push({ type: 'text', text });
    const result = await session.prompt(content, 'queue');
    if (!result.ok) throw new Error(result.error?.message ?? 'DSH 未接受这条消息');
  };

  let syncQueued = false;
  let knownSessionIds = new Set();
  const syncSessions = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      const sessions = sessionSnapshot(ctx);
      const ids = new Set(sessions.map(session => session.id));
      const removedSessionIds = [...knownSessionIds].filter(id => !ids.has(id));
      knownSessionIds = ids;
      void fetch('/synapse/api/sessions/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessions, removedSessionIds }) }).catch(() => {});
    });
  };

  const syncCurrentSession = () => {
    syncSessions();
    send('synapse:theme', { dark: isDark() });
    if (frame !== null) {
      send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx) });
      send('synapse:current-session', { session: currentSession(ctx) });
    }
  };

  const openSession = sessionId => {
    try { ctx.uiWorkspace.openSession(sessionId); } catch { send('synapse:bridge-error', { message: '关联的 DSH 会话已不可用' }); }
  };

  const onFrameLoad = () => {
    syncCurrentSession();
    send('synapse:map-opened');
  };

  const onMessage = event => {
    if (event.origin !== origin || event.source !== frame?.contentWindow) return;
    const data = event.data;
    if (data?.source !== 'dsh-synapse') return;
    if (data.type === 'synapse:close') {
      const session = currentSession(ctx);
      if (session !== null) { try { ctx.uiConversation.binding(session.id).activate('chat'); } catch { /* view may be gone */ } }
      return;
    }
    if (data.type === 'synapse:request-current') {
      send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx) });
      send('synapse:current-session', { session: currentSession(ctx) });
      return;
    }
    if (data.type === 'synapse:map-ready') return;
    if (data.type === 'synapse:open-session' || data.type === 'synapse:activate-session') return openSession(data.sessionId);
    if (data.type === 'synapse:fork-session') {
      const atSeq = Number.isInteger(data.atSeq) ? data.atSeq : undefined;
      ctx.sessions.fork({ sessionId: data.sessionId, atSeq, increaseTitle: true }).then(id => {
        const snapshot = ctx.sessions.list.getSnapshot();
        send('synapse:forked-session', { requestId: data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? 'DSH 分支' } });
      }).catch(() => { send('synapse:bridge-error', { message: 'DSH 分支创建失败，请确认源会话已经完成当前轮次' }); });
      return;
    }
    if (data.type === 'synapse:send-message') {
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      const files = Array.isArray(data.attachments) ? data.attachments.filter(file => file instanceof File) : [];
      if (text === '' && files.length === 0) return send('synapse:bridge-error', { requestId: data.requestId, message: '消息不能为空' });
      prompt(data.sessionId, text, files).then(() => {
        send('synapse:message-sent', { requestId: data.requestId, sessionId: data.sessionId });
      }).catch(error => {
        send('synapse:bridge-error', { requestId: data.requestId, message: error instanceof Error ? error.message : 'DSH 消息发送失败' });
      });
      return;
    }
    if (data.type === 'synapse:create-session') {
      const workspaceId = typeof data.workspaceId === 'string' && data.workspaceId !== '' && data.workspaceId !== 'dsh-ungrouped' ? data.workspaceId : undefined;
      const cwd = typeof data.cwd === 'string' && data.cwd !== '' ? data.cwd : undefined;
      const create = workspaceId === undefined ? ctx.sessions.create(cwd === undefined ? {} : { cwd }) : ctx.sessions.create({ workspaceId });
      create.then(id => {
        const snapshot = ctx.sessions.list.getSnapshot();
        send('synapse:created-session', { requestId: data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? '新会话', cwd: snapshot.byId[id]?.cwd ?? cwd ?? null } });
      }).catch(() => { send('synapse:bridge-error', { requestId: data.requestId, message: 'DSH 会话创建失败，请先在 DSH 选择工作目录' }); });
    }
  };

  window.addEventListener('message', onMessage);
  const themeObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => send('synapse:theme', { dark: isDark() }));
  if (themeObserver !== null && document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
  const unsubscribeSessions = ctx.sessions.list.subscribe(syncCurrentSession);
  const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(syncCurrentSession);

  function SynapseView() {
    const ref = useRef(null);
    useEffect(() => {
      const element = ref.current;
      if (element === null) return undefined;
      frame = element;
      ensureComposerHideStyle();
      document.documentElement.setAttribute(SYNAPSE_ACTIVE_ATTR, '');
      const onLoad = () => onFrameLoad();
      element.addEventListener('load', onLoad);
      return () => {
        element.removeEventListener('load', onLoad);
        document.documentElement.removeAttribute(SYNAPSE_ACTIVE_ATTR);
        if (frame === element) frame = null;
      };
    }, []);
    return React.createElement('iframe', {
      ref,
      title: '会话地图',
      src: '/synapse/',
      style: { display: 'block', width: '100%', height: '100%', border: '0', background: '#f5f7fa' },
    });
  }

  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'synapse',
    order: 5,
    label: () => '会话地图',
  }, SynapseView)), 'synapse: conversation view tab');

  ctx.effect(() => () => {
    window.removeEventListener('message', onMessage);
    themeObserver?.disconnect();
    unsubscribeSessions();
    unsubscribeWorkspaces();
  }, 'synapse: client bridge teardown');
}
