// The judge-sampling log is what makes a model verdict reviewable later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from 'tabellio';
import { appendJudgeEvent, appendJudgeReview, judgeQuality, judgeTrend, readJudgeLog, readJudgeReviews } from '../src/judge-log.js';

async function tempStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabellio-judge-log-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return openStore(dir);
}

test('judge events are stored newest first with kept and dropped titles', async (t) => {
  const store = await tempStore(t);
  appendJudgeEvent(store, { at: 1000, query: '发布流程', kept: [{ id: 'a', title: '发布：推 tag' }], dropped: [{ id: 'b', title: '无关笔记' }] });
  appendJudgeEvent(store, { at: 2000, query: '阈值', kept: [{ id: 'c', title: '阈值' }], dropped: [], verdict: 'verdict' });
  const events = readJudgeLog(store, { limit: 10 });
  assert.equal(events.length, 2);
  assert.equal(events[0].at, 2000);
  assert.deepEqual(events[1].kept, ['发布：推 tag']);
  assert.deepEqual(events[1].dropped, ['无关笔记']);
});

test('reviews attach to one decision and quality counts them', async (t) => {
  const store = await tempStore(t);
  const now = Date.now();
  appendJudgeEvent(store, { at: now - 2000, query: 'a', kept: [], dropped: [{ id: 'x', title: 'x' }] });
  appendJudgeEvent(store, { at: now - 1000, query: 'b', kept: [], dropped: [{ id: 'y', title: 'y' }] });
  assert.deepEqual(judgeQuality(store), { total: 2, reviewed: 0, agreed: 0 });
  assert.equal(appendJudgeReview(store, { at: now - 2000, ok: false }), true);
  assert.equal(appendJudgeReview(store, { at: now - 1000, ok: true }), true);
  assert.equal(readJudgeReviews(store).get(now - 2000), false);
  assert.deepEqual(judgeQuality(store), { total: 2, reviewed: 2, agreed: 1 });
});

test('a broken log line never hides the rest of the log', async (t) => {
  const store = await tempStore(t);
  appendJudgeEvent(store, { at: 1000, query: 'a' });
  const { appendFileSync } = await import('node:fs');
  appendFileSync(path.join(store.store, 'judge-log.jsonl'), '{not json\n');
  appendJudgeEvent(store, { at: 2000, query: 'b' });
  const events = readJudgeLog(store);
  assert.equal(events.length, 2);
  assert.equal(events[0].at, 2000);
});

test('judgeTrend buckets weeks and reports review agreement per week', async (t) => {
  const store = await tempStore(t);
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;

  appendJudgeEvent(store, { at: now - week * 2 - 1000, query: 'old', kept: [{ id: 'a' }], dropped: [] });
  appendJudgeReview(store, { at: now - week * 2 - 1000, ok: true });
  appendJudgeEvent(store, { at: now - week - 1000, query: 'mid', kept: [], dropped: [{ id: 'b' }] });
  appendJudgeReview(store, { at: now - week - 1000, ok: false });
  appendJudgeEvent(store, { at: now - 1000, query: 'new', kept: [{ id: 'c' }], dropped: [] });

  const trend = judgeTrend(store, { weeks: 3, now });
  assert.equal(trend.length, 3);
  const [oldest, middle, newest] = trend;
  assert.equal(oldest.total, 1);
  assert.equal(oldest.reviewed, 1);
  assert.equal(oldest.agreed, 1);
  assert.equal(oldest.agreement, 1);
  assert.equal(middle.total, 1);
  assert.equal(middle.agreed, 0);
  assert.equal(middle.agreement, 0);
  assert.equal(newest.total, 1);
  assert.equal(newest.reviewed, 0);
  assert.equal(newest.agreement, null);
});
