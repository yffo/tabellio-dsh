import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, remember } from 'tabellio';
import { buildNotesPage, buildReport, renderReport } from '../src/report.js';
import { createToolDefinitions } from '../src/tools.js';
import { normalizeConfig } from '../src/config.js';

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tabellio-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('report on an empty store is all zeros and says so', (t) => {
  const dir = temp(t);
  const report = buildReport(openStore(dir), { days: 7, limit: 10 });
  assert.equal(report.notes_total, 0);
  assert.equal(report.notes_added, 0);
  assert.deepEqual(report.added, []);
  assert.match(renderReport(report), /这周没有新记忆/);
});

test('report counts notes written today and lists their titles', (t) => {
  const dir = temp(t);
  const store = openStore(dir);
  remember(store, { content: '记忆周报测试笔记一号：项目代号是青鸟计划。' }, { writtenBy: 'test' });
  remember(store, { content: '记忆周报测试笔记二号：发布流程走 tag 加 CI。' }, { writtenBy: 'test' });

  const report = buildReport(store, { days: 7, limit: 10 });
  assert.equal(report.notes_total, 2);
  assert.equal(report.notes_added, 2);
  assert.equal(report.truncated, 0);
  assert.ok(report.added.every((note) => note.id.length > 0 && note.title.length > 0 && Number.isFinite(Date.parse(note.valid_from))));
  const text = renderReport(report);
  assert.match(text, /新增 2 条/);
  assert.match(text, /青鸟计划|发布流程/);
});

test('report ignores notes older than the window', (t) => {
  const dir = temp(t);
  const store = openStore(dir);
  remember(store, { content: '记忆周报测试笔记三号：今天刚写的约定。' }, { writtenBy: 'test' });
  mkdirSync(join(dir, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'notes', 'OLD-NOTE.md'), [
    '---',
    'schema: memory.note/1',
    'id: OLD-NOTE',
    'kind: semantic',
    'valid_from: "2020-01-01T00:00:00+08:00"',
    '---',
    '',
    '# 很旧的笔记',
    '这条不在最近 7 天窗口内。',
  ].join('\n'));

  const report = buildReport(store, { days: 7, limit: 10 });
  assert.equal(report.notes_total, 2);
  assert.equal(report.notes_added, 1);
  assert.match(report.added[0].title, /今天刚写/);
  assert.doesNotMatch(renderReport(report), /很旧的笔记/);
});

test('tabellio_report tool returns the window and respects limit', async (t) => {
  const dir = temp(t);
  const store = openStore(dir);
  remember(store, { content: '周报工具笔记甲：以后都用 pnpm。' }, { writtenBy: 'test' });
  remember(store, { content: '周报工具笔记乙：脚本统一放 archive。' }, { writtenBy: 'test' });

  const defs = createToolDefinitions({ settings: normalizeConfig({ storePath: dir }), getStore: () => store });
  const tool = defs.find((item) => item.name === 'tabellio_report');
  assert.ok(tool, 'tabellio_report should be registered');

  const value = await tool.execute({ days: 30, limit: 1 });
  assert.equal(value.ok, true);
  assert.equal(value.days, 30);
  assert.equal(value.notes_added, 2);
  assert.equal(value.added.length, 1);
  assert.equal(value.truncated, 1);
  assert.equal(typeof value.plain, 'string');
  assert.match(tool.output.render({}, value)[0].text, /记忆周报/);
});

test('notes page reads frontmatter and paginates by valid_from desc', (t) => {
  const dir = temp(t);
  mkdirSync(join(dir, 'notes'), { recursive: true });
  const write = (id, day, title) => {
    writeFileSync(
      join(dir, 'notes', `${id}.md`),
      `---\nkind: semantic\nvalid_from: 2026-10-${day}T00:00:00.000Z\n---\n# ${title}\n\n正文。\n`,
    );
  };
  write('p1', '14', '较早的笔记');
  write('p2', '18', '最新的笔记');
  write('p3', '16', '中间的笔记');

  const store = { store: dir };
  const page = buildNotesPage(store, { offset: 0, limit: 2 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.items.map((n) => n.id), ['p2', 'p3']);
  assert.equal(page.items[0].title, '最新的笔记');

  const next = buildNotesPage(store, { offset: 2, limit: 2 });
  assert.deepEqual(next.items.map((n) => n.id), ['p1']);
});

test('notes page filters by kind and by days', (t) => {
  const dir = temp(t);
  mkdirSync(join(dir, 'notes'), { recursive: true });
  const write = (id, kind, iso, title) => {
    writeFileSync(
      join(dir, 'notes', `${id}.md`),
      `---\nkind: ${kind}\nvalid_from: ${iso}\n---\n# ${title}\n\n正文。\n`,
    );
  };
  write('s1', 'semantic', '2026-10-18T00:00:00.000Z', '语义笔记');
  write('p1', 'procedural', '2026-10-18T00:00:00.000Z', '流程笔记');
  write('s2', 'semantic', '2026-09-01T00:00:00.000Z', '上个月的语义笔记');

  const store = { store: dir };
  const now = Date.parse('2026-10-19T00:00:00.000Z');
  const procedural = buildNotesPage(store, { kind: 'procedural', now });
  assert.deepEqual(procedural.items.map((n) => n.id), ['p1']);
  assert.equal(procedural.total, 1);

  const recent = buildNotesPage(store, { days: 7, now });
  assert.deepEqual(recent.items.map((n) => n.id).sort(), ['p1', 's1']);

  const both = buildNotesPage(store, { kind: 'semantic', days: 7, now });
  assert.deepEqual(both.items.map((n) => n.id), ['s1']);
});
