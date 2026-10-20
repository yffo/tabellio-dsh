// 反思 / 升维（“把一周的事实压成一段项目状态”）——只产候选，不自动入库。
//
// 与捕获、巩固同一条纪律：模型可以提议，入库仍然要人批准。反思读取最近的
// 非外部笔记，让宿主默认模型写出 1–2 段“当前状态”摘要，作为候选正文落到
// notes/candidates/，面板里批准后才成为正式笔记。任何失败都静默跳过：
// 巩固是锦上添花，不能影响对话回合，也不能因为模型挂了删东西。
const MIN_BODY = 40;
const MAX_BODY = 400;
const MIN_TITLE = 4;
const MAX_TITLE = 60;
const SNIPPET_CHARS = 300;

import { read } from 'tabellio';

export const REFLECT_TIMEOUT_MS = 8000;
export const REFLECT_MAX_NOTES = 20;

export function buildReflectPrompt(notes) {
  const lines = notes.map((note) => {
    const body = String(note.body ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
    return `[${note.id}] ${note.title ?? ''}\n${body}`;
  });
  return [
    'You compress a personal memory store into at most two "current state" summaries.',
    'Use only the numbered notes below; do not invent facts, names, numbers or dates.',
    'Each summary must merge several notes into one durable statement (project state,',
    'standing rules, or decisions), not repeat a single note.',
    'Answer with JSON only:',
    '[{"title":"short title","body":"40-400 character summary","sources":["note-id", "..."]}]',
    'Use an empty array when the notes do not support a summary.',
    '',
    'Notes:',
    ...lines,
  ].join('\n');
}

function clampText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Tolerant parser: returns [] for "no summary", null when the reply is unusable
 * (so the caller keeps nothing and logs no candidate). Source ids must exist in
 * the note window; invented ids are dropped rather than trusted.
 */
export function parseReflectReply(reply, allowedIds) {
  const text = String(reply ?? '').trim();
  if (!text) return null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const allowed = new Set((allowedIds ?? []).map(String));
  const out = [];
  for (const item of parsed.slice(0, 2)) {
    const title = clampText(item?.title, MAX_TITLE);
    const body = clampText(item?.body, MAX_BODY);
    const sources = Array.isArray(item?.sources) ? item.sources.map(String).filter((id) => allowed.has(id)) : [];
    if (title.length < MIN_TITLE || body.length < MIN_BODY || sources.length === 0) continue;
    out.push({ title, body, sources });
  }
  return out;
}

/** Pick recent, non-external, active notes to reflect over. */
export function selectReflectNotes(store, { days = 14, max = REFLECT_MAX_NOTES, nowMs = Date.now() } = {}) {
  let entries = [];
  try {
    entries = store.scan().notes ?? [];
  } catch {
    return [];
  }
  const cutoff = nowMs - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const picked = [];
  for (const entry of entries) {
    // scan() returns {id, title, note} where frontmatter lives on `note`.
    const note = entry.note ?? entry;
    if (note.status !== 'active') continue;
    if (note.trust === 'external') continue;
    if (Array.isArray(note.tags) && note.tags.includes('reflect')) continue;
    const at = Date.parse(note.valid_from ?? '');
    if (!Number.isFinite(at) || at < cutoff) continue;
    picked.push(entry);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Read note bodies for the picked entries; unreadable notes are skipped. */
export function readReflectNotes(store, notes) {
  const out = [];
  for (const note of notes) {
    try {
      const got = read(store, note.id);
      if (got?.ok) out.push({ id: String(note.id), title: got.title ?? note.title ?? '', body: got.body ?? '' });
    } catch {
      // Skip; reflection over fewer notes is still valid.
    }
  }
  return out;
}

/**
 * Ask the host model for summaries. Returns an array or null when the check is
 * unavailable or failed (caller writes nothing).
 */
export async function reflectNotes({ llm, selection, notes, timeoutMs = REFLECT_TIMEOUT_MS, signal, onReply }) {
  if (!llm || typeof llm.stream !== 'function') return null;
  if (!selection?.provider || !selection?.model) return null;
  if (!Array.isArray(notes) || notes.length < 2) return null;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

  try {
    const chunks = llm.stream({
      provider: selection.provider,
      model: selection.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildReflectPrompt(notes) }] }],
      maxTokens: 1024,
      temperature: 0.2,
      signal: controller.signal,
    });
    let reply = '';
    for await (const chunk of chunks) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text;
      if (chunk?.type === 'finish') break;
    }
    try {
      onReply?.(reply);
    } catch {
      // Diagnostics must never affect the sweep.
    }
    return parseReflectReply(reply, notes.map((note) => note.id));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/** Proposal text for the candidate store: title + summary + source ids. */
export function reflectionText(reflection) {
  return `# 状态摘要：${reflection.title}\n\n${reflection.body}\n\n来源：${reflection.sources.join('、')}\n`;
}

export function writeReflections(addCandidate, reflections, { source = 'dsh:reflect' } = {}) {
  const written = [];
  for (const reflection of reflections.slice(0, 2)) {
    try {
      const result = addCandidate(
        { text: reflectionText(reflection), kind: 'semantic', tags: ['reflect', 'summary'], source },
        { writtenBy: 'reflect:dsh' },
      );
      if (result?.ok) written.push({ id: result.id, title: reflection.title });
    } catch {
      // One bad summary must not sink the sweep.
    }
  }
  return written;
}
