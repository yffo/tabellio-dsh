// 记忆周报：扫描 notes/ 的 valid_from，统计最近 N 天新增，并带上候选/提案数。
// 只读，不调模型，不联网。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listCandidates, listProposals } from 'tabellio';

const DAY_MS = 24 * 60 * 60 * 1000;

function readFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return { frontmatter: '', body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

function field(frontmatter, name) {
  const match = new RegExp(`^${name}:\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(frontmatter);
  return match ? match[1].trim() : '';
}

function collectNotes(store) {
  const dir = join(store.store, 'notes');
  let files = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.md'));
  } catch {
    files = [];
  }
  const notes = [];
  for (const name of files) {
    let raw;
    try {
      raw = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    const { frontmatter, body } = readFrontmatter(raw);
    const validFrom = field(frontmatter, 'valid_from');
    const heading = /^#\s+(.+)$/m.exec(body);
    const firstLine = body.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? '';
    const id = name.replace(/\.md$/, '');
    notes.push({
      id,
      title: heading ? heading[1].trim() : (firstLine.replace(/^#+\s*/, '').slice(0, 80) || id),
      valid_from: validFrom,
      kind: field(frontmatter, 'kind') || 'semantic',
      scope: field(frontmatter, 'scope'),
    });
  }
  notes.sort((a, b) => (Date.parse(b.valid_from) || 0) - (Date.parse(a.valid_from) || 0));
  return notes;
}

// 全部笔记的分页视图：面板里不必先搜索也能翻到更早的记忆。
export function buildNotesPage(store, { offset = 0, limit = 20, kind = '', days = 0, now = Date.now() } = {}) {
  let notes = collectNotes(store);
  if (kind) notes = notes.filter((note) => note.kind === kind);
  if (Number.isFinite(days) && days > 0) {
    const since = now - days * DAY_MS;
    notes = notes.filter((note) => {
      const when = note.valid_from ? Date.parse(note.valid_from) : NaN;
      return Number.isFinite(when) && when >= since;
    });
  }
  const start = Math.max(0, offset);
  return {
    total: notes.length,
    offset: start,
    limit,
    kind,
    days,
    items: notes.slice(start, start + Math.max(1, limit)),
  };
}

export function buildReport(store, { days = 7, limit = 10, now = Date.now() } = {}) {
  const since = now - days * DAY_MS;
  const all = collectNotes(store);
  const added = all.filter((note) => {
    const when = note.valid_from ? Date.parse(note.valid_from) : NaN;
    return Number.isFinite(when) && when >= since;
  });

  let candidates = 0;
  let proposals = 0;
  try {
    candidates = (listCandidates(store).candidates ?? []).length;
  } catch {
    candidates = 0;
  }
  try {
    proposals = (listProposals(store).proposals ?? []).length;
  } catch {
    proposals = 0;
  }

  return {
    days,
    since: new Date(since).toISOString(),
    notes_total: all.length,
    notes_added: added.length,
    candidates,
    proposals,
    added: added.slice(0, limit),
    truncated: Math.max(0, added.length - limit),
  };
}

export function renderReport(report) {
  const lines = [];
  lines.push(`记忆周报（最近 ${report.days} 天）：新增 ${report.notes_added} 条，库共 ${report.notes_total} 条。`);
  for (const note of report.added) {
    const when = note.valid_from.slice(0, 10);
    lines.push(`- ${when} ${note.title}（${note.id}）`);
  }
  if (report.truncated > 0) lines.push(`…另有 ${report.truncated} 条未列出。`);
  if (report.candidates > 0) lines.push(`候选待批：${report.candidates} 条。`);
  if (report.proposals > 0) lines.push(`提案待批：${report.proposals} 条。`);
  if (report.notes_added === 0 && report.candidates === 0 && report.proposals === 0) {
    lines.push('这周没有新记忆。');
  }
  return lines.join('\n');
}
