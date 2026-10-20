// A small, human-reviewable sample of judge decisions.
//
// The judge is a model call, so its verdicts drift with the model and the
// corpus. Keeping the last few decisions (query + kept/dropped titles) is what
// lets a person spot a bad streak instead of trusting an aggregate number.
// Reviews are stored separately so logging a decision never rewrites history.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const JUDGE_LOG_FILE = 'judge-log.jsonl';
export const JUDGE_REVIEW_FILE = 'judge-review.jsonl';
export const JUDGE_LOG_MAX = 300;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TITLE_MAX = 80;
const QUERY_MAX = 120;

const pathOf = (store, file) => join(store.store, 'runs', file);

const readLines = (file) => {
  try {
    return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
  } catch {
    return [];
  }
};

const cleanTitles = (items) =>
  (Array.isArray(items) ? items : [])
    .slice(0, 6)
    .map((item) => String(item?.title ?? item?.id ?? '').slice(0, TITLE_MAX))
    .filter(Boolean);

export function appendJudgeEvent(store, { at = Date.now(), query = '', kept = [], dropped = [], verdict = 'verdict' } = {}) {
  try {
    mkdirSync(join(store.store, 'runs'), { recursive: true });
    const file = pathOf(store, JUDGE_LOG_FILE);
    const lines = readLines(file);
    const entry = { at, query: String(query).slice(0, QUERY_MAX), kept: cleanTitles(kept), dropped: cleanTitles(dropped), verdict };
    lines.push(JSON.stringify(entry));
    const keptLines = lines.slice(-JUDGE_LOG_MAX);
    writeFileSync(file, keptLines.join('\n') + '\n');
    return entry;
  } catch {
    return null;
  }
}

export function readJudgeLog(store, { limit = 20 } = {}) {
  const events = [];
  for (const line of readLines(pathOf(store, JUDGE_LOG_FILE))) {
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object') continue;
      events.push({
        at: Number(parsed.at) || 0,
        query: String(parsed.query ?? ''),
        kept: Array.isArray(parsed.kept) ? parsed.kept.map(String) : [],
        dropped: Array.isArray(parsed.dropped) ? parsed.dropped.map(String) : [],
        verdict: String(parsed.verdict ?? 'verdict'),
      });
    } catch {
      // a truncated line never hides the rest of the log
    }
  }
  return events.sort((left, right) => right.at - left.at).slice(0, Math.max(1, limit));
}

export function appendJudgeReview(store, { at = 0, ok = false } = {}) {
  try {
    mkdirSync(join(store.store, 'runs'), { recursive: true });
    appendFileSync(pathOf(store, JUDGE_REVIEW_FILE), JSON.stringify({ at: Number(at) || 0, ok: ok === true }) + '\n');
    return true;
  } catch {
    return false;
  }
}

export function readJudgeReviews(store) {
  const reviews = new Map();
  for (const line of readLines(pathOf(store, JUDGE_REVIEW_FILE))) {
    try {
      const parsed = JSON.parse(line);
      if (!parsed || !Number(parsed.at)) continue;
      reviews.set(Number(parsed.at), parsed.ok === true);
    } catch {
      // ignore broken lines
    }
  }
  return reviews;
}

export function judgeQuality(store, { days = 7, now = Date.now() } = {}) {
  const since = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const reviews = readJudgeReviews(store);
  const events = readJudgeLog(store, { limit: JUDGE_LOG_MAX }).filter((event) => event.at >= since);
  let reviewed = 0;
  let agreed = 0;
  for (const event of events) {
    if (!reviews.has(event.at)) continue;
    reviewed += 1;
    if (reviews.get(event.at)) agreed += 1;
  }
  return { total: events.length, reviewed, agreed };
}

/**
 * Per-week judge activity for the panel: how often the model was asked, how
 * often a human reviewed its verdict, and how often that review agreed.
 * Weeks are aligned to "now", oldest first.
 */
export function judgeTrend(store, { weeks = 4, now = Date.now() } = {}) {
  const count = Math.max(1, Math.min(12, Math.floor(Number(weeks) || 4)));
  const events = readJudgeLog(store, { limit: JUDGE_LOG_MAX });
  const reviews = readJudgeReviews(store);
  const buckets = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = now - (index + 1) * WEEK_MS;
    const end = now - index * WEEK_MS;
    let total = 0;
    let reviewed = 0;
    let agreed = 0;
    let kept = 0;
    let dropped = 0;
    for (const event of events) {
      if (event.at < start || event.at >= end) continue;
      total += 1;
      kept += event.kept.length;
      dropped += event.dropped.length;
      if (!reviews.has(event.at)) continue;
      reviewed += 1;
      if (reviews.get(event.at)) agreed += 1;
    }
    buckets.push({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      total,
      kept,
      dropped,
      reviewed,
      agreed,
      agreement: reviewed ? agreed / reviewed : null,
    });
  }
  return buckets;
}
