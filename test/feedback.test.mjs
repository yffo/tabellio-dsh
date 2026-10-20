import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from 'tabellio';
import { appendFeedback, aggregateFeedback, feedbackCounts, rankByFeedback, readFeedback } from '../src/feedback.js';

async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabellio-feedback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: openStore(dir) };
}

test('feedback is appended, read back and aggregated', async (t) => {
  const { store } = await temp(t);
  assert.deepEqual(appendFeedback(store, { id: 'n1', signal: 'useful' }), { ok: true, id: 'n1', signal: 'useful' });
  appendFeedback(store, { id: 'n1', signal: 'wrong' });
  appendFeedback(store, { id: 'n2', signal: 'stale' });
  const entries = readFeedback(store);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].source, 'panel');
  const aggregates = aggregateFeedback(entries);
  assert.deepEqual(aggregates.get('n1'), { useful: 1, wrong: 1, stale: 0 });
  assert.deepEqual(feedbackCounts(entries), { total: 3, useful: 1, wrong: 1, stale: 1 });
});

test('feedback rejects unknown signals and missing ids', async (t) => {
  const { store } = await temp(t);
  assert.equal(appendFeedback(store, { id: 'n1', signal: 'maybe' }).reason, 'invalid_signal');
  assert.equal(appendFeedback(store, { id: '', signal: 'useful' }).reason, 'missing_id');
  assert.deepEqual(readFeedback(store), []);
});

test('ranking reorders by feedback without changing the item set', () => {
  const items = [
    { id: 'a', relevance: 0.8 },
    { id: 'b', relevance: 0.78 },
    { id: 'c', relevance: 0.7 },
  ];
  const aggregates = aggregateFeedback([
    { id: 'b', signal: 'useful' },
    { id: 'b', signal: 'useful' },
    { id: 'b', signal: 'useful' },
  ]);
  const order = rankByFeedback(items, aggregates).map((item) => item.id);
  assert.deepEqual(order, ['b', 'a', 'c']);
  assert.equal(new Set(order).size, 3);
});

test('ranking leaves items alone when there is no feedback', () => {
  const items = [{ id: 'a', relevance: 0.5 }, { id: 'b', relevance: 0.9 }];
  assert.deepEqual(rankByFeedback(items, new Map()).map((item) => item.id), ['a', 'b']);
});
