// Retrieval outcome: turn a later "no, that's wrong" into a correction event
// about the memory that was actually injected before it. Attribution stays in
// the adapter (it needs turn state); the event log and ranking belong to the
// core so every host shares the same feedback.
import { read as readNote, readFeedback, recordFeedback } from 'tabellio';
import { tokensOf } from './conflicts.js';

export const OUTCOME_WINDOW_MS = 10 * 60 * 1000;

// A correction cue broad enough for attribution: the overlap requirement, not
// the wording, is what keeps unrelated complaints from blaming a note.
const CORRECTION_CUE = /(不对|错了|放错|写错|说错|记错|弄错|搞错|改错|算错|不是|改成|改为|纠正|更正|应该是|其实是)/;

export function hasCorrectionCue(text) {
  return CORRECTION_CUE.test(String(text ?? ''));
}

export function sharedTokenCount(a, b) {
  const left = tokensOf(a);
  const right = tokensOf(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared;
}

/**
 * Record a correction against the notes injected on the previous turn, when
 * (and only when) the two texts share at least three tokens. Pass `state` with
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
  // Two shared bigrams are enough for "same topic, different aspect" mistakes
  // (for example a meeting change inside a project whose codename was recalled),
  // so a correction needs three before it can demote a note.
  if (overlap < 3) return null;
  const saved = recordFeedback(store, {
    noteIds,
    signal: 'corrected',
    query: state.injectedQuery,
    source: 'dsh:outcome',
  });
  if (!saved?.ok) return null;
  state.injectedIds = [];
  return { noteIds, overlap };
}

/** Corrections in the window, counted from the core's feedback log. */
export function outcomeSummary(store, { days = 30, now = Date.now() } = {}) {
  const since = now - Math.max(0, days) * 24 * 60 * 60 * 1000;
  const notes = new Set();
  let corrected = 0;
  for (const row of readFeedback(store, { max: 5000 })) {
    if (row.signal !== 'corrected' || (Number(row.at) || 0) < since) continue;
    corrected += 1;
    for (const id of row.noteIds ?? []) notes.add(String(id));
  }
  return { corrected, notes: notes.size };
}

export function feedbackCountsFrom(store, { max = 2000 } = {}) {
  const rows = readFeedback(store, { max });
  const counts = { total: rows.length, useful: 0, wrong: 0, stale: 0, corrected: 0 };
  for (const row of rows) if (counts[row.signal] !== undefined) counts[row.signal] += 1;
  return counts;
}
