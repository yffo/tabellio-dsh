// Usage feedback: append-only, plugin-owned signals about whether a memory
// actually helped. Ranking only nudges order — it never deletes a note, and a
// single negative report cannot outvote the core's relevance gates.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const FEEDBACK_FILE = 'panel-feedback.jsonl';
export const SIGNALS = new Set(['useful', 'wrong', 'stale']);

const pathFor = (store) => path.join(store?.store ?? '', FEEDBACK_FILE);

export function appendFeedback(store, { id, signal, query = '', source = 'panel' } = {}) {
  const noteId = String(id ?? '').trim();
  if (!noteId) return { ok: false, reason: 'missing_id' };
  const kind = String(signal ?? '').trim();
  if (!SIGNALS.has(kind)) return { ok: false, reason: 'invalid_signal' };
  try {
    const dir = store?.store;
    if (!dir) return { ok: false, reason: 'missing_store' };
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      id: noteId,
      signal: kind,
      query: String(query ?? '').slice(0, 120),
      source: String(source ?? 'panel').slice(0, 40),
      at: Date.now(),
    });
    appendFileSync(pathFor(store), line + '\n', 'utf8');
    return { ok: true, id: noteId, signal: kind };
  } catch (error) {
    return { ok: false, reason: 'write_failed', message: String(error?.message ?? error) };
  }
}

export function readFeedback(store, { max = 5000 } = {}) {
  try {
    const file = pathFor(store);
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const parsed = [];
    for (const line of lines.slice(-Math.max(1, max))) {
      try {
        const row = JSON.parse(line);
        if (row && row.id && SIGNALS.has(row.signal)) parsed.push(row);
      } catch {
        // A torn line from a crashed write is ignored, never fatal.
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

/** @returns {Map<string, {useful: number, wrong: number, stale: number}>} */
export function aggregateFeedback(entries = []) {
  const map = new Map();
  for (const row of entries) {
    const id = String(row.id);
    const slot = map.get(id) ?? { useful: 0, wrong: 0, stale: 0 };
    if (row.signal === 'useful') slot.useful += 1;
    else if (row.signal === 'wrong') slot.wrong += 1;
    else if (row.signal === 'stale') slot.stale += 1;
    map.set(id, slot);
  }
  return map;
}

export function feedbackCounts(entries = []) {
  const counts = { total: entries.length, useful: 0, wrong: 0, stale: 0 };
  for (const row of entries) {
    if (row.signal === 'useful') counts.useful += 1;
    else if (row.signal === 'wrong') counts.wrong += 1;
    else if (row.signal === 'stale') counts.stale += 1;
  }
  return counts;
}

/**
 * Reorder recalled items by accumulated feedback, then by their original
 * relevance. Items without a stored score keep their original relative order.
 * Weights are deliberately small: feedback is a tie-breaker, not an override.
 */
export function rankByFeedback(items, aggregates) {
  if (!Array.isArray(items) || items.length < 2 || !aggregates || aggregates.size === 0) return items ?? [];
  const scoreOf = (item) => {
    const raw = Number(item?.relevance ?? item?.score);
    return Number.isFinite(raw) ? raw : null;
  };
  const weightOf = (item) => {
    const slot = aggregates.get(String(item?.id ?? ''));
    if (!slot) return 1;
    const positive = Math.min(slot.useful, 3);
    const negative = Math.min(slot.wrong + slot.stale, 4);
    return 1 + 0.03 * positive - 0.12 * negative;
  };
  return items
    .map((item, index) => ({ item, index, score: scoreOf(item), weight: weightOf(item) }))
    .sort((a, b) => {
      if (a.score !== null && b.score !== null) {
        const delta = b.score * b.weight - a.score * a.weight;
        if (Math.abs(delta) > 1e-9) return delta;
      }
      return a.index - b.index;
    })
    .map((row) => row.item);
}
