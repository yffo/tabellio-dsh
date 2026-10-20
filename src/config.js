import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULTS = Object.freeze({
  enabled: true,
  storePath: '~/memory/tabellio',
  autoRecall: true,
  shadow: false,
  // Turn a later correction into a ranking signal for the notes that were
  // injected right before it (local only; never deletes nor outvotes gates).
  outcomeFeedback: true,
  // Summarize the assistant's own conclusions into candidates (opt-in: a wrong
  // summary costs review time, so the default keeps the user in charge).
  captureAssistant: false,
  recallBudgetTokens: 500,
  recallMaxNotes: 6,
  // Context is a budget: only the first N notes carry their body, the rest
  // become pointers, and the rendered block stops at injectMaxChars.
  injectMaxChars: 1400,
  injectFullNotes: 2,
  injectRepeat: 'session',
  // Queries shorter than this (after stripping punctuation) with no number,
  // latin word or quoted text skip the ~2s judge call.
  judgeMinChars: 6,
  // Recall gates, in tabellio's own units (see tabellio `recall` docs).
  // The plugin default is tuned for auto-injection into ordinary conversation,
  // not for short CLI queries: a 796-note store answered 1/12 realistic
  // questions at coverage 0.6 but 6/12 at 0.3, because long natural questions
  // dilute the query-coverage ratio and get silently refused. These looser
  // values are then covered by the intent gate and the optional LLM judge.
  recallMinRelevance: 0.12,
  recallMinScore: 0.1,
  recallMinCoverage: 0.33,
  includeCore: true,
  minQueryChars: 4,
  queryChars: 400,
  refreshSeconds: 30,
  recallIntentGate: true,
  // A very strong lexical hit may skip the intent gate: blind eval (2026-10-19)
  // put ordinary work questions at relevance 0.93-0.98 while every off-topic
  // question in the same set stayed at or below 0.911.
  recallConfidentRelevance: 0.9,
  feedbackRanking: true,
  decayDays: 180,
  decayFloor: 0.6,
  // Imported reference documents carry trust 'external'. They stay searchable
  // from the panel and the tools, but auto-recall only injects what the user
  // stated or the system derived — otherwise 600+ docs drown ordinary chat.
  recallTrusts: ['user_stated', 'system_derived'],
  capture: 'explicit',
  // Auto-approval of the narrow T0 class (explicit "remember this" + durable +
  // single topic + no credential/conflict/authority). Off by default: the
  // adversarial corpus showed a naive version admitting 60.8% wrong memories.
  autoApprove: 'off',
  // How a recall reaches the model: 'notice' appends one visible user notice;
  // 'context' registers it as quiet runtime context in the system prompt.
  delivery: 'notice',
  // Relevance judge before injection: 'llm' asks one small host-model call to
  // drop notes that only share words; 'off' keeps raw lexical recall. Default
  // on: with a local host model the call is cheap and the precision gain is
  // the difference between "memory works" and "memory is noise".
  judge: 'llm',
  judgeProvider: '',
  judgeModel: '',
  judgeTimeoutMs: 4000,
  judgeCacheMinutes: 10,
  writeJudge: 'off',
  writeJudgeTimeoutMs: 2500,
  reflect: 'off',
  reflectDays: 14,
  reflectMaxNotes: 20,
  reflectTimeoutMs: 8000,
  maxCandidatesPerTurn: 2,
  captureMaxSentenceChars: 240,
  // Background consolidation: 'off' keeps everything manual; 'daily'/'weekly'
  // run a near-duplicate sweep that writes merge proposals only. Approval stays
  // in the panel, so this never rewrites memory by itself.
  consolidate: 'off',
  // Semantic supplement: 'auto' probes well-known local embedding endpoints and
  // falls back to lexical recall when none answers; 'local' pins the configured
  // endpoint/model; 'off' is pure BM25.
  semantic: 'auto',
  semanticEndpoint: 'http://127.0.0.1:8080/v1/embeddings',
  // Optional bearer token for a remote OpenAI-compatible embedding endpoint.
  // Prefer the TABELLIO_SEMANTIC_API_KEY environment variable; a key typed in
  // the panel is stored in panel-settings.json next to the store (plain text,
  // local file) and is never returned to the browser.
  semanticApiKey: '',
  semanticModel: 'qwen3-embedding-0.6b',
  semanticMinSimilarity: 0.55,
  semanticTop: 8,
  semanticTimeoutMs: 2500,
  semanticRefreshMinutes: 5,
});

export function expandHome(value) {
  const text = String(value ?? '').trim();
  // With an unset HOME, `homedir()` is empty; returning '' lets the caller
  // refuse to open a relative store instead of writing into the cwd.
  if (text === '~') return homedir() || '';
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    const home = homedir();
    return home ? join(home, text.slice(2)) : '';
  }
  return text;
}

const int = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
};

const ratio = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), 1);
};

// Only these three trust levels exist in tabellio. An unknown/empty list falls
// back to the safe default instead of silently disabling the filter.
const TRUST_LEVELS = new Set(['user_stated', 'system_derived', 'external']);
const trusts = (value) => {
  if (!Array.isArray(value)) return [...DEFAULTS.recallTrusts];
  const kept = [...new Set(value.filter((item) => TRUST_LEVELS.has(item)))];
  return kept.length ? kept : [...DEFAULTS.recallTrusts];
};

/**
 * Normalize host config once, at the plugin boundary. A typo in `capture`
 * fails safe (off), not into "capture everything"; numeric bounds are clamped
 * so a bad config cannot blow up the context budget.
 */
export function normalizeConfig(config = {}) {
  const raw = config && typeof config === 'object' ? config : {};
  const captureRaw = raw.capture === undefined ? DEFAULTS.capture : raw.capture;
  const judge = raw.judge === 'off' ? 'off' : 'llm';
  const judgeProvider = String(raw.judgeProvider ?? '').trim();
  const judgeModel = String(raw.judgeModel ?? '').trim();
  const consolidate = raw.consolidate === 'daily' || raw.consolidate === 'weekly' ? raw.consolidate : 'off';
  const semantic = raw.semantic === 'off' ? 'off' : raw.semantic === 'local' ? 'local' : 'auto';
  const capture = captureRaw === true
    ? 'explicit'
    : captureRaw === false
      ? 'off'
      : captureRaw === 'explicit' || captureRaw === 'implicit' || captureRaw === 'assist' || captureRaw === 'off'
        ? captureRaw
        : 'off';
  return {
    enabled: raw.enabled !== false,
    // Empty means "use the default", but the default itself must be expanded:
    // an unexpanded '~' would create a literal tilde directory under cwd.
    storePath: expandHome(raw.storePath ?? '') || expandHome(DEFAULTS.storePath),
    autoRecall: raw.autoRecall !== false,
    shadow: raw.shadow === true,
    outcomeFeedback: raw.outcomeFeedback !== false,
    captureAssistant: raw.captureAssistant === true,
    recallBudgetTokens: int(raw.recallBudgetTokens, DEFAULTS.recallBudgetTokens, 100, 4000),
    recallMaxNotes: int(raw.recallMaxNotes, DEFAULTS.recallMaxNotes, 1, 20),
    injectMaxChars: int(raw.injectMaxChars, DEFAULTS.injectMaxChars, 400, 6000),
    injectFullNotes: int(raw.injectFullNotes, DEFAULTS.injectFullNotes, 0, 10),
    judgeMinChars: int(raw.judgeMinChars, DEFAULTS.judgeMinChars, 0, 40),
    injectRepeat: raw.injectRepeat === 'off' || raw.injectRepeat === 'turn' ? raw.injectRepeat : 'session',
    recallMinRelevance: ratio(raw.recallMinRelevance, DEFAULTS.recallMinRelevance),
    recallMinScore: ratio(raw.recallMinScore, DEFAULTS.recallMinScore),
    recallMinCoverage: ratio(raw.recallMinCoverage, DEFAULTS.recallMinCoverage),
    includeCore: raw.includeCore !== false,
    minQueryChars: int(raw.minQueryChars, DEFAULTS.minQueryChars, 2, 80),
    queryChars: int(raw.queryChars, DEFAULTS.queryChars, 80, 2000),
    refreshSeconds: int(raw.refreshSeconds, DEFAULTS.refreshSeconds, 0, 3600),
    recallIntentGate: raw.recallIntentGate === undefined ? DEFAULTS.recallIntentGate : raw.recallIntentGate === true,
    recallConfidentRelevance: ratio(raw.recallConfidentRelevance, DEFAULTS.recallConfidentRelevance),
    feedbackRanking: raw.feedbackRanking === undefined ? DEFAULTS.feedbackRanking : raw.feedbackRanking === true,
    decayDays: int(raw.decayDays, DEFAULTS.decayDays, 0, 3650),
    decayFloor: ratio(raw.decayFloor, DEFAULTS.decayFloor),
    recallTrusts: trusts(raw.recallTrusts),
    autoApprove: raw.autoApprove === 't0' ? 't0' : 'off',
    capture,
    delivery: raw.delivery === 'context' ? 'context' : 'notice',
    judge,
    judgeProvider,
    judgeModel,
    judgeTimeoutMs: int(raw.judgeTimeoutMs, DEFAULTS.judgeTimeoutMs, 500, 15000),
    judgeCacheMinutes: int(raw.judgeCacheMinutes, DEFAULTS.judgeCacheMinutes, 0, 1440),
    writeJudge: raw.writeJudge === 'llm' || raw.writeJudge === true ? 'llm' : 'off',
    writeJudgeTimeoutMs: int(raw.writeJudgeTimeoutMs, DEFAULTS.writeJudgeTimeoutMs, 500, 15000),
    reflect: raw.reflect === 'llm' || raw.reflect === true ? 'llm' : 'off',
    reflectDays: int(raw.reflectDays, DEFAULTS.reflectDays, 1, 90),
    reflectMaxNotes: int(raw.reflectMaxNotes, DEFAULTS.reflectMaxNotes, 3, 50),
    reflectTimeoutMs: int(raw.reflectTimeoutMs, DEFAULTS.reflectTimeoutMs, 1000, 30000),
    maxCandidatesPerTurn: int(raw.maxCandidatesPerTurn, DEFAULTS.maxCandidatesPerTurn, 1, 5),
    captureMaxSentenceChars: int(raw.captureMaxSentenceChars, DEFAULTS.captureMaxSentenceChars, 40, 1000),
    consolidate,
    semantic,
    semanticEndpoint: String(raw.semanticEndpoint ?? '').trim() || DEFAULTS.semanticEndpoint,
    semanticModel: String(raw.semanticModel ?? '').trim() || DEFAULTS.semanticModel,
    semanticMinSimilarity: ratio(raw.semanticMinSimilarity, DEFAULTS.semanticMinSimilarity),
    semanticTop: int(raw.semanticTop, DEFAULTS.semanticTop, 1, 20),
    semanticTimeoutMs: int(raw.semanticTimeoutMs, DEFAULTS.semanticTimeoutMs, 300, 15000),
    semanticRefreshMinutes: int(raw.semanticRefreshMinutes, DEFAULTS.semanticRefreshMinutes, 0, 1440),
  };
}
