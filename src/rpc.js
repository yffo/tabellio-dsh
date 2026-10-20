// Host side of the panel channel: read status, list candidates, approve or
// reject, and search the store. Every endpoint is a thin projection of the
// tabellio API — the panel never writes memory directly, it only exercises the
// same approval gate the `tabellio inbox` CLI uses.
import { applyContentConsolidation, consolidate, listCandidates, listProposals, proposeConsolidation, read, remember, reviewCandidates, reviewProposals, search, status, recordFeedback, feedbackSummary } from 'tabellio';
import { buildNotesPage, buildReport } from './report.js';
import { findConflicts, readConflictState } from './conflicts.js';
import { readLastRun } from './consolidate.js';
import { auditCounts, readAudit, readAuditSince, summarizeAudit } from './audit.js';
import { outcomeSummary } from './outcome.js';
import { noteTimeline, provenanceView } from './provenance.js';
import { editNote } from './edit.js';
import { appendJudgeReview, judgeQuality, readJudgeLog, readJudgeReviews } from './judge-log.js';
import { usageSummary } from './usage.js';
import { buildWeekly } from './weekly.js';

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
    chars: Math.max(0, Number(last.chars) || 0),
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

function statusView(settings, store, lastRecall, judgeState, semanticState, worthState, reflectState) {
  const result = status(store);
  return {
    feedback: summarizeFeedback(store),
    outcome: outcomeSummary(store),
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
    conflicts: {
      mode: settings.consolidate ?? 'off',
      last: readConflictState(store),
    },
    writeJudge: {
      mode: settings.writeJudge,
      last: worthState?.last ?? null,
    },
    reflect: {
      mode: settings.reflect ?? 'off',
      last: reflectState?.last ?? null,
    },
    semantic: {
      mode: settings.semantic,
      model: settings.semanticModel,
      endpoint: settings.semanticEndpoint,
      apiKeySet: Boolean(semanticState?.apiKeySet),
      ready: Boolean(semanticState?.ready),
      size: Number(semanticState?.size) || 0,
      error: semanticState?.error ?? null,
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
function summarizeFeedback(store) {
  const summary = feedbackSummary(store, { days: 3650 });
  return { total: summary.total, ...summary.counts };
}

export function createRpcHandler({ settings, getStore, getLastRecall, getJudgeState, getWorthState, getReflectState, getSemanticState, getSettingsView, updateSettings, testSemantic, getSemanticModels }) {
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
            typeof getSemanticState === 'function' ? getSemanticState() : null,
            typeof getWorthState === 'function' ? getWorthState() : null,
            typeof getReflectState === 'function' ? getReflectState() : null,
          ));
        case 'audit': {
          const limit = Math.max(5, Math.min(100, Number(payload?.limit) || 20));
          const items = readAudit(store, { limit });
          return ok({ items, counts: auditCounts(items), window: limit });
        }
        case 'conflicts.list': {
          const days = payload?.days === undefined ? 30 : Math.min(365, Math.max(1, Math.trunc(Number(payload.days) || 30)));
          const limit = payload?.limit === undefined ? 10 : Math.min(50, Math.max(1, Math.trunc(Number(payload.limit) || 10)));
          const found = findConflicts(getStore().scan(), { days, limit });
          return ok({
            days,
            scanned: found.scanned,
            pairs: found.pairs.map((pair) => ({
              older_id: pair.older.id,
              older_title: pair.older.title,
              older_at: pair.older.at,
              older_snippet: pair.older.snippet,
              newer_id: pair.newer.id,
              newer_title: pair.newer.title,
              newer_at: pair.newer.at,
              newer_snippet: pair.newer.snippet,
              overlap: pair.overlap,
              signals: pair.signals,
            })),
          });
        }
        case 'conflicts.preview': {
          const ids = (payload?.ids ?? []).map((id) => String(id)).filter(Boolean);
          if (ids.length < 2 || ids.length > 8) return fail('bad-request', 'ids must contain 2 to 8 note ids');
          const plan = proposeConsolidation(store, { mode: 'merge', ids });
          return ok({
            ok: Boolean(plan.ok),
            reason: String(plan.reason ?? ''),
            title: String(plan.target?.title ?? '').slice(0, 120),
            body: String(plan.target?.body ?? '').slice(0, MAX_NOTE_CHARS),
            source_ids: ids,
            warnings: (plan.warnings ?? []).map((item) => String(item.message ?? item.code ?? '')),
          });
        }
        case 'conflicts.merge': {
          const ids = (payload?.ids ?? []).map((id) => String(id)).filter(Boolean);
          if (ids.length < 2 || ids.length > 8) return fail('bad-request', 'ids must contain 2 to 8 note ids');
          if (payload?.confirm !== true) return fail('bad-request', 'merging supersedes notes; pass confirm:true after a human approved the preview');
          const result = applyContentConsolidation(store, { mode: 'merge', ids, apply: true, maxChangeRatio: 1 });
          if (!result.ok) return fail('conflict', String(result.reason ?? 'merge_failed'));
          return ok({
            target_id: String(result.target_id ?? result.target?.id ?? ''),
            source_ids: ids,
            warnings: (result.warnings ?? []).map((item) => String(item.message ?? item.code ?? '')),
          });
        }
        case 'feedback.add': {
          const id = String(payload?.id ?? '').trim();
          const signal = String(payload?.signal ?? '').trim();
          if (!id) return fail('bad-request', 'id must be a non-empty string');
          const written = recordFeedback(store, { id, signal, query: String(payload?.query ?? ''), source: 'dsh:panel' });
          if (!written.ok) return fail('bad-request', written.reason ?? 'write_failed');
          return ok(written);
        }
        case 'audit.summary': {
          const days = Math.max(1, Math.min(31, Number(payload?.days) || 7));
          const since = Date.now() - days * 24 * 60 * 60 * 1000;
          const entries = readAuditSince(store, since, { max: 2000 });
          const summary = summarizeAudit(entries);
          return ok({ days, since, ...summary });
        }
        case 'weekly.report': {
          const days = Math.max(1, Math.min(31, Number(payload?.days) || 7));
          return ok(buildWeekly(store, { days }));
        }
        case 'settings.get':
          return ok(typeof getSettingsView === 'function' ? getSettingsView() : {});
        case 'settings.set': {
          if (typeof updateSettings !== 'function') return fail('unsupported', 'settings are read-only on this host');
          const patch = payload ?? {};
          if (patch.semantic !== undefined && !['off', 'local', 'auto'].includes(patch.semantic)) {
            return fail('bad-request', 'semantic must be "off", "local" or "auto"');
          }
          if (patch.judge !== undefined && !['off', 'llm'].includes(patch.judge)) {
            return fail('bad-request', 'judge must be "off" or "llm"');
          }
          if (patch.consolidate !== undefined && !['off', 'daily', 'weekly'].includes(patch.consolidate)) {
            return fail('bad-request', 'consolidate must be "off", "daily" or "weekly"');
          }
          if (patch.capture !== undefined && !['off', 'explicit', 'implicit', 'assist'].includes(patch.capture)) {
            return fail('bad-request', 'capture must be "off", "explicit", "implicit" or "assist"');
          }
          if (patch.delivery !== undefined && !['notice', 'context'].includes(patch.delivery)) {
            return fail('bad-request', 'delivery must be "notice" or "context"');
          }
          if (patch.recallMaxNotes !== undefined && (!Number.isInteger(patch.recallMaxNotes) || patch.recallMaxNotes < 1 || patch.recallMaxNotes > 20)) {
            return fail('bad-request', 'recallMaxNotes must be an integer between 1 and 20');
          }
          if (patch.semanticEndpoint !== undefined && typeof patch.semanticEndpoint !== 'string') {
            return fail('bad-request', 'semanticEndpoint must be a string');
          }
          if (typeof patch.semanticEndpoint === 'string' && patch.semanticEndpoint.length > 200) {
            return fail('bad-request', 'semanticEndpoint is too long');
          }
          if (patch.semanticApiKey !== undefined && (typeof patch.semanticApiKey !== 'string' || patch.semanticApiKey.length > 512)) {
            return fail('bad-request', 'semanticApiKey must be a string of at most 512 chars');
          }
          for (const key of ['captureAssistant', 'outcomeFeedback']) {
            if (patch[key] !== undefined && typeof patch[key] !== 'boolean') return fail('bad-request', key + ' must be a boolean');
          }
          for (const key of ['semanticModel', 'judgeModel', 'judgeProvider']) {
            if (patch[key] !== undefined && typeof patch[key] !== 'string') return fail('bad-request', key + ' must be a string');
            if (typeof patch[key] === 'string' && patch[key].length > 120) return fail('bad-request', key + ' is too long');
          }
          return ok(updateSettings(patch));
        }
        case 'semantic.test': {
          if (typeof testSemantic !== 'function') return fail('unsupported', 'semantic test is unavailable');
          try {
            return ok(await testSemantic(payload ?? {}));
          } catch (error) {
            return ok({ ok: false, error: String(error?.message ?? error) });
          }
        }
        case 'semantic.models': {
          if (typeof getSemanticModels !== 'function') return fail('unsupported', 'model discovery is unavailable');
          const endpoint = payload?.endpoint === undefined ? undefined : String(payload.endpoint);
          if (endpoint !== undefined && (endpoint.length > 200 || !/^https?:\/\//.test(endpoint))) {
            return fail('bad-request', 'endpoint must be an http(s) URL');
          }
          try {
            const models = await getSemanticModels(payload ?? {});
            return ok({ models: Array.isArray(models) ? models.map(String) : [] });
          } catch (error) {
            return ok({ models: [], error: String(error?.message ?? error) });
          }
        }
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
        case 'provenance': {
          if (typeof payload?.id !== 'string' || !payload.id.trim()) return fail('bad-request', 'id is required');
          const view = provenanceView(getStore(), payload.id);
          if (!view) return fail('not-found', 'note not found');
          return ok(view);
        }
        case 'forget': {
          if (typeof payload?.id !== 'string' || !payload.id.trim()) return fail('bad-request', 'id is required');
          const store = getStore();
          const current = read(store, payload.id.trim());
          if (!current.ok) return fail('not-found', 'note not found');
          if (current.note?.status === 'archived') return ok({ ok: true, id: payload.id.trim(), archived: true, already: true, message: '这条记忆已经归档。' });
          const result = consolidate(store, { archive: [payload.id.trim()], apply: true });
          if (!result.ok) return fail('forget-failed', String(result.reason ?? 'archive failed'));
          return ok({ ok: true, id: payload.id.trim(), archived: true, already: false, message: '已忘掉，不再自动召回。' });
        }
        case 'usage.summary': {
          const days = Math.min(31, Math.max(1, Number(payload?.days) || 7));
          return ok(usageSummary(getStore(), { days }));
        }
        case 'judge.recent': {
          const limit = Math.min(30, Math.max(1, Number(payload?.limit) || 10));
          const reviews = readJudgeReviews(getStore());
          const events = readJudgeLog(getStore(), { limit }).map((event) => ({
            at: event.at,
            query: event.query,
            kept: event.kept,
            dropped: event.dropped,
            verdict: event.verdict,
            reviewed: reviews.has(event.at) ? reviews.get(event.at) : null,
          }));
          return ok({ events, quality: judgeQuality(getStore()) });
        }
        case 'judge.review': {
          const at = Number(payload?.at);
          if (!Number.isFinite(at) || at <= 0) return fail('bad-request', 'at must be a positive timestamp');
          if (typeof payload?.ok !== 'boolean') return fail('bad-request', 'ok must be a boolean');
          const known = readJudgeLog(getStore(), { limit: 300 }).some((event) => event.at === at);
          if (!known) return fail('not-found', 'judge event not found');
          const saved = appendJudgeReview(getStore(), { at, ok: payload.ok });
          if (!saved) return fail('review-failed', 'could not record the review');
          return ok({ at, ok: payload.ok });
        }
        case 'edit': {
          const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
          const content = typeof payload?.content === 'string' ? payload.content : '';
          if (!id) return fail('bad-request', 'id is required');
          if (!content.trim()) return fail('bad-request', 'content is required');
          if (content.length > MAX_WRITE_CHARS) return fail('bad-request', 'content is too long');
          const title = typeof payload?.title === 'string' ? payload.title.slice(0, 120) : undefined;
          const result = editNote(getStore(), { id, content, title });
          if (!result.ok) {
            if (result.reason === 'not_found') return fail('not-found', 'note not found');
            if (result.reason === 'too_long') return fail('too-long', 'content exceeds the 400-char note limit', { chars: result.chars, limit: result.limit });
            return fail('edit-failed', String(result.reason || 'edit failed'), result);
          }
          return ok(result);
        }
        case 'timeline': {
          if (typeof payload?.id !== 'string' || !payload.id.trim()) return fail('bad-request', 'id is required');
          const events = noteTimeline(getStore(), payload.id.trim());
          if (!events.length) {
            const exists = provenanceView(getStore(), payload.id.trim());
            if (!exists) return fail('not-found', 'note not found');
          }
          return ok({ id: payload.id.trim(), events });
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
