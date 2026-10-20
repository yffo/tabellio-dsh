// Reflection is proposal-only and fail-closed: the parser rejects invented
// source ids, and any model failure writes nothing. These tests pin that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addCandidate, openStore, remember, status } from 'tabellio';
import {
  buildReflectPrompt,
  parseReflectReply,
  reflectNotes,
  selectReflectNotes,
  writeReflections,
} from '../src/reflect.js';

const temp = async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabellio-reflect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const streamOf = (parts) => ({
  stream() {
    return (async function* () {
      for (const part of parts) {
        if (part instanceof Error) throw part;
        yield part;
      }
      yield { type: 'finish' };
    })();
  },
});

const selection = { provider: 'deepseek-account', model: 'deepseek-flash' };

test('reflect prompt lists notes with ids and demands strict JSON', () => {
  const prompt = buildReflectPrompt([{ id: 'note-1', title: '发布流程', body: '先打 tag。' }]);
  assert.match(prompt, /\[note-1\] 发布流程/);
  assert.match(prompt, /"title"/);
  assert.match(prompt, /empty array/);
});

test('reflect parser keeps grounded summaries and drops invented sources', () => {
  const reply = JSON.stringify([
    { title: '发布当前状态', body: '发布已改为 tag 触发 GitHub Actions 自动发布，不再手动 npm publish。', sources: ['note-1', 'note-2'] },
    { title: '编造', body: '模型自己编出来的一段不存在的状态摘要内容，长度也够但没有任何来源。', sources: ['nope'] },
  ]);
  const out = parseReflectReply(reply, ['note-1', 'note-2']);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].sources, ['note-1', 'note-2']);
});

test('reflect parser returns [] for an explicit empty array and null for junk', () => {
  assert.deepEqual(parseReflectReply('[]', ['a']), []);
  assert.equal(parseReflectReply('not json', ['a']), null);
  assert.equal(parseReflectReply('', ['a']), null);
});

test('selectReflectNotes keeps recent non-external active notes', async (t) => {
  const dir = await temp(t);
  const store = openStore(dir);
  remember(store, { content: '项目代号是青鸟计划。' });
  remember(store, { content: '外部资料：美国节点 1080 端口。' }, { trust: 'external' });
  const picked = selectReflectNotes(store, { days: 14, max: 20 });
  assert.equal(picked.length, 1);
  assert.match(String(picked[0].title ?? ''), /青鸟/);
});

test('written reflections are candidates, never formal notes', async (t) => {
  const dir = await temp(t);
  const store = openStore(dir);
  const written = writeReflections(
    (input, options) => addCandidate(store, input, options),
    [{ title: '发布状态', body: '发布已改为 tag 触发自动发布，不再手动 npm publish，回滚仍走本地。', sources: ['note-1'] }],
  );
  assert.equal(written.length, 1);
  assert.equal(status(store).candidates, 1);
  assert.equal(status(store).notes, 0);
});

test('reflectNotes fails closed on stream errors and needs two notes', async () => {
  const llm = {
    stream() {
      return (async function* () {
        throw new Error('boom');
      })();
    },
  };
  const notes = [
    { id: 'a', title: 'A', body: 'a'.repeat(80) },
    { id: 'b', title: 'B', body: 'b'.repeat(80) },
  ];
  assert.equal(await reflectNotes({ llm, selection, notes }), null);
  assert.equal(await reflectNotes({ llm: streamOf([{ type: 'text-delta', text: '[]' }]), selection, notes: [notes[0]] }), null);
});

test('reflectNotes parses a real reply through the stream', async () => {
  const notes = [
    { id: 'note-1', title: '发布流程', body: '旧流程是手动 npm publish。' },
    { id: 'note-2', title: '发布改动', body: '现在推送 tag 由 Actions 自动发布。' },
  ];
  const reply = JSON.stringify([{ title: '发布状态', body: '发布改为 tag 触发 Actions 自动发布，手动 npm publish 不再使用，回滚仍可本地执行。', sources: ['note-1', 'note-2'] }]);
  const llm = streamOf([{ type: 'text-delta', text: reply }]);
  const out = await reflectNotes({ llm, selection, notes });
  assert.equal(out.length, 1);
});
