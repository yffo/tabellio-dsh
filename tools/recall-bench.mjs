#!/usr/bin/env node
// Read-only latency benchmark against a real store. Measures the plugin's
// recall path (text gates + optional semantic merge), not the model judge:
// the judge only runs when the caller enables it and is measured separately.
//
// Run: TABELLIO_STORE=~/memory/tabellio node tools/recall-bench.mjs [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, recallQuery, read } from 'tabellio';
import { loadIndex, semanticTop, mergeSemanticResult } from '../src/semantic.js';

const HOME = os.homedir();
const expand = (value) => (value.startsWith('~') ? path.join(HOME, value.slice(1)) : value);
const storePath = expand(process.env.TABELLIO_STORE || '~/memory/tabellio');
const store = openStore(storePath);

const QUERIES = [
  '我们记忆服务的默认召回阈值是多少？',
  '发版流程是什么？',
  '上次 DSH 插件安装踩过哪些坑？',
  '前端项目用 pnpm 还是 npm？',
  '线上数据变更前要注意什么？',
  '周报里最近新增了哪些记忆？',
  '桌面端更新 dshmarket 的正路是什么？',
  '怎么把旧 engramory 库迁移过来？',
  '记忆冲突怎么处理？',
  '为什么深夜不要发消息？',
  '模型裁决在哪里配置？',
  '语义检索和词面检索差别在哪？',
];

const options = {
  budgetTokens: 436,
  maxNotes: 6,
  includeCore: true,
  minRelevance: 0.12,
  minScore: 0.1,
  minCoverage: 0.33,
  trusts: ['user_stated', 'system_derived'],
};

const index = loadIndex(store, 'qwen3-embedding-0.6b');
const endpoint = process.env.TABELLIO_SEMANTIC_ENDPOINT || 'http://127.0.0.1:8080/v1/embeddings';

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at];
};

const rows = [];
for (const query of QUERIES) {
  const t0 = process.hrtime.bigint();
  let result = recallQuery(store, query, options);
  const lexicalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  let merged = 0;
  if (index && index.size) {
    try {
      const hits = await semanticTop({
        index,
        query,
        endpoint,
        model: 'qwen3-embedding-0.6b',
        top: 8,
        minSimilarity: 0.55,
        timeoutMs: 2500,
      });
      if (hits.length) {
        const before = Array.isArray(result?.items) ? result.items.length : 0;
        result = mergeSemanticResult(result, { hits, readNote: (id) => read(store, id), maxNotes: 6 });
        merged = (result?.items?.length ?? 0) - before;
      }
    } catch {
      // The local embedding service may be offline; lexical timing still counts.
    }
  }
  const totalMs = Number(process.hrtime.bigint() - t1) / 1e6;
  rows.push({
    query,
    lexicalMs: Number(lexicalMs.toFixed(1)),
    semanticMs: Number(totalMs.toFixed(1)),
    hits: Array.isArray(result?.items) ? result.items.length : 0,
    merged,
    refused: Boolean(result?.refused),
  });
}

const summary = {
  store: storePath,
  notes: (() => {
    try {
      return [...store.scan()].length;
    } catch {
      return null;
    }
  })(),
  semanticIndex: Boolean(index?.vectorSize),
  lexicalP50: percentile(rows.map((row) => row.lexicalMs), 50),
  lexicalP95: percentile(rows.map((row) => row.lexicalMs), 95),
  withSemanticP50: percentile(rows.map((row) => row.lexicalMs + row.semanticMs), 50),
  withSemanticP95: percentile(rows.map((row) => row.lexicalMs + row.semanticMs), 95),
  rows,
};

if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 1));
else {
  console.log(`store ${storePath} · notes ${summary.notes} · semantic index ${summary.semanticIndex ? 'yes' : 'no'}`);
  console.log(`lexical p50 ${summary.lexicalP50}ms p95 ${summary.lexicalP95}ms`);
  console.log(`+semantic p50 ${summary.withSemanticP50}ms p95 ${summary.withSemanticP95}ms`);
  for (const row of rows) {
    console.log(`  ${row.lexicalMs}ms / ${row.semanticMs}ms  hits ${row.hits} (+${row.merged})  ${row.query}`);
  }
}
