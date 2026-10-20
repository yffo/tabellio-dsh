// Editing a note means writing its successor, never mutating a file in place.
//
// The core only changes notes through the write gate, and the `supersedes`
// link is what keeps the old text auditable: the new note records which note it
// replaces, then the core's invalidation pass archives the old one so automatic
// recall stops returning it. If either half fails, the caller sees it instead of
// a silently half-applied edit.
import { consolidate, read, remember } from 'tabellio';

export const MAX_EDIT_TITLE = 120;
export const MAX_EDIT_BODY = 400; // the core write gate's per-note limit

function splitHeading(content) {
  const match = String(content ?? '').match(/^\s*#{1,3}\s+(.+?)\s*\n+([\s\S]*)$/);
  return match ? { title: match[1].trim(), body: match[2] } : null;
}

export function buildEditText(current, { content, title } = {}) {
  if (!current || current.ok === false) return null;
  const note = current.note ?? {};
  const parsed = splitHeading(content);
  const nextTitle = String(title ?? parsed?.title ?? current.title ?? '').trim().slice(0, MAX_EDIT_TITLE);
  const body = String(parsed ? parsed.body : content).trim();
  if (!body || !nextTitle) return null;
  const scope = note.scope_detail ? `${note.scope ?? 'user'}:${note.scope_detail}` : note.scope ?? 'user';
  const tags = [...new Set([...(Array.isArray(note.tags) ? note.tags.map(String) : []), 'edited'])];
  const lines = [
    '---',
    `kind: ${note.kind ?? 'semantic'}`,
    `scope: ${JSON.stringify(scope)}`,
    `trust: ${note.trust ?? 'user_stated'}`,
    'status: active',
    `supersedes: [${JSON.stringify(String(current.id))}]`,
    `tags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    'provenance:',
    '  written_by: "panel:edit"',
    `  source_ref: ${JSON.stringify('edit:' + String(current.id))}`,
    '---',
    '',
    `# ${nextTitle}`,
    '',
    body,
    '',
  ];
  return lines.join('\n');
}

/** Returns `{ok, id (new note), superseded (old id), oldArchived, applied}`. */
export function editNote(store, { id, content, title } = {}) {
  const noteId = String(id ?? '').trim();
  if (!noteId) return { ok: false, reason: 'missing_id' };
  const current = read(store, noteId);
  if (!current?.ok) return { ok: false, reason: 'not_found', id: noteId };

  const parsed = splitHeading(content);
  const body = String(parsed ? parsed.body : content).trim();
  if (!body) return { ok: false, reason: 'empty', id: noteId };
  const nextTitle = String(title ?? parsed?.title ?? current.title ?? '').trim().slice(0, MAX_EDIT_TITLE);
  const currentBody = String(current.body ?? '').trim().replace(/^#{1,3}\s+.+\n+/, '').trim();
  if (nextTitle === String(current.title ?? '').trim() && body === currentBody) {
    return { ok: false, reason: 'unchanged', id: noteId };
  }
  const chars = [...`# ${nextTitle}\n\n${body}`].length;
  if (chars > MAX_EDIT_BODY) {
    return { ok: false, reason: 'too_long', id: noteId, chars, limit: MAX_EDIT_BODY };
  }

  const text = buildEditText(current, { content: body, title: nextTitle });
  if (!text) return { ok: false, reason: 'empty', id: noteId };
  const written = remember(store, { text }, { writtenBy: 'panel:edit', sourceRef: 'edit:' + noteId });
  if (!written?.ok) {
    const reason = written?.reason === 'duplicate' ? 'unchanged' : String(written?.reason ?? 'write_failed');
    return { ok: false, reason, id: noteId };
  }

  const newId = String(written.id);
  const applied = consolidate(store, { apply: true });
  const after = read(store, noteId);
  const retired = after?.ok === true && (after.note?.status === 'archived' || Boolean(after.note?.superseded_by) || Boolean(after.note?.valid_to));
  return {
    ok: true,
    id: newId,
    superseded: noteId,
    oldRetired: retired,
    applied: Number(applied?.applied) || 0,
    consolidated: applied?.ok !== false,
  };
}
