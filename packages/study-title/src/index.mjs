/**
 * Amadeus study-title plugin.
 *
 * Registers one model-facing tool that pins the current conversation's title.
 * The coach mode calls it so every new study conversation is named after the
 * day's main line and the date, instead of an auto-generated summary.
 *
 * Why a tool: `dsh-session-title` folds the latest `session/title` event, and a
 * title whose `source.kind` is `user` PINS it — the service's own `onUserMessage`
 * returns early once the folded title is user-sourced, so automatic generation
 * stops and later human messages schedule none. Appending that event is exactly
 * what the service's `rename(session, title)` does; doing it from a tool keeps
 * the model in control of the text without reaching into host internals.
 *
 * `dsh-session-title`'s invariant: a `source.kind: "user"` title must carry an
 * EMPTY `messageSeqs` (only non-user sources cite message seqs).
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'amadeus-study-title';
export const inject = ['tools'];

const MAX_TITLE_CHARS = 80;

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'set_session_title',
    description:
      'Set the title of THIS conversation. A user-sourced title pins the session: automatic title generation stops and later messages never rename it. Call it once, at the start of a new conversation, right after you have settled today\'s main line. Format the title as "MM-DD 学习主线", for example "09-21 EEG带通滤波与N170". Keep it under about 20 CJK characters. Do not call it again unless the focus of the conversation actually changes.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'The new title, e.g. "09-21 EEG带通滤波与N170".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `会话标题已设为「${value.title}」` }],
    },
    execute(args, exec) {
      const agent = exec === undefined ? undefined : exec.agent;
      if (agent === undefined || agent === null) throw new Error('set_session_title requires a calling agent');
      const raw = args === undefined || args === null ? '' : args.title;
      const title = String(raw === undefined || raw === null ? '' : raw).trim().slice(0, MAX_TITLE_CHARS);
      if (title.length === 0) throw new Error('session title must contain visible characters');
      agent.session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } });
      return Promise.resolve({ title });
    },
    presentCall: args => ({
      card: 'generic',
      title: '设置会话标题',
      kind: 'write',
      rawInput: String((args && args.title) || ''),
    }),
  }));
}
