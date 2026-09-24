import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpError, json, routeErrors, sessionRoot } from '../../files/src/workspace.mjs';

export const inject = ['webServer', 'sessions'];

const execFileAsync = promisify(execFile);
const PYTHON = '/srv/amadeus/bci-venv/bin/python';
const SKIP_DIRS = new Set(['node_modules', '.git', '.ipynb_checkpoints', '.mne_data', '.mplcache', '.obsidian', '.uvcache']);

function parseLastJson(text) {
  const lines = String(text || '').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* keep scanning */ }
  }
  return null;
}

/** ISO 周（与 Python 的 date.isocalendar 口径一致，用 UTC 计算避免时区漂移）。 */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

async function listNotebooks(root, limit = 60) {
  const found = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = await readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(childRel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ipynb')) {
        try { const info = await stat(path.join(root, childRel)); found.push({ path: childRel, mtime: info.mtimeMs }); }
        catch { /* ignore */ }
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map(entry => entry.path);
}

export function apply(ctx, config = {}) {
  const python = config.python || PYTHON;
  const jupyterUrl = String(config.jupyterUrl || '').replace(/\/+$/, '');
  let chain = Promise.resolve();

  const runPython = (cwd, script, args, timeout = 180000) => {
    const task = () => execFileAsync(python, [script, ...args], {
      cwd,
      timeout,
      maxBuffer: 128 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        MPLCONFIGDIR: path.join(cwd, '.mplcache'),
      },
    });
    const next = chain.then(task, task);
    chain = next.then(() => {}, () => {});
    return next;
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/amadeus/progress',
    handler: routeErrors(async (req, res) => {
      const url = new URL(req.url, 'http://amadeus');
      const route = url.pathname.slice('/amadeus/progress'.length) || '/';

      if (route === '/panel' && req.method === 'GET') {
        const root = await sessionRoot(ctx, url.searchParams.get('session'));
        const target = path.join(root, '_diag', 'panel.html');
        const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
        await runPython(root, path.join(root, '_diag', 'render_panel.py'), ['--out', target, '--theme', theme]);
        const markup = await readFile(target, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(markup);
        return;
      }

      if (route === '/refresh' && req.method === 'POST') {
        const root = await sessionRoot(ctx, url.searchParams.get('session'));
        const target = path.join(root, '_diag', 'panel.html');
        const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
        const { stdout } = await runPython(root, path.join(root, '_diag', 'render_panel.py'), ['--out', target, '--theme', theme]);
        return json(res, 200, { ok: true, result: parseLastJson(stdout) });
      }

      if (route === '/cards' && req.method === 'POST') {
        const root = await sessionRoot(ctx, url.searchParams.get('session'));
        const target = path.join(root, 'cards.csv');
        const { stdout } = await runPython(root, path.join(root, '_diag', 'make_cards.py'), ['--out', target, '--json']);
        return json(res, 200, { ok: true, ...parseLastJson(stdout) });
      }

      if (route === '/meta' && req.method === 'GET') {
        const root = await sessionRoot(ctx, url.searchParams.get('session'));
        const { year, week } = isoWeek(new Date());
        const padded = String(week).padStart(2, '0');
        const reportRel = `_diag/周报-${year}-W${padded}.md`;
        let weeklyReport = null;
        try { if ((await stat(path.join(root, reportRel))).isFile()) weeklyReport = reportRel; } catch { /* not yet generated */ }
        return json(res, 200, {
          jupyterUrl,
          weeklyReport,
          notebooks: await listNotebooks(root),
          week: `${year}-W${padded}`,
        });
      }

      throw new HttpError(404, 'Unknown progress route');
    }),
  }));
}
