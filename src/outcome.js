// Retrieval outcome: turn a later "no, that's wrong" into a local signal about
// the memory that was actually injected before it. The signal never deletes a
// note and never outvotes the core relevance gates; it only nudges order, and
// only when the correction sentence visibly talks about the same topic
// (token overlap with the note body) — otherwise we would blame the memory for
// an unrelated mistake.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { read as readNote } from 'tabellio';
import { CORRECTION_PATTERNS } from './capture.js';
import { tokensOf } from './conflicts.js';

export const OUTCOME_FILE = 'outcome.jsonl';
export const OUTCOME_WINDOW_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

const pathFor = (store) => path.join(store?.store ?? '', OUTCOME_FILE);
const correctionRe = new RegExp(CORRECTION_PATTERNS.map((re) => re.source).join('|'));

export function hasCorrectionCue(text) {
  return correctionRe.test(String(text ?? ''));
}

export function sharedTokenCount(a, b) {
  const left = tokensOf(a);
  const right = tokensOf(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared;
}

export function appendOutcome(store, entry = {}) {
  const noteIds = [...new Set((Array.isArray(entry.noteIds) ? entry.noteIds : []).map(String).filter(Boolean))].slice(0, 6);
  if (!noteIds.length) return { ok: false, reason: 'missing_notes' };
  try {
    const dir = store?.store;
    if (!dir) return { ok: false, reason: 'missing_store' };
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      signal: 'corrected',
      noteIds,
      query: String(entry.query ?? '').slice(0, 120),
      excerpt: String(entry.excerpt ?? '').slice(0, 160),
      overlap: Number(entry.overlap) || 0,
      at: Number(entry.at) || Date.now(),
    });
    appendFileSync(pathFor(store), line + '\n', 'utf8');
    return { ok: true, noteIds };
  } catch (error) {
    return { ok: false, reason: 'write_failed', message: String(error?.message ?? error) };
  }
}

export function readOutcomes(store, { max = MAX_ENTRIES } = {}) {
  try {
    const file = pathFor(store);
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const parsed = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item && Array.isArray(item.noteIds)) parsed.push(item);
      } catch {
        // A half-written line from a crash is skipped, not fatal.
      }
    }
    return parsed.slice(-max);
  } catch {
    return [];
  }
}

export function outcomePenalties(store, { days = 30, now = Date.now() } = {}) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const counts = new Map();
  for (const entry of readOutcomes(store)) {
    if ((Number(entry.at) || 0) < since) continue;
    for (const id of entry.noteIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Record a correction against the notes injected on the previous turn, when
 * (and only when) the two texts share at least two tokens. Pass `state` with
 * `injectedIds`/`injectedAt`/`injectedQuery`; returns the recorded hit or null.
 */
export function maybeRecordCorrection({ store, state, text, now = Date.now() } = {}) {
  if (!store || !state || !Array.isArray(state.injectedIds) || !state.injectedIds.length) return null;
  if (now - (Number(state.injectedAt) || 0) > OUTCOME_WINDOW_MS) {
    state.injectedIds = [];
    return null;
  }
  if (!hasCorrectionCue(text)) return null;
  const noteIds = state.injectedIds.slice(0, 4);
  let overlap = 0;
  for (const id of noteIds) {
    const got = readNote(store, id);
    if (!got?.ok) continue;
    overlap = Math.max(overlap, sharedTokenCount(text, String(got.title ?? '') + '\n' + String(got.body ?? '')));
  }
  if (overlap < 2) return null;
  const saved = appendOutcome(store, { noteIds, query: state.injectedQuery, excerpt: text, overlap, at: now });
  if (!saved.ok) return null;
  state.injectedIds = [];
  return { noteIds, overlap };
}

/** Demote notes that were corrected before; stable, bounded, never removes. */
export function rankByOutcome(items, penalties, { step = 0.08, cap = 3 } = {}) {
  if (!Array.isArray(items) || !penalties || !penalties.size) return items;
  return items
    .map((item, index) => {
      const count = Math.min(cap, penalties.get(item.id) ?? 0);
      return { item, index, factor: 1 - step * count };
    })
    .sort((a, b) => b.factor - a.factor || a.index - b.index)
    .map((row) => row.item);
}
