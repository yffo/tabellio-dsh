import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, read, recallQuery, remember } from 'tabellio';
import { buildEditText, editNote, MAX_EDIT_BODY } from '../src/edit.js';
import { createToolDefinitions } from '../src/tools.js';
import { normalizeConfig } from '../src/config.js';

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-edit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: openStore(dir) };
};

test('editing writes a successor note and archives the old one', async (t) => {
  const { dir, store } = temp(t);
  const written = remember(store, { content: '发版流程：本地 npm publish，然后再推 tag。', title: '发版流程' });
  assert.equal(written.ok, true, written.reason);

  const result = editNote(store, { id: written.id, title: '发版流程', content: '发版流程：推 tag 触发 CI，不再本地 publish。' });
  assert.equal(result.ok, true, result.reason);
  assert.notEqual(result.id, written.id);
  assert.equal(result.superseded, written.id);
  assert.equal(result.oldRetired, true);

  const old = read(store, written.id);
  assert.equal(old.note.superseded_by, result.id);
  assert.ok(old.note.valid_to);
  const next = read(store, result.id);
  assert.equal(next.ok, true);
  assert.match(next.body, /推 tag 触发 CI/);
  assert.equal(next.note.provenance.source_ref, 'edit:' + written.id);

  const recalled = recallQuery(store, '发版流程怎么做', { budgetTokens: 400, maxNotes: 6 });
  const texts = (recalled.items || []).map((item) => String(item.content || '')).join('\n');
  assert.match(texts, /推 tag 触发 CI/);
  assert.doesNotMatch(texts, /然后再推 tag/);
});

test('editing with identical text reports unchanged instead of duplicating', (t) => {
  const { store } = temp(t);
  const written = remember(store, { content: '项目代号是青鸟计划，内部代号。', title: '项目代号' });
  const result = editNote(store, { id: written.id, content: '项目代号是青鸟计划，内部代号。' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unchanged');
});

test('editing refuses missing notes, empty text and over-limit text', (t) => {
  const { store } = temp(t);
  const written = remember(store, { content: '短笔记：用于边界测试。', title: '边界' });
  assert.equal(editNote(store, { id: 'NOT-EXISTS', content: 'x' }).reason, 'not_found');
  assert.equal(editNote(store, { id: written.id, content: '   ' }).reason, 'empty');
  const tooLong = editNote(store, { id: written.id, content: '很长的正文。'.repeat(80) });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, 'too_long');
  assert.equal(tooLong.limit, MAX_EDIT_BODY);
});

test('buildEditText keeps scope, trust and tags and links supersedes', (t) => {
  const { store } = temp(t);
  const written = remember(store, { content: '原内容：先备份再升级。', title: '升级步骤' });
  const current = read(store, written.id);
  const text = buildEditText(current, { content: '# 升级步骤\n\n新内容：先升级再补备份。' });
  assert.match(text, /^---\n/);
  assert.match(text, new RegExp('supersedes: \\["' + written.id + '"\\]'));
  assert.match(text, /# 升级步骤/);
  assert.match(text, /tags: \[.*"edited".*\]/);
});

test('the edit tool reports success and the unchanged case', async (t) => {
  const { dir, store } = temp(t);
  const written = remember(store, { content: '工具编辑测试：旧版本内容。', title: '工具编辑' });
  const defs = createToolDefinitions({ settings: normalizeConfig({ storePath: dir }), getStore: () => store });
  const edit = defs.find((tool) => tool.name === 'tabellio_edit');
  const done = await edit.execute({ id: written.id, content: '工具编辑测试：新版本内容。' });
  assert.equal(done.ok, true);
  assert.equal(done.old_retired, true);
  assert.equal(read(store, done.id).ok, true);
  const again = await edit.execute({ id: done.id, content: '工具编辑测试：新版本内容。' });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'unchanged');
});
