// The write-side worthiness check is optional and fail-open: these tests pin
// the prompt, the tolerant parser, and "keep the candidates when the model or
// the host call breaks".
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorthPrompt, filterCandidatesByWorth, judgeWorth, parseWorthReply } from '../src/worth.js';

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
const candidates = [
  { sentence: '以后都用 pnpm。' },
  { sentence: '把这次临时端口改成 8080。' },
  { sentence: '线上库只读。' },
];

test('worth prompt numbers the candidates and asks for a JSON keep list', () => {
  const prompt = buildWorthPrompt(candidates);
  assert.match(prompt, /\[1\] 以后都用 pnpm。/);
  assert.match(prompt, /\[3\] 线上库只读。/);
  assert.match(prompt, /\{"keep":\[1,2\]\}/);
});

test('worth parser accepts JSON, fenced JSON and yes/no lines', () => {
  assert.deepEqual([...parseWorthReply('{"keep":[1,3]}', 3)], [0, 2]);
  assert.deepEqual([...parseWorthReply('```json\n{"keep":[2]}\n```', 3)], [1]);
  assert.deepEqual([...parseWorthReply('{"keep":[]}', 3)], []);
  assert.deepEqual([...parseWorthReply('1 yes\n2 no\n3 yes', 3)], [0, 2]);
  assert.equal(parseWorthReply('', 3), null);
  assert.equal(parseWorthReply('{"keep":[9]}', 3), null, 'out-of-range means no verdict');
});

test('judgeWorth keeps only the indices the model picked', async () => {
  const llm = streamOf([{ type: 'text-delta', text: '{"keep": [1, 3]}' }]);
  const kept = await judgeWorth({ llm, selection, candidates });
  assert.deepEqual([...kept], [0, 2]);
});

test('filterCandidatesByWorth keeps everything when the host call fails', async () => {
  const llm = {
    stream() {
      return (async function* () {
        throw new Error('boom');
      })();
    },
  };
  const result = await filterCandidatesByWorth({ llm, selection, candidates });
  assert.equal(result.judged, false);
  assert.equal(result.candidates.length, 3);
});

test('filterCandidatesByWorth can keep nothing — the caller writes no candidate', async () => {
  const llm = streamOf([{ type: 'text-delta', text: '{"keep": []}' }]);
  const result = await filterCandidatesByWorth({ llm, selection, candidates });
  assert.equal(result.judged, true);
  assert.equal(result.candidates.length, 0);
});
