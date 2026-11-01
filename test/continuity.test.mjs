// New-window continuity and zero-approval capture: the two friction points
// reported after two weeks of real use (2026-11-02).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.js';
import { normalizeConfig } from '../src/config.js';
import { openStore, remember, status } from 'tabellio';

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-continuity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const human = (id, text) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });
const agent = (sessionId = 'session-1') => ({
  id: 'agent-1',
  session: { id: sessionId, header: { delegationDepth: 0 } },
  options: {},
});
const decision = (messages) => ({ kind: 'enter', messages });

const fakeLlm = (reply) => ({
  async *stream() {
    yield { type: 'text-delta', index: 0, text: reply };
    yield { type: 'finish' };
  },
});

const fakeHost = ({ llm = null } = {}) => {
  const handlers = new Map();
  const tools = [];
  const warns = [];
  const ctx = {
    logger: { info() {}, warn: (message) => warns.push(String(message ?? '')), debug() {}, error() {} },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    get(name) {
      if (name === 'llm') return llm;
      return undefined;
    },
    inject(_deps, callback) {
      callback?.({
        llm,
        agentDefaultModel: { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) },
        effect(fn) {
          const dispose = fn();
          return typeof dispose === 'function' ? dispose : () => {};
        },
        get: () => undefined,
        logger: ctx.logger,
        tools: ctx.tools,
      });
    },
    effect(fn) {
      fn();
      return () => {};
    },
    tools: {
      register(definition) {
        tools.push(definition);
      },
    },
  };
  return { ctx, handlers, tools, warns };
};

const runPre = async (handlers, who, messages) => {
  const handler = handlers.get('agent/pre-step')[0];
  return handler({ agent: who, messages, turn: {}, step: 0, signal: null }, async () => decision(messages));
};
const runSerial = async (handlers, event, payload) => {
  for (const handler of handlers.get(event) ?? []) await handler(payload);
};

test('config defaults: zero-approval capture and session bootstrap', () => {
  const config = normalizeConfig({});
  assert.equal(config.autoApprove, 't0');
  assert.equal(config.writeJudge, 'llm');
  assert.equal(config.bootstrapRecall, true);
  assert.equal(config.bootstrapNotes, 2);
  assert.equal(normalizeConfig({ autoApprove: false }).autoApprove, 'off');
  assert.equal(normalizeConfig({ writeJudge: false }).writeJudge, 'off');
  assert.equal(normalizeConfig({ bootstrapRecall: 'yes' }).bootstrapRecall, false);
});

test('a topic-less first turn gets the recent project notes once', async (t) => {
  const dir = temp(t);
  const store = openStore(dir);
  remember(store, { text: '项目 V2 以 tabellio 为记忆底座，先验证召回再谈界面。' }, { kind: 'core', trust: 'user_stated' });
  const host = fakeHost();
  apply(host.ctx, { storePath: dir, autoRecall: true, delivery: 'notice' });
  const who = agent();

  const first = await runPre(host.handlers, who, [human('m1', '继续')]);
  assert.equal(first.kind, 'enter');
  assert.equal(first.messages.length, 2, 'bootstrap adds one notice');
  assert.match(first.messages[1].content[0].text, /V2 以 tabellio/);
  assert.equal(first.messages[1].source.summary, 'tabellio 会话接续 1 条');
  assert.equal(first.messages[1].source.kind, 'plugin:tabellio-dsh');

  const second = await runPre(host.handlers, who, [human('m2', '继续')]);
  assert.equal(second.messages.length, 1, 'bootstrap only runs once per session');

  const fresh = agent('session-2');
  const third = await runPre(host.handlers, fresh, [human('m3', '我们上次定的召回阈值是多少？')]);
  const thirdSummary = third.messages[1]?.source?.summary ?? '';
  assert.notEqual(thirdSummary, 'tabellio 会话接续 1 条', 'a real question does not use the bootstrap path');
});

test('bootstrap stays out of shadow mode', async (t) => {
  const dir = temp(t);
  remember(openStore(dir), { text: '项目 V2 以 tabellio 为记忆底座。' }, { kind: 'core' });
  const host = fakeHost();
  apply(host.ctx, { storePath: dir, autoRecall: true, shadow: true, delivery: 'notice' });
  const result = await runPre(host.handlers, agent(), [human('m1', '继续')]);
  assert.equal(result.messages.length, 1);
});

test('capture tool auto-approves only when the write judge verified the text', async (t) => {
  const dir = temp(t);
  const host = fakeHost({ llm: fakeLlm('{"keep":[1]}') });
  apply(host.ctx, { storePath: dir, autoRecall: false, capture: 'explicit', autoApprove: 't0', writeJudge: 'llm' });
  const capture = host.tools.find((tool) => tool.name === 'tabellio_capture');
  assert.ok(capture, 'capture tool registered');

  const approved = await capture.execute({ content: '记住，以后都用 pnpm。' });
  assert.equal(approved.ok, true);
  assert.equal(approved.reason, 'auto_approved');
  assert.match(approved.message, /跳过审批/);
  const view = status(openStore(dir));
  assert.equal(view.notes, 1);
  assert.equal(view.candidates, 0);

  const oneOff = await capture.execute({ content: '记住，明天用飞书发版。' });
  assert.equal(oneOff.ok, true);
  const after = status(openStore(dir));
  assert.equal(after.notes, 1, 'a one-off still needs approval');
  assert.equal(after.candidates, 1);
});

test('capture tool falls back to a candidate when the model cannot verdict', async (t) => {
  const dir = temp(t);
  const failing = {
    async *stream() {
      throw new Error('host model unavailable');
    },
  };
  const host = fakeHost({ llm: failing });
  apply(host.ctx, { storePath: dir, autoRecall: false, capture: 'explicit', autoApprove: 't0', writeJudge: 'llm' });
  const capture = host.tools.find((tool) => tool.name === 'tabellio_capture');
  const result = await capture.execute({ content: '记住，以后都用 pnpm。' });
  assert.equal(result.ok, true);
  const view = status(openStore(dir));
  assert.equal(view.notes, 0, 'no verdict means no silent write');
  assert.equal(view.candidates, 1);
});

test('turn-end capture also needs the judge verdict before auto-approval', async (t) => {
  const dir = temp(t);
  const host = fakeHost({ llm: fakeLlm('{"keep":[1]}') });
  apply(host.ctx, {
    storePath: dir,
    autoRecall: false,
    capture: 'explicit',
    autoApprove: 't0',
    writeJudge: 'llm',
  });
  const who = agent();
  await runPre(host.handlers, who, [human('m1', '记住，以后都用 pnpm。')]);
  await runSerial(host.handlers, 'agent/turn-stopping', { agent: who, turn: {}, signal: null });
  const view = status(openStore(dir));
  assert.equal(view.notes, 1);
  assert.equal(view.candidates, 0);
});
