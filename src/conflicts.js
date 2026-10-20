// Surface probably-stale note pairs without writing anything. The core has no
// exported "supersede without merge" API, so the plugin's job here is to make
// the conflict visible; closing the older note goes through tabellio_merge,
// which is human-gated and receipted.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFLICT_STATE = 'conflict-state.json';

const LATIN = /[a-z0-9][a-z0-9._-]{1,}/gi;
const HAN = /[\u4e00-\u9fff]+/g;
const NUMBERS = /\d+(?:[.,]\d+)*%?/g;
const REPLACEMENT = /(改成|改为|换成|不再|现在用|现在已经|停止使用|替代|取代|已经改|已经换|instead|no longer)/i;
const NEGATION = /(不|禁止|别|never|stop|don't|不允许)/i;

const snippets = (text, size = 120) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > size ? flat.slice(0, size) + '…' : flat;
};

export function tokensOf(text) {
  const out = new Set();
  const source = String(text ?? '').toLowerCase();
  for (const word of source.match(LATIN) ?? []) out.add(word);
  for (const run of source.match(HAN) ?? []) {
    const chars = [...run];
    for (let i = 0; i < chars.length - 1; i += 1) out.add(chars[i] + chars[i + 1]);
  }
  return out;
}

const overlapOf = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) shared += 1;
  return shared / small.size;
};

const numberSet = (text) => new Set(String(text ?? '').match(NUMBERS) ?? []);
const differs = (a, b) => {
  if (a.size !== b.size) return true;
  for (const item of a) if (!b.has(item)) return true;
  return false;
};

const noteOf = (entry) => entry.note ?? entry;
const dateOf = (note) => Date.parse(note.valid_from ?? '') || 0;

/**
 * @param {{notes: Array<{id: string, title: string, body: string, note?: object}>}} scan
 * @param {{days?: number, limit?: number, minOverlap?: number, now?: number}} options
 */
export function findConflicts(scan, { days = 30, limit = 10, minOverlap = 0.5, now = Date.now(), trusts = ['user_stated', 'system_derived'] } = {}) {
  const cutoff = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const active = [];
  for (const entry of scan?.notes ?? []) {
    const meta = noteOf(entry);
    if (meta.status !== 'active') continue;
    if (meta.superseded_by) continue;
    if (meta.valid_to) continue;
    if (Array.isArray(trusts) && !trusts.includes(meta.trust)) continue;
    const text = String(meta.title ?? entry.title ?? '') + '\n' + String(entry.body ?? '');
    if ([...text].length < 40) continue;
    active.push({
      id: String(entry.id),
      title: String(meta.title ?? entry.title ?? ''),
      body: String(entry.body ?? ''),
      tokens: tokensOf(text),
      titleTokens: tokensOf(String(meta.title ?? entry.title ?? '')),
      numbers: numberSet(text),
      from: dateOf(meta),
      recent: dateOf(meta) >= cutoff,
    });
  }
  const pairs = [];
  for (let i = 0; i < active.length; i += 1) {
    const a = active[i];
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j];
      if (!a.recent && !b.recent) continue;
      const overlap = overlapOf(a.tokens, b.tokens);
      if (overlap < minOverlap) continue;
      let shared = 0;
      const [small, large] = a.tokens.size <= b.tokens.size ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
      for (const token of small) if (large.has(token)) shared += 1;
      if (shared < 6) continue;
      // Different documents often share words ("验收", "客户端"); require the
      // titles themselves to talk about the same thing before accusing them.
      const titleOverlap = overlapOf(a.titleTokens, b.titleTokens);
      if (titleOverlap < 0.4) continue;
      const [older, newer] = a.from <= b.from ? [a, b] : [b, a];
      if (older.id === newer.id) continue;
      const text = String(newer.body).toLowerCase();
      const signals = [];
      if (differs(older.numbers, newer.numbers) && older.numbers.size > 0) signals.push('values_differ');
      if (REPLACEMENT.test(text)) signals.push('replacement_wording');
      if (NEGATION.test(text) !== NEGATION.test(String(older.body).toLowerCase())) signals.push('polarity_differs');
      if (signals.length === 0) continue;
      if (signals.length < 2 && overlap < 0.55) continue;
      pairs.push({
        older: { id: older.id, title: older.title, at: older.from, snippet: snippets(older.body) },
        newer: { id: newer.id, title: newer.title, at: newer.from, snippet: snippets(newer.body) },
        overlap: Math.round(overlap * 100) / 100,
        title_overlap: Math.round(titleOverlap * 100) / 100,
        signals,
      });
    }
  }
  pairs.sort((x, y) => y.overlap - x.overlap);
  return { scanned: active.length, pairs: pairs.slice(0, Math.max(1, Math.min(limit, 50))) };
}


/** Last daily conflict scan, so the panel can show it without rescanning. */
export function readConflictState(store) {
  try {
    const parsed = JSON.parse(readFileSync(join(store.store, 'runs', CONFLICT_STATE), 'utf8'));
    return { at: Number(parsed.at) || 0, count: Number(parsed.count) || 0 };
  } catch {
    return null;
  }
}

export function writeConflictState(store, { at = Date.now(), count = 0 } = {}) {
  try {
    mkdirSync(join(store.store, 'runs'), { recursive: true });
    writeFileSync(join(store.store, 'runs', CONFLICT_STATE), JSON.stringify({ at, count }) + '\n');
    return true;
  } catch {
    return false;
  }
}
