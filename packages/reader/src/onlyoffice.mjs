import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { HttpError } from '../../files/src/workspace.mjs';

export const DEFAULT_IMAGE = 'onlyoffice/documentserver@sha256:3ab6ebc7c605e5a32b7ae3ff19daed4925090245acc8100ce2230bd766c88212';
export const DOCKER_BUILDER = '/var/www/onlyoffice/documentserver/server/FileConverter/bin/docbuilder';

// The builder runs once per document. No editor, database or persistent worker.
export function createOnlyOffice({ executable = 'docbuilder', mode = 'native', image = DEFAULT_IMAGE, dockerExecutable = 'docker', fontsDir, timeoutMs = 120000, workers = 1, spawnProcess = spawn } = {}) {
  if (!['native', 'docker'].includes(mode)) throw new Error('onlyOfficeMode must be native or docker');
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('previewWorkers must be between 1 and 4');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Preview timeout must be positive');
  const queue = [], active = new Set();
  let disposed = false;
  const helper = (file, args) => new Promise(resolve => {
    const process = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { process.kill('SIGKILL'); resolve(); }, 5000);
    const finish = () => { clearTimeout(timer); resolve(); };
    process.on('error', finish); process.on('close', finish);
  });
  async function run(job) {
    const { input, directory, onProgress } = job;
    const name = `amadeus-builder-${randomUUID()}`;
    const inputPath = mode === 'docker' ? `/job/${path.basename(input)}` : input.replaceAll('\\', '/');
    const outputPath = mode === 'docker' ? '/job/input.pdf' : path.join(directory, 'input.pdf').replaceAll('\\', '/');
    const script = path.join(directory, 'convert.docbuilder');
    await writeFile(script, `builder.OpenFile(${JSON.stringify(inputPath)}, "");\nbuilder.SaveFile("pdf", ${JSON.stringify(outputPath)});\nbuilder.CloseFile();\n`, { mode: 0o600 });
    if (disposed) throw new HttpError(503, 'Preview converter is stopping');
    let command = executable, args = [script];
    if (mode === 'docker') {
      command = dockerExecutable;
      args = ['run', '--rm', '--name', name, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '2g', '--cpus', '2', '--mount', `type=bind,source=${directory},target=/job`];
      if (process.platform === 'linux') args.push('--user', `${process.getuid()}:${process.getgid()}`, '--env', 'HOME=/tmp');
      if (fontsDir) args.push('--mount', `type=bind,source=${path.resolve(fontsDir)},target=/usr/share/fonts/truetype/amadeus,readonly`);
      args.push('--entrypoint', DOCKER_BUILDER, image, '/job/convert.docbuilder');
    }
    onProgress?.({}); // Builder has no reliable page-by-page progress callback.
    await new Promise((resolve, reject) => {
      const child = spawnProcess(command, args, { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
      job.pid = child.pid;
      let failure, cleanup, detail = '';
      child.stderr.on('data', data => { detail = (detail + data).slice(-2048); });
      job.stop = (error = new HttpError(503, 'Preview converter is stopping')) => {
        failure ||= error;
        cleanup ||= (async () => {
          const containerCleanup = mode === 'docker' ? helper(dockerExecutable, ['rm', '-f', name]) : Promise.resolve();
          if (child.pid) {
            if (process.platform === 'win32') await helper('taskkill', ['/PID', String(child.pid), '/T', '/F']);
            else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
          }
          await containerCleanup;
        })();
        return cleanup;
      };
      const timer = setTimeout(() => job.stop(new HttpError(504, 'ONLYOFFICE conversion timed out')), timeoutMs);
      child.once('error', () => { failure ||= new HttpError(503, 'ONLYOFFICE could not start; check the converter installation'); });
      child.once('close', async code => {
        clearTimeout(timer);
        await cleanup;
        // Remove a named container even if cancellation raced Docker startup.
        if (failure && mode === 'docker') await helper(dockerExecutable, ['rm', '-f', name]);
        if (failure) reject(failure);
        else if (code !== 0) {
          const error = new HttpError(422, 'ONLYOFFICE could not convert this document; check the runtime and document format');
          error.cause = new Error(detail);
          reject(error);
        }
        else resolve();
      });
    });
  }
  function drain() {
    while (!disposed && active.size < workers && queue.length) {
      const job = queue.shift(); active.add(job);
      job.done = run(job).then(job.resolve, job.reject).finally(() => { active.delete(job); drain(); });
    }
  }
  return {
    convert(input, directory, onProgress) {
      if (disposed) return Promise.reject(new HttpError(503, 'Preview converter is stopping'));
      return new Promise((resolve, reject) => { queue.push({ input, directory, onProgress, resolve, reject }); drain(); });
    },
    status: () => [...active].map(job => ({ pid: job.pid, running: true })),
    async dispose() {
      disposed = true;
      for (const job of queue.splice(0)) job.reject(new HttpError(503, 'Preview converter is stopping'));
      await Promise.allSettled([...active].map(async job => { await job.stop?.(); await job.done; }));
    },
  };
}
