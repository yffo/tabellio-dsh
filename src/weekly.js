/**
 * One compact "how did memory behave this week" view for the panel and tools.
 * It reads only local logs; nothing here calls a model or the network.
 */
import { readAuditSince, summarizeAudit } from './audit.js';
import { usageSummary } from './usage.js';
import { judgeQuality, judgeTrend } from './judge-log.js';
import { buildReport } from './report.js';
import { readConflictState } from './conflicts.js';
import { feedbackSummary } from 'tabellio';

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildWeekly(store, { days = 7, now = Date.now() } = {}) {
  const windowDays = Math.max(1, Math.min(31, Math.floor(Number(days) || 7)));
  const since = now - windowDays * DAY_MS;
  const audit = summarizeAudit(readAuditSince(store, since));
  const usage = usageSummary(store, { days: windowDays, now });
  const judge = judgeQuality(store, { days: windowDays, now });
  const report = buildReport(store, { days: windowDays, limit: 0, now });
  const feedback = feedbackSummary(store, { days: windowDays, now });
  return {
    days: windowDays,
    since: new Date(since).toISOString(),
    recall: {
      runs: audit.total,
      byMode: audit.byMode,
      judge: audit.judge,
    },
    context: {
      injected: usage.injected,
      chars: usage.chars,
      tokensEst: usage.tokensEst,
    },
    judgeTrend: judgeTrend(store, { weeks: 4, now }),
    judge: {
      calls: judge.total,
      reviewed: judge.reviewed,
      agreed: judge.agreed,
    },
    feedback: feedback.counts ?? { useful: 0, wrong: 0, stale: 0, corrected: 0 },
    notes: {
      total: report.notes_total,
      added: report.notes_added,
    },
    conflicts: readConflictState(store),
  };
}

export function renderWeekly(weekly) {
  const modes = weekly.recall.byMode ?? {};
  const injected = (modes.context ?? 0) + (modes.notice ?? 0);
  const kept = weekly.recall.judge?.kept ?? 0;
  const dropped = weekly.recall.judge?.dropped ?? 0;
  return [
    `近 ${weekly.days} 天：召回 ${weekly.recall.runs} 次，注入 ${injected} 次（约 ${weekly.context.tokensEst} token），裁决保留 ${kept}、丢弃 ${dropped}。`,
    `judge 调用 ${weekly.judge.calls} 次，复核 ${weekly.judge.reviewed} 次（同意 ${weekly.judge.agreed}）。`,
    `新增记忆 ${weekly.notes.added} 条，库 ${weekly.notes.total} 条；这周你用过的反馈：有用 ${weekly.feedback.useful}、不对 ${weekly.feedback.wrong}、过时 ${weekly.feedback.stale}、纠正 ${weekly.feedback.corrected}。`,
  ].join('\n');
}
