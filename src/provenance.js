// Where did this note come from, and has it ever been used or replaced?
//
// The answer must be reconstructible from files the store already keeps:
// the note's own frontmatter (provenance.written_by, trust, validity) and the
// recall receipts under runs/. Nothing new is written here.
import fs from 'node:fs';
import path from 'node:path';
import { read } from 'tabellio';
import { readFeedback } from './feedback.js';
import { readOutcomes } from './outcome.js';

export const MAX_RECEIPT_SCAN = 500;

function msOfStamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Metadata for one note, or null when the note does not exist. */
export function noteProvenance(store, id) {
  let result = null;
  try {
    result = read(store, id);
  } catch {
    result = null;
  }
  const note = result?.note ?? result ?? null;
  if (!note || !result?.ok) return null;
  const provenance = note.provenance && typeof note.provenance === 'object' ? note.provenance : {};
  return {
    id: note.id ?? id,
    title: result.title ?? note.title ?? '',
    kind: note.kind ?? '',
    trust: note.trust ?? '',
    scope: note.scope ?? '',
    status: note.status ?? 'active',
    validTo: note.valid_to ?? null,
    validFrom: note.valid_from ?? null,
    supersededBy: note.superseded_by ?? null,
    writtenBy: provenance.written_by ?? '',
    writtenAt: typeof provenance.written_at === 'number' ? provenance.written_at : null,
    tags: Array.isArray(note.tags) ? note.tags.slice(0, 8) : [],
    chars: String(result.body ?? note.body ?? '').length,
    path: note.path ?? '',
  };
}

/**
 * Count recall receipts whose items include this note id. Receipt filenames are
 * monotonic Crockford ids, so keeping the newest tail is a stable sample.
 */
export function recallUsage(store, id, { maxReceipts = MAX_RECEIPT_SCAN } = {}) {
  const dir = path.join(store.store, 'runs');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => /^rcp_[0-9A-HJKMNP-TV-Z]+\.json$/.test(name));
  } catch {
    return { count: 0, lastAt: null, scanned: 0 };
  }
  files.sort();
  files = files.slice(-maxReceipts);
  let count = 0;
  let lastAt = null;
  for (const name of files) {
    try {
      const receipt = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const items = Array.isArray(receipt?.items) ? receipt.items : [];
      if (!items.some((item) => item?.id === id)) continue;
      count += 1;
      const at = msOfStamp(receipt.createdAt);
      if (at && (!lastAt || at > lastAt)) lastAt = at;
    } catch {
      // A corrupt receipt is skipped; provenance stays advisory.
    }
  }
  return { count, lastAt, scanned: files.length };
}

const FEEDBACK_TEXT = { useful: '标记为有用', wrong: '标记为不准确', stale: '标记为过时' };

/**
 * One chronological story per note: when it was written, the queries that
 * pulled it in, corrections it took part in, and panel feedback.
 */
export function noteTimeline(store, id, { limit = 20, maxReceipts = MAX_RECEIPT_SCAN } = {}) {
  const meta = noteProvenance(store, id);
  if (!meta) return [];
  const events = [];
  const created = meta.writtenAt ?? msOfStamp(meta.validFrom);
  if (created) events.push({ at: created, kind: 'created', text: '写入' + (meta.writtenBy ? '（' + meta.writtenBy + '）' : '') });
  if (meta.supersededBy) {
    const at = msOfStamp(meta.validTo) ?? Date.now();
    events.push({ at, kind: 'superseded', text: '被新笔记取代 → ' + meta.supersededBy });
  }
  for (const receipt of recentReceipts(store, maxReceipts)) {
    if (!receipt.items.some((item) => item?.id === id)) continue;
    const at = msOfStamp(receipt.createdAt);
    if (at) events.push({ at, kind: 'recall', text: '召回：' + String(receipt.query || '').slice(0, 60), query: String(receipt.query || '') });
  }
  for (const outcome of readOutcomes(store)) {
    if (!Array.isArray(outcome.noteIds) || !outcome.noteIds.includes(id)) continue;
    const at = Number(outcome.at) || null;
    if (at) events.push({ at, kind: 'correction', text: '你纠正过的对话：' + String(outcome.query || '').slice(0, 60) });
  }
  for (const entry of readFeedback(store)) {
    if (entry.id !== id) continue;
    const at = Number(entry.at) || null;
    if (at) events.push({ at, kind: 'feedback', text: FEEDBACK_TEXT[entry.signal] || '面板反馈' });
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

function recentReceipts(store, maxReceipts) {
  const dir = path.join(store.store, 'runs');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => /^rcp_[0-9A-HJKMNP-TV-Z]+\.json$/.test(name));
  } catch {
    return [];
  }
  files.sort();
  files = files.slice(-maxReceipts);
  const receipts = [];
  for (const name of files) {
    try {
      receipts.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
    } catch {
      // skip corrupt receipts
    }
  }
  return receipts;
}

export function provenanceView(store, id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  const meta = noteProvenance(store, id.trim());
  if (!meta) return null;
  return { ...meta, recalled: recallUsage(store, meta.id) };
}
