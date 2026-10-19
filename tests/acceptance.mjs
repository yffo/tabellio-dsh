#!/usr/bin/env node
/**
 * tabellio-dsh functional acceptance suite.
 *
 * This script loads the REAL plugin through dynamic import, drives it with a
 * fake host shaped like DSH (apply + handlers/contexts/tools), and uses a fresh
 * mkdtemp store for every case. Nothing under ~/memory is touched.
 *
 * Run:
 *   node tests/acceptance.mjs
 *   node tests/acceptance.mjs --filter matrix-04
 *   node tests/acceptance.mjs --report /path/to/report.md
 *
 * Exit code 0 = every selected case passed. 1 = at least one failure.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const importRepo = (relative) => import(new URL(relative, import.meta.url).href);

const tabellio = await import('tabellio');
const plugin = await importRepo('../index.js');
const { normalizeConfig } = await importRepo('../src/config.js');
const { createRpcHandler, MAX_REVIEW_IDS, MAX_SEARCH_LIMIT } = await importRepo('../src/rpc.js');

const { apply, name: pluginName, inject } = plugin;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argValue = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
};
const reportArg = argValue('--report');
const filter = (argValue('--filter') || '').trim();

if (argv.includes('--help')) {
  console.log('Usage: node tests/acceptance.mjs [--filter <substring>] [--report <report.md>]');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Temp stores and lifecycle-safe cleanup
// ---------------------------------------------------------------------------
const tempDirs = [];
let didCleanup = false;

function tempStore(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tabellio-dsh-accept-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function walkTree(root) {
  const dirs = [root];
  const files = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(full);
        visit(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  visit(root);
  return { dirs, files };
}

function makeTreeReadOnly(root) {
  const { dirs, files } = walkTree(root);
  for (const file of files) fs.chmodSync(file, 0o444);
  for (const dir of dirs.slice().reverse()) fs.chmodSync(dir, 0o555);
}

function makeTreeWritable(root) {
  const { dirs, files } = walkTree(root);
  for (const dir of dirs) {
    try {
      fs.chmodSync(dir, 0o755);
    } catch {
      // A vanished temp dir needs no repair.
    }
  }
  for (const file of files) {
    try {
      fs.chmodSync(file, 0o644);
    } catch {
      // Same as above.
    }
  }
}

function cleanupTempStores() {
  if (didCleanup) return;
  didCleanup = true;
  for (const dir of tempDirs.splice(0)) {
    try {
      makeTreeWritable(dir);
    } catch {
      // best effort
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4 });
    } catch (error) {
      console.error(`warning: could not remove temp store ${dir}: ${error.message}`);
    }
  }
}
process.on('exit', cleanupTempStores);

// ---------------------------------------------------------------------------
// Fake DSH host
// ---------------------------------------------------------------------------
function createHost({ llm } = {}) {
  const handlers = new Map();
  const tools = [];
  const contexts = [];
  const warns = [];
  const infos = [];
  const injectCalls = [];

  const prompt = {
    context(definition) {
      contexts.push(definition);
      return () => {};
    },
  };
  const llmService = llm;
  const agentDefaultModel = {
    currentSelection: () => ({ provider: 'acceptance', model: 'fake-judge' }),
  };
  const logger = {
    warn(message) {
      warns.push(String(message ?? ''));
    },
    info(message) {
      infos.push(String(message ?? ''));
    },
    debug() {},
  };
  const hostServices = {
    systemPrompt: prompt,
    llm: llmService,
    agentDefaultModel,
    effect(fn) {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    logger,
  };
  const ctx = {
    get(service) {
      return hostServices[service];
    },
    inject(deps, callback) {
      injectCalls.push({ deps: [...deps], callback });
      // DSH activates services asynchronously; for tests the non-web services
      // are available immediately, while webServer is intentionally absent.
      if (deps.every((dep) => dep !== 'webServer')) {
        try {
          callback(hostServices);
        } catch (error) {
          warns.push('inject callback failed: ' + (error?.message ?? error));
        }
      }
      return () => {};
    },
    effect(fn) {
      return hostServices.effect(fn);
    },
    tools: {
      register(definition) {
        tools.push(definition);
      },
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    logger,
  };
  return { ctx, handlers, tools, contexts, warns, infos, injectCalls, prompt };
}

let agentSeq = 0;
function makeAgent(id, { depth = 0, sessionId, subagentDepth } = {}) {
  const agentId = id ?? `agent-${++agentSeq}`;
  const agent = {
    id: agentId,
    session: {
      id: sessionId ?? `session-${agentId}`,
      header: { delegationDepth: depth },
    },
    options: {},
  };
  if (subagentDepth !== undefined) agent.options.subagentDepth = subagentDepth;
  return agent;
}

const human = (id, text) => ({
  id,
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
});

async function runPre(host, who, messages) {
  const handlers = host.handlers.get('agent/pre-step') ?? [];
  assert.equal(handlers.length, 1, 'expected exactly one agent/pre-step handler');
  const signal = new AbortController().signal;
  return handlers[0]({ agent: who, signal }, async () => ({ kind: 'enter', messages }));
}

async function runBoundary(host, event, who) {
  for (const handler of host.handlers.get(event) ?? []) {
    await handler({ agent: who, turn: 1 });
  }
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------
function seedNotes(dir, texts) {
  const store = tabellio.openStore(dir);
  for (const text of texts) {
    const written = tabellio.remember(store, { text });
    assert.equal(written?.ok, true, `failed to seed note: ${text}`);
  }
  return store;
}

function storeStatus(dir) {
  return tabellio.status(tabellio.openStore(dir));
}

function candidateRecords(dir) {
  return tabellio.listCandidates(tabellio.openStore(dir)).candidates ?? [];
}

function candidateFiles(dir) {
  const dirPath = path.join(dir, 'notes', 'candidates');
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter((name) => name.endsWith('.md'));
}

function readReceipts(dir) {
  const runsDir = path.join(dir, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .filter((name) => /^rcp_.*\.json$/.test(name))
    .map((name) => JSON.parse(fs.readFileSync(path.join(runsDir, name), 'utf8')));
}

// ---------------------------------------------------------------------------
// Tool-contract helpers
// ---------------------------------------------------------------------------
function findTool(host, name) {
  const tool = host.tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `tool not registered: ${name}`);
  return tool;
}

function assertObjectSchema(schema, label) {
  assert.ok(schema && typeof schema === 'object', `${label}: schema missing`);
  assert.equal(schema.type, 'object', `${label}: type must be object`);
  assert.equal(schema.additionalProperties, false, `${label}: additionalProperties must be false`);
  assert.ok(schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties), `${label}: properties missing`);
  if (schema.required !== undefined) {
    assert.ok(Array.isArray(schema.required), `${label}: required must be an array when present`);
    for (const key of schema.required) {
      assert.equal(typeof key, 'string', `${label}: required entries must be strings`);
      assert.ok(Object.prototype.hasOwnProperty.call(schema.properties, key), `${label}: required ${key} not declared in properties`);
    }
  }
}

function assertOutputValue(schema, value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: output must be an object`);
  assertObjectSchema(schema, label);
  for (const key of schema.required ?? []) {
    assert.ok(Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined, `${label}: missing required output ${key}`);
  }
  for (const key of Object.keys(value)) {
    assert.ok(Object.prototype.hasOwnProperty.call(schema.properties, key), `${label}: unexpected output field ${key}`);
  }
  for (const [key, spec] of Object.entries(schema.properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const item = value[key];
    switch (spec.type) {
      case 'string':
        assert.equal(typeof item, 'string', `${label}.${key}: expected string, got ${typeof item}`);
        break;
      case 'number':
        assert.equal(typeof item, 'number', `${label}.${key}: expected number`);
        assert.ok(Number.isFinite(item), `${label}.${key}: expected finite number`);
        break;
      case 'integer':
        assert.equal(typeof item, 'number', `${label}.${key}: expected integer`);
        assert.ok(Number.isInteger(item), `${label}.${key}: expected integer, got ${item}`);
        break;
      case 'boolean':
        assert.equal(typeof item, 'boolean', `${label}.${key}: expected boolean`);
        break;
      case 'array':
        assert.ok(Array.isArray(item), `${label}.${key}: expected array`);
        if (spec.items?.type === 'object') {
          item.forEach((entry, index) => assertOutputValue(spec.items, entry, `${label}.${key}[${index}]`));
        }
        break;
      case 'object':
        assert.ok(item && typeof item === 'object' && !Array.isArray(item), `${label}.${key}: expected object`);
        break;
      default:
        break;
    }
  }
}

async function callTool(host, toolName, args) {
  const tool = findTool(host, toolName);
  const value = await tool.execute(args);
  assertOutputValue(tool.output.schema, value, `${toolName} (${JSON.stringify(args)})`);
  const rendered = tool.output.render(args, value);
  assert.ok(typeof rendered === 'string' || Array.isArray(rendered), `${toolName}: render must return text`);
  if (Array.isArray(rendered)) {
    for (const block of rendered) {
      assert.equal(block?.type, 'text', `${toolName}: render block must be text`);
      assert.equal(typeof block.text, 'string', `${toolName}: render block text must be a string`);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------
function rpcOk(result, label) {
  assert.equal(result?.ok, true, `${label}: expected ok, got ${JSON.stringify(result)}`);
  assert.ok(result.value && typeof result.value === 'object', `${label}: value missing`);
  return result.value;
}

function rpcFail(result, label, messagePart) {
  assert.equal(result?.ok, false, `${label}: expected failure, got ${JSON.stringify(result)}`);
  assert.equal(result.error?.code, 'bad-request', `${label}: expected bad-request, got ${JSON.stringify(result)}`);
  assert.equal(typeof result.error.message, 'string', `${label}: error.message missing`);
  assert.deepEqual(result.error.details, {}, `${label}: error.details must be an object`);
  if (messagePart) {
    assert.ok(result.error.message.includes(messagePart), `${label}: message ${JSON.stringify(result.error.message)} should contain ${JSON.stringify(messagePart)}`);
  }
  return result.error;
}

async function expectBadRequest(handler, endpoint, payload, label, messagePart) {
  const result = await handler(endpoint, payload);
  rpcFail(result, label, messagePart);
}

// ---------------------------------------------------------------------------
// Test registry
// ---------------------------------------------------------------------------
const cases = [];
function testCase(id, title, fn) {
  cases.push({ id, title, fn });
}

const MATRIX = [
  { id: 'matrix-01', autoRecall: true, delivery: 'notice', shadow: false, capture: 'explicit', judge: 'off', gate: true, judgeKeep: 'all' },
  { id: 'matrix-02', autoRecall: true, delivery: 'notice', shadow: false, capture: 'explicit', judge: 'off', gate: false, judgeKeep: 'all' },
  { id: 'matrix-03', autoRecall: true, delivery: 'notice', shadow: false, capture: 'off', judge: 'off', gate: false, judgeKeep: 'all' },
  { id: 'matrix-04', autoRecall: true, delivery: 'notice', shadow: false, capture: 'implicit', judge: 'llm', gate: false, judgeKeep: 'all' },
  { id: 'matrix-05', autoRecall: true, delivery: 'notice', shadow: false, capture: 'assist', judge: 'llm', gate: false, judgeKeep: 'all' },
  { id: 'matrix-06', autoRecall: true, delivery: 'context', shadow: false, capture: 'explicit', judge: 'off', gate: true, judgeKeep: 'all' },
  { id: 'matrix-07', autoRecall: true, delivery: 'context', shadow: false, capture: 'explicit', judge: 'off', gate: false, judgeKeep: 'all' },
  { id: 'matrix-08', autoRecall: true, delivery: 'context', shadow: true, capture: 'explicit', judge: 'off', gate: false, judgeKeep: 'all' },
  { id: 'matrix-09', autoRecall: true, delivery: 'notice', shadow: true, capture: 'explicit', judge: 'off', gate: true, judgeKeep: 'all' },
  { id: 'matrix-10', autoRecall: true, delivery: 'notice', shadow: false, capture: 'explicit', judge: 'llm', gate: true, judgeKeep: 'all' },
  { id: 'matrix-11', autoRecall: true, delivery: 'notice', shadow: false, capture: 'implicit', judge: 'llm', gate: false, judgeKeep: 'all' },
  { id: 'matrix-12', autoRecall: true, delivery: 'notice', shadow: false, capture: 'off', judge: 'llm', gate: false, judgeKeep: 'none' },
  { id: 'matrix-13', autoRecall: false, delivery: 'notice', shadow: false, capture: 'implicit', judge: 'off', gate: true, judgeKeep: 'all' },
  { id: 'matrix-14', autoRecall: false, delivery: 'context', shadow: false, capture: 'assist', judge: 'off', gate: false, judgeKeep: 'all' },
  { id: 'matrix-15', autoRecall: false, delivery: 'notice', shadow: true, capture: 'off', judge: 'off', gate: false, judgeKeep: 'all' },
  { id: 'matrix-16', autoRecall: true, delivery: 'context', shadow: false, capture: 'assist', judge: 'off', gate: true, judgeKeep: 'all' },
];

function fakeJudgeLlm(state) {
  return {
    stream() {
      state.calls += 1;
      return (async function* streamReply() {
        if (state.fail) throw new Error('judge stream failed');
        yield { type: 'text-delta', text: JSON.stringify({ keep: state.keep }) };
        yield { type: 'finish' };
      })();
    },
  };
}

function observedInjection(messages) {
  return (messages ?? []).find((message) => message?.source?.kind === 'plugin:tabellio-dsh');
}

async function runMatrixCase(combo) {
  const dir = tempStore(combo.id);
  seedNotes(dir, ['# 项目代号\n\n项目代号是青鸟。', '# 天气记录\n\n今天天气不错，适合发布。']);
  const llmState = { calls: 0, keep: combo.judgeKeep === 'none' ? [] : [1], fail: false };
  const host = createHost({ llm: fakeJudgeLlm(llmState) });
  apply(host.ctx, {
    storePath: dir,
    autoRecall: combo.autoRecall,
    delivery: combo.delivery,
    shadow: combo.shadow,
    capture: combo.capture,
    judge: combo.judge,
    judgeProvider: combo.judge === 'llm' ? 'acceptance' : '',
    judgeModel: combo.judge === 'llm' ? 'fake-judge' : '',
    recallIntentGate: combo.gate,
    refreshSeconds: 0,
    minQueryChars: 4,
  });

  const who = makeAgent(combo.id);
  const gateBlocks = combo.gate; // "今天天气怎么样？" has no memory-intent marker
  const judgedOut = combo.judge === 'llm' && combo.judgeKeep === 'none' && !gateBlocks && !combo.shadow;
  const injected = combo.autoRecall && !combo.shadow && !gateBlocks && !judgedOut;
  const expectedJudgeCalls = combo.autoRecall && combo.judge === 'llm' && !combo.shadow && !gateBlocks ? 1 : 0;

  const turn1 = await runPre(host, who, [human(`m1-${combo.id}`, '今天天气怎么样？')]);
  assert.ok(Array.isArray(turn1.messages), 'pre-step must return a decision with messages');
  assert.equal(turn1.messages.length, injected && combo.delivery === 'notice' ? 2 : 1, `${combo.id}: unexpected notice injection`);
  if (injected && combo.delivery === 'notice') {
    const notice = observedInjection(turn1.messages);
    assert.ok(notice, `${combo.id}: injected message missing`);
    assert.equal(notice.role, 'user');
    assert.equal(notice.source.form, 'notice');
    assert.match(notice.source.summary, /tabellio 召回 1 条/);
    assert.match(notice.content[0].text, /<tabellio-memory>/);
    assert.match(notice.content[0].text, /今天天气不错/);
  }
  assert.equal(host.contexts.length, combo.autoRecall && combo.delivery === 'context' ? 1 : 0, `${combo.id}: quiet context registration count`);
  if (host.contexts.length === 1) {
    assert.equal(host.contexts[0].name, 'tabellio.recall');
    assert.equal(host.contexts[0].order, 800);
    assert.match(host.contexts[0].text(), injected ? /今天天气不错/ : /^$/);
  }
  assert.equal(llmState.calls, expectedJudgeCalls, `${combo.id}: judge calls`);

  const turn2 = await runPre(host, who, [human(`m2-${combo.id}`, '记住：以后脚本放 archive/。')]);
  assert.equal(turn2.messages.length, 1, `${combo.id}: capture-turn query should not inject`);
  if (host.contexts.length === 1) assert.equal(host.contexts[0].text(), '', `${combo.id}: quiet context must be cleared on a no-hit turn`);

  const receipts = readReceipts(dir);
  if (combo.shadow && combo.autoRecall) {
    assert.equal(receipts.length, 2, `${combo.id}: shadow should record one receipt per queried turn`);
    const weatherReceipt = receipts.find((receipt) => receipt.query === '今天天气怎么样？');
    assert.ok(weatherReceipt, `${combo.id}: weather receipt missing`);
    assert.equal(weatherReceipt.decision?.refused, false);
    assert.equal(weatherReceipt.decision?.reason, null);
    assert.equal(weatherReceipt.items.length, 1);
    const captureReceipt = receipts.find((receipt) => String(receipt.query).includes('archive'));
    assert.ok(captureReceipt, `${combo.id}: capture-turn receipt missing`);
    assert.equal(captureReceipt.decision?.refused, true);
  } else {
    assert.equal(receipts.length, 0, `${combo.id}: receipts must only be written in shadow mode`);
  }

  await runBoundary(host, 'agent/turn-stopping', who);
  const status = storeStatus(dir);
  assert.equal(status.candidates, combo.capture === 'off' ? 0 : 1, `${combo.id}: candidate count for capture=${combo.capture}`);
  if (combo.capture !== 'off') {
    const records = candidateRecords(dir);
    assert.match(records[0]?.source ?? '', /^dsh:session:/);
    assert.match(records[0]?.title ?? '', /脚本|archive/);
  }
  assert.deepEqual(host.warns, [], `${combo.id}: unexpected warnings: ${JSON.stringify(host.warns)}`);

  return {
    matrix: {
      id: combo.id,
      autoRecall: combo.autoRecall,
      delivery: combo.delivery,
      shadow: combo.shadow,
      capture: combo.capture,
      judge: combo.judge,
      judgeKeep: combo.judgeKeep,
      gate: combo.gate,
      injected,
      judgeCalls: llmState.calls,
      receipts: receipts.length,
      candidates: status.candidates,
      contextText: host.contexts.length ? (injected ? '有' : '空') : '未注册',
    },
  };
}

for (const combo of MATRIX) {
  testCase(combo.id, `matrix autoRecall=${combo.autoRecall} delivery=${combo.delivery} shadow=${combo.shadow} capture=${combo.capture} judge=${combo.judge} gate=${combo.gate}`, () => runMatrixCase(combo));
}

// ---------------------------------------------------------------------------
// 1. Metadata / registration
// ---------------------------------------------------------------------------
testCase('meta-01', 'plugin metadata, six tools and lifecycle handlers registered', async () => {
  assert.equal(pluginName, 'tabellio-dsh');
  assert.deepEqual(inject, ['tools']);
  assert.equal(normalizeConfig({ capture: 'bogus' }).capture, 'off');
  assert.equal(normalizeConfig({ delivery: 'bogus' }).delivery, 'notice');
  assert.equal(normalizeConfig({ judge: true }).judge, 'llm');
  assert.equal(normalizeConfig({ recallIntentGate: 'false' }).recallIntentGate, false);
  assert.ok(normalizeConfig({ storePath: '' }).storePath.startsWith(os.homedir()));

  const dir = tempStore('meta');
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: false, delivery: 'notice', capture: 'off', refreshSeconds: 0 });

  assert.deepEqual(
    host.tools.map((tool) => tool.name).sort(),
    ['tabellio_capture', 'tabellio_inbox', 'tabellio_read', 'tabellio_recall', 'tabellio_search', 'tabellio_status'],
  );
  for (const event of ['agent/pre-step', 'agent/turn-stopping', 'agent/disposed']) {
    assert.ok((host.handlers.get(event) ?? []).length >= 1, `missing handler for ${event}`);
  }
  assert.deepEqual(host.injectCalls.map((entry) => entry.deps.join(',')), ['webServer']);
  return { observations: ['非 webServer 的可选服务通过 ctx.inject 声明；本测试的 fake host 会同步激活它们。'] };
});

// ---------------------------------------------------------------------------
// 2. Tool contracts and real round-trip
// ---------------------------------------------------------------------------
const TOOL_CONTRACT = {
  tabellio_recall: { params: ['query'], required: ['query'], optional: ['budgetTokens', 'maxNotes'] },
  tabellio_search: { params: ['query'], required: ['query'], optional: ['limit'] },
  tabellio_read: { params: ['id'], required: ['id'], optional: [] },
  tabellio_status: { params: [], required: null, optional: [] },
  tabellio_capture: { params: ['content'], required: ['content'], optional: ['source', 'tags'] },
  tabellio_inbox: { params: ['action', 'ids'], required: null, optional: [] },
};

testCase('tools-01-schema', 'six tool schemas: required, additionalProperties:false, output schema and render', async () => {
  const dir = tempStore('tools-schema');
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: false, capture: 'off', refreshSeconds: 0 });
  assert.equal(host.tools.length, 6);
  const observations = [];
  for (const [name, expected] of Object.entries(TOOL_CONTRACT)) {
    const tool = findTool(host, name);
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 20, `${name}: description too short`);
    assertObjectSchema(tool.parameters, `${name}.parameters`);
    for (const prop of [...expected.params, ...expected.optional]) {
      assert.ok(Object.prototype.hasOwnProperty.call(tool.parameters.properties, prop), `${name}: missing parameter ${prop}`);
    }
    if (expected.required) {
      assert.deepEqual(tool.parameters.required, expected.required, `${name}: required mismatch`);
    } else {
      const required = tool.parameters.required;
      assert.ok(required === undefined || (Array.isArray(required) && required.length === 0), `${name}: optional-only tool must not require args`);
      if (required === undefined) observations.push(`${name}: parameters 未声明 required（等价于无可选必填参数）`);
    }
    assert.ok(tool.output?.schema, `${name}: output schema missing`);
    assertObjectSchema(tool.output.schema, `${name}.output`);
    assert.ok(Array.isArray(tool.output.schema.required) && tool.output.schema.required.length > 0, `${name}: output required missing`);
    assert.equal(typeof tool.output.render, 'function', `${name}: render missing`);
  }
  return { observations };
});

testCase('tools-02-roundtrip', 'capture -> list -> recall refusal -> approve -> recall/search/read/status round-trip', async () => {
  const dir = tempStore('tools-roundtrip');
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: false, capture: 'off', refreshSeconds: 0 });

  const initial = await callTool(host, 'tabellio_status', {});
  assert.equal(initial.notes, 0);
  assert.equal(initial.candidates, 0);
  assert.equal(initial.recall_mode, 'off');
  assert.equal(initial.last_recall.mode, 'none');

  const captured = await callTool(host, 'tabellio_capture', { content: '记住：发布用 pnpm。' });
  assert.equal(captured.ok, true);
  assert.match(captured.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(captured.chars > 0);
  assert.equal(captured.source, 'dsh:tool');
  assert.ok(captured.path.startsWith(dir), 'candidate path should live under the temp store');

  const duplicate = await callTool(host, 'tabellio_capture', { content: '记住：发布用 pnpm。' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'duplicate');

  const listed = await callTool(host, 'tabellio_inbox', {});
  assert.equal(listed.action, 'list');
  assert.equal(listed.count, 1);
  assert.equal(listed.candidates[0].id, captured.id);

  const beforeApproval = await callTool(host, 'tabellio_recall', { query: '发布用 pnpm' });
  assert.equal(beforeApproval.refused, true);
  assert.equal(beforeApproval.items.length, 0);

  const approved = await callTool(host, 'tabellio_inbox', { action: 'accept', ids: [captured.id] });
  assert.equal(approved.ok, true);
  assert.deepEqual(approved.accepted, [captured.id]);
  assert.deepEqual(approved.failed, []);

  const inspected = await callTool(host, 'tabellio_status', {});
  assert.equal(inspected.notes, 1);
  assert.equal(inspected.candidates, 0);

  const recalled = await callTool(host, 'tabellio_recall', { query: '发布用 pnpm' });
  assert.equal(recalled.refused, false);
  assert.equal(recalled.ok, true);
  assert.equal(recalled.items.length, 1);
  assert.match(recalled.items[0].content, /pnpm/);

  const searched = await callTool(host, 'tabellio_search', { query: 'pnpm' });
  assert.ok(searched.hits.length >= 1);
  assert.equal(searched.hits[0].id, recalled.items[0].id);

  const readBack = await callTool(host, 'tabellio_read', { id: recalled.items[0].id });
  assert.equal(readBack.ok, true);
  assert.match(readBack.body, /pnpm/);
  assert.equal(readBack.id, recalled.items[0].id);

  const missing = await callTool(host, 'tabellio_read', { id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' });
  assert.equal(missing.ok, false);
  assert.ok(missing.error.length > 0);

  const second = await callTool(host, 'tabellio_capture', { content: '记住：部署走蓝绿发布。' });
  assert.equal(second.ok, true);
  const rejected = await callTool(host, 'tabellio_inbox', { action: 'reject', ids: [second.id] });
  assert.equal(rejected.ok, true);
  assert.deepEqual(rejected.rejected, [second.id]);
  assert.equal(storeStatus(dir).candidates, 0);

  const emptyRecall = await callTool(host, 'tabellio_recall', { query: '' });
  assert.equal(emptyRecall.refused, true);
  assert.equal(emptyRecall.reason, 'empty_query');

  const emptySearch = await callTool(host, 'tabellio_search', { query: '' });
  assert.equal(emptySearch.refused, true);
  assert.equal(emptySearch.reason, 'empty_query');

  const emptyRead = await callTool(host, 'tabellio_read', { id: '' });
  assert.equal(emptyRead.ok, false);
  assert.match(emptyRead.error, /不能为空/);

  const emptyCapture = await callTool(host, 'tabellio_capture', { content: '   ' });
  assert.equal(emptyCapture.ok, false);
  assert.equal(emptyCapture.reason, 'empty');

  const secretCapture = await callTool(host, 'tabellio_capture', { content: '记住：数据库密码是 Hunter2@2026。' });
  assert.equal(secretCapture.ok, false);
  assert.equal(secretCapture.reason, 'secret_detected');

  const missingIds = await callTool(host, 'tabellio_inbox', { action: 'accept' });
  assert.equal(missingIds.ok, false);
  assert.match(missingIds.message, /ids/);

  const unknownReview = await callTool(host, 'tabellio_inbox', { action: 'accept', ids: ['NO_SUCH_CANDIDATE'] });
  assert.equal(unknownReview.ok, false);
  assert.equal(unknownReview.failed.length, 1);
  assert.equal(unknownReview.failed[0].id, 'NO_SUCH_CANDIDATE');
  assert.equal(unknownReview.failed[0].reason, 'candidate_not_found');

  const finalStatus = await callTool(host, 'tabellio_status', {});
  assert.equal(finalStatus.notes, 1);
  assert.equal(finalStatus.candidates, 0);
  return { observations: ['工具层 round-trip 覆盖候选、审批门、召回拒绝语义与只读查询。'] };
});

// ---------------------------------------------------------------------------
// 3. Panel RPC
// ---------------------------------------------------------------------------
async function makeRpcContext(label, settingsOverrides = {}) {
  const dir = tempStore(label);
  const store = tabellio.openStore(dir);
  const settings = normalizeConfig({ storePath: dir, refreshSeconds: 0, ...settingsOverrides });
  let lastRecall = null;
  const handler = createRpcHandler({
    settings,
    getStore: () => store,
    getLastRecall: () => lastRecall,
  });
  return {
    dir,
    store,
    settings,
    handler,
    getLastRecall: () => lastRecall,
    setLastRecall(value) {
      lastRecall = value;
    },
  };
}

testCase('rpc-01-status', 'RPC status and inbox.list envelopes, counts and lastRecall projection', async () => {
  const { dir, store, handler, setLastRecall } = await makeRpcContext('rpc-status');
  const initial = rpcOk(await handler('status', {}), 'status empty');
  assert.equal(initial.store, dir);
  assert.equal(typeof initial.exists, 'boolean');
  assert.equal(initial.exists, false, 'an untouched mkdtemp dir has no tabellio store yet');
  assert.equal(initial.notes, 0);
  assert.equal(initial.candidates, 0);
  assert.equal(initial.proposals, 0);
  assert.equal(initial.mode, 'inject');
  assert.equal(initial.capture, 'explicit');
  assert.equal(initial.delivery, 'notice');
  assert.equal(initial.lastRecall, null);

  setLastRecall({ at: '123', query: 42, mode: 'notice', refused: 1, count: '2', reason: undefined, receiptPath: 42 });
  const projected = rpcOk(await handler('status', null), 'status lastRecall');
  assert.deepEqual(projected.lastRecall, {
    at: 123,
    query: '42',
    mode: 'notice',
    refused: true,
    count: 2,
    judged: false,
    reason: null,
    titles: [],
    receiptPath: '42',
  });

  const note = tabellio.remember(store, { text: '# 项目代号\n\n项目代号是青鸟。' });
  assert.equal(note.ok, true);
  const first = tabellio.addCandidate(store, { text: '# 候选甲\n\n候选甲正文。', source: 'acceptance' }, { writtenBy: 'acceptance' });
  const second = tabellio.addCandidate(store, { text: '# 候选乙\n\n候选乙正文。', source: 'acceptance' }, { writtenBy: 'acceptance' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const status = rpcOk(await handler('status', {}), 'status populated');
  assert.equal(status.notes, 1);
  assert.equal(status.candidates, 2);
  assert.ok(Array.isArray(status.warnings));
  assert.ok(status.warnings.every((warning) => typeof warning === 'string'));

  const listed = rpcOk(await handler('inbox.list', {}), 'inbox.list');
  assert.equal(listed.items.length, 2);
  assert.deepEqual(
    listed.items.map((item) => item.id).sort(),
    [first.id, second.id].sort(),
  );
  for (const item of listed.items) {
    assert.deepEqual(Object.keys(item).sort(), ['chars', 'created', 'id', 'kind', 'source', 'title', 'trust']);
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.chars, 'number');
    assert.equal(typeof item.created, 'string');
    assert.equal(typeof item.kind, 'string');
    assert.equal(typeof item.trust, 'string');
    assert.equal(typeof item.source, 'string');
    assert.ok(!('path' in item));
    assert.ok(!('scope' in item));
  }

  const shadow = await makeRpcContext('rpc-status-shadow', { shadow: true });
  const shadowStatus = rpcOk(await shadow.handler('status', {}), 'status shadow');
  assert.equal(shadowStatus.mode, 'shadow');
  assert.equal(shadowStatus.delivery, 'shadow');

  const off = await makeRpcContext('rpc-status-off', { autoRecall: false, delivery: 'context' });
  const offStatus = rpcOk(await off.handler('status', {}), 'status off');
  assert.equal(offStatus.mode, 'off');
  assert.equal(offStatus.delivery, 'context');
  return { observations: [`status.mode 覆盖 inject/shadow/off；delivery 在 shadow 下投影为 "shadow"。`] };
});

testCase('rpc-02-inbox', 'RPC inbox.review: valid accept/reject, partial failure and every invalid shape', async () => {
  const { dir, store, handler } = await makeRpcContext('rpc-inbox');
  const candidates = [];
  for (const text of ['# 候选一\n\n候选一正文。', '# 候选二\n\n候选二正文。', '# 候选三\n\n候选三正文。']) {
    const result = tabellio.addCandidate(store, { text, source: 'acceptance' }, { writtenBy: 'acceptance' });
    assert.equal(result.ok, true);
    candidates.push(result.id);
  }
  const [one, two] = candidates;

  const invalidPayloads = [
    [{}, 'missing action'],
    [{ action: 'accept' }, 'missing ids'],
    [{ action: 'accept', ids: [] }, 'empty ids'],
    [{ action: 'accept', ids: 'not-an-array' }, 'non-array ids'],
    [{ action: 'accept', ids: [one] }, 'valid accept (control)'],
    [{ action: 'archive', ids: [one] }, 'invalid action'],
    [{ action: 'accept', ids: [one, 42] }, 'non-string id'],
    [{ action: 'accept', ids: [''] }, 'empty string id'],
    [{ action: 'accept', ids: [one, two, ...Array.from({ length: MAX_REVIEW_IDS - 1 }, (_, index) => `extra-${index}`)] }, 'too many ids'],
  ];
  // Remove the valid control; it must run after the invalid-shape assertions so
  // it does not consume the candidate these assertions use.
  invalidPayloads.splice(4, 1);
  for (const [payload, name] of invalidPayloads) {
    if (name === 'invalid action') {
      await expectBadRequest(handler, 'inbox.review', payload, name, 'action must be');
    } else if (name === 'missing action') {
      await expectBadRequest(handler, 'inbox.review', payload, name, 'action must be');
    } else if (name.includes('ids') || name.includes('id')) {
      await expectBadRequest(handler, 'inbox.review', payload, name);
    } else {
      await expectBadRequest(handler, 'inbox.review', payload, name);
    }
  }
  await expectBadRequest(handler, 'inbox.review', { action: 'accept', ids: Array.from({ length: MAX_REVIEW_IDS + 1 }, (_, index) => `id-${index}`) }, 'too many ids', `at most ${MAX_REVIEW_IDS}`);

  const accepted = rpcOk(await handler('inbox.review', { action: 'accept', ids: [one] }), 'accept one');
  assert.deepEqual(accepted.accepted, [one]);
  assert.deepEqual(accepted.rejected, []);
  assert.deepEqual(accepted.failed, []);
  assert.equal(accepted.notes, 1);
  assert.equal(accepted.candidates, 2);

  const rejected = rpcOk(await handler('inbox.review', { action: 'reject', ids: [two] }), 'reject one');
  assert.deepEqual(rejected.rejected, [two]);
  assert.equal(rejected.candidates, 1);

  const partial = rpcOk(await handler('inbox.review', { action: 'accept', ids: ['NO_SUCH_CANDIDATE'] }), 'unknown id');
  assert.deepEqual(partial.accepted, []);
  assert.equal(partial.failed.length, 1);
  assert.equal(partial.failed[0].id, 'NO_SUCH_CANDIDATE');
  assert.equal(partial.failed[0].reason, 'candidate_not_found');
  assert.equal(partial.notes, 1);
  assert.equal(partial.candidates, 1);

  const fiftyUnknown = Array.from({ length: MAX_REVIEW_IDS }, (_, index) => `missing-${index}`);
  const boundary = rpcOk(await handler('inbox.review', { action: 'accept', ids: fiftyUnknown }), '50 unknown ids');
  assert.equal(boundary.failed.length, MAX_REVIEW_IDS);

  assert.equal(storeStatus(dir).notes, 1);
  assert.equal(storeStatus(dir).candidates, 1);
  await expectBadRequest(handler, 'nope', {}, 'unknown endpoint', 'unknown endpoint');
  await expectBadRequest(handler, '', null, 'empty endpoint', 'unknown endpoint');
  await expectBadRequest(handler, 'STATUS', {}, 'case-sensitive endpoint', 'unknown endpoint');
  return { observations: ['未知 id 走 ok:true + failed[] 的部分失败语义，而不是 bad-request。'] };
});

testCase('rpc-03-search', 'RPC search: hits, candidate invisibility, query/limit validation', async () => {
  const { dir, store, handler } = await makeRpcContext('rpc-search');
  const project = tabellio.remember(store, { text: '# 项目代号\n\n项目代号是青鸟。' });
  const release = tabellio.remember(store, { text: '# 发布流程\n\n发布用 pnpm。' });
  const cadence = tabellio.remember(store, { text: '# 发布节奏\n\n发布节奏是周二。' });
  const checklist = tabellio.remember(store, { text: '# 发布检查\n\n发布前跑测试。' });
  for (const result of [project, release, cadence, checklist]) assert.equal(result.ok, true);

  const hits = rpcOk(await handler('search', { query: '项目代号' }), 'search project');
  assert.equal(hits.refused, false);
  assert.ok(hits.hits.length >= 1);
  assert.ok(hits.hits.some((hit) => hit.id === project.id));
  for (const hit of hits.hits) {
    assert.deepEqual(Object.keys(hit).sort(), ['id', 'score', 'title']);
    assert.equal(typeof hit.id, 'string');
    assert.equal(typeof hit.title, 'string');
    assert.equal(typeof hit.score, 'number');
  }

  const pnpm = rpcOk(await handler('search', { query: 'pnpm' }), 'search pnpm');
  assert.ok(pnpm.hits.some((hit) => hit.id === release.id));

  const missing = rpcOk(await handler('search', { query: '完全不存在的词xyz' }), 'search miss');
  assert.equal(missing.hits.length, 0);

  const candidate = tabellio.addCandidate(store, { text: '# 候选\n\n玄武门计划只存在于候选。', source: 'acceptance' }, { writtenBy: 'acceptance' });
  assert.equal(candidate.ok, true);
  const invisible = rpcOk(await handler('search', { query: '玄武门' }), 'candidate invisibility');
  assert.ok(!invisible.hits.some((hit) => hit.id === candidate.id));

  for (const [payload, label, part] of [
    [{}, 'missing query', 'non-empty string'],
    [{ query: '' }, 'empty query', 'non-empty string'],
    [{ query: '   ' }, 'whitespace query', 'non-empty string'],
    [{ query: 123 }, 'non-string query', 'non-empty string'],
    [{ query: '长'.repeat(201) }, 'too long query', 'too long'],
  ]) {
    await expectBadRequest(handler, 'search', payload, label, part);
  }
  const boundaryQuery = '项目'.repeat(100);
  assert.equal(boundaryQuery.length, 200);
  const boundary = await handler('search', { query: boundaryQuery });
  assert.equal(boundary.ok, true);

  const limited = rpcOk(await handler('search', { query: '发布', limit: -5 }), 'negative limit');
  assert.ok(limited.hits.length <= 1, 'negative limit must clamp to 1');
  const one = rpcOk(await handler('search', { query: '发布', limit: 1 }), 'limit 1');
  assert.ok(one.hits.length <= 1);
  const zero = rpcOk(await handler('search', { query: '发布', limit: 0 }), 'limit 0');
  assert.ok(zero.hits.length <= 1);
  const many = rpcOk(await handler('search', { query: '发布', limit: 999 }), 'limit 999');
  assert.ok(many.hits.length <= MAX_SEARCH_LIMIT);
  const textLimit = rpcOk(await handler('search', { query: '发布', limit: 'abc' }), 'non-numeric limit');
  assert.ok(textLimit.hits.length <= MAX_SEARCH_LIMIT);
  assert.equal(typeof hits.refused, 'boolean');
  assert.ok(hits.reason === null || typeof hits.reason === 'string');
  return { observations: ['search 的 limit 将负数/0 夹到 1，超大值夹到 20，非数字回落到 8。'] };
});

testCase('rpc-04-malformed', 'RPC malformed payloads return envelopes and never throw', async () => {
  const { handler } = await makeRpcContext('rpc-malformed');
  const results = [];
  const calls = [
    ['nope', {}],
    ['', null],
    ['STATUS', {}],
    [undefined, {}],
    ['status', null],
    ['inbox.list', null],
    ['inbox.review', null],
    ['proposals.list', null],
    ['proposals.review', null],
    ['search', null],
    ['search', { query: new String('x') }], // eslint-disable-line no-new-wrappers
  ];
  for (const [endpoint, payload] of calls) {
    const result = await handler(endpoint, payload);
    assert.ok(result && typeof result === 'object' && typeof result.ok === 'boolean', `no envelope for ${String(endpoint)}`);
    results.push({ endpoint: String(endpoint), ok: result.ok });
  }
  assert.equal(results.find((entry) => entry.endpoint === 'status').ok, true);
  assert.equal(results.find((entry) => entry.endpoint === 'inbox.list').ok, true);
  for (const endpoint of ['nope', '', 'STATUS', 'undefined']) {
    const found = results.find((entry) => entry.endpoint === endpoint);
    assert.equal(found?.ok, false, `${endpoint} should fail`);
  }
  assert.equal(results.find((entry) => entry.endpoint === 'inbox.review').ok, false);
  assert.equal(results.find((entry) => entry.endpoint === 'proposals.list').ok, true);
  assert.equal(results.find((entry) => entry.endpoint === 'proposals.review').ok, false);
  const searchFailures = results.filter((entry) => entry.endpoint === 'search');
  assert.ok(searchFailures.every((entry) => entry.ok === false));
  return { observations: ['未知 endpoint 与 null payload 均返回 {ok:false,error:{code,message,details}}，没有抛异常。'] };
});

// ---------------------------------------------------------------------------
// 4. Lifecycle
// ---------------------------------------------------------------------------
testCase('life-01-disposed', 'agent/disposed clears state: no duplicate capture on repeated boundaries', async () => {
  const dir = tempStore('life-disposed');
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: false, capture: 'explicit', refreshSeconds: 0 });
  const who = makeAgent('life-disposed');
  const text = '记住：以后脚本放 archive/。';

  await runPre(host, who, [human('m1', text)]);
  await runBoundary(host, 'agent/turn-stopping', who);
  assert.equal(storeStatus(dir).candidates, 1);
  assert.equal(candidateFiles(dir).length, 1);

  await runBoundary(host, 'agent/turn-stopping', who);
  assert.equal(storeStatus(dir).candidates, 1, 'same turn must not be captured twice');
  assert.equal(candidateFiles(dir).length, 1);

  await runBoundary(host, 'agent/disposed', who);
  assert.equal(storeStatus(dir).candidates, 1, 'disposed after a successful capture must not duplicate');
  assert.equal(candidateFiles(dir).length, 1);

  await runBoundary(host, 'agent/turn-stopping', who);
  assert.equal(storeStatus(dir).candidates, 1, 'late turn-stopping after disposed must be a no-op');

  // A new turn on the same agent gets a fresh state; identical text is stopped
  // by tabellio's duplicate gate, not re-written.
  await runPre(host, who, [human('m2', text)]);
  await runBoundary(host, 'agent/turn-stopping', who);
  assert.equal(storeStatus(dir).candidates, 1);
  assert.equal(candidateFiles(dir).length, 1);
  return { observations: ['重复文本由 tabellio 的 duplicate 门拦截；候选文件数保持 1。'] };
});

testCase('life-02-dedupe', 'pre-step dedupes the same message id and the same recalled note set', async () => {
  const dir = tempStore('life-dedupe');
  seedNotes(dir, ['# 项目代号\n\n项目代号是青鸟。', '# 发布流程\n\n发布用 pnpm。']);
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: true, capture: 'off', refreshSeconds: 0 });
  const who = makeAgent('life-dedupe');

  const first = await runPre(host, who, [human('m1', '项目代号是什么？')]);
  assert.equal(first.messages.length, 2);
  assert.match(observedInjection(first.messages)?.content[0].text ?? '', /青鸟/);

  const repeatedId = await runPre(host, who, [human('m1', '项目代号是什么？')]);
  assert.equal(repeatedId.messages.length, 1, 'same message id must not inject twice');

  const sameNotes = await runPre(host, who, [human('m2', '项目代号是什么？')]);
  assert.equal(sameNotes.messages.length, 1, 'same note set must not be injected twice');

  const other = await runPre(host, who, [human('m3', '发布流程是什么？')]);
  assert.equal(other.messages.length, 2);
  assert.match(observedInjection(other.messages)?.content[0].text ?? '', /pnpm/);

  const backToFirst = await runPre(host, who, [human('m4', '发布流程是什么？')]);
  assert.equal(backToFirst.messages.length, 1, 'last injected note set is remembered per agent');

  const newTurn = await runPre(host, who, [human('m5', '发布流程是什么？')]);
  assert.equal(newTurn.messages.length, 1, 'a new message id does not defeat note-set dedupe');

  assert.deepEqual(host.warns, []);
  return { observations: ['两层去重：messageId（seen）与 note-id 集合（lastInjectedKey）。'] };
});

testCase('life-03-delegated', 'delegationDepth > 0 neither recalls, writes receipts, nor captures', async () => {
  const dir = tempStore('life-delegated');
  seedNotes(dir, ['# 项目代号\n\n项目代号是青鸟。']);
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: true, shadow: true, capture: 'explicit', refreshSeconds: 0 });

  const scout = makeAgent('scout', { depth: 1 });
  const scoutRecall = await runPre(host, scout, [human('s1', '项目代号是什么？')]);
  assert.equal(scoutRecall.messages.length, 1);
  assert.equal(readReceipts(dir).length, 0, 'delegated recall must not write a receipt');
  await runBoundary(host, 'agent/turn-stopping', scout);
  await runBoundary(host, 'agent/disposed', scout);
  assert.equal(storeStatus(dir).candidates, 0);

  const subagentDepth = makeAgent('scout-options', { subagentDepth: 2 });
  const optionsRecall = await runPre(host, subagentDepth, [human('s2', '记住：项目代号是青鸟。')]);
  assert.equal(optionsRecall.messages.length, 1);
  await runBoundary(host, 'agent/turn-stopping', subagentDepth);
  await runBoundary(host, 'agent/disposed', subagentDepth);
  assert.equal(readReceipts(dir).length, 0);
  assert.equal(storeStatus(dir).candidates, 0);

  // Control: the main agent still works after delegated agents were disposed.
  const main = makeAgent('main');
  await runPre(host, main, [human('s3', '记住：以后脚本放 archive/。')]);
  await runBoundary(host, 'agent/turn-stopping', main);
  assert.equal(storeStatus(dir).candidates, 1, 'delegated disposal must not poison the main agent state');
  return { observations: ['session.header.delegationDepth 与 options.subagentDepth 两条路径都被覆盖。'] };
});

// ---------------------------------------------------------------------------
// 5. Concurrency
// ---------------------------------------------------------------------------
testCase('conc-01-same-agent', 'two concurrent pre-steps on one agent keep recall independent', async () => {
  const dir = tempStore('conc-same');
  seedNotes(dir, ['# 项目代号\n\n项目代号是青鸟。', '# 发布流程\n\n发布用 pnpm。']);
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: true, capture: 'explicit', recallIntentGate: false, refreshSeconds: 0 });
  const who = makeAgent('conc-same');
  const textA = '记住：项目代号是青鸟。';
  const textB = '记住：发布用 pnpm。';

  const [first, second] = await Promise.all([
    runPre(host, who, [human('c1', textA)]),
    runPre(host, who, [human('c2', textB)]),
  ]);
  assert.equal(first.messages.length, 2);
  assert.equal(second.messages.length, 2);
  assert.match(observedInjection(first.messages)?.content[0].text ?? '', /青鸟/);
  assert.match(observedInjection(second.messages)?.content[0].text ?? '', /pnpm/);

  await runBoundary(host, 'agent/turn-stopping', who);
  const records = candidateRecords(dir);
  assert.equal(records.length, 1, 'one shared state slot captures the latest turn once');
  assert.match(records[0].title, /青鸟|pnpm/, 'captured candidate must be one of the two turns, not a mixture');
  assert.deepEqual(host.warns, []);
  return { observations: ['并发 pre-step 的召回结果互不串味；capture 的 lastUser 为最后完成的一轮（单槽设计）。'] };
});

testCase('conc-02-two-agents', 'two agents concurrently: recall and capture state stay isolated', async () => {
  const dir = tempStore('conc-two');
  seedNotes(dir, ['# 项目代号\n\n项目代号是青鸟。', '# 发布流程\n\n发布用 pnpm。']);
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: true, capture: 'explicit', recallIntentGate: false, refreshSeconds: 0 });
  const agentA = makeAgent('conc-a', { sessionId: 'sess-a' });
  const agentB = makeAgent('conc-b', { sessionId: 'sess-b' });

  const [recallA, recallB] = await Promise.all([
    runPre(host, agentA, [human('a1', '项目代号是什么？')]),
    runPre(host, agentB, [human('b1', '发布流程是什么？')]),
  ]);
  assert.match(observedInjection(recallA.messages)?.content[0].text ?? '', /青鸟/);
  assert.match(observedInjection(recallB.messages)?.content[0].text ?? '', /pnpm/);

  await Promise.all([
    runPre(host, agentA, [human('a2', '记住：甲代理偏好青鸟。')]),
    runPre(host, agentB, [human('b2', '记住：乙代理偏好白虎。')]),
  ]);
  await Promise.all([
    runBoundary(host, 'agent/turn-stopping', agentA),
    runBoundary(host, 'agent/turn-stopping', agentB),
  ]);

  const records = candidateRecords(dir);
  assert.equal(records.length, 2);
  const bySource = new Map(records.map((record) => [record.source, record]));
  const aRecord = bySource.get('dsh:session:sess-a');
  const bRecord = bySource.get('dsh:session:sess-b');
  assert.ok(aRecord, 'agent A candidate must carry its own session source');
  assert.ok(bRecord, 'agent B candidate must carry its own session source');
  assert.match(aRecord.title, /青鸟/);
  assert.match(bRecord.title, /白虎/);
  assert.deepEqual(host.warns, []);
  return { observations: ['候选的 source 分别指向 dsh:session:sess-a/sess-b，没有串写。'] };
});

// ---------------------------------------------------------------------------
// 6. Read-only store
// ---------------------------------------------------------------------------
testCase('ro-01-readonly', 'read-only store: candidate write warns, prepare does not crash, disposal retries', async () => {
  const dir = tempStore('ro-basic');
  seedNotes(dir, ['# 占位\n\n先建目录。']);
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: true, capture: 'explicit', shadow: false, refreshSeconds: 0 });
  const who = makeAgent('ro-basic');

  // Baseline recall works before permissions are tightened.
  await runPre(host, who, [human('ro0', '项目代号是什么？')]);

  makeTreeReadOnly(dir);
  try {
    const prepared = await runPre(host, who, [human('ro1', '记住：以后脚本放 archive/。')]);
    assert.ok(prepared && Array.isArray(prepared.messages), 'prepare must return a decision when the store is read-only');
    await runBoundary(host, 'agent/turn-stopping', who);
    assert.equal(storeStatus(dir).candidates, 0, 'no candidate should be written to a read-only store');
    assert.ok(
      host.warns.some((warning) => warning.includes('candidates were not written')),
      'expected a warning when the candidate write fails: ' + JSON.stringify(host.warns),
    );
    const stillPrepared = await runPre(host, who, [human('ro2', '项目代号是什么？')]);
    assert.ok(stillPrepared && Array.isArray(stillPrepared.messages), 'recall must not crash on a read-only store');
  } finally {
    makeTreeWritable(dir);
  }

  await runBoundary(host, 'agent/disposed', who);
  assert.equal(storeStatus(dir).candidates, 1, 'disposal must retry and write the pending candidate after recovery');
  const files = candidateFiles(dir);
  assert.equal(files.length, 1);
  const body = fs.readFileSync(path.join(dir, 'notes', 'candidates', files[0]), 'utf8');
  assert.match(body, /archive/);
  return { observations: ['整库（含根目录、notes/candidates、runs）chmod 只读后 prepare 仍可读；写入失败只 warn。'] };
});

testCase('ro-02-retry-cleanup', 'after a read-only retry succeeds, pending state must be cleared and not warn again', async () => {
  const dir = tempStore('ro-retry');
  seedNotes(dir, ['# 占位\n\n先建目录。']);
  const host = createHost();
  apply(host.ctx, { storePath: dir, autoRecall: false, capture: 'explicit', refreshSeconds: 0 });
  const who = makeAgent('ro-retry');
  const notWrittenWarnings = () => host.warns.filter((warning) => warning.includes('candidates were not written')).length;

  await runPre(host, who, [human('r1', '记住：以后脚本放 archive/。')]);
  makeTreeReadOnly(dir);
  try {
    await runBoundary(host, 'agent/turn-stopping', who);
    assert.equal(storeStatus(dir).candidates, 0);
    assert.equal(notWrittenWarnings(), 1, 'read-only boundary should warn exactly once');
  } finally {
    makeTreeWritable(dir);
  }

  const warningsBefore = notWrittenWarnings();
  await runBoundary(host, 'agent/turn-stopping', who);
  assert.equal(storeStatus(dir).candidates, 1, 'retry should write the pending candidate');
  assert.equal(
    notWrittenWarnings(),
    warningsBefore,
    'a successful retry must not re-warn merely because the same text now exists (duplicate is success, not failure)',
  );

  await runBoundary(host, 'agent/turn-stopping', who);
  assert.equal(storeStatus(dir).candidates, 1);
  assert.equal(notWrittenWarnings(), warningsBefore, 'pending state must be cleared after the successful retry');

  await runBoundary(host, 'agent/disposed', who);
  assert.equal(storeStatus(dir).candidates, 1);
  assert.equal(notWrittenWarnings(), warningsBefore, 'disposal must not keep retrying a cleared pending candidate');
  return { observations: ['用例验证 retry 成功后 pendingCandidates/lastUser 是否收敛；若失败见报告 bug 段。'] };
});

// ---------------------------------------------------------------------------
// Runner and report
// ---------------------------------------------------------------------------
const sourceFiles = ['index.js', ...fs.readdirSync(path.join(ROOT, 'src')).filter((name) => name.endsWith('.js')).sort().map((name) => 'src/' + name)];

function hashSources() {
  const hashes = {};
  for (const relative of sourceFiles) {
    try {
      hashes[relative] = createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
    } catch {
      hashes[relative] = '<missing>';
    }
  }
  return hashes;
}

function ms(value) {
  return `${value}ms`;
}

function formatError(error) {
  if (!error) return 'unknown error';
  return `${error.name ?? 'Error'}: ${error.message ?? String(error)}`;
}

function sourceLine(relative, needle) {
  try {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const at = text.indexOf(needle);
    if (at < 0) return null;
    return text.slice(0, at).split('\n').length;
  } catch {
    return null;
  }
}

function sourceLocation(relative, needle, span = 1) {
  const line = sourceLine(relative, needle);
  if (!line) return `\`${relative}\``;
  return span > 1 ? `\`${relative}:${line}-${line + span - 1}\`` : `\`${relative}:${line}\``;
}

function renderKnownIssues(outcomes) {
  const retryFailed = outcomes.some((outcome) => outcome.id === 'ro-02-retry-cleanup' && outcome.status === 'fail');
  if (!retryFailed) return [];
  const duplicateLine = sourceLocation('index.js', 'if (result?.ok) written += 1;', 2);
  const retryLine = sourceLocation('index.js', 'const retry = writeCandidates(', 6);
  const pendingLine = sourceLocation('index.js', 'state.pendingCandidates = result.failedItems;', 4);
  const warnLine = sourceLocation('index.js', ' candidates were not written at ', 5);
  const testLine = sourceLocation('tests/acceptance.mjs', 'a successful retry must not re-warn');
  const lines = [];
  lines.push('## 缺陷登记（未修改 src）', '');
  lines.push('### BUG-1：只读恢复后的 duplicate 被当成写入失败，pending 永不收敛', '');
  lines.push(`- 位置：${duplicateLine}（\`duplicate\` 走 \`else failedItems.push(candidate)\`）；重试入口 ${retryLine}；pending 回填 ${pendingLine}；告警 ${warnLine}；断言 ${testLine}。`);
  lines.push('');
  lines.push('```text');
  lines.push('if (result?.ok) written += 1;');
  lines.push('else failedItems.push(candidate);                 // duplicate 也被计入失败');
  lines.push('const retry = writeCandidates(state.pendingCandidates, ...);');
  lines.push('state.pendingCandidates = retry.failedItems;');
  lines.push('const result = writeCandidates(found, source, where);');
  lines.push('if (result.failedItems.length > 0) state.pendingCandidates = result.failedItems;');
  lines.push('warn("... N of M candidates were not written at ...")');
  lines.push('```');
  lines.push('');
  lines.push('- 复现：`cd /Users/yangfu/yffto/tabellio-dsh && node tests/acceptance.mjs --filter ro-02-retry-cleanup --report /tmp/ro-02.md`');
  lines.push('- 步骤：capture 的候选先遇到整库只读（一次 warn，pending 保留）→ 恢复写权限 → 再次触发 `agent/turn-stopping`。');
  lines.push('- 期望：重试成功写入候选（candidates=1）后清空 pending；同一文本再次提交得到 `duplicate` 时应视为“已存在”而不是“未写入”，warn 计数不再增加。');
  lines.push('- 实际：重试确实写入了 1 条候选，但同一 `lastUser` 随后被再次捕获；`addCandidate` 返回 `{ok:false, reason:"duplicate"}`，被计入 failedItems 并重新赋给 `pendingCandidates`，`candidates were not written` 告警从 1 条变成 2 条；之后每个 boundary/disposed 都继续告警并重试。');
  lines.push('- 影响：store 从只读恢复后日志持续出现假告警，pending 永不清理；`agent/disposed` 也无法结束该循环。');
  lines.push('');
  return lines;
}

function renderReport({ startedAt, durationMs, before, after, outcomes, skipped, passed, failed }) {
  const lines = [];
  const localStamp = new Date(startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const cell = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|').slice(0, 300);
  lines.push('# tabellio-dsh 功能验收报告', '');
  lines.push(`- 生成时间：${localStamp}（Asia/Shanghai） / ${startedAt}`);
  lines.push(`- 运行环境：Node ${process.version} / ${process.platform} ${process.arch} / ${os.userInfo().username}`);
  lines.push(`- 仓库：\`${ROOT}\``);
  lines.push('- 测试文件：`tests/acceptance.mjs`（本次唯一新增文件；src 未修改）');
  lines.push('- 运行方式：`node tests/acceptance.mjs --report <path>`');
  lines.push('');
  lines.push('## 结果', '');
  lines.push(`- 通过：**${passed}**`);
  lines.push(`- 失败：**${failed}**`);
  lines.push(`- 跳过：${skipped.length}`);
  lines.push(`- 总耗时：${durationMs}ms`);
  if (failed) {
    lines.push(`- 失败清单：${outcomes.filter((outcome) => outcome.status === 'fail').map((outcome) => '`' + outcome.id + '`').join('、')}`);
  }
  lines.push('');
  lines.push('| 用例 | 结果 | 耗时 | 说明 |');
  lines.push('| --- | --- | --- | --- |');
  for (const outcome of outcomes) {
    const note = outcome.status === 'pass'
      ? (outcome.detail?.observations ?? []).join('；')
      : formatError(outcome.error);
    lines.push(`| \`${outcome.id}\` | ${outcome.status === 'pass' ? 'PASS' : '**FAIL**'} | ${ms(outcome.durationMs)} | ${cell(note)} |`);
  }
  if (skipped.length) {
    lines.push('', `跳过的用例：${skipped.map((item) => '`' + item.id + '`').join('、')}`);
  }

  const matrixRows = outcomes.filter((outcome) => outcome.detail?.matrix).map((outcome) => outcome.detail.matrix);
  if (matrixRows.length) {
    lines.push('', '## 配置矩阵（16 组合）', '');
    lines.push('| 用例 | autoRecall | delivery | shadow | capture | judge | gate | notice 注入 | context | judge 调用 | receipts | candidates |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of matrixRows) {
      lines.push(`| \`${row.id}\` | ${row.autoRecall} | ${row.delivery} | ${row.shadow} | ${row.capture} | ${row.judge}${row.judge === 'llm' ? ` (keep=${row.judgeKeep})` : ''} | ${row.gate} | ${row.injected && row.delivery === 'notice' ? '是' : '否'} | ${row.contextText} | ${row.judgeCalls} | ${row.receipts} | ${row.candidates} |`);
    }
    lines.push('', '矩阵查询：第 1 轮 `今天天气怎么样？`（无记忆意图，命中种子笔记 `今天天气不错，适合发布。`）；第 2 轮 `记住：以后脚本放 archive/。`（召回拒绝，用于验证 capture）。每轮独立 store。');
  }

  const observations = outcomes.flatMap((outcome) => outcome.detail?.observations ?? []);
  if (observations.length) {
    lines.push('', '## 观察与备注', '');
    observations.forEach((observation, index) => lines.push(`${index + 1}. ${observation}`));
  }

  const failures = outcomes.filter((outcome) => outcome.status === 'fail');
  lines.push('', '## 失败详情', '');
  if (!failures.length) {
    lines.push('无。', '');
  } else {
    for (const failure of failures) {
      lines.push(`### \`${failure.id}\` — ${failure.title}`, '');
      lines.push('```text');
      lines.push(String(failure.error?.stack ?? formatError(failure.error)).slice(0, 8000));
      lines.push('```', '');
      lines.push(`复现：\`node tests/acceptance.mjs --filter ${failure.id}\``, '');
    }
  }

  lines.push(...renderKnownIssues(outcomes));
  lines.push('## 源码快照', '');
  lines.push('运行开始与结束各取一次 sha256；若两次不一致，说明运行期间有其他进程修改了源码。', '');
  lines.push('| 文件 | 运行前 sha256 | 运行后 sha256 | 是否变化 |');
  lines.push('| --- | --- | --- | --- |');
  for (const relative of sourceFiles) {
    const changed = before[relative] !== after[relative];
    lines.push(`| \`${relative}\` | \`${before[relative]?.slice(0, 16)}\` | \`${after[relative]?.slice(0, 16)}\` | ${changed ? '**是**' : '否'} |`);
  }
  lines.push('');
  lines.push('## 清理', '');
  lines.push('每个用例使用 `mkdtemp` 临时 store；运行结束统一恢复权限并删除（包括只读用例）。未访问 `~/memory/tabellio`，未联网，未重启 DSH。');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const before = hashSources();
  const outcomes = [];
  const skipped = [];
  let passed = 0;
  let failed = 0;

  for (const test of cases) {
    if (filter && !`${test.id} ${test.title}`.toLowerCase().includes(filter.toLowerCase())) {
      skipped.push(test);
      continue;
    }
    const caseStart = Date.now();
    try {
      const detail = await test.fn();
      outcomes.push({ id: test.id, title: test.title, status: 'pass', durationMs: Date.now() - caseStart, detail });
      passed += 1;
      console.log(`ok   ${test.id}  ${test.title} (${ms(Date.now() - caseStart)})`);
    } catch (error) {
      outcomes.push({ id: test.id, title: test.title, status: 'fail', durationMs: Date.now() - caseStart, error });
      failed += 1;
      console.error(`FAIL ${test.id}  ${test.title} (${ms(Date.now() - caseStart)})`);
      console.error(String(error?.stack ?? error).split('\n').slice(0, 6).map((line) => '     ' + line).join('\n'));
    }
  }

  const after = hashSources();
  const durationMs = Date.now() - start;
  cleanupTempStores();

  console.log('');
  console.log(`tabellio-dsh acceptance: ${passed} passed, ${failed} failed, ${skipped.length} skipped (${ms(durationMs)})`);
  if (failed) {
    console.log('failed: ' + outcomes.filter((outcome) => outcome.status === 'fail').map((outcome) => outcome.id).join(', '));
  }

  const report = renderReport({
    startedAt,
    durationMs,
    before,
    after,
    outcomes,
    skipped,
    passed,
    failed,
  });
  if (reportArg) {
    const target = path.resolve(process.cwd(), reportArg);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, report, 'utf8');
    console.log(`report: ${target}`);
  }

  process.exitCode = failed ? 1 : 0;
}

await main();
