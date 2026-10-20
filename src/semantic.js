// Optional embedding layer — the provider side.
//
// The index format, the eligibility rules, cosine ranking and the merge back
// into lexical results all live in the core (`tabellio`): one implementation
// shared by the DSH plugin, the CLI and MCP. This file only knows how to talk
// to an embedding server and how to schedule refreshes in the background:
//   - `embedTexts` speaks the OpenAI-compatible /v1/embeddings shape;
//   - `startIndexer` refreshes the core index off the recall path;
//   - any failure keeps the lexical result untouched (callers fail open).

import { indexSemantic, mergeSemanticItems, rankSemantic } from 'tabellio';

export const DEFAULT_MODEL = 'qwen3-embedding-0.6b';
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080/v1/embeddings';

const EMBED_TIMEOUT_MS = 10000;
const BATCH = 8;

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

/** Build/refresh the core index with this endpoint. Throws when the service fails. */
export async function refreshIndex({ store, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, apiKey = '', onProgress } = {}) {
  return indexSemantic(store, {
    model,
    batch: BATCH,
    embed: (texts) => embedTexts({ endpoint, model, apiKey, inputs: texts }),
    onProgress,
  });
}

/**
 * Build the index in the background. The returned state is what the recall path
 * reads; until `ready` is true the plugin behaves exactly like before.
 */
export function startIndexer({ store, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, apiKey = '', logger, delayMs = 2500, refreshMs = 5 * 60 * 1000 }) {
  const state = { ready: false, size: 0, changed: 0, error: null, startedAt: Date.now(), refreshedAt: null };
  let disposed = false;
  let inFlight = false;
  let timer = null;
  const run = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      const result = await refreshIndex({ store, endpoint, model, apiKey });
      if (disposed) return;
      state.index = result.index;
      state.size = result.size;
      state.changed = result.changed;
      state.ready = true;
      state.error = null;
      state.refreshedAt = Date.now();
      const line = 'tabellio-dsh: semantic index ready (' + result.size + ' notes, ' + result.changed + ' refreshed)';
      if (result.changed > 0 || !state.loggedOnce) {
        state.loggedOnce = true;
        logger?.info?.(line);
      } else {
        logger?.debug?.(line);
      }
    } catch (error) {
      state.error = error?.message ?? String(error);
      logger?.warn?.('tabellio-dsh: semantic index unavailable: ' + state.error);
    } finally {
      inFlight = false;
    }
  };
  const tick = async () => {
    await run();
    if (disposed || refreshMs <= 0) return;
    timer = setTimeout(tick, refreshMs);
    timer.unref?.();
  };
  timer = setTimeout(tick, delayMs);
  timer.unref?.();
  return { state, run, dispose() { disposed = true; clearTimeout(timer); } };
}

/**
 * Top semantic hits for one query. The in-memory index (built by startIndexer)
 * is passed in so a recall never re-reads the index file.
 */
export async function semanticTop({ index, query, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, apiKey = '', top = 8, minSimilarity = 0, timeoutMs = 2500 }) {
  if (!index || index.size === 0) return [];
  const [queryVector] = await embedTexts({ endpoint, model, apiKey, inputs: [query], timeoutMs });
  return rankSemantic(index, queryVector, { top, minSimilarity });
}

/** Merge semantic hits back into a lexical result (pure core function). */
export const mergeSemanticResult = mergeSemanticItems;

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
        const probe = await probeEmbedding({ endpoint: candidate.endpoint, model: name, apiKey, timeoutMs });
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
