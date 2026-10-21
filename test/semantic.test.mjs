import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openStore, remember } from 'tabellio';
import { normalizeConfig } from '../src/config.js';
import {
  createVectorCache,
  detectEmbedding,
  embedTexts,
  listEmbeddingModels,
  mergeSemanticResult,
  queryVector,
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

test('mergeSemanticResult fuses unseen hits by rank and trims to the note cap', () => {
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


test('semantic merge never resurrects archived, superseded or untrusted notes', () => {
  const readNote = (id) => ({
    ok: true,
    id,
    title: 'note ' + id,
    body: 'body',
    note: {
      status: id === 'archived' ? 'archived' : 'active',
      superseded_by: id === 'superseded' ? 'newer#1' : null,
      valid_to: null,
      trust: id === 'reference' ? 'external' : 'user_stated',
    },
  });
  const result = { items: [], tokens: 0, refused: true };
  const merged = mergeSemanticResult(result, {
    hits: [1, 2, 3, 4].map((index) => ({ id: ['archived', 'superseded', 'reference', 'good'][index - 1], similarity: 0.8 })),
    readNote,
    maxNotes: 6,
    allowedTrusts: ['user_stated', 'system_derived'],
  });
  assert.deepEqual(merged.items.map((item) => item.id), ['good']);
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


test('the indexer refreshes new notes without a restart', async (t) => {
  const endpoint = await fakeEmbeddingServer(t);
  const { store } = await tempStore(t);
  remember(store, { content: '语义刷新测试：启动时只索引这一条。', title: '首条' });
  const indexer = startIndexer({ store, endpoint, model: 'fake', delayMs: 20, refreshMs: 80, logger: { info() {}, debug() {}, warn() {} } });
  t.after(() => indexer.dispose());
  const waitFor = async (check) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };
  assert.equal(await waitFor(() => indexer.state.ready === true), true);
  const before = indexer.state.size;
  remember(store, { content: '语义刷新测试：这条是索引建好之后才写的。', title: '后写的' });
  assert.equal(await waitFor(() => indexer.state.size > before), true);
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

test('semantic config defaults to auto and keeps explicit modes', () => {
  const auto = normalizeConfig({});
  assert.equal(auto.semantic, 'auto');
  assert.equal(auto.semanticMinSimilarity, 0.55);
  assert.equal(normalizeConfig({ semantic: 'off' }).semantic, 'off');
  const local = normalizeConfig({ semantic: 'local', semanticTop: 99, semanticMinSimilarity: 3 });
  assert.equal(local.semantic, 'local');
  assert.equal(local.semanticTop, 20);
  assert.equal(local.semanticMinSimilarity, 1);
  assert.equal(normalizeConfig({ semantic: 'bogus' }).semantic, 'auto');
});

test('auto-discovery asks /v1/models and falls back to candidate names', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'qwen3-embedding-0.6b' }] }));
      return;
    }
    if (req.url === '/v1/embeddings') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const found = await detectEmbedding({
    candidates: [{ endpoint: 'http://127.0.0.1:' + port + '/v1/embeddings', models: ['fallback-name'] }],
    timeoutMs: 1000,
  });
  assert.deepEqual(found, { endpoint: 'http://127.0.0.1:' + port + '/v1/embeddings', model: 'qwen3-embedding-0.6b', dims: 3 });
});

test('auto-discovery returns null when nothing answers', async () => {
  const found = await detectEmbedding({
    candidates: [{ endpoint: 'http://127.0.0.1:9/v1/embeddings', models: ['nope'] }],
    timeoutMs: 300,
  });
  assert.equal(found, null);
});


test('remote embeddings carry the bearer key and expose model ids', async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || '' });
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'text-embedding-3-small' }, { id: 'gpt-4o' }] }));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ embedding: [0.5, 0.25] }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port + '/v1';
  const vectors = await embedTexts({ endpoint: base + '/embeddings', model: 'text-embedding-3-small', apiKey: 'sk-test', inputs: ['hello'], timeoutMs: 1000 });
  assert.deepEqual(vectors, [[0.5, 0.25]]);
  const models = await listEmbeddingModels({ endpoint: base + '/embeddings', apiKey: 'sk-test', timeoutMs: 1000 });
  assert.deepEqual(models, ['text-embedding-3-small']);
  assert.equal(seen[0].auth, 'Bearer sk-test');
});

test('semanticTop takes a precomputed vector and never calls the server', async (t) => {
  const { store } = await tempStore(t);
  const ctx = openStore(store.store);
  remember(ctx, { content: '发布流程：推 tag 由 GitHub Actions OIDC 发布。', title: '发布流程' });
  const endpoint = await fakeEmbeddingServer(t);
  const built = await refreshIndex({ store, endpoint, model: 'fake-model' });

  // Nothing listens on port 9: if semanticTop embedded the query itself this throws.
  const hits = await semanticTop({
    index: built.index,
    query: '发布流程',
    vector: vectorFor('发布流程'),
    endpoint: 'http://127.0.0.1:9/v1/embeddings',
    model: 'fake-model',
    top: 1,
  });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].similarity > 0.9, 'vector path still ranks the note first');
});

test('queryVector embeds once and then answers from the cache', async (t) => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls += 1;
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1/embeddings';
  const cache = createVectorCache();

  const first = await queryVector({ endpoint, model: 'm', query: '同一个问题', timeoutMs: 1000, cache });
  const second = await queryVector({ endpoint, model: 'm', query: '同一个问题 ', timeoutMs: 1000, cache });
  assert.deepEqual(first, second);
  assert.equal(calls, 1, 'a repeat query must not pay for a second embedding call');
  // A different model is a different vector space: never share the cached vector.
  await queryVector({ endpoint, model: 'other', query: '同一个问题', timeoutMs: 1000, cache });
  assert.equal(calls, 2);
});

test('createVectorCache expires by TTL and evicts the oldest entry', () => {
  let clock = 0;
  const cache = createVectorCache({ ttlMs: 100, max: 2, now: () => clock });
  cache.set('a', [1]);
  clock = 50;
  cache.set('b', [2]);
  assert.deepEqual(cache.get('a'), [1]);
  clock = 151; // 50 + 101 > ttl, so `b` is stale
  assert.equal(cache.get('b'), null, 'entry past its TTL is gone');
  cache.set('c', [3]);
  cache.set('d', [4]);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), null, 'oldest key is evicted once the cap is hit');
});
