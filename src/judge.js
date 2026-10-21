// Optional LLM relevance judge.
//
// Recall is lexical (BM25 + co-occurrence), so a hit means "the words match",
// not "this answers the question" — 实测里「今天天气怎么样」也能蹭到笔记。
// When `judge: 'llm'` is on, the plugin asks one small model call to keep only
// the notes that actually help, before the recall is injected. Every failure
// path falls back to the unjudged hits: the judge may remove noise, it must
// never remove memory because the model call broke.
import { createHash } from 'node:crypto';
import { read } from 'tabellio';

export const JUDGE_TIMEOUT_MS = 6000;
export const JUDGE_MAX_NOTES = 4;
const SNIPPET_CHARS = 200;

/**
 * Give a judge call at most `ms` to answer.
 *
 * Why a deadline instead of just a shorter timeout: aborting the call throws
 * away everything it did, while a slow verdict is still useful for the *next*
 * identical question. So the race returns `null` at the deadline, the call
 * keeps running, and `onLate` gets the verdict whenever it lands (the caller
 * caches it). `ms <= 0` disables the race and behaves like a plain await.
 */
export function withDeadline(promise, ms, { onLate } = {}) {
  const limit = Number(ms);
  if (!Number.isFinite(limit) || limit <= 0) return promise;
  if (typeof onLate === 'function') {
    // Attach eagerly: a late verdict must not become an unhandled rejection.
    promise.then(onLate, () => {});
  }
  let timer;
  // 不 unref：这个定时器是 `race` 的唯一活跃句柄。unref 之后事件循环会把它
  // 当成「可以退出」，Node 22/24 的测试跑器直接报
  // `Promise resolution is still pending but the event loop has already resolved`。
  // `finally` 里一定会 clearTimeout，所以它不会把进程吊住。
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), limit);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** The prompt is intentionally tiny: a yes/no list beats free-form reasoning. */
export function buildJudgePrompt(query, notes) {
  const lines = notes.map((note, index) => {
    const body = String(note.body ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
    return `[${index + 1}] ${note.title ?? ''}\n${body}`;
  });
  return [
    'You are filtering a personal memory store before it is injected into a chat.',
    'Decide which numbered notes actually help answer the question. Be strict:',
    'a shared word is not enough; the note must contain facts the question asks for.',
    'Answer with JSON only: {"keep":[1,3]} — empty array when none of them help.',
    '',
    `Question: ${subject(query)}`,
    '',
    'Notes:',
    ...lines,
  ].join('\n');
}

function subject(query) {
  const text = String(query ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 400 ? text.slice(0, 400) + '…' : text;
}

/** Tolerant parser: JSON body, fenced JSON, or "1 yes / 2 no" lines. */
export function parseJudgeReply(reply, count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  const text = String(reply ?? '').trim();
  if (!text) return null;

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const list = Array.isArray(parsed?.keep) ? parsed.keep : Array.isArray(parsed?.relevant) ? parsed.relevant : null;
      if (list) {
        const kept = new Set();
        let integers = 0;
        for (const item of list) {
          const n = Number(item);
          if (!Number.isInteger(n)) continue;
          integers += 1;
          if (n >= 1 && n <= count) kept.add(n - 1);
        }
        // Numbers that all fall outside the note range mean the model did not
        // follow the format; fail open instead of silently keeping nothing.
        return integers > 0 && kept.size === 0 ? null : kept;
      }
    } catch {
      // Fall through to the line format.
    }
  }

  const kept = new Set();
  let seen = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\[?(\d{1,3})\]?\s*[:.)-]?\s*(yes|no|true|false|是|否)/i.exec(line);
    if (!match) continue;
    const n = Number(match[1]);
    if (n < 1 || n > count) continue;
    seen = true;
    if (/yes|true|是/i.test(match[2])) kept.add(n - 1);
  }
  return seen ? kept : null;
}

/**
 * Ask the host model which notes to keep. `llm` is the host `ctx.llm` service;
 * `selection` is the provider/model to use ({provider, model}).
 *
 * Returns a Set of kept indices, or null when the judge is unavailable or
 * failed (caller keeps everything).
 */
export async function judgeNotes({ llm, selection, query, notes, timeoutMs = JUDGE_TIMEOUT_MS, signal, onReply, onError }) {
  if (!llm || typeof llm.stream !== 'function') return null;
  if (!selection?.provider || !selection?.model) return null;
  if (!Array.isArray(notes) || notes.length === 0) return null;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));

  try {
    const chunks = llm.stream({
      provider: selection.provider,
      model: selection.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildJudgePrompt(query, notes) }] }],
      // Reasoning models spend part of the budget before the first text
      // token; 80 was small enough to end some calls with no text at all
      // (实测 deepseek-flash 1173ms 无裁决、回复为空).
      maxTokens: 512,
      temperature: 0,
      signal: controller.signal,
    });

    let reply = '';
    for await (const chunk of chunks) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text;
      if (chunk?.type === 'finish') break;
    }
    try {
      onReply?.(reply);
    } catch {
      // Diagnostics must never affect the turn.
    }
    const parsed = parseJudgeReply(reply, notes.length);
    if (!parsed && !reply.trim()) {
      // An empty reply is almost always a reasoning-budget or timeout symptom;
      // surface it so a silent fail-open can be told apart from a real "keep none".
      try { onError?.('empty'); } catch { /* diagnostics only */ }
    }
    return parsed;
  } catch {
    try { onError?.(controller.signal.aborted ? 'timeout' : 'error'); } catch { /* diagnostics only */ }
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/**
 * Read note bodies for judging. Missing notes are dropped (a stale id must not
 * make the whole injection fail).
 */
export function readJudgeNotes(store, items, limit = JUDGE_MAX_NOTES) {
  const notes = [];
  for (const item of items.slice(0, limit)) {
    try {
      const got = read(store, item.id);
      if (got?.ok) notes.push({ id: item.id, title: got.title ?? item.title ?? '', body: got.body ?? '' });
    } catch {
      // Skip unreadable notes; the caller compares by id.
    }
  }
  return notes;
}

/**
 * Filter recall items by the judge's verdict. Returns {items, judged, kept}
 * where `judged` is false when the caller should keep the original list.
 */
export async function filterByJudge({ llm, selection, query, items, store, maxNotes = JUDGE_MAX_NOTES, onReply, ...rest }) {
  const notes = readJudgeNotes(store, items, maxNotes);
  if (notes.length === 0) return { items, judged: false };
  const kept = await judgeNotes({ llm, selection, query, notes, onReply, ...rest });
  if (!kept) return { items, judged: false };
  const ids = new Set(notes.filter((_, index) => kept.has(index)).map((note) => note.id));
  // Items past the judge window were never shown to the model, so they cannot
  // be vetoed: keep them instead of silently dropping the recall tail.
  const judgedIds = new Set(notes.map((note) => note.id));
  return { items: items.filter((item) => !judgedIds.has(item.id) || ids.has(item.id)), judged: true };
}

/**
 * A short-lived verdict cache: the same question against the same note set
 * should not pay for a model call twice. The key includes the note ids, so a
 * changed recall set is always re-judged. `0` minutes disables the cache.
 */
export function judgeCacheKey(query, ids) {
  const normalized = String(query ?? '').trim().toLowerCase();
  return createHash('sha1').update(normalized + '\u0000' + ids.join('\u0000')).digest('hex').slice(0, 16);
}

export function createJudgeCache({ ttlMs = 10 * 60 * 1000, now = () => Date.now(), max = 200 } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() - entry.at > ttlMs) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { at: now(), value });
      while (entries.size > max) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
      }
    },
    get size() {
      return entries.size;
    },
  };
}
