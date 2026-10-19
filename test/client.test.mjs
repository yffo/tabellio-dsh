// Client-half smoke test: the bundle must register a settings section and map
// the host RPC result envelopes correctly. React hooks are not exercised here —
// the panel renders inside the real app; this only pins the wiring contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function loadBundle() {
  const code = await readFile(path.join(root, 'client', 'client.js'), 'utf8');
  let spec;
  const fakeWindow = { __ModuleLoader__: { load: (candidate) => { spec = candidate; } } };
  // eslint-disable-next-line no-new-func
  new Function('window', code)(fakeWindow);
  assert.ok(spec, 'bundle must call window.__ModuleLoader__.load');
  assert.equal(spec.id, 'tabellio-dsh');
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol.for('react.fragment'),
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  };
  const exports = spec.factory((name) => {
    assert.equal(name, 'react');
    return react;
  });
  return exports;
}

function fakeContext(callImpl) {
  const registered = {};
  const ctx = {
    connection: { rpc: { call: callImpl } },
    locale: {
      bind: () => (key) => 'zh:' + key,
      register: (ns, dicts) => {
        registered.locale = { ns, dicts };
        return () => {};
      },
    },
    slots: {
      inject: (name, callback) => {
        registered.injectName = name;
        callback();
        return () => {};
      },
      register: (meta, component) => {
        registered.slot = { meta, component };
        return () => {};
      },
    },
    effect: (factory) => {
      const dispose = factory();
      registered.effectDispose = dispose;
      return () => {};
    },
  };
  return { ctx, registered };
}

test('client bundle registers the memory settings section', async () => {
  const exports = await loadBundle();
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, ['slots', 'connection', 'locale']);
  assert.equal(typeof exports.MemoryPanel, 'function');

  const { ctx, registered } = fakeContext(async () => ({ ok: true, value: {} }));
  exports.apply(ctx);

  assert.equal(registered.injectName, 'settings.section');
  assert.equal(registered.slot.meta.name, 'settings.section');
  assert.equal(registered.slot.meta.id, 'tabellio-dsh');
  assert.equal(registered.slot.meta.order, 40);
  assert.equal(registered.slot.component, exports.MemoryPanel);
  assert.equal(registered.slot.meta.label(), 'zh:section');
  assert.equal(registered.locale.ns, 'tabellio-dsh');
  assert.ok(registered.locale.dicts.zh && registered.locale.dicts.en);
});

test('client rpcCall unwraps ok envelopes and rejects failures', async () => {
  const exports = await loadBundle();
  let seen;
  let next = { ok: true, value: { notes: 3 } };
  const { ctx, registered } = fakeContext(async (channel, endpoint, payload) => {
    seen = { channel, endpoint, payload };
    return next;
  });
  exports.apply(ctx);
  const { rpcCall } = registered.slot.meta.inject();

  assert.deepEqual(await rpcCall('status', {}), { notes: 3 });
  assert.deepEqual(seen, { channel: '/tabellio-dsh', endpoint: 'status', payload: {} });

  next = { ok: false, error: { code: 'bad-request', message: 'boom' } };
  await assert.rejects(() => rpcCall('inbox.review', { action: 'accept', ids: ['x'] }), /boom/);
});
