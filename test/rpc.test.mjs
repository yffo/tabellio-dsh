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
