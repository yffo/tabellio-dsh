#!/usr/bin/env node
// Cross-host demo: one Markdown store, three entry points.
//
// The DSH plugin, the CLI (`tabellio …`) and the MCP server all call the same
// tabellio API. This script exercises that API directly so the parity is
// checkable without a harness: write a note, search it, and run the
// candidate → approval loop.
//
//   node tools/cross-host-demo.mjs [storeDir]
//
// Defaults to a throwaway directory so it never touches a real library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addCandidate, listCandidates, openStore, remember, reviewCandidates, search, status } from 'tabellio';

const dir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-cross-host-'));
const store = openStore(dir);

const line = (label, value) => console.log(label.padEnd(22) + value);

console.log('store: ' + dir + '\n');

// 1) Durable note — what `tabellio remember --file` writes after the write gate.
const written = remember(
  store,
  {
    content: '跨宿主演示：发版规则 — 打完 vX.Y.Z tag 后由 CI 自动发布，不再手动 npm publish。',
  },
  { writtenBy: 'demo:cross-host', kind: 'procedural' },
);
line('remember ok', String(written.ok));
line('note id', String(written.id ?? ''));

// 2) Candidate — what the DSH plugin's auto-capture writes; a human approves it.
const candidate = addCandidate(
  store,
  { text: '发布前先跑 npm test 和 node tests/acceptance.mjs。', title: '跨宿主演示：发布检查', kind: 'procedural', tags: ['demo'] },
  { writtenBy: 'demo:cross-host' },
);
line('candidate ok', String(candidate.ok));
const pending = listCandidates(store);
line('candidates pending', String(pending.count ?? pending.length ?? 0));
const approved = reviewCandidates(store, { accept: [candidate.id] });
line('candidate approved', String(approved.ok) + ' (' + String(approved.accepted?.length ?? 0) + ')');

// 3) Recall — the same lexical search the plugin's `tabellio_search` tool exposes.
const hits = search(store, '发版 tag 自动发布', { maxNotes: 5 });
line('search hits', String(hits.items?.length ?? hits.hits?.length ?? 0));
for (const hit of (hits.items ?? hits.hits ?? []).slice(0, 3)) {
  line('  · ' + String(hit.title ?? hit.id).slice(0, 40), String(hit.relevance ?? hit.score ?? '').slice(0, 6));
}

const health = status(store);
line('notes after demo', String(health.notes));
line('candidates after demo', String(health.candidates));
console.log('\nOK — the CLI/MCP/DSH plugin read and write this exact directory.');
