#!/usr/bin/env node
// Claude Code 契约检查：真正的钩子命令与真正的 MCP 握手。
//
//   node tools/cross-host-claude.mjs
//
// 默认在临时 HOME / 临时库里跑：不碰 ~/.claude/settings.json、不碰真实库、
// 不联网、不调用任何模型。验证的是 Claude Code 会执行的那两条命令：
//   1. `tabellio hook install --write` 写出的 settings.json 形状
//   2. SessionEnd 钩子读 transcript → 只写候选
//   3. SessionStart 钩子读候选数 → 输出 additionalContext
//   4. MCP 服务器 initialize / tools/list / tools/call 的 stdio 往返
// 真实模型会话不在本检查范围内（那需要 Claude Code 的登录与网络）。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = new URL('../node_modules/tabellio/bin/', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'tabellio-claude-'));
const home = join(root, 'home');
const storeDir = join(root, 'store');
const settingsPath = join(home, '.claude', 'settings.json');
const results = [];
const pass = (message) => results.push({ ok: true, message });
const fail = (message) => results.push({ ok: false, message });

const run = (args, { input = '', env = {} } = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: home, ...env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });

const main = async () => {
  // 1) 安装：写出的命令必须是最小可执行形状
  const install = await run([
    join(bin, 'memory'), 'hook', 'install', '--host', 'claude', '--session-start',
    '--write', '--store', storeDir, '--json',
  ]);
  let plan = null;
  try {
    plan = JSON.parse(install.stdout);
  } catch {
    fail('hook install did not return JSON: ' + install.stderr.slice(0, 200));
  }
  if (!plan?.ok || !plan.written) fail('hook install failed: ' + install.stdout.slice(0, 300));
  else pass('hook install wrote settings for SessionEnd + SessionStart');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
  const endHook = settings?.hooks?.SessionEnd?.[0]?.hooks?.[0];
  const startHook = settings?.hooks?.SessionStart?.[0]?.hooks?.[0];
  if (endHook?.type === 'command' && String(endHook.command).length > 0 && Array.isArray(endHook.args) && endHook.args.join(' ').includes('claude-session-end')) {
    pass('SessionEnd hook points at the tabellio command with an absolute bin path');
  } else {
    fail('SessionEnd hook shape is wrong: ' + JSON.stringify(endHook));
  }
  if (endHook?.timeout === 15 && startHook?.timeout === 15) pass('both hooks declare a 15s timeout');
  else fail('hook timeout missing or unexpected');

  // 2) SessionEnd：给一段真实形状的 transcript，只应把显式线索写成候选
  const transcript = join(root, 'transcript.jsonl');
  writeFileSync(transcript, [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '以后这个项目发版都用 pnpm，记住。' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '好的。' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '这个 bug 先跳过，下午再说。' }] } },
  ].map((line) => JSON.stringify(line)).join('\n') + '\n');
  const endPayload = JSON.stringify({
    session_id: 'e2e-session',
    transcript_path: transcript,
    cwd: root,
    hook_event_name: 'SessionEnd',
  });
  const ended = await run([
    join(bin, 'memory'), 'hook', 'claude-session-end', '--store', storeDir, '--json',
  ], { input: endPayload });
  let endResult = null;
  try {
    endResult = JSON.parse(ended.stdout);
  } catch {
    fail('SessionEnd hook did not return JSON: ' + ended.stdout.slice(0, 200));
  }
  if (endResult?.ok && endResult.captured?.length === 1 && endResult.captured[0].title.includes('pnpm')) {
    pass('SessionEnd captured exactly the explicit promise as a candidate');
  } else {
    fail('SessionEnd capture unexpected: ' + ended.stdout.slice(0, 300));
  }
  if (endResult?.stats?.secret === 0) pass('SessionEnd reports no credential leaks');
  else fail('SessionEnd secret counter unexpected');

  // 3) SessionStart：只读，输出一段可注入的提示
  const startPayload = JSON.stringify({
    session_id: 'e2e-session',
    transcript_path: transcript,
    cwd: root,
    hook_event_name: 'SessionStart',
    source: 'startup',
  });
  const started = await run([
    join(bin, 'memory'), 'hook', 'claude-session-start', '--store', storeDir, '--json',
  ], { input: startPayload });
  let startResult = null;
  try {
    startResult = JSON.parse(started.stdout);
  } catch {
    fail('SessionStart hook did not return JSON');
  }
  if (startResult?.ok && typeof startResult.additionalContext === 'string' && startResult.additionalContext.includes('候选')) {
    pass('SessionStart reports the pending candidate without writing');
  } else {
    fail('SessionStart output unexpected: ' + started.stdout.slice(0, 300));
  }

  // 4) MCP：同一个库，stdio 往返
  const mcpMessages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'cross-host-claude', version: '0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'status', arguments: {} } },
  ];
  const mcp = await run([join(bin, 'memory-mcp'), '--store', storeDir], {
    input: mcpMessages.map((message) => JSON.stringify(message)).join('\n') + '\n',
  });
  const replies = new Map();
  const noise = [];
  for (const line of mcp.stdout.split('\n').filter((line) => line.trim())) {
    try {
      const message = JSON.parse(line);
      replies.set(message.id, message);
    } catch {
      noise.push(line);
    }
  }
  if (replies.get(1)?.result?.serverInfo?.name) pass('MCP initialize handshake succeeds');
  else fail('MCP initialize failed: ' + mcp.stdout.slice(0, 200));
  const tools = replies.get(2)?.result?.tools ?? [];
  if (tools.some((tool) => tool.name === 'search') && tools.some((tool) => tool.name === 'read')) {
    pass('MCP lists the read tools');
  } else {
    fail('MCP tools/list missing read tools');
  }
  if (replies.get(3)?.result?.content) pass('MCP tools/call status returns content');
  else fail('MCP tools/call failed: ' + JSON.stringify(replies.get(3)).slice(0, 200));
  if (noise.length === 0) pass('MCP stdout carries only JSON-RPC messages');
  else fail('MCP wrote non-JSON to stdout: ' + noise.slice(0, 1).join(' ').slice(0, 160));
};

try {
  await main();
} finally {
  rmSync(root, { recursive: true, force: true });
}

const failed = results.filter((entry) => !entry.ok);
for (const entry of results) console.log((entry.ok ? 'PASS ' : 'FAIL ') + entry.message);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) process.exitCode = 1;
