import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchWorkbench, patchWorkbenchHtml, reloadWorkingCopy } from '../scripts/patch-code-server.mjs';

test('resource reload updates only the requested model, preserves dirty models and handles edits during I/O', async () => {
  const uri = { toString: () => 'file:///a' }, calls = [];
  let dirty = false, editDuringRead = false, skippedRead = false, onResolve;
  const model = { resource: uri, textEditorModel: {}, isDisposed: () => false, isDirty: () => dirty,
    onDidResolve(callback) { onResolve = callback; return { dispose() { onResolve = undefined; } }; },
    async resolve(options) { calls.push(options); if (editDuringRead) dirty = true; else if (!skippedRead) onResolve(); },
    async revert() { calls.push('revert'); dirty = false; onResolve(); } };
  const other = { ...model, resource: { toString: () => 'file:///b' }, resolve: () => assert.fail('wrong file') };
  const service = { workingCopies: [other, model] };
  assert.equal((await reloadWorkingCopy(service, uri)).refreshed, true);
  assert.deepEqual(calls, [{ forceReadFromFile: true }]);
  dirty = true;
  assert.deepEqual(await reloadWorkingCopy(service, uri), { open: true, dirty: true });
  assert.equal(calls.length, 1);
  assert.equal((await reloadWorkingCopy(service, uri, true)).refreshed, true);
  assert.equal(calls[1], 'revert');
  editDuringRead = true;
  assert.deepEqual(await reloadWorkingCopy(service, uri), { open: true, dirty: true });
  editDuringRead = false;
  dirty = false;
  skippedRead = true;
  assert.deepEqual(await reloadWorkingCopy(service, uri), { open: true, retry: true }, 'edit then undo or an in-progress save can leave a clean model without applying the disk read');
  assert.deepEqual(await reloadWorkingCopy(service, { toString: () => 'file:///absent' }), { open: false });
});

test('workbench patch captures minifier symbols, registers a callable handler, is idempotent and rejects changed anchors', async () => {
  const source = 'Registry.registerCommand("_workbench.revertAllDirty",async function(x){if(!x.get(Environment).extensionTestsLocationURI)throw new Error("Command is only available when running extension tests.");const copies=x.get(WorkingCopies);for(const copy of copies.dirtyWorkingCopies)await copy.revert({soft:!0})});';
  const commands = new Map();
  const patched = patchWorkbench(source);
  vm.runInNewContext(patched, { Registry: { registerCommand: (name, callback) => commands.set(name, callback) }, WorkingCopies: 'workingCopies', Environment: 'environment' });
  const result = await commands.get('amadeus.reloadFile')({ get: key => { assert.equal(key, 'workingCopies'); return { workingCopies: [] }; } }, {});
  assert.equal(result.open, false);
  assert.equal(patchWorkbench(patched), patched);
  assert.throws(() => patchWorkbench('unknown build'), /Unsupported/);
  assert.throws(() => patchWorkbench(source + source), /exactly once/);
});

test('patched module URL changes with the bundle so normal reload cannot reuse the old workbench', () => {
  const html = '<script type="module" src="{{WORKBENCH_WEB_BASE_URL}}/out/vs/code/browser/workbench/workbench.js"></script>';
  const a = patchWorkbenchHtml(html, 'bundle A');
  assert.match(a, /workbench\.js\?amadeus=[a-f0-9]{16}"/);
  assert.equal(patchWorkbenchHtml(a, 'bundle A'), a);
  assert.notEqual(patchWorkbenchHtml(a, 'bundle B'), a);
  assert.throws(() => patchWorkbenchHtml('<html/>', 'bundle'), /exactly once/);
});
