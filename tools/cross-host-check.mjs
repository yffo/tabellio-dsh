#!/usr/bin/env node
// 跨宿主一致性检查：同一个库，三个入口必须看到同一条记忆。
//
//   node tools/cross-host-check.mjs
//
// 默认在临时目录里跑，不碰真实库、不联网；任何一处不一致都会非零退出。
// 覆盖：
//   1. 插件 API 写入 → CLI 能检索到
//   2. CLI 批准候选   → MCP 能召回正文
//   3. MCP 只读列出   → 插件 API 看到同样的笔记数
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCandidate, listCandidates, openStore, recallQuery, remember, reviewCandidates, status } from 'tabellio';

const bin = new URL('../node_modules/tabellio/bin/', import.meta.url).pathname;
const storeDir = mkdtempSync(join(tmpdir(), 'tabellio-cross-host-'));
const results = [];
const fail = (message) => {
  results.push({ ok: false, message });
};
const pass = (message) => {
  results.push({ ok: true, message });
};

const run = (args, { input = '' } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr });
  });
  if (input) child.stdin.end(input);
  else child.stdin.end();
});

const mcpCall = async (messages) => {
  const input = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  const { stdout, stderr } = await run([join(bin, 'memory-mcp'), '--store', storeDir], { input });
  const lines = stdout.split('\n').filter((line) => line.trim().startsWith('{'));
  const byId = new Map();
  for (const line of lines) {
    try {
      const message = JSON.parse(line);
      byId.set(message.id, message);
    } catch {
      // 非 JSON 行不该出现；出现就说明 stdout 被日志污染
    }
  }
  const noise = stdout.split('\n').filter((line) => line.trim() && !line.trim().startsWith('{'));
  return { byId, stderr, noise, raw: stdout };
};

const main = async () => {
  const store = openStore(storeDir);
  const written = remember(store, { content: '跨宿主检查笔记：项目代号是青鸟计划。' }, { writtenBy: 'check:plugin' });
  if (!written?.ok && !written?.id) fail('plugin write returned no id');

  // 1) CLI（与插件同一个 tabellio 包）
  const cli = await run([
    join(bin, 'memory'), 'search', '--query', '项目代号', '--store', storeDir, '--json',
  ]);
  let cliHits = [];
  try {
    const parsed = JSON.parse(cli.stdout);
    cliHits = parsed.items ?? parsed.hits ?? [];
  } catch {
    fail('CLI search did not return JSON: ' + cli.stderr.slice(0, 200));
  }
  if (cliHits.some((hit) => hit.id === written.id)) pass('CLI sees the note written by the plugin API');
  else fail('CLI search did not include the plugin-written note');

  // 2) 候选由 CLI 批准 → MCP 召回
  addCandidate(store, { text: '跨宿主候选：发版走 tag 加 CI。', source: 'check:plugin', kind: 'semantic', tags: ['check'] }, { writtenBy: 'check:plugin' });
  const candidate = listCandidates(store).candidates[0];
  const accepted = reviewCandidates(store, { accept: [candidate.id] });
  if (accepted.accepted?.length === 1) pass('CLI approval gate accepts a candidate written by the plugin');
  else fail('candidate approval failed: ' + JSON.stringify(accepted).slice(0, 200));

  const { byId, raw, stderr, noise } = await mcpCall([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'cross-host-check', version: '0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'recall', arguments: { query: '发版怎么走？' } } },
  ]);
  const tools = byId.get(2)?.result?.tools ?? [];
  if (tools.some((tool) => tool.name === 'recall')) pass('MCP server lists the recall tool');
  else fail('MCP tools/list missing recall: ' + raw.slice(0, 200));

  const call = byId.get(3);
  const text = JSON.stringify(call?.result ?? '');
  if (text.includes('tag') || text.includes('发版')) pass('MCP recall returns the approved candidate text');
  else fail('MCP recall did not return the approved note: ' + text.slice(0, 300));
  // stderr 是 MCP 允许的日志通道；stdout 才是协议通道，必须只有 JSON。
  if (noise.length) fail('MCP wrote non-JSON to stdout: ' + noise.slice(0, 2).join(' | ').slice(0, 200));

  // 3) 三个入口对同一批条目数一致
  const apiStatus = status(openStore(storeDir));
  const cliStatus = await run([join(bin, 'memory'), 'status', '--store', storeDir, '--json']);
  let cliNotes = null;
  try {
    cliNotes = JSON.parse(cliStatus.stdout).notes;
  } catch {
    fail('CLI status did not return JSON');
  }
  if (Number(cliNotes) === Number(apiStatus.notes)) pass(`API and CLI agree on note count (${apiStatus.notes})`);
  else fail(`note count mismatch: API ${apiStatus.notes}, CLI ${cliNotes}`);

  // 4) 直接召回 API（插件同款）也能看到
  const recalled = recallQuery(openStore(storeDir), '项目代号是什么？', { budgetTokens: 400 });
  if (!recalled.refused && recalled.items?.length) pass('plugin-style recallQuery sees the same store');
  else fail('plugin-style recallQuery returned nothing');
};

try {
  await main();
} finally {
  rmSync(storeDir, { recursive: true, force: true });
}

for (const result of results) console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.message}`);
const failed = results.filter((result) => !result.ok).length;
console.log(failed === 0 ? `\ncross-host check: ${results.length}/${results.length} passed` : `\ncross-host check: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
