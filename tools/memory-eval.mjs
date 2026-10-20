// Reproducible memory-quality evaluation, run against a throwaway store.
//
// The three metrics the product is judged on are: knowledge updates (a fact
// changed — does recall return the current one?), time reasoning (does it know
// "now" vs "then"?), and abstention (does it refuse when the store cannot
// answer?). Retrieval-only hit rate is reported but is not the point.
//
// Usage: node tools/memory-eval.mjs [--json] [--strict]
// Exit code is 0 unless --strict is passed and any category regresses below
// the recorded baseline (BASELINE).
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, recallQuery, remember } from 'tabellio';
import { hasMemoryIntent } from '../src/messages.js';

const NOTES = [
  { key: 'release-old', text: '发布流程：本地手动打包后执行 npm publish 发版。' },
  { key: 'release-new', text: '发布流程已改：现在推送 v* tag，由 GitHub Actions 自动发布，不再手动 npm publish。' },
  { key: 'db-new', text: '2026-09 起线上库改为只读，写操作统一走生产变更流程。' },
  { key: 'db-old', text: '2026-06 之前线上库可以直接写，后来收紧了权限。' },
  { key: 'style', text: '我偏好先看结论再看细节，汇报不需要铺垫。' },
  { key: 'project', text: '项目代号是青鸟计划，内部文档也用这个名字。' },
  { key: 'archive', text: '临时脚本和日志一律放到 archive/ 下，不要留在仓库根目录。' },
  { key: 'semantic', text: '召回默认使用 BM25 加本地嵌入模型，嵌入服务不可用时会静默回退词面检索。' },
];

const CASES = [
  // knowledge update: the store holds both the old and the new fact.
  { id: 'ku-1', category: 'knowledge_update', query: '我们现在的发布流程是什么？', expectTitle: ['发布流程已改'] },
  { id: 'ku-2', category: 'knowledge_update', query: '线上库现在还能直接写吗？', expectTitle: ['只读'] },
  // temporal: the correct answer depends on the date in the note.
  { id: 'tm-1', category: 'temporal', query: '2026 年 9 月以后线上库的写权限是怎么规定的？', expectTitle: ['只读'] },
  { id: 'tm-2', category: 'temporal', query: '以前线上库可以随便写吗？', expectTitle: ['2026-06'] },
  // preference / project facts.
  { id: 'pf-1', category: 'preference', query: '我汇报时喜欢什么顺序？', expectTitle: ['先看结论'] },
  { id: 'pf-2', category: 'preference', query: '临时文件应该放哪里？', expectTitle: ['archive'] },
  { id: 'pj-1', category: 'project', query: '项目代号叫什么？', expectTitle: ['青鸟'] },
  { id: 'pj-2', category: 'project', query: '语义召回服务挂了会怎样？', expectTitle: ['回退词面'] },
  // abstention: these are not questions about the store.
  { id: 'ab-1', category: 'abstention', query: '今天天气怎么样？' },
  { id: 'ab-2', category: 'abstention', query: '帮我翻译一句话成英文。' },
  { id: 'ab-3', category: 'abstention', query: '推荐一部科幻电影。' },
  { id: 'ab-4', category: 'abstention', query: '现在几点了？' },
];

// Recorded after the first run on 0.13.x; --strict only fails below these.
// Abstention is measured at the gate+recall layer; with `judge: llm` (default)
// the off-topic hit below is dropped by the judge before injection.
const BASELINE = { knowledge_update: 2, temporal: 2, preference: 2, project: 2, abstention: 4 };

const RECALL_OPTIONS = { budgetTokens: 500, maxNotes: 6, minCoverage: 0.33, minScore: 0.1, minRelevance: 0.12 };

function evaluate(caseDef, items) {
  if (caseDef.category === 'abstention') return items.length === 0;
  const titles = items.map((item) => String(item.title ?? ''));
  return caseDef.expectTitle.some((needle) => titles.some((title) => title.includes(needle)));
}

function seed(store) {
  for (const note of NOTES) {
    const result = remember(store, { content: note.text });
    if (!result?.ok) throw new Error('seed failed for ' + note.key + ': ' + (result?.reason ?? 'unknown'));
  }
}

function main() {
  const wantJson = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tabellio-eval-'));
  const store = openStore(dir);
  const rows = [];
  try {
    seed(store);
    for (const caseDef of CASES) {
      const intent = hasMemoryIntent(caseDef.query);
      let items = [];
      let refused = false;
      if (intent) {
        const result = recallQuery(store, caseDef.query, RECALL_OPTIONS);
        refused = Boolean(result?.refused);
        items = refused ? [] : (result?.items ?? []);
      }
      const pass = caseDef.category === 'abstention' ? !intent || items.length === 0 : evaluate(caseDef, items);
      rows.push({
        id: caseDef.id,
        category: caseDef.category,
        query: caseDef.query,
        intent,
        refused,
        items: items.length,
        top: items[0] ? String(items[0].title ?? '') : '',
        pass,
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const categories = [...new Set(rows.map((row) => row.category))];
  const summary = {};
  for (const category of categories) {
    const list = rows.filter((row) => row.category === category);
    summary[category] = { pass: list.filter((row) => row.pass).length, total: list.length };
  }

  if (wantJson) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    for (const row of rows) {
      console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.id.padEnd(5)} ${row.category.padEnd(16)} items=${row.items}${row.intent ? '' : ' suppressed'}${row.top ? '  top=' + row.top : ''}`);
    }
    console.log('');
    for (const [category, value] of Object.entries(summary)) {
      const base = BASELINE[category];
      console.log(`${category.padEnd(16)} ${value.pass}/${value.total}${base === undefined ? '' : '  (baseline ' + base + ')'}`);
    }
  }

  if (strict) {
    for (const [category, value] of Object.entries(summary)) {
      const base = BASELINE[category];
      if (base !== undefined && value.pass < base) {
        console.error(`regression in ${category}: ${value.pass} < ${base}`);
        process.exitCode = 1;
      }
    }
  }
}

main();
