import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, remember } from 'tabellio';
import { appendAudit } from '../src/audit.js';
import { appendUsage } from '../src/usage.js';
import { appendJudgeEvent, appendJudgeReview } from '../src/judge-log.js';
import { buildWeekly, renderWeekly } from '../src/weekly.js';

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-dsh-weekly-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('weekly report aggregates recall, cost, judge and notes in one window', (t) => {
  const dir = temp(t);
  const store = openStore(dir);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const first = remember(store, { text: '# 项目代号\n\n项目代号是青鸟。' });
  assert.equal(first.ok, true);

  appendAudit(store, { at: now - day, mode: 'context', query: '项目代号', count: 1, judged: true, chars: 300, titles: ['项目代号'] });
  appendAudit(store, { at: now - day, mode: 'suppressed', query: '今天天气', refused: true, reason: 'no_memory_intent' });
  appendAudit(store, { at: now - day * 9, mode: 'context', query: 'old', count: 1, chars: 999 });

  appendUsage(store, { at: now - day, mode: 'context', chars: 300, judge: 1, judgeMs: 900, semantic: 1, notes: 1 });
  appendUsage(store, { at: now - day * 9, mode: 'context', chars: 999 });

  appendJudgeEvent(store, { at: now - day, query: '项目代号', kept: [{ id: 'a', title: 'A' }], dropped: [{ id: 'b', title: 'B' }] });
  appendJudgeReview(store, { at: now - day, ok: true });

  const weekly = buildWeekly(store, { days: 7, now });
  assert.equal(weekly.days, 7);
  assert.equal(weekly.recall.runs, 2);
  assert.equal(weekly.recall.byMode.context, 1);
  assert.equal(weekly.recall.byMode.suppressed, 1);
  assert.equal(weekly.recall.judge.kept, 1);
  assert.equal(weekly.context.injected, 1);
  assert.equal(weekly.context.chars, 300);
  assert.equal(weekly.context.tokensEst, 100);
  assert.equal(weekly.judge.calls, 1);
  assert.equal(weekly.judge.reviewed, 1);
  assert.equal(weekly.judge.agreed, 1);
  assert.equal(weekly.notes.total, 1);
  assert.equal(weekly.notes.added, 1);

  const text = renderWeekly(weekly);
  assert.match(text, /召回 2 次/);
  assert.match(text, /复核 1 次（同意 1）/);
});

test('weekly report clamps its window and tolerates an empty store', (t) => {
  const dir = temp(t);
  const store = openStore(dir);
  const weekly = buildWeekly(store, { days: 99 });
  assert.equal(weekly.days, 31);
  assert.equal(weekly.recall.runs, 0);
  assert.equal(weekly.context.chars, 0);
  assert.equal(weekly.notes.total, 0);
});
