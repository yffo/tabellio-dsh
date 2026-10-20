// Local accounting for the memory layer's own overhead.
//
// People tolerate a memory plugin until it silently doubles their token bill.
// These numbers are deliberately small and honest: injected characters, the
// estimated tokens they imply, judge calls and embedding queries. The host's
// own token meter stays the source of truth for the whole conversation.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const USAGE_FILE = 'usage.jsonl';
export const USAGE_MAX = 2000;

const pathOf = (store) => join(store.store, 'runs', USAGE_FILE);

const readLines = (file) => {
  try {
    return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
  } catch {
    return [];
  }
};

export function appendUsage(store, { at = Date.now(), mode = 'context', chars = 0, judge = 0, judgeMs = 0, semantic = 0, notes = 0 } = {}) {
  try {
    mkdirSync(join(store.store, 'runs'), { recursive: true });
    const file = pathOf(store);
    const lines = readLines(file);
    lines.push(JSON.stringify({
      at,
      mode: String(mode),
      chars: Math.max(0, Math.round(Number(chars) || 0)),
      judge: judge ? 1 : 0,
      judgeMs: Math.max(0, Math.round(Number(judgeMs) || 0)),
      semantic: semantic ? 1 : 0,
      notes: Math.max(0, Math.round(Number(notes) || 0)),
    }));
    writeFileSync(file, lines.slice(-USAGE_MAX).join('\n') + '\n');
    return true;
  } catch {
    return false;
  }
}

export function readUsage(store, { limit = USAGE_MAX } = {}) {
  const events = [];
  for (const line of readLines(pathOf(store))) {
    try {
      const parsed = JSON.parse(line);
      if (!parsed || !Number(parsed.at)) continue;
      events.push({
        at: Number(parsed.at),
        mode: String(parsed.mode ?? 'context'),
        chars: Number(parsed.chars) || 0,
        judge: parsed.judge ? 1 : 0,
        judgeMs: Number(parsed.judgeMs) || 0,
        semantic: parsed.semantic ? 1 : 0,
        notes: Number(parsed.notes) || 0,
      });
    } catch {
      // a torn line must not hide the rest of the ledger
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, Math.max(1, limit));
}

export function usageSummary(store, { days = 7, now = Date.now() } = {}) {
  const since = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const events = readUsage(store, { limit: USAGE_MAX }).filter((event) => event.at >= since);
  const summary = {
    days,
    recalls: events.length,
    injected: 0,
    chars: 0,
    tokensEst: 0,
    judgeCalls: 0,
    judgeMs: 0,
    semanticCalls: 0,
    notes: 0,
  };
  for (const event of events) {
    summary.chars += event.chars;
    if (event.chars > 0) summary.injected += 1;
    summary.judgeCalls += event.judge;
    summary.judgeMs += event.judge ? event.judgeMs : 0;
    summary.semanticCalls += event.semantic;
    summary.notes += event.notes;
  }
  // A deliberately rough estimate: CJK text costs more per character than
  // Latin, so 3 chars/token is the conservative bound to quote to people.
  summary.tokensEst = Math.round(summary.chars / 3);
  summary.judgeMsAvg = summary.judgeCalls > 0 ? Math.round(summary.judgeMs / summary.judgeCalls) : 0;
  return summary;
}
