import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULTS = Object.freeze({
  enabled: true,
  storePath: '~/memory/tabellio',
  autoRecall: true,
  shadow: false,
  recallBudgetTokens: 500,
  recallMaxNotes: 6,
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
  capture: 'explicit',
  // How a recall reaches the model: 'notice' appends one visible user notice;
  // 'context' registers it as quiet runtime context in the system prompt.
  delivery: 'notice',
  // Optional relevance judge before injection: 'off' keeps lexical recall,
  // 'llm' asks one small host-model call to drop notes that only share words.
  judge: 'off',
  judgeProvider: '',
  judgeModel: '',
  judgeTimeoutMs: 4000,
  maxCandidatesPerTurn: 2,
  captureMaxSentenceChars: 240,
  // Background consolidation: 'off' keeps everything manual; 'daily'/'weekly'
  // run a near-duplicate sweep that writes merge proposals only. Approval stays
  // in the panel, so this never rewrites memory by itself.
  consolidate: 'off',
  // Optional local semantic layer: 'off' is pure BM25; 'local' builds a
  // background embedding index and adds the semantic hits BM25 missed. It
  // defaults off because it needs a local embedding endpoint.
  semantic: 'off',
  semanticEndpoint: 'http://127.0.0.1:8080/v1/embeddings',
  semanticModel: 'qwen3-embedding-0.6b',
  semanticMinSimilarity: 0.55,
  semanticTop: 8,
  semanticTimeoutMs: 2500,
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

/**
 * Normalize host config once, at the plugin boundary. A typo in `capture`
 * fails safe (off), not into "capture everything"; numeric bounds are clamped
 * so a bad config cannot blow up the context budget.
 */
export function normalizeConfig(config = {}) {
  const raw = config && typeof config === 'object' ? config : {};
  const captureRaw = raw.capture === undefined ? DEFAULTS.capture : raw.capture;
  const judge = raw.judge === 'llm' || raw.judge === true ? 'llm' : 'off';
  const judgeProvider = String(raw.judgeProvider ?? '').trim();
  const judgeModel = String(raw.judgeModel ?? '').trim();
  const consolidate = raw.consolidate === 'daily' || raw.consolidate === 'weekly' ? raw.consolidate : 'off';
  const semantic = raw.semantic === 'local' || raw.semantic === true ? 'local' : 'off';
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
    recallBudgetTokens: int(raw.recallBudgetTokens, DEFAULTS.recallBudgetTokens, 100, 4000),
    recallMaxNotes: int(raw.recallMaxNotes, DEFAULTS.recallMaxNotes, 1, 20),
    recallMinRelevance: ratio(raw.recallMinRelevance, DEFAULTS.recallMinRelevance),
    recallMinScore: ratio(raw.recallMinScore, DEFAULTS.recallMinScore),
    recallMinCoverage: ratio(raw.recallMinCoverage, DEFAULTS.recallMinCoverage),
    includeCore: raw.includeCore !== false,
    minQueryChars: int(raw.minQueryChars, DEFAULTS.minQueryChars, 2, 80),
    queryChars: int(raw.queryChars, DEFAULTS.queryChars, 80, 2000),
    refreshSeconds: int(raw.refreshSeconds, DEFAULTS.refreshSeconds, 0, 3600),
    recallIntentGate: raw.recallIntentGate === undefined ? DEFAULTS.recallIntentGate : raw.recallIntentGate === true,
    recallConfidentRelevance: ratio(raw.recallConfidentRelevance, DEFAULTS.recallConfidentRelevance),
    capture,
    delivery: raw.delivery === 'context' ? 'context' : 'notice',
    judge,
    judgeProvider,
    judgeModel,
    judgeTimeoutMs: int(raw.judgeTimeoutMs, DEFAULTS.judgeTimeoutMs, 500, 15000),
    maxCandidatesPerTurn: int(raw.maxCandidatesPerTurn, DEFAULTS.maxCandidatesPerTurn, 1, 5),
    captureMaxSentenceChars: int(raw.captureMaxSentenceChars, DEFAULTS.captureMaxSentenceChars, 40, 1000),
    consolidate,
    semantic,
    semanticEndpoint: String(raw.semanticEndpoint ?? '').trim() || DEFAULTS.semanticEndpoint,
    semanticModel: String(raw.semanticModel ?? '').trim() || DEFAULTS.semanticModel,
    semanticMinSimilarity: ratio(raw.semanticMinSimilarity, DEFAULTS.semanticMinSimilarity),
    semanticTop: int(raw.semanticTop, DEFAULTS.semanticTop, 1, 20),
    semanticTimeoutMs: int(raw.semanticTimeoutMs, DEFAULTS.semanticTimeoutMs, 300, 15000),
  };
}
