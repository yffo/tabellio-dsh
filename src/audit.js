// Recall audit trail: one compact JSONL line per recall decision, kept next to
// the store (runs/recall-audit-YYYY-MM.jsonl). It answers the question the
// panel otherwise cannot: why did (or didn't) this turn get memory?
//
// The audit is advisory telemetry, never a source of truth: a failed append
// must not affect the turn, and entries are bounded so a store cannot grow
// without limit.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_QUERY_CHARS = 120;
export const MAX_TITLES = 3;
export const MAX_TITLE_CHARS = 80;
export const MAX_REASON_CHARS = 160;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function auditPath(store, at = Date.now()) {
  const date = new Date(at);
  const name = `recall-audit-${date.getFullYear()}-${pad(date.getMonth() + 1)}.jsonl`;
  return join(store.store, 'runs', name);
}

function clip(value, max) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > max ? text.slice(0, max) : text;
}

export function toAuditEntry(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    at: Number(source.at) || Date.now(),
    query: clip(source.query, MAX_QUERY_CHARS),
    mode: clip(source.mode, 32) || 'unknown',
    refused: Boolean(source.refused),
    count: Math.max(0, Number(source.count) || 0),
    reason: source.reason === null || source.reason === undefined ? null : clip(source.reason, MAX_REASON_CHARS),
    judged: Boolean(source.judged),
    elapsedMs: Math.max(0, Number(source.elapsedMs) || 0),
    titles: (Array.isArray(source.titles) ? source.titles : [])
      .slice(0, MAX_TITLES)
      .map((title) => clip(title, MAX_TITLE_CHARS)),
  };
}

export function appendAudit(store, input) {
  try {
    const entry = toAuditEntry(input);
    mkdirSync(join(store.store, 'runs'), { recursive: true });
    appendFileSync(auditPath(store, entry.at), JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  } catch {
    return null;
  }
}

// Newest first. Current month is enough for the panel; a stale month file is
// ignored rather than merged, which keeps the read path cheap and predictable.
export function readAudit(store, { limit = 20 } = {}) {
  const max = Math.max(1, Math.min(200, Number(limit) || 20));
  try {
    const file = auditPath(store);
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const entries = [];
    for (let index = lines.length - 1; index >= 0 && entries.length < max; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index]);
        if (parsed && typeof parsed === 'object') entries.push(toAuditEntry(parsed));
      } catch {
        // A torn line (crash mid-append) is skipped, not fatal.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function auditCounts(entries) {
  const counts = {};
  for (const entry of entries) counts[entry.mode] = (counts[entry.mode] ?? 0) + 1;
  return counts;
}
