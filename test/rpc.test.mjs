// Host-half tests for the panel channel: status, candidate list, and the
// approval gate. These call the handler directly — no browser involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addCandidate, openStore, remember } from 'tabellio';
import { normalizeConfig } from '../src/config.js';
import { createRpcHandler, RPC_CHANNEL } from '../src/rpc.js';

async function tempStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabellio-rpc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  return { dir, store };
}

function handlerFor(dir, store, overrides = {}) {
  return createRpcHandler({
    settings: normalizeConfig({ storePath: dir, ...overrides }),
    getStore: () => store,
  });
}

test('exposes a channel path the client can mount', () => {
  assert.equal(RPC_CHANNEL, '/tabellio-dsh');
});

test('status reports counts and the current delivery mode', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = handlerFor(dir, store, { shadow: true, capture: 'assist' });

  const result = await handler('status', {});
  assert.equal(result.ok, true);
  assert.equal(result.value.store, dir);
  assert.equal(result.value.notes, 0);
  assert.equal(result.value.candidates, 0);
  assert.equal(result.value.mode, 'shadow');
  assert.equal(result.value.delivery, 'shadow');
  assert.equal(result.value.capture, 'assist');
  assert.equal(result.value.judge.mode, 'off');
  assert.equal(result.value.consolidate.mode, 'off');
  assert.equal(result.value.consolidate.lastRun, 0);
});

test('conflicts.preview shows the merged body and merge requires confirm', async (t) => {
  const { dir, store } = await tempStore(t);
  remember(store, { content: '发布流程：手动 npm publish，发布前跑 npm test。' });
  remember(store, { content: '发布流程改成推送 tag，自动 npm publish；不再手动发布。' });
  const handler = handlerFor(dir, store);
  const ids = store.scan().notes.map((note) => note.id);

  const preview = await handler('conflicts.preview', { ids });
  assert.equal(preview.ok, true);
  assert.equal(preview.value.ok, true);
  assert.match(preview.value.body, /tag/);

  const unconfirmed = await handler('conflicts.merge', { ids });
  assert.equal(unconfirmed.ok, false);

  const merged = await handler('conflicts.merge', { ids, confirm: true });
  assert.equal(merged.ok, true);
  assert.ok(merged.value.target_id.length > 0);
});

test('feedback.add records a signal and status reports the counts', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = handlerFor(dir, store);
  const before = await handler('status', {});
  assert.deepEqual(before.value.feedback, { total: 0, useful: 0, wrong: 0, stale: 0 });

  const written = await handler('feedback.add', { id: '01ABC', signal: 'useful' });
  assert.equal(written.ok, true);
  const bad = await handler('feedback.add', { id: '01ABC', signal: 'maybe' });
  assert.equal(bad.ok, false);

  const after = await handler('status', {});
  assert.equal(after.value.feedback.total, 1);
  assert.equal(after.value.feedback.useful, 1);
});

test('conflicts.list surfaces a rewording pair over the panel channel', async (t) => {
  const { dir, store } = await tempStore(t);
  remember(store, { content: '发布流程：手动 npm publish，发布前跑 npm test。' });
  remember(store, { content: '发布流程改成推送 tag，自动 npm publish；不再手动发布。' });
  const handler = handlerFor(dir, store);
  const result = await handler('conflicts.list', { days: 30, limit: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.value.scanned, 2);
  assert.equal(result.value.pairs.length, 1);
  assert.ok(result.value.pairs[0].signals.length >= 1);
});

test('audit.summary aggregates the recent recall trail', async (t) => {
  const { dir, store } = await tempStore(t);
  const { appendAudit } = await import('../src/audit.js');
  appendAudit(store, { query: '今天天气怎么样？', mode: 'suppressed', reason: 'no_memory_intent' });
  appendAudit(store, { query: '发布流程是什么？', mode: 'context', count: 2, titles: ['发布流程'] });
  const handler = handlerFor(dir, store);
  const summary = await handler('audit.summary', { days: 7 });
  assert.equal(summary.ok, true);
  assert.equal(summary.value.total, 2);
  assert.equal(summary.value.byMode.context, 1);
  assert.equal(summary.value.topMisses[0].query, '今天天气怎么样？');
});

test('inbox.list returns candidate views and inbox.review approves them', async (t) => {
  const { dir, store } = await tempStore(t);
  addCandidate(store, { text: '以后脚本统一放 archive 目录', kind: 'semantic', tags: ['rpc-test'] }, { writtenBy: 'test' });
  const handler = handlerFor(dir, store);

  const listed = await handler('inbox.list', {});
  assert.equal(listed.ok, true);
  assert.equal(listed.value.items.length, 1);
  const candidate = listed.value.items[0];
  assert.equal(typeof candidate.id, 'string');
  assert.equal(typeof candidate.title, 'string');
  assert.ok(candidate.chars > 0);

  const approved = await handler('inbox.review', { action: 'accept', ids: [candidate.id] });
  assert.equal(approved.ok, true);
  assert.deepEqual(approved.value.accepted, [candidate.id]);
  assert.equal(approved.value.notes, 1);
  assert.equal(approved.value.candidates, 0);

  const after = await handler('status', {});
  assert.equal(after.value.notes, 1);
});

test('inbox.review rejects invalid payloads and unknown endpoints', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = handlerFor(dir, store);

  const badAction = await handler('inbox.review', { action: 'delete', ids: ['x'] });
  assert.equal(badAction.ok, false);
  assert.equal(badAction.error.code, 'bad-request');

  const emptyIds = await handler('inbox.review', { action: 'accept', ids: [] });
  assert.equal(emptyIds.ok, false);

  const unknown = await handler('nope', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'bad-request');
});

test('inbox.review reports ids that are not candidates as failures, not crashes', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = handlerFor(dir, store);

  const result = await handler('inbox.review', { action: 'accept', ids: ['missing-id'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.accepted, []);
  assert.equal(result.value.failed.length, 1);
  assert.equal(result.value.failed[0].id, 'missing-id');
});

test('search returns hits for a stored note and refuses empty queries', async (t) => {
  const { dir, store } = await tempStore(t);
  remember(store, { content: '项目代号是青鸟计划，发布前要先跑测试。' }, { writtenBy: 'test' });
  const handler = handlerFor(dir, store);

  const found = await handler('search', { query: '项目代号是什么' });
  assert.equal(found.ok, true);
  assert.equal(found.value.hits.length > 0, true);
  assert.equal(typeof found.value.hits[0].id, 'string');
  assert.equal(typeof found.value.hits[0].title, 'string');

  const oversized = await handler('search', { query: 'x'.repeat(201) });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.code, 'bad-request');

  const empty = await handler('search', { query: '   ' });
  assert.equal(empty.ok, false);
});

test('status exposes the host last-recall decision, or null before the first turn', async (t) => {
  const { dir, store } = await tempStore(t);
  const base = { settings: normalizeConfig({ storePath: dir }), getStore: () => store };

  const empty = await createRpcHandler(base)('status', {});
  assert.equal(empty.value.lastRecall, null);

  const handler = createRpcHandler({
    ...base,
    getLastRecall: () => ({ at: 123, query: '项目代号是什么', mode: 'shadow', refused: false, count: 2, reason: null, titles: ['项目：青鸟计划'], elapsedMs: 87, receiptPath: '/tmp/rcp.json' }),
  });
  const result = await handler('status', {});
  assert.equal(result.value.lastRecall.mode, 'shadow');
  assert.equal(result.value.lastRecall.query, '项目代号是什么');
  assert.equal(result.value.lastRecall.count, 2);
  assert.equal(result.value.lastRecall.receiptPath, '/tmp/rcp.json');
  assert.equal(result.value.lastRecall.judged, false);
  assert.deepEqual(result.value.lastRecall.titles, ['项目：青鸟计划']);
  assert.equal(result.value.lastRecall.elapsedMs, 87);
});

test('status exposes judge diagnostics when the judge is enabled', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = createRpcHandler({
    settings: normalizeConfig({ storePath: dir, judge: 'llm' }),
    getStore: () => store,
    getJudgeState: () => ({
      mode: 'llm',
      host: 'inject',
      selection: { provider: 'deepseek-account', model: 'deepseek-flash' },
      last: { at: 123, stage: 'verdict', kept: 2, notes: 3 },
    }),
  });
  const result = await handler('status', {});
  assert.equal(result.value.judge.mode, 'llm');
  assert.equal(result.value.judge.host, 'inject');
  assert.equal(result.value.judge.selection.provider, 'deepseek-account');
  assert.equal(result.value.judge.last.stage, 'verdict');
  assert.equal(result.value.judge.last.kept, 2);
});

test('proposals.list is empty on a fresh store and proposals.review rejects unknown ids', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = handlerFor(dir, store);

  const listed = await handler('proposals.list', {});
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.value.items, []);

  const reviewed = await handler('proposals.review', { action: 'accept', ids: ['no-such-proposal'] });
  assert.equal(reviewed.ok, true);
  assert.deepEqual(reviewed.value.accepted, []);
  assert.equal(reviewed.value.failed.length, 1);
  assert.equal(reviewed.value.failed[0].id, 'no-such-proposal');
  assert.ok(['invalid_id', 'proposal_not_found'].includes(reviewed.value.failed[0].reason));
});

test('proposals.review rejects malformed payloads', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = handlerFor(dir, store);

  const badAction = await handler('proposals.review', { action: 'merge', ids: ['x'] });
  assert.equal(badAction.ok, false);
  assert.equal(badAction.error.code, 'bad-request');

  const badIds = await handler('proposals.review', { action: 'reject', ids: [] });
  assert.equal(badIds.ok, false);
});

test('report returns the recent window and clamps its inputs', async (t) => {
  const { dir, store } = await tempStore(t);
  remember(store, { content: '面板周报测试笔记：项目代号是青鸟计划。' }, { writtenBy: 'test' });
  const handler = handlerFor(dir, store);

  const wide = await handler('report', { days: 30, limit: 5 });
  assert.equal(wide.ok, true);
  assert.equal(wide.value.days, 30);
  assert.equal(wide.value.notes_added, 1);
  assert.equal(wide.value.items.length, 1);
  assert.match(wide.value.items[0].title, /面板周报测试笔记/);

  const defaults = await handler('report', {});
  assert.equal(defaults.value.days, 7);
  assert.equal(defaults.value.items.length, 1);

  const clamped = await handler('report', { days: 9999, limit: 999 });
  assert.equal(clamped.value.days, 90);
  assert.ok(clamped.value.items.length <= 10);
});

test('notes pages through the whole store for the panel', async (t) => {
  const { dir, store } = await tempStore(t);
  for (let i = 0; i < 7; i += 1) {
    remember(store, { content: `面板分页测试笔记第 ${i + 1} 号：项目代号是青鸟计划。` }, { writtenBy: 'test' });
  }
  const handler = handlerFor(dir, store);

  const first = await handler('notes', { offset: 0, limit: 5 });
  assert.equal(first.ok, true);
  assert.equal(first.value.total, 7);
  assert.equal(first.value.items.length, 5);

  const second = await handler('notes', { offset: 5, limit: 5 });
  assert.equal(second.value.items.length, 2);
  assert.equal(new Set(first.value.items.concat(second.value.items).map((n) => n.id)).size, 7);

  const clamped = await handler('notes', { offset: -3, limit: 999 });
  assert.equal(clamped.value.offset, 0);
  assert.equal(clamped.value.limit, 50);

  const defaults = await handler('notes', {});
  assert.equal(defaults.value.limit, 20);

  const past = await handler('notes', { offset: 100 });
  assert.deepEqual(past.value.items, []);
});

test('notes echoes and clamps its kind and day filters', async (t) => {
  const { dir, store } = await tempStore(t);
  remember(store, { content: '面板筛选测试笔记：项目代号是青鸟计划。' }, { writtenBy: 'test' });
  const handler = handlerFor(dir, store);

  const filtered = await handler('notes', { kind: 'procedural', days: 30 });
  assert.equal(filtered.ok, true);
  assert.equal(filtered.value.kind, 'procedural');
  assert.equal(filtered.value.days, 30);
  assert.equal(filtered.value.total, 0);

  const clamped = await handler('notes', { days: 9999 });
  assert.equal(clamped.value.days, 3650);
  const negative = await handler('notes', { days: -5 });
  assert.equal(negative.value.days, 0);

  const semantic = await handler('notes', { kind: 'semantic' });
  assert.equal(semantic.value.total, 1);
});

test('read returns note content for the panel viewer and rejects bad ids', async (t) => {
  const { dir, store } = await tempStore(t);
  const written = remember(store, { content: '面板查看测试笔记：项目代号是青鸟计划。' }, { writtenBy: 'test' });
  const handler = handlerFor(dir, store);

  const view = await handler('read', { id: written.id });
  assert.equal(view.ok, true);
  assert.match(view.value.title, /面板查看测试笔记/);
  assert.match(view.value.body, /青鸟计划/);
  assert.equal(view.value.truncated, false);

  assert.equal((await handler('read', {})).ok, false);
  assert.equal((await handler('read', { id: 'x'.repeat(80) })).ok, false);
  assert.equal((await handler('read', { id: 'DOES-NOT-EXIST' })).ok, false);
});

test('provenance reports where a note came from and where it was used', async (t) => {
  const { dir, store } = await tempStore(t);
  const written = remember(store, { content: '面板来源测试：发版由 CI 完成，不手动上传。' }, { writtenBy: 'test:provenance' });
  const handler = handlerFor(dir, store);

  const view = await handler('provenance', { id: written.id });
  assert.equal(view.ok, true);
  assert.equal(view.value.writtenBy, 'test:provenance');
  assert.equal(view.value.recalled.count, 0);

  assert.equal((await handler('provenance', {})).ok, false);
  assert.equal((await handler('provenance', { id: 'DOES-NOT-EXIST' })).ok, false);
});

test('remember writes from the panel and rejects empty, short or oversized content', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = handlerFor(dir, store);

  const saved = await handler('remember', { content: '面板直接写入测试：以后发版都用 tag 加 CI。' });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.notes, 1);
  assert.match(saved.value.title, /面板直接写入测试|tag/);

  assert.equal((await handler('remember', {})).ok, false);
  assert.equal((await handler('remember', { content: '   ' })).ok, false);
  assert.equal((await handler('remember', { content: '短' })).ok, false);
  assert.equal((await handler('remember', { content: 'x'.repeat(4001) })).ok, false);
  assert.equal(store.scan().notes.length, 1);
});

test('status reports the semantic supplement state', async (t) => {
  const { dir, store } = await tempStore(t);
  const handler = createRpcHandler({
    settings: normalizeConfig({ storePath: dir, semantic: 'local', semanticModel: 'qwen3-embedding-0.6b' }),
    getStore: () => store,
    getSemanticState: () => ({ ready: true, size: 12 }),
  });
  const status = (await handler('status', {})).value;
  assert.equal(status.semantic.mode, 'local');
  assert.equal(status.semantic.ready, true);
  assert.equal(status.semantic.size, 12);
  assert.equal(status.semantic.model, 'qwen3-embedding-0.6b');
  const off = createRpcHandler({ settings: normalizeConfig({ storePath: dir }), getStore: () => store });
  assert.equal((await off('status', {})).value.semantic.mode, 'auto');
});

test('settings endpoints read, validate and persist panel overrides', async (t) => {
  const { dir, store } = await tempStore(t);
  let view = { semantic: { mode: 'off', endpoint: '', model: '' }, judge: { mode: 'off', provider: '', model: '' }, consolidate: { mode: 'off' } };
  const applied = [];
  const handler = createRpcHandler({
    settings: normalizeConfig({ storePath: dir }),
    getStore: () => store,
    getSettingsView: () => view,
    updateSettings: (patch) => { applied.push(patch); view = { ...view, semantic: { mode: patch.semantic ?? 'off', endpoint: patch.semanticEndpoint ?? '', model: patch.semanticModel ?? '' } }; return view; },
  });
  assert.equal((await handler('settings.get', {})).value.semantic.mode, 'off');
  const saved = await handler('settings.set', { semantic: 'local', semanticEndpoint: 'http://127.0.0.1:8080/v1/embeddings', semanticModel: 'qwen3-embedding-0.6b', judge: 'llm', consolidate: 'daily' });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.semantic.mode, 'local');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].judge, 'llm');
  assert.equal((await handler('settings.set', { semantic: 'local', captureAssistant: 'yes' })).error.code, 'bad-request');
  assert.equal((await handler('settings.set', { judge: 'maybe' })).error.code, 'bad-request');
  assert.equal((await handler('settings.set', { semanticModel: 42 })).error.code, 'bad-request');
});

test('semantic.test returns the probe result or a soft failure', async (t) => {
  const { dir, store } = await tempStore(t);
  const okHandler = createRpcHandler({
    settings: normalizeConfig({ storePath: dir }),
    getStore: () => store,
    testSemantic: async () => ({ ok: true, dims: 1024, ms: 61 }),
  });
  assert.deepEqual((await okHandler('semantic.test', {})).value, { ok: true, dims: 1024, ms: 61 });
  const downHandler = createRpcHandler({
    settings: normalizeConfig({ storePath: dir }),
    getStore: () => store,
    testSemantic: async () => { throw new Error('ECONNREFUSED'); },
  });
  const down = (await downHandler('semantic.test', {})).value;
  assert.equal(down.ok, false);
  assert.match(down.error, /ECONNREFUSED/);
});


test('semantic.models returns the endpoint model list and rejects bad URLs', async (t) => {
  const { dir } = await tempStore(t);
  const handler = createRpcHandler({
    settings: normalizeConfig({ storePath: dir }),
    getStore: () => openStore(dir),
    getSemanticModels: async () => ['text-embedding-3-small'],
  });
  const okResult = await handler('semantic.models', { endpoint: 'http://127.0.0.1:8080/v1/embeddings' });
  assert.deepEqual(okResult.value.models, ['text-embedding-3-small']);
  const bad = await handler('semantic.models', { endpoint: 'ftp://example.com' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'bad-request');
});

test('settings.set accepts an api key but never echoes it back', async (t) => {
  const { dir } = await tempStore(t);
  const settings = normalizeConfig({ storePath: dir });
  let applied;
  const handler = createRpcHandler({
    settings,
    getStore: () => openStore(dir),
    getSettingsView: () => ({ semantic: { mode: settings.semantic, apiKeySet: Boolean(settings.semanticApiKey) } }),
    updateSettings: (patch) => { applied = patch; Object.assign(settings, patch); return { semantic: { mode: settings.semantic, apiKeySet: Boolean(settings.semanticApiKey) } }; },
  });
  const saved = await handler('settings.set', { semanticApiKey: 'sk-secret' });
  assert.equal(saved.ok, true);
  assert.equal(applied.semanticApiKey, 'sk-secret');
  assert.equal(saved.value.semantic.apiKeySet, true);
  assert.ok(!JSON.stringify(saved).includes('sk-secret'));
  const huge = await handler('settings.set', { semanticApiKey: 'x'.repeat(600) });
  assert.equal(huge.ok, false);
});
