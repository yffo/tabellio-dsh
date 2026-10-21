// Judge 判据实验：现在的 judge 到底会误杀多少条真正的答案？
//
// 为什么单独写这个：56 题评测（`bench/run-eval.mjs`）测的是「检索有没有把 gold
// 笔记拿进上下文」，judge 根本不在那条路径上 —— 它只活在插件的 pre-step 里。
// 所以「judge 变严会不会掉答案质量」这个问题，现有评测答不了，必须单独测。
//
// 这个脚本只回答三件事：
//   1. judge 杀掉 gold 笔记的比例（误杀率，最危险的那个数）；
//   2. judge 杀掉噪声笔记的比例（它到底干了多少活）；
//   3. 单次 judge 的延迟分布（生产 audit 里只有总耗时，没有这一层）。
//
// 用法：
//   EVAL_LLM_API_KEY=... node bench/judge-eval.mjs --model deepseek-flash
//   EVAL_LLM_API_KEY=... node bench/judge-eval.mjs --policy border --concurrency 4
//
// 它只读核心仓库的题集与语料，写临时目录，不碰 `~/memory`。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, recallQuery } from 'tabellio';
import { buildJudgePrompt, parseJudgeReply } from '../src/judge.js';

const CORE = path.resolve(process.cwd(), '..', 'tabellio');
const TASKS = path.join(CORE, 'bench/core-30-v1/tasks.json');
const LIBRARY = path.join(CORE, 'bench/core-30-v1/library');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const MODEL = flag('model', 'deepseek-flash');
const BASE_URL = flag('base-url', 'https://api.deepseek.com');
const POLICY = flag('policy', 'current'); // current | border
const CONCURRENCY = Number(flag('concurrency', '4'));
const MAX_NOTES = Number(flag('max-notes', '4'));
const RECALL_MAX_NOTES = Number(flag('recall-max-notes', '6'));
const RECALL_BUDGET = Number(flag('recall-budget', '436'));
const RECALL_MIN_RELEVANCE = Number(flag('recall-min-relevance', '0.12'));
const RECALL_MIN_SCORE = Number(flag('recall-min-score', '0.1'));
const RECALL_MIN_COVERAGE = Number(flag('recall-min-coverage', '0.33'));
const SNIPPET = Number(flag('snippet', '200'));
const CONFIDENT = Number(flag('confident-relevance', '0.9'));
const BORDER_CAP = Number(flag('border-cap', '2'));
const TIMEOUT_MS = Number(flag('timeout-ms', '6000'));
const MAX_TOKENS = Number(flag('max-tokens', '512'));
const API_KEY = process.env.EVAL_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';

if (!API_KEY) {
  console.error('缺少 EVAL_LLM_API_KEY（或 DEEPSEEK_API_KEY）');
  process.exit(2);
}
if (!fs.existsSync(TASKS)) {
  console.error('找不到题集：' + TASKS);
  process.exit(2);
}

const parsedTasks = JSON.parse(fs.readFileSync(TASKS, 'utf8'));
const tasks = Array.isArray(parsedTasks) ? parsedTasks : parsedTasks.tasks;
const scrub = () => fs.mkdtempSync(path.join(os.tmpdir(), 'judge-eval-'));
const scratch = scrub();
const store = path.join(scratch, 'store');
fs.mkdirSync(path.join(store, 'notes'), { recursive: true });
for (const file of fs.readdirSync(LIBRARY)) {
  if (file.endsWith('.md')) fs.copyFileSync(path.join(LIBRARY, file), path.join(store, 'notes', file));
}

const ctx = openStore(store);
const scan = ctx.scan(true);

const stem = (id) => String(id ?? '').replace(/\.md$/, '');

async function judgeOnce(query, notes) {
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: buildJudgePrompt(query, notes) }],
  };
  const started = Date.now();
  const response = await fetch(BASE_URL.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) throw new Error('http ' + response.status);
  const payload = await response.json();
  const reply = payload?.choices?.[0]?.message?.content ?? '';
  const usage = payload?.usage ?? {};
  return {
    kept: parseJudgeReply(reply, notes.length),
    elapsed,
    usage,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    completion: usage?.completion_tokens ?? 0,
    empty: !String(reply ?? '').trim(),
  };
}

/** 现在线上的策略：4 条全交给 judge。 */
function candidatesCurrent(items) {
  return items.slice(0, MAX_NOTES).map((item) => ({ item, judged: true }));
}

/** 候选策略：只判「没把握」的（relevance < 0.9），最多 2 条，其余直接放行。 */
function candidatesBorder(items) {
  const top = items.slice(0, MAX_NOTES);
  const out = [];
  let budget = BORDER_CAP;
  for (const item of top) {
    const judged = Number(item.relevance ?? 0) < CONFIDENT && budget > 0;
    if (judged) budget -= 1;
    out.push({ item, judged });
  }
  return out;
}

const candidatesFor = POLICY === 'border' ? candidatesBorder : candidatesCurrent;

const rows = [];
let cursor = 0;
async function worker() {
  while (cursor < tasks.length) {
    const index = cursor++;
    const task = tasks[index];
    // 按插件默认口径召回（config.js: maxNotes 6 / minRelevance 0.12 / minScore 0.1 /
    // minCoverage 0.33 / budget 500-64），否则会捞进一堆 relevance=0 的填充条目，
    // judge 的「去噪」就变成砍空气，测出来的误杀率没有意义。
    const result = recallQuery(ctx, task.prompt, {
      maxNotes: RECALL_MAX_NOTES,
      budgetTokens: RECALL_BUDGET,
      minRelevance: RECALL_MIN_RELEVANCE,
      minScore: RECALL_MIN_SCORE,
      minCoverage: RECALL_MIN_COVERAGE,
    });
    // recall 出来的条目用 `content` 放正文、`score.relevance` 放相关性；
    // 直接读 `item.body`/`item.relevance` 会得到空串 —— judge 看到的是一排空笔记，
    // 于是「全杀」，误杀率会假得离谱（第一版就踩了这个）。
    const items = (result.items ?? []).map((item) => ({
      id: item.id,
      title: item.title ?? '',
      body: item.content ?? item.body ?? '',
      relevance: item.score?.relevance ?? item.relevance ?? 0,
    }));
    const gold = new Set((task.source ?? []).map((s) => stem(s)));
    const candidates = candidatesFor(items).slice(0, MAX_NOTES);
    const toJudge = candidates.filter((c) => c.judged);

    const row = {
      id: task.id,
      kind: task.kind,
      answerable: gold.size > 0,
      items: items.length,
      goldInItems: items.filter((item) => gold.has(item.id)).length,
      goldTotal: gold.size,
      judged: toJudge.length,
      latency: null,
      kept: null,
      tokens: null,
      error: null,
      goldKept: null,
      noiseKept: null,
      policy: POLICY,
    };

    if (gold.size === 0) {
      // 拒答题：judge 把候选全杀掉是「正确」，留一条也不一定有错（可能是同领域笔记）。
      if (toJudge.length > 0) {
        try {
          const out = await judgeOnce(task.prompt, toJudge.map((c) => c.item));
          row.latency = out.elapsed;
          row.tokens = out.usage?.total_tokens ?? null;
          row.reasoning = out.reasoning;
          row.empty = out.empty;
          row.kept = out.kept ? out.kept.size : 0;
        } catch (error) {
          row.error = String(error?.message ?? error);
        }
      }
      rows.push(row);
      continue;
    }

    if (toJudge.length > 0) {
      try {
        const out = await judgeOnce(task.prompt, toJudge.map((c) => c.item));
        row.latency = out.elapsed;
        row.tokens = out.usage?.total_tokens ?? null;
        row.reasoning = out.reasoning;
        row.empty = out.empty;
        row.kept = out.kept ? out.kept.size : 0;
        const keepSet = out.kept ?? new Set();
        // 把 judge 的裁决映射回 id：judge 只看到 toJudge 的编号。
        const keptIds = new Set(toJudge.filter((_, i) => keepSet.has(i)).map((c) => c.item.id));
        // 没送审的直接放行（border 策略），送审的按 judge 结果。
        const finalKept = new Set([
          ...candidates.filter((c) => !c.judged).map((c) => c.item.id),
          ...keptIds,
        ]);
        row.goldKept = [...gold].filter((id) => finalKept.has(id)).length;
        row.noiseKept = [...finalKept].filter((id) => !gold.has(id)).length;
      } catch (error) {
        row.error = String(error?.message ?? error);
      }
    }
    rows.push(row);
  }
}

await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

const answered = rows.filter((row) => row.answerable);
const refusals = rows.filter((row) => !row.answerable);
const latencies = rows.map((row) => row.latency).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
const pct = (n) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(n * latencies.length))] : 0);

const judgedRows = answered.filter((row) => row.judged > 0 && !row.error);
const goldIn = judgedRows.filter((row) => row.goldInItems > 0);
const falseDrops = goldIn.filter((row) => row.goldKept < row.goldInItems);
const noiseDrop = judgedRows.reduce((acc, row) => {
  const before = row.items - row.goldInItems;
  const after = row.noiseKept ?? before;
  return acc + Math.max(0, before - after);
}, 0);
const noiseBefore = judgedRows.reduce((acc, row) => acc + (row.items - row.goldInItems), 0);

const errors = rows.filter((row) => row.error);
const emptyRefusals = refusals.filter((row) => row.judged > 0 && row.kept === 0);

console.log('# judge 判据实验（' + new Date().toISOString() + '）');
console.log('- 模型：' + MODEL + '；策略：' + POLICY + '；送审上限：' + MAX_NOTES + '；并发：' + CONCURRENCY);
console.log('- 题：' + tasks.length + '（可答 ' + answered.length + ' / 拒答 ' + refusals.length + '）；临时库 ' + scan.notes.length + ' 篇');
console.log('');
console.log('| 指标 | 值 |');
console.log('| --- | --- |');
console.log('| 送审题数 | ' + rows.filter((row) => row.judged > 0).length + ' |');
console.log('| 平均送审条数 | ' + (rows.reduce((a, r) => a + r.judged, 0) / Math.max(1, rows.filter((r) => r.judged > 0).length)).toFixed(2) + ' |');
console.log('| **gold 被 judge 误杀** | ' + falseDrops.length + ' / ' + goldIn.length + ' 题（' + (goldIn.length ? (100 * falseDrops.length / goldIn.length).toFixed(1) : '0') + '%） |');
console.log('| 噪声条被丢弃 | ' + noiseDrop + ' / ' + noiseBefore + ' 条（' + (noiseBefore ? (100 * noiseDrop / noiseBefore).toFixed(1) : '0') + '%） |');
console.log('| 拒答题全杀 | ' + emptyRefusals.length + ' / ' + refusals.filter((row) => row.judged > 0).length + ' |');
console.log('| 延迟 p50 / p90 / max | ' + pct(0.5) + ' / ' + pct(0.9) + ' / ' + (latencies.at(-1) ?? 0) + ' ms |');
console.log('| 平均 token（单次） | ' + Math.round(rows.filter((r) => r.tokens).reduce((a, r) => a + r.tokens, 0) / Math.max(1, rows.filter((r) => r.tokens).length)) + '（其中推理 ' + Math.round(rows.filter((r) => r.reasoning).reduce((a, r) => a + r.reasoning, 0) / Math.max(1, rows.filter((r) => r.reasoning !== undefined).length)) + '） |');
console.log('| 空回复 | ' + rows.filter((r) => r.empty).length + ' |');
console.log('| 调用失败 | ' + errors.length + (errors.length ? '（' + errors[0].error + '）' : '') + ' |');

if (falseDrops.length) {
  console.log('');
  console.log('## 误杀明细');
  console.log('| 题 | 类型 | gold 总数 | 仍保留 |');
  console.log('| --- | --- | --- | --- |');
  for (const row of falseDrops) console.log('| ' + row.id + ' | ' + row.kind + ' | ' + row.goldInItems + ' | ' + (row.goldKept ?? 0) + ' |');
}

const head = [
  '# judge-eval ' + POLICY,
  '- 时间：' + new Date().toISOString(),
  '- 模型：' + MODEL + '；送审上限 ' + MAX_NOTES + '；并发 ' + CONCURRENCY,
  '- 题：' + tasks.length + '；库 ' + scan.notes.length + ' 篇',
  '',
  '| 题 | 答案型 | gold 命中/总数 | 送审 | 保留 | gold 保留 | 延迟 ms | error |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((row) => '| ' + row.id + ' | ' + row.kind + ' | ' + row.goldInItems + '/' + row.goldTotal + ' | ' +
    row.judged + ' | ' + (row.kept ?? '-') + ' | ' + (row.goldKept ?? '-') + ' | ' + (row.latency ?? '-') + ' | ' + (row.error ?? '') + ' |'),
].join('\n');
const outDir = path.join(process.cwd(), 'tmp');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'judge-eval-' + POLICY + '-' + Date.now() + '.md');
fs.writeFileSync(outFile, head + '\n');
console.log('');
console.log('报告：' + outFile);
