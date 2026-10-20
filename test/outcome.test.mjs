import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, readFeedback, remember, recordFeedback } from 'tabellio';
import {
  hasCorrectionCue,
  maybeRecordCorrection,
  outcomeSummary,
  sharedTokenCount,
} from '../src/outcome.js';
import { createToolDefinitions } from '../src/tools.js';
import { normalizeConfig } from '../src/config.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-outcome-'));

test('corrections land in the core feedback log, not a plugin file', () => {
  const dir = temp();
  const store = openStore(dir);
  const note = remember(store, { content: '# 项目代号\n\n项目代号是青鸟，发布前确认一遍。' });
  assert.equal(note.ok, true);
  const state = { injectedIds: [note.id], injectedAt: Date.now(), injectedQuery: '项目代号是什么' };
  assert.equal(hasCorrectionCue('今天天气不错'), false);
  assert.equal(maybeRecordCorrection({ store, state, text: '不对，这个目录应该放 archive。' }), null);
  const hit = maybeRecordCorrection({ store, state, text: '不对，项目代号不是青鸟，是白鹭。' });
  assert.ok(hit);
  assert.equal(hit.noteIds.length, 1);
  assert.ok(hit.overlap >= 3);
  const rows = readFeedback(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].signal, 'corrected');
  assert.deepEqual(rows[0].noteIds, [note.id]);
  assert.equal(fs.existsSync(path.join(dir, 'outcome.jsonl')), false, 'the plugin no longer writes its own log');
  assert.equal(fs.existsSync(path.join(dir, 'runs', 'feedback.jsonl')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stale injections are forgotten instead of blamed', () => {
  const dir = temp();
  const store = openStore(dir);
  const note = remember(store, { content: '# 项目代号\n\n项目代号是青鸟。' });
  const state = { injectedIds: [note.id], injectedAt: Date.now() - 11 * 60 * 1000, injectedQuery: '代号' };
  assert.equal(maybeRecordCorrection({ store, state, text: '不对，项目代号是白鹭。' }), null);
  assert.deepEqual(state.injectedIds, []);
  assert.equal(readFeedback(store).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('outcome summary counts only corrections in the window', () => {
  const dir = temp();
  const store = openStore(dir);
  const now = Date.now();
  recordFeedback(store, { id: 'a', signal: 'corrected', at: now });
  recordFeedback(store, { id: 'a', signal: 'corrected', at: now - 40 * 24 * 60 * 60 * 1000 });
  recordFeedback(store, { id: 'b', signal: 'useful', at: now });
  const summary = outcomeSummary(store, { days: 30, now });
  assert.deepEqual(summary, { corrected: 1, notes: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the feedback tool records through the core and returns its counts', async () => {
  const dir = temp();
  const store = openStore(dir);
  const note = remember(store, { content: '# 发版方式\n\n发版走 tag，不手动上传。' });
  const defs = createToolDefinitions({ settings: normalizeConfig({ storePath: dir }), getStore: () => store });
  const tool = defs.find((def) => def.name === 'tabellio_feedback');
  const result = await tool.execute({ id: note.id, signal: 'useful' });
  assert.equal(result.ok, true);
  assert.equal(result.counts.total, 1);
  assert.equal(result.counts.useful, 1);
  const rows = readFeedback(store);
  assert.equal(rows[0].source, 'dsh:tool');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shared tokens ignore unrelated sentences', () => {
  assert.equal(sharedTokenCount('项目代号是什么', '项目代号是青鸟'), 4);
  assert.equal(sharedTokenCount('帮我翻译这段英文', '项目代号是青鸟'), 0);
});
