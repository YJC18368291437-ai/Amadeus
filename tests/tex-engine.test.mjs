import test from 'node:test';
import assert from 'node:assert/strict';
import { createTexCompiler } from '../packages/reader/src/tex-engine.mjs';

test('a transient TeX initialization failure can retry without reloading the app', async () => {
  let firstLoad = true;
  const engines = [];
  const engineFactory = ({ command }) => {
    const engine = {
      command,
      closes: 0,
      async load() { if (command === 'compilelatex' && firstLoad) { firstLoad = false; throw new Error('temporary worker failure'); } },
      setEndpoint() {}, flush() {}, write() {}, setMain() {},
      async request(requested) { return { status: 0, log: '', bytes: new Uint8Array(requested === 'compileformat' ? [1] : [2]) }; },
      async compile() { return { status: 0, log: '', bytes: new Uint8Array(command === 'compilelatex' ? [3] : [4]) }; },
      close() { this.closes++; },
    };
    engines.push(engine);
    return engine;
  };
  const compiler = createTexCompiler({ engineFactory });
  await assert.rejects(compiler.compile('first'), /temporary worker failure/);
  const result = await compiler.compile('second');
  assert.deepEqual([...result.pdf], [4]);
  assert.ok(engines.every(engine => engine.closes >= 1));
  compiler.close();
});
