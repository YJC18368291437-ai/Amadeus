import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../packages/files/src/index.mjs';

test('open_sidebar tool is registered on ctx.tools', async () => {
  let registeredTool = null;
  const mockCtx = {
    tools: {
      register(tool) {
        registeredTool = tool;
        return () => {};
      },
    },
    effect() {},
    webServer: { register() {} },
  };

  apply(mockCtx);

  assert.ok(registeredTool, 'open_sidebar tool should be registered');
  assert.equal(registeredTool.name, 'open_sidebar');

  const result = await registeredTool.execute({ path: 'playwright-output/qrcode.png' }, { agent: { session: { id: 'test-session-1' } } });
  assert.equal(result.success, true);
  assert.match(result.message, /playwright-output\/qrcode\.png/);
});

test('open_sidebar tool registers via ctx.inject when available', async () => {
  let registeredTool = null;
  const mockCtx = {
    inject(deps, callback) {
      assert.deepEqual(deps, ['tools']);
      callback({
        tools: {
          register(tool) {
            registeredTool = tool;
            return () => {};
          }
        }
      });
    },
    effect() {},
    webServer: { register() {} },
  };

  apply(mockCtx);

  assert.ok(registeredTool, 'open_sidebar tool should be registered via inject');
  assert.equal(registeredTool.name, 'open_sidebar');
});

