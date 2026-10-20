// The LLM judge is optional and fail-open: these tests pin the parser and the
// "keep everything when the model call breaks" contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore, remember } from 'tabellio';
import { buildJudgePrompt, createJudgeCache, filterByJudge, judgeCacheKey, judgeNotes, parseJudgeReply } from '../src/judge.js';

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

const selection = { provider: 'deepseek', model: 'flash' };

test('the judge prompt numbers the notes and states the strict criterion', () => {
  const prompt = buildJudgePrompt('项目代号是什么', [
    { title: '项目代号', body: '项目代号是青鸟计划。' },
    { title: '发布流程', body: '发布前要跑测试。' },
  ]);
  assert.match(prompt, /\[1\] 项目代号/);
  assert.match(prompt, /\[2\] 发布流程/);
  assert.match(prompt, /Question: 项目代号是什么/);
  assert.match(prompt, /JSON only/);
});

test('parseJudgeReply accepts JSON, fenced JSON and line lists', () => {
  assert.deepEqual([...parseJudgeReply('{"keep":[1,3]}', 3)], [0, 2]);
  assert.deepEqual([...parseJudgeReply('```json\n{"keep":[2]}\n```', 3)], [1]);
  assert.deepEqual([...parseJudgeReply('1 yes\n2 no\n3 no', 3)], [0]);
  assert.equal(parseJudgeReply('{"keep":[]}', 3).size, 0);
  assert.equal(parseJudgeReply('sure!', 3), null);
  assert.equal(parseJudgeReply('', 3), null);
  assert.equal(parseJudgeReply('{"keep":[9]}', 3), null);
});

test('judgeNotes streams a reply and maps kept indices', async () => {
  const llm = streamOf([{ type: 'text-delta', index: 0, text: '{"keep":[2]}' }]);
  const notes = [
    { id: 'a', title: '天气', body: '今天天气不错，适合出门散步。' },
    { id: 'b', title: '项目', body: '项目代号是青鸟。' },
  ];
  const kept = await judgeNotes({ llm, selection, query: '项目代号是什么', notes });
  assert.deepEqual([...kept], [1]);
});

test('judgeNotes fails open on stream errors and missing selection', async () => {
  const broken = streamOf([new Error('NO_ADAPTER')]);
  const notes = [{ id: 'a', title: 't', body: 'b' }];
  assert.equal(await judgeNotes({ llm: broken, selection, query: 'q', notes }), null);
  assert.equal(await judgeNotes({ llm: streamOf([]), selection: null, query: 'q', notes }), null);
  assert.equal(await judgeNotes({ llm: null, selection, query: 'q', notes }), null);
});

test('filterByJudge drops notes the model rejects, and keeps all on failure', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabellio-judge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  const first = remember(store, { content: '项目代号是青鸟计划。' }, { writtenBy: 'test', id: 'n1' });
  const second = remember(store, { content: '今天天气不错，适合出门散步。' }, { writtenBy: 'test', id: 'n2' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const items = [{ id: first.id, title: '项目代号' }, { id: second.id, title: '天气' }];

  const keepFirst = streamOf([{ type: 'text-delta', text: '{"keep":[1]}' }]);
  const filtered = await filterByJudge({ llm: keepFirst, selection, query: '项目代号是什么', items, store });
  assert.equal(filtered.judged, true);
  assert.deepEqual(filtered.items.map((item) => item.id), [first.id]);

  const broken = streamOf([new Error('AUTH')]);
  const fallback = await filterByJudge({ llm: broken, selection, query: '项目代号是什么', items, store });
  assert.equal(fallback.judged, false);
  assert.deepEqual(fallback.items.map((item) => item.id), [first.id, second.id]);
});

test('items beyond the judge window are kept, not silently dropped', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'judge-tail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  const ids = [];
  for (let index = 1; index <= 6; index += 1) {
    const written = remember(store, { content: `项目记录第 ${index} 条：代号青鸟计划。` }, { writtenBy: 'test' });
    assert.equal(written.ok, true);
    ids.push(written.id);
  }
  const items = ids.map((id) => ({ id }));
  const llm = {
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '{"keep":[]}' };
        yield { type: 'finish' };
      })();
    },
  };
  const filtered = await filterByJudge({ llm, selection: { provider: 'p', model: 'm' }, query: '项目代号是什么？', items, store });
  assert.equal(filtered.judged, true);
  assert.deepEqual(filtered.items.map((item) => item.id), ids.slice(4), 'the two unjudged tail items stay');

  const all = await filterByJudge({ llm, selection: { provider: 'p', model: 'm' }, query: '项目代号是什么？', items, store, maxNotes: 6 });
  assert.equal(all.judged, true);
  assert.equal(all.items.length, 0, 'a wider judge window can veto the whole list');
});

test('judge reports the raw reply for diagnostics', async () => {
  let seen = '';
  const llm = {
    async *stream() {
      yield { type: 'text-delta', index: 0, text: '{"keep": ' };
      yield { type: 'text-delta', index: 0, text: '[1]}' };
    },
  };
  const kept = await judgeNotes({
    llm,
    selection: { provider: 'p', model: 'm' },
    query: '问题',
    notes: [{ id: 'a', title: 't', body: 'b' }],
    onReply: (text) => { seen = text; },
  });
  assert.equal(seen, '{"keep": [1]}');
  assert.deepEqual([...kept], [0]);
});

test('a judge verdict cache expires and keys include the note set', () => {
  let now = 1000;
  const cache = createJudgeCache({ ttlMs: 5000, now: () => now });
  const key = judgeCacheKey('项目代号是什么？', ['a', 'b']);
  assert.equal(cache.get(key), null);
  cache.set(key, { kept: ['a'] });
  assert.deepEqual(cache.get(key), { kept: ['a'] });
  assert.notEqual(judgeCacheKey('项目代号是什么？', ['a', 'c']), key);
  now += 5001;
  assert.equal(cache.get(key), null);
});
