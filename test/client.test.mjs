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
  const registered = { registrations: [] };
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
        registered.registrations.push({ meta, component });
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
  assert.equal(typeof exports.MemoryIndicator, 'function');

  const { ctx, registered } = fakeContext(async () => ({ ok: true, value: {} }));
  exports.apply(ctx);

  assert.equal(registered.registrations.length, 2);
  const indicator = registered.registrations[0];
  assert.equal(indicator.meta.name, 'conversation.session.header.utilities');
  assert.equal(indicator.meta.id, 'tabellio-dsh.memory-indicator');
  assert.equal(indicator.component, exports.MemoryIndicator);
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

test('panel renders the sectioned layout with a populated status', async () => {
  const { readFile } = await import('node:fs/promises');
  const code = await readFile(path.join(root, 'client', 'client.js'), 'utf8');
  let spec;
  new Function('window', code)({ __ModuleLoader__: { load: (candidate) => { spec = candidate; } } });

  let hook = 0;
  const initial = [
    'overview',
    { loading: false, error: null, notice: '' },
    {
      notes: 795, candidates: 1, proposals: 0, mode: 'inject', capture: 'assist',
      indexExists: true, indexStale: false, store: '/tmp/store', warnings: [],
      semantic: { mode: 'local', model: 'qwen3-embedding-0.6b', endpoint: 'http://127.0.0.1:8080/v1/embeddings', ready: true, size: 795, error: null },
      judge: { mode: 'llm', selection: { model: 'deepseek-flash' }, last: { stage: 'verdict', kept: 1 } },
      consolidate: { mode: 'daily', lastRun: 1792360000000 },
      lastRecall: { at: 1792360000000, query: '上次说的阈值', mode: 'context', count: 1, elapsedMs: 900, judged: true, titles: ['阈值'] },
    },
    [{ id: 'cand-1', title: '一条候选', chars: 20 }],
    [],
    { notes_added: 3, truncated: 0, items: [] },
    { items: [], counts: {} },
    { total: 5, byMode: { context: 2, suppressed: 1, refused: 1, judged_out: 1 }, judge: { kept: 2, dropped: 1 }, topMisses: [{ query: '天气', count: 2 }] },
    { items: [], total: 0, loading: false },
    { kind: '', days: 0 },
    null, '', false, '', '', null, false,
    { semantic: { mode: 'local', endpoint: 'http://x', model: 'm' }, judge: { mode: 'llm', model: '' }, consolidate: { mode: 'daily' } },
    { semantic: 'local', semanticEndpoint: 'http://x', semanticModel: 'm', judge: 'llm', judgeModel: '', judgeProvider: '', consolidate: 'daily' },
    false,
    null,
  ];
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: 'Fragment',
    useState: () => { const value = initial[hook] ?? undefined; hook += 1; return [value, () => {}]; },
    useEffect: () => {},
    useCallback: (fn) => fn,
  };
  const exports = spec.factory((name) => {
    if (name !== 'react') throw new Error('unexpected require ' + name);
    return react;
  });
  const tree = exports.MemoryPanel({ rpcCall: async () => ({}), t: (key) => 'zh:' + key });
  const texts = [];
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return; }
    if (typeof node !== 'object') return;
    walk(node.children);
  };
  walk(tree);
  const flat = texts.join('|');
  for (const key of ['zh:tabOverview', 'zh:tabPending', 'zh:tabLibrary', 'zh:tabSettings', 'zh:lastRecallLabel', 'zh:notes', 'zh:index']) {
    assert.ok(flat.includes(key), 'missing ' + key);
  }
  assert.ok(flat.includes('795'), 'notes metric missing');
});
