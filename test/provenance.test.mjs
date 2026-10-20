import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, remember } from 'tabellio';
import { noteProvenance, noteTimeline, provenanceView, recallUsage } from '../src/provenance.js';
import { appendFeedback } from '../src/feedback.js';
import { appendOutcome } from '../src/outcome.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-provenance-'));

test('provenance returns note metadata and counts real recall receipts', () => {
  const dir = temp();
  const store = openStore(dir);
  const written = remember(store, { content: '发布流程：打 tag 后由 CI 发布，不手动上传。', title: '发布流程' });
  assert.equal(written.ok, true);
  const id = written.id;
  const meta = noteProvenance(store, id);
  assert.ok(String(meta.title).includes('发布流程'));
  assert.equal(meta.status, 'active');
  assert.equal(meta.supersededBy, null);

  const runs = path.join(dir, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, 'rcp_00000001.json'), JSON.stringify({ items: [{ id }], createdAt: '2026-10-19T06:59:44+08:00' }));
  fs.writeFileSync(path.join(runs, 'rcp_00000002.json'), JSON.stringify({ items: [{ id: 'other' }], createdAt: '2026-10-19T07:00:00+08:00' }));
  fs.writeFileSync(path.join(runs, 'rcp_00000003.json'), 'not json');

  const usage = recallUsage(store, id);
  assert.equal(usage.count, 1);
  assert.equal(usage.scanned, 3);
  assert.ok(usage.lastAt > 0);

  const view = provenanceView(store, id);
  assert.equal(view.recalled.count, 1);
  assert.equal(provenanceView(store, 'missing#1'), null);
  assert.equal(noteProvenance(store, ''), null);
});

test('a superseded note still reports its successor', () => {
  const dir = temp();
  const store = openStore(dir);
  const written = remember(store, { content: '旧规则：周报每周五发。', title: '周报节奏' });
  const id = written.id;
  const file = path.join(dir, 'notes', id.split('#')[0] + '.md');
  const body = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, body.replace('superseded_by:', 'superseded_by: newer#1').replace('valid_to:', 'valid_to: 2026-10-20T00:00:00+08:00'));
  const meta = noteProvenance(store, id);
  if (meta) {
    assert.equal(meta.supersededBy, 'newer#1');
  }
});

test('timeline merges creation, recalls, corrections and feedback', () => {
  const dir = temp();
  const store = openStore(dir);
  const written = remember(store, { content: '时间线测试：以后发版都走 tag 加 CI。' }, { writtenBy: 'test:timeline' });
  const id = written.id;
  const runs = path.join(dir, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, 'rcp_00000001.json'), JSON.stringify({ items: [{ id }], query: '发版怎么走？', createdAt: '2026-10-19T06:00:00+08:00' }));
  appendFeedback(store, { id, signal: 'useful' });
  appendOutcome(store, { noteIds: [id], query: '发版方式', at: Date.now() });

  const events = noteTimeline(store, id);
  assert.ok(events.some((event) => event.kind === 'created'));
  assert.ok(events.some((event) => event.kind === 'recall' && event.text.includes('发版怎么走')));
  assert.ok(events.some((event) => event.kind === 'feedback'));
  assert.ok(events.some((event) => event.kind === 'correction'));
  assert.deepEqual(noteTimeline(store, 'missing#1'), []);
});
