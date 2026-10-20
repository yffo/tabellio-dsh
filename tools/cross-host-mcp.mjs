#!/usr/bin/env node
/**
 * Offline contract check for the MCP entry (Cursor / Codex use this shape).
 *
 * It starts the packaged stdio server against a temporary store and checks:
 *   1. default tool surface is read-only (no remember/capture);
 *   2. --allow-write adds exactly the two write tools;
 *   3. initialize + tools/call round-trip works and stdout is JSON-RPC only;
 *   4. the documented npx invocation in docs/CROSS-HOST*.md does not drift.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'node_modules', 'tabellio', 'bin', 'memory-mcp');
const READ_ONLY = ['list', 'read', 'recall', 'search', 'status'];
const WRITE = ['capture', 'remember'];

let failures = 0;
const ok = (name) => console.log('ok   ' + name);
const bad = (name, detail) => { failures += 1; console.error('FAIL ' + name + (detail ? ': ' + detail : '')); };

function serve(args, requests, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ out, err });
    });
    for (const request of requests) child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();
  });
}

function messages(out) {
  return out.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error('non-JSON stdout line ' + (index + 1) + ': ' + line.slice(0, 80));
    }
  });
}

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'mcp-check', version: '0' } } };
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
const list = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

const dir = mkdtempSync(path.join(tmpdir(), 'tabellio-mcp-check-'));

try {
  const readOnlyRun = await serve(['--store', dir], [init, ready, list]);
  const readOnlyMessages = messages(readOnlyRun.out);
  const initResult = readOnlyMessages.find((message) => message.id === 1)?.result;
  if (initResult?.serverInfo?.name === 'tabellio') ok('initialize returns the tabellio server');
  else bad('initialize returns the tabellio server', JSON.stringify(initResult));

  const readOnlyTools = (readOnlyMessages.find((message) => message.id === 2)?.result?.tools ?? []).map((tool) => tool.name).sort();
  if (JSON.stringify(readOnlyTools) === JSON.stringify(READ_ONLY)) ok('default MCP surface is read-only');
  else bad('default MCP surface is read-only', readOnlyTools.join(','));

  const writeRun = await serve(['--store', dir, '--allow-write'], [init, ready, list]);
  const writeTools = (messages(writeRun.out).find((message) => message.id === 2)?.result?.tools ?? []).map((tool) => tool.name).sort();
  const expected = [...READ_ONLY, ...WRITE].sort();
  if (JSON.stringify(writeTools) === JSON.stringify(expected)) ok('--allow-write adds remember and capture');
  else bad('--allow-write adds remember and capture', writeTools.join(','));

  const callRun = await serve(['--store', dir], [init, ready, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'status', arguments: {} } }]);
  const callMessages = messages(callRun.out);
  const statusResult = callMessages.find((message) => message.id === 3)?.result;
  const statusText = statusResult?.content?.[0]?.text ?? '';
  if (callResultOk(statusText)) ok('tools/call round-trip answers with text content');
  else bad('tools/call round-trip answers with text content', statusText.slice(0, 120));

  const doc = readFileSync(path.join(root, 'docs', 'CROSS-HOST.md'), 'utf8') + readFileSync(path.join(root, 'docs', 'CROSS-HOST.en.md'), 'utf8');
  for (const token of ['"--package"', 'tabellio-mcp', 'TABELLIO_STORE']) {
    if (doc.includes(token)) ok('docs mention ' + token);
    else bad('docs mention ' + token);
  }
} catch (error) {
  bad('mcp contract check', error?.message ?? String(error));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error('mcp contract: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('mcp contract: all checks passed');

function callResultOk(text) {
  return typeof text === 'string' && text.trim().length > 0;
}
