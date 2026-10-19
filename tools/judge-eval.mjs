// Measure the real (non-simulated) judge quality against a labeled query set.
//
// Usage:
//   JUDGE_MODEL=qwen3.6-35b-a3b-apex node tools/judge-eval.mjs /tmp/tabellio-final-recall/blind.json
//
// The query set stays outside the repo when it contains personal facts; this
// script only knows the `{queries:[{id,kind,query,gold?}]}` shape. It calls an
// OpenAI-compatible endpoint (default: the local llama-swap at :8080), replays
// the plugin's real recall gates, then asks the judge prompt to keep/answer.
import { readFileSync, writeFileSync } from 'node:fs';
import { openStore, recallQuery } from 'tabellio';
import { buildJudgePrompt, parseJudgeReply, readJudgeNotes } from '../src/judge.js';

const datasetPath = process.argv[2];
if (!datasetPath) {
  console.error('usage: node tools/judge-eval.mjs <labeled-queries.json>');
  process.exit(2);
}
const baseUrl = process.env.JUDGE_BASE_URL ?? 'http://127.0.0.1:8080/v1';
const model = process.env.JUDGE_MODEL ?? 'qwen3.6-35b-a3b-apex';
const storePath = process.env.TABELLIO_STORE ?? `${process.env.HOME}/memory/tabellio`;
const thresholds = {
  minRelevance: Number(process.env.MIN_RELEVANCE ?? 0.12),
  minScore: Number(process.env.MIN_SCORE ?? 0.1),
  minCoverage: Number(process.env.MIN_COVERAGE ?? 0.33),
};
const maxNotes = Number(process.env.MAX_NOTES ?? 6);
const judgeWindow = Number(process.env.JUDGE_WINDOW ?? 4);

async function complete(prompt, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: Number(process.env.JUDGE_MAX_TOKENS ?? 128),
        // Qwen3.6 spends most of a small budget on thinking and returns an
        // empty `content`; the eval only needs the JSON verdict.
        chat_template_kwargs: { enable_thinking: process.env.JUDGE_THINKING === '1' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
const queries = dataset.queries ?? dataset;
const store = openStore(storePath);

const rows = [];
let firstCall = true;
for (const q of queries) {
  const result = recallQuery(store, q.query, {
    budgetTokens: 500,
    maxNotes,
    includeCore: true,
    ...thresholds,
    saveReceipt: false,
  });
  const items = result?.refused ? [] : result?.items ?? [];
  const gold = new Set(q.gold ?? []);
  const notes = readJudgeNotes(store, items, judgeWindow);
  let kept = new Set(notes.map((note) => note.id));
  let parseOk = true;
  let reply = '';
  if (notes.length > 0) {
    const prompt = buildJudgePrompt(q.query, notes);
    try {
      if (firstCall) {
        process.stderr.write(`[judge-eval] loading ${model}…\n`);
        firstCall = false;
      }
      reply = await complete(prompt);
      const parsed = parseJudgeReply(reply, notes.length);
      if (parsed) kept = new Set(notes.filter((_, index) => parsed.has(index)).map((note) => note.id));
      else parseOk = false;
    } catch (error) {
      parseOk = false;
      process.stderr.write(`[judge-eval] judge failed for ${q.id}: ${error.message}\n`);
    }
  }
  const tail = items.filter((item) => !notes.some((note) => note.id === item.id)).map((item) => item.id);
  const recalledGold = [...gold].filter((id) => items.some((item) => item.id === id));
  const keptGold = recalledGold.filter((id) => kept.has(id));
  rows.push({
    id: q.id,
    kind: q.kind,
    query: q.query,
    recalled: items.map((item) => item.id),
    recalledGold,
    kept: [...kept],
    tail,
    keptGold,
    parseOk,
    reply: reply.slice(0, 160),
  });
  process.stderr.write(`[judge-eval] ${q.id} ${items.length} hits ${notes.length} judged ok=${parseOk}\n`);
}

const answerable = rows.filter((row) => row.kind === 'answerable' || row.recalledGold.length > 0);
const negatives = rows.filter((row) => row.kind !== 'answerable' && row.recalledGold.length === 0);
const recalledGoldTotal = answerable.reduce((n, row) => n + row.recalledGold.length, 0);
const keptGoldTotal = answerable.reduce((n, row) => n + row.keptGold.length, 0);
const judgedTotal = answerable.reduce((n, row) => n + row.kept.length, 0);
const keptNoise = answerable.reduce((n, row) => n + row.kept.length - row.keptGold.length, 0);
const negativeKept = negatives.reduce((n, row) => n + row.kept.length, 0);
const summary = {
  model,
  dataset: datasetPath,
  thresholds,
  queries: rows.length,
  answerable: answerable.length,
  negatives: negatives.length,
  recalledGold: recalledGoldTotal,
  keptGold: keptGoldTotal,
  notePrecision: judgedTotal ? Number((keptGoldTotal / judgedTotal).toFixed(3)) : null,
  noteRecall: recalledGoldTotal ? Number((keptGoldTotal / recalledGoldTotal).toFixed(3)) : null,
  keptNoise,
  negativeKept,
  parseFailures: rows.filter((row) => !row.parseOk && row.recalled.length > 0).length,
  injectedWithGold: answerable.filter((row) => row.keptGold.length > 0).length,
  rows,
};
const out = `/tmp/judge-eval-${model.replace(/[^a-z0-9.-]/gi, '_')}.json`;
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
console.log(`\nfull rows: ${out}`);
