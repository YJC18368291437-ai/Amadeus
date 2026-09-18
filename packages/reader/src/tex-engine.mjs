const DEFAULT_ASSET_BASE = '/amadeus/reader-assets/tex/';
const DEFAULT_TEXLIVE_ENDPOINT = '/amadeus/texlive/';

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
  request(command = this.command) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); this.close(); const error = new Error('TeX compilation timed out'); error.name = 'TimeoutError'; reject(error); }, this.timeoutMs);
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
      this.post(command);
    });
  }
  compile() { return this.request(this.command); }
  close() {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
  }
}

function formatDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('amadeus-tex', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('formats');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCachedFormat(key) {
  try {
    const database = await formatDatabase();
    if (!database) return null;
    return await new Promise((resolve, reject) => {
      const request = database.transaction('formats').objectStore('formats').get(key);
      request.onsuccess = () => resolve(request.result ? new Uint8Array(request.result) : null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
}

async function writeCachedFormat(key, bytes) {
  try {
    const database = await formatDatabase();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('formats', 'readwrite');
      transaction.objectStore('formats').put(bytes, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {}
}

export function createTexCompiler({ assetBase = DEFAULT_ASSET_BASE, texliveEndpoint = DEFAULT_TEXLIVE_ENDPOINT, timeoutMs = 120000, formatCacheKey = 'amadeus-xelatex-format-v1' } = {}) {
  const xetex = new WorkerEngine({ script: `${assetBase}swiftlatexxetex.js`, command: 'compilelatex', timeoutMs });
  const dvipdfmx = new WorkerEngine({ script: `${assetBase}swiftlatexdvipdfm.js`, command: 'compilepdf', timeoutMs });
  let chain = Promise.resolve(), initializePromise, formatBytes;
  const cache = new Map(), pending = new Map();
  async function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      const dviReady = dvipdfmx.load().then(() => dvipdfmx.setEndpoint(texliveEndpoint));
      await xetex.load();
      xetex.setEndpoint(texliveEndpoint);
      formatBytes = await readCachedFormat(formatCacheKey);
      if (!formatBytes) {
        const built = await xetex.request('compileformat');
        if (built.status !== 0 || !built.bytes) throw new TexCompileError('XeTeX format generation failed', built.log, built.status);
        formatBytes = built.bytes;
        await writeCachedFormat(formatCacheKey, formatBytes);
        xetex.close();
        await xetex.load();
        xetex.setEndpoint(texliveEndpoint);
      }
      await dviReady;
    })();
    return initializePromise;
  }
  return {
    compile(source) {
      if (cache.has(source)) return Promise.resolve(cache.get(source));
      if (pending.has(source)) return pending.get(source);
      let job = chain.then(async () => {
        await initialize();
        xetex.flush();
        xetex.write('swiftlatexxetex.fmt', formatBytes);
        xetex.write('main.tex', source);
        xetex.setMain('main.tex');
        const xdv = await xetex.compile();
        if (xdv.status !== 0 || !xdv.bytes) throw new TexCompileError('XeTeX compilation failed', xdv.log, xdv.status);
        dvipdfmx.flush();
        dvipdfmx.write('main.xdv', xdv.bytes);
        dvipdfmx.setMain('main.xdv');
        const pdf = await dvipdfmx.compile();
        if (pdf.status !== 0 || !pdf.bytes) throw new TexCompileError('PDF generation failed', pdf.log, pdf.status);
        const result = { pdf: pdf.bytes, log: `${xdv.log}\n${pdf.log}`.trim() };
        cache.set(source, result);
        while (cache.size > 4) cache.delete(cache.keys().next().value);
        return result;
      });
      job = job.catch(error => {
        if (error.name === 'TimeoutError') { xetex.close(); dvipdfmx.close(); initializePromise = undefined; }
        throw error;
      });
      chain = job.catch(() => {});
      pending.set(source, job);
      job.finally(() => pending.delete(source)).catch(() => {});
      return job;
    },
    close() { cache.clear(); pending.clear(); initializePromise = undefined; formatBytes = undefined; xetex.close(); dvipdfmx.close(); },
  };
}
