// Host side of the panel channel: read status, list candidates, approve or
// reject, and search the store. Every endpoint is a thin projection of the
// tabellio API — the panel never writes memory directly, it only exercises the
// same approval gate the `tabellio inbox` CLI uses.
import { listCandidates, listProposals, read, remember, reviewCandidates, reviewProposals, search, status } from 'tabellio';
import { buildNotesPage, buildReport } from './report.js';
import { readLastRun } from './consolidate.js';

export const RPC_CHANNEL = '/tabellio-dsh';
export const MAX_REVIEW_IDS = 50;
export const MAX_SEARCH_LIMIT = 20;
export const MAX_REPORT_DAYS = 90;
export const MAX_NOTES_LIMIT = 50;
export const MAX_NOTE_CHARS = 4000;
export const MAX_WRITE_CHARS = 4000;

const fail = (code, message) => ({ ok: false, error: { code, message, details: {} } });
const ok = (value) => ({ ok: true, value });

function modeOf(settings) {
  if (!settings.autoRecall) return 'off';
  return settings.shadow ? 'shadow' : 'inject';
}

function lastRecallView(last) {
  if (!last || typeof last !== 'object') return null;
  return {
    at: Number(last.at) || 0,
    query: String(last.query ?? ''),
    mode: String(last.mode ?? ''),
    refused: Boolean(last.refused),
    count: Number(last.count) || 0,
    judged: Boolean(last.judged),
    reason: last.reason === null || last.reason === undefined ? null : String(last.reason),
    titles: Array.isArray(last.titles) ? last.titles.map(String).slice(0, 3) : [],
    elapsedMs: Number(last.elapsedMs) || 0,
    receiptPath: last.receiptPath === null || last.receiptPath === undefined ? null : String(last.receiptPath),
  };
}

function judgeView(state) {
  if (!state || state.mode !== 'llm') return { mode: state?.mode ?? 'off', last: null };
  return {
    mode: 'llm',
    host: String(state.host ?? 'none'),
    selection: state.selection ? { provider: String(state.selection.provider ?? ''), model: String(state.selection.model ?? '') } : null,
    last: state.last
      ? {
        at: Number(state.last.at) || 0,
        stage: String(state.last.stage ?? ''),
        kept: state.last.kept === undefined ? null : Number(state.last.kept),
        notes: state.last.notes === undefined ? null : Number(state.last.notes),
        elapsedMs: state.last.elapsedMs === undefined ? null : Number(state.last.elapsedMs),
        chars: state.last.chars === undefined ? null : Number(state.last.chars),
        preview: String(state.last.preview ?? ''),
      }
      : null,
  };
}

function statusView(settings, store, lastRecall, judgeState) {
  const result = status(store);
  return {
    store: store.store,
    exists: Boolean(store.exists()),
    notes: Number(result.notes) || 0,
    candidates: Number(result.candidates) || 0,
    proposals: Number(result.proposals) || 0,
    indexExists: Boolean(result.indexExists),
    indexStale: Boolean(result.indexStale),
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    mode: modeOf(settings),
    capture: settings.capture,
    delivery: settings.shadow ? 'shadow' : settings.delivery,
    lastRecall: lastRecallView(lastRecall),
    judge: judgeView(judgeState),
    consolidate: {
      mode: settings.consolidate ?? 'off',
      lastRun: readLastRun(store),
    },
  };
}

function candidateView(candidate) {
  return {
    id: String(candidate.id),
    title: String(candidate.title ?? ''),
    chars: Number(candidate.chars) || 0,
    created: String(candidate.created ?? ''),
    kind: String(candidate.kind ?? 'semantic'),
    trust: String(candidate.trust ?? ''),
    source: String(candidate.source ?? ''),
  };
}

function proposalView(proposal) {
  const similarity = Number(proposal?.similarity);
  return {
    id: String(proposal?.id ?? ''),
    mode: String(proposal?.mode ?? 'merge'),
    created: String(proposal?.created ?? ''),
    sourceCount: Number(proposal?.source_count) || 0,
    sourceTitles: Array.isArray(proposal?.source_titles) ? proposal.source_titles.map(String) : [],
    similarity: Number.isFinite(similarity) ? similarity : null,
    targetId: proposal?.target_id === null || proposal?.target_id === undefined ? null : String(proposal.target_id),
    warnings: Array.isArray(proposal?.warnings) ? proposal.warnings.map(String) : [],
  };
}

function reviewPayload(payload) {
  const action = payload?.action;
  const ids = payload?.ids;
  if (action !== 'accept' && action !== 'reject') return { error: 'action must be "accept" or "reject"' };
  if (!Array.isArray(ids) || ids.length === 0) return { error: 'ids must be a non-empty array' };
  if (ids.length > MAX_REVIEW_IDS) return { error: `ids must contain at most ${MAX_REVIEW_IDS} entries` };
  if (!ids.every((id) => typeof id === 'string' && id.length > 0)) return { error: 'ids must be non-empty strings' };
  if (ids.some((id) => id.includes(','))) return { error: 'ids must not contain commas; pass an array' };
  return { action, ids };
}

/**
 * Build the channel handler. One store instance is shared with the tools and
 * auto recall, so a hot store invalidate is reflected everywhere.
 */
export function createRpcHandler({ settings, getStore, getLastRecall, getJudgeState }) {
  return async function handler(endpoint, payload) {
    try {
      const store = getStore();
      switch (endpoint) {
        case 'status':
          return ok(statusView(
            settings,
            store,
            typeof getLastRecall === 'function' ? getLastRecall() : null,
            typeof getJudgeState === 'function' ? getJudgeState() : null,
          ));
        case 'inbox.list': {
          const listed = listCandidates(store);
          if (listed?.ok === false) return fail('internal', String(listed.reason ?? 'list failed'));
          const items = Array.isArray(listed?.candidates) ? listed.candidates : [];
          return ok({ items: items.map(candidateView) });
        }
        case 'inbox.review': {
          const parsed = reviewPayload(payload);
          if (parsed.error) return fail('bad-request', parsed.error);
          const result = reviewCandidates(store, {
            [parsed.action === 'accept' ? 'accept' : 'reject']: parsed.ids,
          });
          if (result?.ok === false && !Array.isArray(result.failed)) {
            return fail('bad-request', String(result.reason ?? 'review failed'));
          }
          const counts = status(store);
          return ok({
            accepted: (result.accepted ?? []).map((item) => String(item.id ?? item)),
            rejected: (result.rejected ?? []).map((item) => String(item.id ?? item)),
            failed: (result.failed ?? []).map((item) => ({
              id: String(item.id ?? ''),
              reason: String(item.reason ?? item.status ?? 'unknown'),
            })),
            notes: Number(counts.notes) || 0,
            candidates: Number(counts.candidates) || 0,
          });
        }
        case 'proposals.list': {
          const listed = listProposals(store);
          if (listed?.ok === false) return fail('internal', String(listed.reason ?? 'list failed'));
          return ok({ items: (listed.proposals ?? []).map(proposalView) });
        }
        case 'proposals.review': {
          const parsed = reviewPayload(payload);
          if (parsed.error) return fail('bad-request', parsed.error);
          const result = reviewProposals(store, {
            [parsed.action === 'accept' ? 'accept' : 'reject']: parsed.ids,
          });
          if (result?.ok === false && !Array.isArray(result.failed)) {
            return fail('bad-request', String(result.reason ?? 'review failed'));
          }
          return ok({
            accepted: (result.accepted ?? []).map((item) => String(item.id ?? item)),
            rejected: (result.rejected ?? []).map((item) => String(item.id ?? item)),
            failed: (result.failed ?? []).map((item) => ({
              id: String(item.id ?? ''),
              reason: String(item.reason ?? item.status ?? 'unknown'),
            })),
          });
        }
        case 'search': {
          const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
          if (!query) return fail('bad-request', 'query must be a non-empty string');
          if (query.length > 200) return fail('bad-request', 'query is too long');
          const rawLimit = Number(payload?.limit);
          const limit = Number.isFinite(rawLimit)
            ? Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(rawLimit)))
            : 8;
          const result = search(store, query, { maxNotes: limit, includeCore: false });
          return ok({
            refused: result.refused === true,
            reason: result.reason ?? null,
            hits: (result.hits ?? []).map((hit) => ({
              id: String(hit.id ?? ''),
              title: String(hit.title ?? ''),
              score: Number.isFinite(hit.score) ? Number(hit.score) : null,
            })),
          });
        }
        case 'remember': {
          const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
          if (!content) return fail('bad-request', 'content must be a non-empty string');
          if (content.length > MAX_WRITE_CHARS) return fail('bad-request', `content is longer than ${MAX_WRITE_CHARS} characters`);
          const result = remember(store, { content }, { writtenBy: 'panel:tabellio-dsh' });
          if (!result || result.ok === false) {
            return fail('rejected', String(result?.reason ?? 'write rejected'));
          }
          let title = String(result.title ?? '');
          if (!title) {
            try {
              title = String(read(store, result.id)?.title ?? '');
            } catch {
              title = '';
            }
          }
          return ok({
            id: String(result.id ?? ''),
            title,
            notes: Number(status(store).notes) || 0,
          });
        }
        case 'read': {
          const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
          if (!id) return fail('bad-request', 'id must be a non-empty string');
          if (id.length > 64) return fail('bad-request', 'id is too long');
          const result = read(store, id);
          if (!result || result.ok === false) {
            return fail('not-found', String(result?.reason ?? 'note not found'));
          }
          const body = String(result.body ?? '');
          return ok({
            id: String(result.id ?? id),
            title: String(result.title ?? ''),
            body: body.length > MAX_NOTE_CHARS ? body.slice(0, MAX_NOTE_CHARS) + '\n…' : body,
            truncated: body.length > MAX_NOTE_CHARS,
            scope: String(result.note?.scope ?? ''),
            kind: String(result.note?.kind ?? ''),
            validFrom: String(result.note?.valid_from ?? ''),
          });
        }
        case 'notes': {
          const rawOffset = Number(payload?.offset);
          const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
          const rawLimit = Number(payload?.limit);
          const limit = Number.isFinite(rawLimit) ? Math.min(MAX_NOTES_LIMIT, Math.max(5, Math.trunc(rawLimit))) : 20;
          const kind = typeof payload?.kind === 'string' ? payload.kind.trim().slice(0, 40) : '';
          const rawDays = Number(payload?.days);
          const days = Number.isFinite(rawDays) ? Math.min(3650, Math.max(0, Math.trunc(rawDays))) : 0;
          const page = buildNotesPage(store, { offset, limit, kind, days });
          return ok({
            total: page.total,
            offset: page.offset,
            limit: page.limit,
            kind: page.kind,
            days: page.days,
            items: page.items.map((note) => ({
              id: String(note.id),
              title: String(note.title),
              valid_from: String(note.valid_from),
              kind: String(note.kind ?? ''),
            })),
          });
        }
        case 'report': {
          const rawDays = Number(payload?.days);
          const days = Number.isFinite(rawDays) ? Math.min(MAX_REPORT_DAYS, Math.max(1, Math.trunc(rawDays))) : 7;
          const rawLimit = Number(payload?.limit);
          const limit = Number.isFinite(rawLimit) ? Math.min(10, Math.max(1, Math.trunc(rawLimit))) : 3;
          const report = buildReport(store, { days, limit });
          return ok({
            days: report.days,
            since: report.since,
            notes_total: report.notes_total,
            notes_added: report.notes_added,
            candidates: report.candidates,
            proposals: report.proposals,
            truncated: report.truncated,
            items: report.added.map((note) => ({
              id: String(note.id),
              title: String(note.title),
              valid_from: String(note.valid_from),
            })),
          });
        }
        default:
          return fail('bad-request', 'unknown endpoint: ' + String(endpoint));
      }
    } catch (error) {
      return fail('internal', error?.message ?? String(error));
    }
  };
}
