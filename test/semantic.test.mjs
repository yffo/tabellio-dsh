import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openStore, remember } from 'tabellio';
import { normalizeConfig } from '../src/config.js';
import {
  cosine,
  loadIndex,
  mergeSemanticResult,
  refreshIndex,
  semanticTop,
  startIndexer,
} from '../src/semantic.js';

const VOCAB = ['jenkins', '403', '发布', '天气', '流程'];

const vectorFor = (text) => {
  const lower = String(text).toLowerCase();
  return VOCAB.map((word) => (lower.split(word).length - 1) + (word === 'jenkins' && lower.includes('hook') ? 0.5 : 0));
};

async function fakeEmbeddingServer(t) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: inputs.map((text) => ({ embedding: vectorFor(text) })) }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return 'http://127.0.0.1:' + server.address().port + '/v1/embeddings';
}

const tempStore = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabellio-semantic-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: openStore(dir) };
};

test('mergeSemanticResult appends only unseen hits and trims to the note cap', () => {
  const readNote = (id) => ({ ok: true, id, title: 'note ' + id, body: 'body ' + id });
  const result = { items: [{ id: 'a', title: 'A', content: 'x', relevance: 0.9 }], tokens: 10, refused: false };
  const merged = mergeSemanticResult(result, {
    hits: [{ id: 'a', similarity: 0.99 }, { id: 'b', similarity: 0.72 }, { id: 'c', similarity: 0.6 }],
    readNote,
    maxNotes: 2,
  });
  assert.deepEqual(merged.items.map((item) => item.id), ['a', 'b']);
  assert.equal(merged.items[1].semantic, true);
  assert.equal(merged.items[1].relevance, 0.72);
  assert.equal(merged.refused, false);
  assert.ok(merged.tokens > 0);
  assert.deepEqual(mergeSemanticResult(result, { hits: [], readNote }), result);
});

test('refreshIndex embeds notes and semanticTop ranks a paraphrase first', async (t) => {
  const { store } = await tempStore(t);
  const ctx = openStore(store.store);
  remember(ctx, { content: 'Jenkins 上的 Gitee WebHook 一直返回 403，最后查出是代理端口没放行。', title: 'WebHook 403 排查' });
  remember(ctx, { content: '发布流程：本地不登录 npm，推 tag 由 GitHub Actions OIDC 发布。', title: '发布流程' });
  remember(ctx, { content: '今天天气不错，适合出门散步。', title: '天气随手记' });
  const endpoint = await fakeEmbeddingServer(t);

  const built = await refreshIndex({ store, endpoint, model: 'fake-model' });
  assert.equal(built.size, 3);
  assert.equal(built.changed, 3);
  assert.equal(loadIndex(store, 'fake-model').size, 3);

  const hits = await semanticTop({ index: built.index, query: 'hook 为什么 403 了', endpoint, model: 'fake-model', top: 2, minSimilarity: 0 });
  assert.equal(hits.length, 2);
  const jenkinsId = fs.readdirSync(path.join(store.store, 'notes'))
    .filter((file) => file.endsWith('.md'))
    .find((file) => fs.readFileSync(path.join(store.store, 'notes', file), 'utf8').includes('403'))
    .replace(/\.md$/, '');
  assert.equal(hits[0].id, jenkinsId);
  assert.ok(hits[0].similarity > hits[1].similarity);
});

test('refreshIndex skips unchanged notes on the second pass', async (t) => {
  const { store } = await tempStore(t);
  remember(store, { content: '一条安静的记忆内容。', title: '安静' });
  const endpoint = await fakeEmbeddingServer(t);
  await refreshIndex({ store, endpoint, model: 'fake-model' });
  const second = await refreshIndex({ store, endpoint, model: 'fake-model' });
  assert.equal(second.changed, 0);
});

test('startIndexer reports failure instead of throwing when the endpoint is down', async (t) => {
  const { store } = await tempStore(t);
  remember(store, { content: '端点为不可达时索引应失败而非崩溃。', title: '失败路径' });
  const logs = [];
  const indexer = startIndexer({ store, endpoint: 'http://127.0.0.1:9/v1/embeddings', model: 'fake', logger: { warn: (line) => logs.push(line), info() {} }, delayMs: 60000 });
  await indexer.run();
  assert.equal(indexer.state.ready, false);
  assert.equal(typeof indexer.state.error, 'string');
  assert.equal(logs.length, 1);
  indexer.dispose();
});

test('semantic config defaults off and normalizes to local', () => {
  const off = normalizeConfig({});
  assert.equal(off.semantic, 'off');
  assert.equal(off.semanticMinSimilarity, 0.55);
  const local = normalizeConfig({ semantic: 'local', semanticTop: 99, semanticMinSimilarity: 3 });
  assert.equal(local.semantic, 'local');
  assert.equal(local.semanticTop, 20);
  assert.equal(local.semanticMinSimilarity, 1);
});

test('cosine is scale invariant and zero for orthogonal vectors', () => {
  assert.equal(cosine([1, 0], [2, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});
