import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from 'tabellio';
import { appendAudit, auditCounts, auditPath, readAudit, toAuditEntry } from '../src/audit.js';

const tempStore = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-audit-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return openStore(dir);
};

test('appendAudit writes one compact JSONL line with bounded fields', (t) => {
  const store = tempStore(t);
  appendAudit(store, {
    query: '记'.repeat(200),
    mode: 'context',
    count: 2,
    reason: 'x'.repeat(300),
    titles: ['a'.repeat(120), 'b', 'c', 'd'],
  });
  const file = auditPath(store);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.mode, 'context');
  assert.equal(entry.count, 2);
  assert.equal(entry.query.length, 120);
  assert.equal(entry.reason.length, 160);
  assert.equal(entry.titles.length, 3);
  assert.equal(entry.titles[0].length, 80);
});

test('readAudit returns newest first, honors the limit, and skips torn lines', (t) => {
  const store = tempStore(t);
  for (let index = 0; index < 5; index += 1) appendAudit(store, { at: Date.now() + index, query: `q${index}`, mode: 'notice' });
  fs.appendFileSync(auditPath(store), '{"broken":\n', 'utf8');
  const rows = readAudit(store, { limit: 3 });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.query), ['q4', 'q3', 'q2']);
  assert.deepEqual(auditCounts(rows), { notice: 3 });
});

test('readAudit is empty for a store without audit data', (t) => {
  const store = tempStore(t);
  assert.deepEqual(readAudit(store), []);
});

test('toAuditEntry normalizes unknown input instead of throwing', () => {
  const entry = toAuditEntry(null);
  assert.equal(entry.mode, 'unknown');
  assert.equal(entry.count, 0);
  assert.deepEqual(entry.titles, []);
  assert.equal(Number.isFinite(entry.at), true);
});

test('recall decisions append audit lines through the plugin pre-step', async (t) => {
  const { apply } = await import('../index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-audit-plugin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map();
  const ctx = {
    get() { return undefined; },
    tools: { register() {} },
    on(event, handler) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(handler); },
    logger: { warn() {}, info() {}, debug() {} },
  };
  apply(ctx, { storePath: dir, autoRecall: true, capture: 'off', recallIntentGate: true });
  const who = { id: 'agent-audit', session: { id: 'session-audit', header: { delegationDepth: 0 } }, options: {} };
  await handlers.get('agent/pre-step')[0]({ agent: who }, async () => ({
    kind: 'enter',
    messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: '今天天气怎么样？' }], source: { kind: 'user' } }],
  }));
  const store = openStore(dir);
  const rows = readAudit(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].query, '今天天气怎么样？');
  assert.ok(['suppressed', 'refused'].includes(rows[0].mode));
});
