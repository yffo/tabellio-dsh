// Conflict surfacing + human-gated merge. The merge path is the only write in
// the plugin that closes existing notes, so these tests pin both halves: the
// dry run never writes, and confirm=true leaves the old notes superseded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore, read, remember, status } from 'tabellio';
import { findConflicts } from '../src/conflicts.js';
import { createToolDefinitions } from '../src/tools.js';
import { normalizeConfig } from '../src/config.js';

const temp = async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabellio-merge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const seedPair = async (t) => {
  const dir = await temp(t);
  const store = openStore(dir);
  const oldNote = remember(store, { content: '发布流程：手动 npm publish，发布前跑 npm test，发布后通知。' });
  const newNote = remember(store, { content: '发布流程改成推送 tag，GitHub Actions 自动 npm publish；不再手动发布。' });
  const unrelated = remember(store, { content: '周末计划：去山里徒步，带两升水。' });
  const defs = createToolDefinitions({ settings: normalizeConfig({ storePath: dir }), getStore: () => store });
  const tool = (name) => defs.find((definition) => definition.name === name);
  return { dir, store, oldNote, newNote, unrelated, tool };
};

test('findConflicts surfaces a rewritten convention but skips unrelated notes', async (t) => {
  const { store, oldNote, newNote, unrelated } = await seedPair(t);
  const found = findConflicts(store.scan(), { days: 30, limit: 10 });
  assert.ok(found.pairs.length >= 1);
  const pair = found.pairs.find((item) => [item.older.id, item.newer.id].includes(newNote.id));
  assert.ok(pair);
  assert.ok(pair.signals.includes('replacement_wording'));
  assert.equal(found.pairs.some((item) => [item.older.id, item.newer.id].includes(unrelated.id)), false);
  assert.ok(oldNote.id);
});

test('conflicts tool is read-only and reports pairs', async (t) => {
  const { store, tool } = await seedPair(t);
  const before = status(store).notes;
  const result = await tool('tabellio_conflicts').execute({ days: 30 });
  assert.equal(result.ok, true);
  assert.ok(result.pairs.length >= 1);
  assert.equal(status(store).notes, before);
  assert.match(result.message, /确认要替换|按重叠度/);
});

test('merge dry-run plans but writes nothing', async (t) => {
  const { store, oldNote, newNote, tool } = await seedPair(t);
  const before = status(store).notes;
  const result = await tool('tabellio_merge').execute({ ids: [oldNote.id, newNote.id] });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.ok(result.target_id);
  assert.equal(status(store).notes, before);
});

test('merge confirm writes the target and supersedes both sources', async (t) => {
  const { store, oldNote, newNote, tool } = await seedPair(t);
  const result = await tool('tabellio_merge').execute({ ids: [oldNote.id, newNote.id], confirm: true });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.ok(result.target_id);
  const older = read(store, oldNote.id);
  const newer = read(store, newNote.id);
  assert.equal(older.ok, true);
  assert.equal(newer.ok, true);
  assert.equal(older.note.superseded_by, result.target_id);
  assert.equal(newer.note.superseded_by, result.target_id);
  assert.ok(older.note.valid_to);
});

test('merge refuses a single id and unknown ids', async (t) => {
  const { oldNote, tool } = await seedPair(t);
  const one = await tool('tabellio_merge').execute({ ids: [oldNote.id] });
  assert.equal(one.ok, false);
  assert.equal(one.reason, 'need_two_ids');
  const missing = await tool('tabellio_merge').execute({ ids: [oldNote.id, '01MISSING'] });
  assert.equal(missing.ok, false);
});

test('recall as_of excludes notes written after that moment', async (t) => {
  const { tool } = await seedPair(t);
  const recall = tool('tabellio_recall');
  const now = await recall.execute({ query: '发布流程 手动 npm publish', maxNotes: 6 });
  assert.equal(now.items.length > 0, true);
  const past = await recall.execute({ query: '发布流程 手动 npm publish', maxNotes: 6, as_of: '2020-01-01' });
  assert.equal(past.items.length, 0);
});
