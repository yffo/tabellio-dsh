import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, remember } from 'tabellio';
import {
  OUTCOME_FILE,
  appendOutcome,
  hasCorrectionCue,
  maybeRecordCorrection,
  outcomePenalties,
  rankByOutcome,
  readOutcomes,
  sharedTokenCount,
} from '../src/outcome.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-outcome-'));

test('outcome lines round-trip and penalties honour the window', () => {
  const dir = temp();
  const store = openStore(dir);
  assert.equal(appendOutcome(store, { noteIds: [] }).ok, false);
  appendOutcome(store, { noteIds: ['a', 'b'], at: Date.now() });
  appendOutcome(store, { noteIds: ['a'], at: Date.now() - 40 * 24 * 60 * 60 * 1000 });
  const rows = readOutcomes(store);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].noteIds, ['a', 'b']);
  const penalties = outcomePenalties(store);
  assert.equal(penalties.get('a'), 1);
  assert.equal(penalties.get('b'), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ranking demotes corrected notes without dropping them', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ranked = rankByOutcome(items, new Map([['a', 3]]));
  assert.deepEqual(ranked.map((item) => item.id), ['b', 'c', 'a']);
  assert.equal(ranked.length, 3);
});

test('correction attribution requires a cue and visible overlap', () => {
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
  assert.ok(hit.overlap >= 2);
  assert.equal(readOutcomes(store).length, 1);
  assert.ok(fs.existsSync(path.join(dir, OUTCOME_FILE)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stale injections are forgotten instead of blamed', () => {
  const dir = temp();
  const store = openStore(dir);
  const note = remember(store, { content: '# 项目代号\n\n项目代号是青鸟。' });
  const state = { injectedIds: [note.id], injectedAt: Date.now() - 11 * 60 * 1000, injectedQuery: '代号' };
  assert.equal(maybeRecordCorrection({ store, state, text: '不对，项目代号是白鹭。' }), null);
  assert.deepEqual(state.injectedIds, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shared tokens ignore unrelated sentences', () => {
  assert.equal(sharedTokenCount('项目代号是什么', '项目代号是青鸟'), 4);
  assert.equal(sharedTokenCount('帮我翻译这段英文', '项目代号是青鸟'), 0);
});
