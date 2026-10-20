// Where did this note come from, and has it ever been used or replaced?
//
// The answer must be reconstructible from files the store already keeps:
// the note's own frontmatter (provenance.written_by, trust, validity) and the
// recall receipts under runs/. Nothing new is written here.
import fs from 'node:fs';
import path from 'node:path';
import { read } from 'tabellio';

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

export function provenanceView(store, id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  const meta = noteProvenance(store, id.trim());
  if (!meta) return null;
  return { ...meta, recalled: recallUsage(store, meta.id) };
}
