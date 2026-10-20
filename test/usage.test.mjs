// The cost card is only honest if the ledger is simple and sums correctly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from 'tabellio';
import { appendUsage, readUsage, usageSummary } from '../src/usage.js';

async function tempStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabellio-usage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return openStore(dir);
}

test('usage records injections, judge calls and semantic queries', async (t) => {
  const store = await tempStore(t);
  const now = Date.now();
  appendUsage(store, { at: now - 3000, mode: 'context', chars: 600, judge: 1, judgeMs: 900, semantic: 1, notes: 2 });
  appendUsage(store, { at: now - 2000, mode: 'notice', chars: 300, judge: 0, semantic: 1, notes: 1 });
  appendUsage(store, { at: now - 1000, mode: 'shadow', chars: 0, semantic: 1, notes: 3 });

  const events = readUsage(store);
  assert.equal(events.length, 3);
  assert.equal(events[0].mode, 'shadow');

  const summary = usageSummary(store);
  assert.equal(summary.recalls, 3);
  assert.equal(summary.injected, 2);
  assert.equal(summary.chars, 900);
  assert.equal(summary.tokensEst, 300);
  assert.equal(summary.judgeCalls, 1);
  assert.equal(summary.judgeMsAvg, 900);
  assert.equal(summary.semanticCalls, 3);
  assert.equal(summary.notes, 6);
});

test('usage only counts the requested window', async (t) => {
  const store = await tempStore(t);
  const now = Date.now();
  appendUsage(store, { at: now - 10 * 24 * 60 * 60 * 1000, mode: 'context', chars: 999 });
  appendUsage(store, { at: now - 1000, mode: 'context', chars: 30 });
  assert.equal(usageSummary(store, { days: 7 }).chars, 30);
  assert.equal(usageSummary(store, { days: 30 }).chars, 1029);
});
