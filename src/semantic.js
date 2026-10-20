// Optional local embedding layer.
//
// BM25 cannot match a paraphrase: "Jenkins 那个 hook 为什么 403" only finds the
// note if the words overlap. A small local embedding model closes that gap, but
// it must stay optional and cheap:
//   - off by default (`semantic: 'off'`);
//   - the index is built in the background, never on the recall path;
//   - a recall only adds the semantic hits BM25 already missed;
//   - any failure (server down, timeout, bad response) keeps the BM25 result.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_MODEL = 'qwen3-embedding-0.6b';
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080/v1/embeddings';

const EMBED_TIMEOUT_MS = 10000;
const BATCH = 8;
const MAX_NOTE_CHARS = 900;

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const dot = (left, right) => {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
};
const norm = (vector) => Math.sqrt(dot(vector, vector));

export function cosine(left, right) {
  const denom = norm(left) * norm(right);
  return denom ? dot(left, right) / denom : 0;
}

export function indexPath(store) {
  return join(store.store, 'runs', 'semantic-index.json');
}

export function loadIndex(store, model) {
  try {
    const raw = JSON.parse(readFileSync(indexPath(store), 'utf8'));
    if (raw?.model !== model || !Array.isArray(raw.notes)) return new Map();
    return new Map(raw.notes.map((note) => [note.id, { hash: note.hash, vector: note.vector }]));
  } catch {
    return new Map();
  }
}

export function saveIndex(store, model, index) {
  try {
    mkdirSync(join(store.store, 'runs'), { recursive: true });
    writeFileSync(indexPath(store), JSON.stringify({
      model,
      builtAt: Date.now(),
      notes: [...index.entries()].map(([id, entry]) => ({ id, hash: entry.hash, vector: entry.vector })),
    }));
    return true;
  } catch {
    return false;
  }
}

function authHeaders(apiKey) {
  return apiKey ? { authorization: 'Bearer ' + apiKey } : {};
}

export async function embedTexts({ endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, inputs, apiKey = '', timeoutMs = EMBED_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders(apiKey)),
      body: JSON.stringify({ model, input: inputs }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('embedding HTTP ' + response.status);
    const body = await response.json();
    if (!Array.isArray(body?.data) || body.data.length !== inputs.length) {
      throw new Error('embedding response shape mismatch');
    }
    return body.data.map((row) => {
      if (!Array.isArray(row?.embedding) || row.embedding.length === 0) throw new Error('embedding vector missing');
      return row.embedding;
    });
  } finally {
    clearTimeout(timer);
  }
}

function noteBody(text) {
  const match = text.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return (match ? match[1] : text).trim().slice(0, MAX_NOTE_CHARS);
}

export function readNotes(store) {
  const dir = join(store.store, 'notes');
  const notes = [];
  let files = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.md'));
  } catch {
    return notes;
  }
  for (const file of files) {
    try {
      const id = file.replace(/\.md$/, '');
      const body = noteBody(readFileSync(join(dir, file), 'utf8'));
      if (!body) continue;
      notes.push({ id, text: body, hash: sha1(body) });
    } catch {
      // unreadable note: skip, keep the rest of the index usable
    }
  }
  return notes;
}

export async function refreshIndex({ store, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, apiKey = '', onProgress } = {}) {
  const index = loadIndex(store, model);
  const entries = readNotes(store);
  const alive = new Set(entries.map((entry) => entry.id));
  for (const id of [...index.keys()]) if (!alive.has(id)) index.delete(id);

  let changed = 0;
  for (let offset = 0; offset < entries.length; offset += BATCH) {
    const chunk = entries
      .slice(offset, offset + BATCH)
      .filter((entry) => index.get(entry.id)?.hash !== entry.hash);
    if (chunk.length === 0) continue;
    const vectors = await embedTexts({ endpoint, model, apiKey, inputs: chunk.map((entry) => entry.text) });
    chunk.forEach((entry, position) => index.set(entry.id, { hash: entry.hash, vector: vectors[position] }));
    changed += chunk.length;
    onProgress?.({ done: Math.min(entries.length, offset + BATCH), total: entries.length });
  }
  if (changed > 0) saveIndex(store, model, index);
  return { index, size: index.size, changed };
}

/**
 * Build the index in the background. The returned state is what the recall path
 * reads; until `ready` is true the plugin behaves exactly like before.
 */
export function startIndexer({ store, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, apiKey = '', logger, delayMs = 2500 }) {
  const state = { ready: false, size: 0, changed: 0, error: null, startedAt: Date.now() };
  let disposed = false;
  const run = async () => {
    if (disposed) return;
    try {
      const result = await refreshIndex({ store, endpoint, model, apiKey });
      if (disposed) return;
      state.index = result.index;
      state.size = result.size;
      state.changed = result.changed;
      state.ready = true;
      logger?.info?.('tabellio-dsh: semantic index ready (' + result.size + ' notes, ' + result.changed + ' refreshed)');
    } catch (error) {
      state.error = error?.message ?? String(error);
      logger?.warn?.('tabellio-dsh: semantic index unavailable: ' + state.error);
    }
  };
  const timer = setTimeout(run, delayMs);
  timer.unref?.();
  return { state, run, dispose() { disposed = true; clearTimeout(timer); } };
}

/**
 * Top semantic hits, ignoring cheap noise. Cosine similarity is model-specific:
 * qwen3-embedding puts relevant pairs around 0.6–0.85 and unrelated text below
 * 0.55 on this corpus, so the caller's threshold does the filtering.
 */
export async function semanticTop({ index, query, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, apiKey = '', top = 8, minSimilarity = 0, timeoutMs = 2500 }) {
  if (!index || index.size === 0) return [];
  const [queryVector] = await embedTexts({ endpoint, model, apiKey, inputs: [query], timeoutMs });
  const scored = [];
  for (const [id, entry] of index) {
    const similarity = cosine(queryVector, entry.vector);
    if (similarity >= minSimilarity) scored.push({ id, similarity });
  }
  scored.sort((left, right) => right.similarity - left.similarity);
  return scored.slice(0, Math.max(1, top));
}

// Pure merge step, separated from the network path so it is easy to test:
// keep the lexical order, append semantic-only hits, then trim to the note cap.
export function mergeSemanticResult(result, { hits = [], readNote, maxNotes = 6 } = {}) {
  const items = Array.isArray(result?.items) ? result.items : [];
  if (!Array.isArray(hits) || hits.length === 0 || typeof readNote !== 'function') return result;
  const known = new Set(items.map((item) => item.id));
  const added = [];
  for (const hit of hits) {
    if (!hit || known.has(hit.id)) continue;
    let note;
    try {
      note = readNote(hit.id);
    } catch {
      continue;
    }
    if (!note || note.ok === false) continue;
    known.add(hit.id);
    added.push({
      id: hit.id,
      title: note.title ?? hit.id,
      content: String(note.body ?? '').trim(),
      relevance: Number(Number(hit.similarity).toFixed(4)),
      score: Number(hit.similarity),
      semantic: true,
    });
    if (added.length >= Math.max(1, maxNotes)) break;
  }
  if (added.length === 0) return result;
  const merged = [...items, ...added].slice(0, Math.max(1, maxNotes));
  const chars = merged.reduce((sum, item) => sum + String(item.title ?? '').length + String(item.content ?? '').length, 0);
  return { ...result, refused: false, reason: null, items: merged, tokens: Math.round(chars / 4) };
}

/**
 * One-shot connectivity check used by the panel's "test" button. Returns the
 * embedding dimension and latency instead of throwing, so the caller can keep
 * the UI honest about whether semantic recall will actually work.
 */
export async function probeEmbedding({ endpoint, model, apiKey = '', timeoutMs = 2500 }) {
  const started = Date.now();
  const vectors = await embedTexts({ endpoint, model, apiKey, inputs: ['ping'], timeoutMs });
  return { ok: true, dims: vectors[0].length, ms: Date.now() - started };
}

/**
 * Zero-config discovery for the semantic layer. Ordinary users should not have
 * to know an endpoint or a model name: probe the ports that local embedding
 * servers actually listen on, ask /v1/models when the server supports it, and
 * fall back to the model names this project has shipped with.
 */
export const EMBED_CANDIDATES = [
  { endpoint: 'http://127.0.0.1:8080/v1/embeddings', models: ['qwen3-embedding-0.6b'] },
  { endpoint: 'http://127.0.0.1:11434/v1/embeddings', models: ['nomic-embed-text', 'bge-m3', 'qwen3-embedding:0.6b'] },
  { endpoint: 'http://127.0.0.1:1234/v1/embeddings', models: ['text-embedding-nomic-embed-text-v1.5'] },
  { endpoint: 'http://127.0.0.1:8000/v1/embeddings', models: ['bge-m3', 'qwen3-embedding-0.6b'] },
];

async function fetchEmbeddingModels(endpoint, timeoutMs, apiKey = '') {
  try {
    const url = String(endpoint).replace(/\/embeddings\/?$/, '/models');
    const response = await fetch(url, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data?.data) ? data.data : [])
      .map((item) => item?.id)
      .filter((id) => typeof id === 'string' && /embed/i.test(id));
  } catch {
    return [];
  }
}

/**
 * Return the first endpoint/model pair that answers an embeddings call.
 * `endpoint`/`model` narrow the search (explicitly configured values win);
 * otherwise every candidate is probed once. Returns null when nothing answers.
 */
export async function detectEmbedding({ endpoint, model, apiKey = '', timeoutMs = 1200, candidates = EMBED_CANDIDATES } = {}) {
  if (endpoint && model) {
    try {
      const probe = await probeEmbedding({ endpoint, model, apiKey, timeoutMs });
      return { endpoint, model, dims: probe.dims };
    } catch {
      // fall through to discovery
    }
  }
  for (const candidate of candidates) {
    const discovered = model ? [] : await fetchEmbeddingModels(candidate.endpoint, timeoutMs, apiKey);
    const names = [...new Set([model, ...discovered, ...candidate.models].filter(Boolean))];
    for (const name of names) {
      try {
        const probe = await probeEmbedding({ endpoint: candidate.endpoint, model: name, timeoutMs });
        return { endpoint: candidate.endpoint, model: name, dims: probe.dims };
      } catch {
        // try the next model name
      }
    }
  }
  return null;
}

/**
 * List the model ids an endpoint advertises. Used by the panel so users pick a
 * model instead of typing one, including remote OpenAI-compatible endpoints.
 */
export async function listEmbeddingModels({ endpoint, apiKey = '', timeoutMs = 2500 } = {}) {
  return fetchEmbeddingModels(endpoint, timeoutMs, apiKey);
}
