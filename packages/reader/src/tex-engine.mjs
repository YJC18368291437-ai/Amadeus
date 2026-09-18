const DEFAULT_ASSET_BASE = '/cofolio/reader-assets/tex/';
const DEFAULT_TEXLIVE_ENDPOINT = '/cofolio/texlive/';

export class TexCompileError extends Error {
  constructor(message, log, status) {
    super(message);
    this.name = 'TexCompileError';
    this.log = log;
    this.status = status;
  }
}

class WorkerEngine {
  constructor({ script, command, timeoutMs = 120000 }) {
    this.script = script;
    this.command = command;
    this.timeoutMs = timeoutMs;
    this.worker = undefined;
    this.ready = undefined;
  }
  load() {
    if (this.ready) return this.ready;
    this.worker = new Worker(this.script);
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('TeX engine startup timed out')), this.timeoutMs);
      const onMessage = event => {
        if (event.data?.result !== 'ok' || event.data?.cmd) return;
        clearTimeout(timeout);
        this.worker.removeEventListener('message', onMessage);
        resolve();
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', event => { clearTimeout(timeout); reject(event.error || new Error('TeX engine failed to start')); }, { once: true });
    });
    return this.ready;
  }
  post(cmd, data = {}) { this.worker.postMessage({ cmd, ...data }); }
  setEndpoint(url) { this.post('settexliveurl', { url }); }
  write(filename, source) { this.post('writefile', { url: filename, src: source }); }
  setMain(filename) { this.post('setmainfile', { url: filename }); }
  flush() { this.post('flushcache'); }
  compile() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('TeX compilation timed out')); }, this.timeoutMs);
      const onMessage = event => {
        if (event.data?.cmd !== 'compile') return;
        cleanup();
        resolve({ status: event.data.status, log: event.data.log || '', bytes: event.data.pdf ? new Uint8Array(event.data.pdf) : undefined });
      };
      const onError = event => { cleanup(); reject(event.error || new Error('TeX worker crashed')); };
      const cleanup = () => {
        clearTimeout(timeout);
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.post(this.command);
    });
  }
  close() {
    this.worker?.postMessage({ cmd: 'grace' });
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
  }
}

export function createTexCompiler({ assetBase = DEFAULT_ASSET_BASE, texliveEndpoint = DEFAULT_TEXLIVE_ENDPOINT, timeoutMs = 120000 } = {}) {
  const xetex = new WorkerEngine({ script: `${assetBase}swiftlatexxetex.js`, command: 'compilelatex', timeoutMs });
  const dvipdfmx = new WorkerEngine({ script: `${assetBase}swiftlatexdvipdfm.js`, command: 'compilepdf', timeoutMs });
  let chain = Promise.resolve();
  async function initialize() {
    await Promise.all([xetex.load(), dvipdfmx.load()]);
    xetex.setEndpoint(texliveEndpoint);
    dvipdfmx.setEndpoint(texliveEndpoint);
  }
  return {
    compile(source) {
      const job = chain.then(async () => {
        await initialize();
        xetex.flush();
        xetex.write('main.tex', source);
        xetex.setMain('main.tex');
        const xdv = await xetex.compile();
        if (xdv.status !== 0 || !xdv.bytes) throw new TexCompileError('XeTeX compilation failed', xdv.log, xdv.status);
        dvipdfmx.flush();
        dvipdfmx.write('main.xdv', xdv.bytes);
        dvipdfmx.setMain('main.xdv');
        const pdf = await dvipdfmx.compile();
        if (pdf.status !== 0 || !pdf.bytes) throw new TexCompileError('PDF generation failed', pdf.log, pdf.status);
        return { pdf: pdf.bytes, log: `${xdv.log}\n${pdf.log}`.trim() };
      });
      chain = job.catch(() => {});
      return job;
    },
    close() { xetex.close(); dvipdfmx.close(); },
  };
}
