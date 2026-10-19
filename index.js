/**
 * tabellio-dsh — DSH host adapter for the tabellio memory core.
 *
 * Division of labour:
 *   - tabellio owns the truth (markdown notes, index, write gates, receipts,
 *     consolidation, budgets, refusal semantics).
 *   - this plugin owns host lifecycle only: native tools, one budgeted recall
 *     block per user turn, and explicit-clue candidates at turn end.
 *
 * It never writes a formal note directly. Captured text is a candidate and a
 * human approves it with `tabellio inbox`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { addCandidate, listCandidates, openStore, recallQuery } from 'tabellio';
import { normalizeConfig } from './src/config.js';
import { delegationDepth, isHumanMessage, isChitchat, latestHuman, textOf, trimQuery, intentGateAllows } from './src/messages.js';
import { extractCandidates, hasSecretHint, looksLikeCredentialLeak } from './src/capture.js';
import { filterByJudge } from './src/judge.js';
import { formatRecall } from './src/render.js';
import { createRpcHandler } from './src/rpc.js';
import { mountPanelRoute } from './src/web-rpc.js';
import { registerTools } from './src/tools.js';
import { startConsolidationTimer } from './src/consolidate.js';
import { appendAudit } from './src/audit.js';

export const name = 'tabellio-dsh';

/** Native tools need the host tools service. Nothing else is required. */
export const inject = ['tools'];

/** Durable producer id used in the injected message source. */
const PRODUCER = 'tabellio-dsh';
const MAX_SEEN_MESSAGES = 500;
const MAX_CAPTURED_MESSAGES = 200;

export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config);
  if (!settings.enabled) return;
  if (!settings.storePath || !settings.storePath.trim()) {
    ctx.logger?.warn?.('tabellio-dsh: storePath is empty; plugin disabled');
    return;
  }

  // One store context per plugin instance. Invalidate its scan cache on a
  // small interval so edits made by the CLI or another host become visible
  // without paying a full scan on every turn.
  const store = openStore(settings.storePath);
  let lastRefresh = 0;
  const currentStore = () => {
    const age = Date.now() - lastRefresh;
    if (settings.refreshSeconds === 0 || age >= settings.refreshSeconds * 1000) {
      store.invalidate();
      lastRefresh = Date.now();
    }
    return store;
  };

  // The panel's "last recall" line: why a turn did or did not get memory.
  // Process-local on purpose — it describes this session's latest decision, not
  // the store's durable history (receipts in runs/ cover that).
  let lastRecall = null;

  // Every recall branch funnels through here: it records the outcome for the
  // panel and appends one compact audit line so a user can later ask why a
  // turn did or did not get memory. Auditing must never break the turn.
  const recordRecall = (entry) => {
    lastRecall = entry;
    try {
      appendAudit(currentStore(), entry);
    } catch (error) {
      ctx.logger?.debug?.('tabellio-dsh: recall audit skipped: ' + (error?.message ?? error));
    }
    return entry;
  };
  const recallTitles = (value) => (Array.isArray(value?.items)
    ? value.items.slice(0, 3).map((item) => String(item.title ?? item.id ?? '').slice(0, 40)).filter(Boolean)
    : []);

  registerTools(ctx, { settings, getStore: currentStore, getLastRecall: () => lastRecall });

  // Diagnostics for the panel: why the judge did or did not run. Declared
  // before the panel channel so the RPC handler always reads the live object;
  // a silent fail-open is right for the turn, but impossible to debug from
  // the outside (2026-10-19: status reported judge off because the handler
  // was created without this getter).
  const judgeState = { mode: settings.judge, host: 'none', selection: null, last: null };

  // Optional panel channel: the browser memory tab reads status and reviews
  // candidates through this handler. The browser posts a `client-request` to
  // `<channel>/<endpoint>` on the page origin, so the channel is an HTTP route
  // served by the host web carrier. `webServer` is optional: a host without a
  // browser carrier keeps tools and lifecycle, and the inject callback simply
  // stays inactive. Declaring the dependency (instead of a bare ctx.get probe)
  // is what lets Cordis hand over the carrier even when it activates late.
  try {
    const rpcHandler = createRpcHandler({ settings, getStore: currentStore, getLastRecall: () => lastRecall, getJudgeState: () => judgeState });
    const mountRoute = (hostCtx) => {
      try {
        const dispose = mountPanelRoute(hostCtx, rpcHandler);
        if (typeof dispose !== 'function') {
          hostCtx.logger?.warn?.('tabellio-dsh: webServer is active but the panel route was not registered');
          return () => {};
        }
        return dispose;
      } catch (error) {
        hostCtx.logger?.warn?.('tabellio-dsh: panel route mount failed: ' + (error?.message ?? error));
        return () => {};
      }
    };
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (hostCtx) => {
        hostCtx.effect(() => mountRoute(hostCtx), 'tabellio-dsh: panel route');
      });
    } else {
      const dispose = mountRoute(ctx);
      ctx.effect?.(() => dispose, 'tabellio-dsh: panel route');
    }
  } catch (error) {
    ctx.logger?.warn?.('tabellio-dsh: panel channel unavailable: ' + (error?.message ?? error));
  }

  // Optional background consolidation: while the session is idle, look for
  // near-duplicate notes and write merge proposals. Nothing is applied here —
  // the panel's proposal review is still the only approval path.
  if (settings.consolidate !== 'off') {
    const stopTimer = startConsolidationTimer({ getStore: currentStore, settings, logger: ctx.logger });
    if (typeof stopTimer === 'function') ctx.effect?.(() => stopTimer, 'tabellio-dsh: consolidation timer');
  }

  // Optional quiet delivery: instead of appending a visible user notice, the
  // last recall is registered as runtime context in the system prompt. The
  // provider is host-scoped, so on a single-user desktop only the latest recall
  // is live (documented limitation); 'notice' remains the default.
  let latestRecallText = '';
  // Ordinary users do not open settings on their own, so a queue of candidates
  // would sit unseen forever. Mention it in the quiet context at most once per
  // six hours; approval still happens only in the panel. The nudge is a line of
  // text, not a second write path.
  const CANDIDATE_NOTICE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  let lastCandidateNoticeAt = 0;
  const candidateNotice = () => {
    try {
      const count = (listCandidates(currentStore())?.candidates ?? []).length;
      if (count === 0) return '';
      if (Date.now() - lastCandidateNoticeAt < CANDIDATE_NOTICE_COOLDOWN_MS) return '';
      lastCandidateNoticeAt = Date.now();
      return `tabellio 记忆库有 ${count} 条候选待批准：打开设置页「记忆」，逐条确认要不要入库。`;
    } catch {
      return '';
    }
  };
  if (settings.autoRecall && settings.delivery === 'context') {
    const registerQuietContext = (promptCtx) => {
      try {
        // Read the service as a property when this context declares it; older
        // hosts without ctx.inject fall back to a bare ctx.get probe.
        const prompt = promptCtx?.systemPrompt ?? (typeof promptCtx?.get === 'function' ? promptCtx.get('systemPrompt') : undefined);
        const dispose = prompt?.context?.({
          name: 'tabellio.recall',
          order: 800,
          text: () => {
            const recall = latestRecallText;
            const notice = candidateNotice();
            if (!recall) return notice;
            if (!notice) return recall;
            return recall + '\n\n' + notice;
          },
        });
        if (typeof dispose !== 'function') {
          ctx.logger?.warn?.('tabellio-dsh: quiet context is active but the recall slot was not registered');
        }
      } catch (error) {
        ctx.logger?.warn?.('tabellio-dsh: quiet context unavailable: ' + (error?.message ?? error));
      }
    };
    // `systemPrompt` is optional: declaring it keeps tools working on hosts
    // where the service activates late, instead of silently disabling delivery.
    if (typeof ctx.inject === 'function') {
      ctx.inject(['systemPrompt'], (promptCtx) => {
        promptCtx.effect?.(() => {
          registerQuietContext(promptCtx);
          return () => {};
        }, 'tabellio-dsh: quiet context');
      });
    } else {
      registerQuietContext(ctx);
    }
  }

  /** Per-agent state: dedupe is per conversation, not global. */
  const states = new Map();
  const anonymousKeys = new WeakMap();
  let anonymousSeq = 0;
  const keyFor = (agent) => {
    if (agent?.id !== undefined && agent?.id !== null && String(agent.id) !== '') return 'agent:' + String(agent.id);
    // Hosts that do not expose agent.id still need per-conversation isolation:
    // a shared "unknown" bucket would let one session capture another's text.
    if (agent?.session?.id) return 'session:' + String(agent.session.id);
    if (agent && typeof agent === 'object') {
      let generated = anonymousKeys.get(agent);
      if (!generated) {
        anonymousSeq += 1;
        generated = 'anon#' + anonymousSeq;
        anonymousKeys.set(agent, generated);
      }
      return generated;
    }
    return 'detached#' + randomUUID();
  };
  const stateFor = (agent) => {
    const key = keyFor(agent);
    let state = states.get(key);
    if (!state) {
      state = {
        seen: new Set(),
        captured: new Set(),
        lastUser: null,
        lastInjectedKey: '',
      };
      states.set(key, state);
    }
    return state;
  };

  // The judge is opt-in. Provider/model come from the plugin config or the
  // host's default model selection; without either, judging is skipped.
  // Declared lazily so judge-capable hosts hand over `llm`/`agentDefaultModel`
  // even when those services activate after the plugin; hosts without them just
  // keep lexical recall (the judge stays off).
  let judgeHost = null;
  if (settings.judge === 'llm' && typeof ctx.inject === 'function') {
    ctx.inject(['llm', 'agentDefaultModel'], (sub) => {
      sub.effect?.(() => {
        judgeHost = {
          llm: sub.llm,
          currentSelection: () => sub.agentDefaultModel?.currentSelection?.(),
        };
        judgeState.host = 'inject';
        try {
          const selection = judgeHost.currentSelection();
          judgeState.selection = selection ? { provider: selection.provider ?? '', model: selection.model ?? '' } : null;
        } catch {
          judgeState.selection = null;
        }
        return () => {
          judgeHost = null;
        };
      }, 'tabellio-dsh: judge host');
    });
  }
  const judgeRuntime = () => {
    if (settings.judge !== 'llm') {
      judgeState.last = { at: Date.now(), stage: 'off' };
      return null;
    }
    let selection = null;
    if (settings.judgeProvider && settings.judgeModel) {
      selection = { provider: settings.judgeProvider, model: settings.judgeModel };
    } else {
      try {
        const current = judgeHost?.currentSelection?.() ?? ctx.get?.('agentDefaultModel')?.currentSelection?.();
        if (current?.provider && current?.model) selection = { provider: current.provider, model: current.model };
      } catch {
        // A host without the service just keeps lexical recall.
      }
    }
    if (!selection) {
      judgeState.last = { at: Date.now(), stage: 'no_selection' };
      return null;
    }
    try {
      const llm = judgeHost?.llm ?? ctx.get?.('llm');
      if (!llm?.stream) {
        judgeState.last = { at: Date.now(), stage: 'no_llm' };
        return null;
      }
      judgeState.selection = { provider: selection.provider, model: selection.model };
      return { llm, selection };
    } catch {
      judgeState.last = { at: Date.now(), stage: 'no_llm' };
      return null;
    }
  };

  const trimSet = (set, limit) => {
    while (set.size > limit) set.delete(set.values().next().value);
  };

  const sessionRef = (agent) => {
    const sessionId = agent?.session?.id;
    return sessionId ? 'dsh:session:' + sessionId : 'dsh:agent:' + (agent?.id ?? 'unknown');
  };

  const writeCandidates = (candidates, source, where) => {
    let written = 0;
    const failedItems = [];
    for (const candidate of candidates) {
      // Second gate, right before persistence: extractCandidates already drops
      // credential-bearing messages, but the tool path and future callers share
      // this writer, so never let a secret reach notes/candidates/.
      if (looksLikeCredentialLeak(candidate.body ?? candidate.sentence ?? '')) {
        ctx.logger?.info?.('tabellio-dsh: capture dropped a candidate that looks like a credential value');
        continue;
      }
      try {
        const result = addCandidate(
          currentStore(),
          {
            text: candidate.body,
            source,
            kind: 'semantic',
            tags: ['dsh', 'auto-capture'],
          },
          { writtenBy: 'capture:dsh' },
        );
        if (result?.ok) written += 1;
        // Already present means the write succeeded on an earlier boundary;
        // counting it as a failure would retry (and warn) forever.
        else if (result?.reason === 'duplicate') written += 1;
        else failedItems.push(candidate);
      } catch (error) {
        failedItems.push(candidate);
        // Capture is best-effort: a broken store must not fail a turn.
        ctx.logger?.warn?.('tabellio-dsh: capture failed at ' + where + ': ' + (error?.message ?? error));
      }
    }
    if (failedItems.length > 0) {
      ctx.logger?.warn?.(
        'tabellio-dsh: ' + failedItems.length + ' of ' + candidates.length + ' candidates were not written at ' + where + ' (store read-only or full?)',
      );
    }
    return { written, failedItems };
  };

  const captureFrom = (agent, where) => {
    if (settings.capture === 'off') return 0;
    // Delegated agents get prompts like "you are a read-only scout"; capturing
    // those as user preferences is noise. Only the main conversation qualifies.
    if (delegationDepth(agent) > 0) return 0;
    const state = states.get(keyFor(agent));
    if (!state) return 0;

    const source = sessionRef(agent);
    let written = 0;

    // A previous boundary may have written some candidates and failed on others.
    // Retry only the failed ones, so a success is never duplicated.
    if (Array.isArray(state.pendingCandidates) && state.pendingCandidates.length > 0) {
      const retry = writeCandidates(state.pendingCandidates, state.pendingSource || source, where + ':retry');
      written += retry.written;
      state.pendingCandidates = retry.failedItems;
      if (state.pendingCandidates.length === 0) state.pendingSource = null;
    }

    if (!state.lastUser) return written;

    const messageId = state.lastUser.messageId;
    const text = state.lastUser.text;
    state.lastUser = null;
    if (state.captured.has(messageId)) return written;

    const found = extractCandidates(text, {
      max: settings.maxCandidatesPerTurn,
      maxChars: settings.captureMaxSentenceChars,
      mode: settings.capture,
    });
    if (found.length === 0) {
      // Fail closed on credentials, but say so: silent drops look like the
      // feature is broken ("I told it my token policy and nothing happened").
      if (hasSecretHint(text)) {
        ctx.logger?.info?.('tabellio-dsh: capture skipped a message that mentions credentials (fail-closed)');
      }
      state.captured.add(messageId);
      trimSet(state.captured, MAX_CAPTURED_MESSAGES);
      return written;
    }

    const result = writeCandidates(found, source, where);
    written += result.written;
    if (result.failedItems.length > 0) {
      state.pendingCandidates = result.failedItems;
      state.pendingSource = source;
    }
    // Retry on the next boundary only when nothing was written; the text is put
    // back for the disposal pass to pick up.
    if (result.written > 0 || result.failedItems.length === 0) {
      state.captured.add(messageId);
      trimSet(state.captured, MAX_CAPTURED_MESSAGES);
    } else {
      state.lastUser = { messageId, text };
    }
    return written;
  };

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision?.kind !== 'enter' || !Array.isArray(decision.messages)) return decision;

    const human = latestHuman(decision.messages);
    if (!human) return decision;

    // A fresh turn starts without remembered context; a hit on this turn is the
    // only thing that may repopulate the quiet context slot. Clear before the
    // delegation guard so a child agent cannot inherit the parent's recall text
    // through the host-level context slot.
    if (settings.delivery === 'context' && !settings.shadow) latestRecallText = '';

    // Delegated agents start from a role prompt, not from the user's own words.
    // Recalling user memory into a scout prompt (and writing a shadow receipt for
    // it) pollutes the store and adds cost with no upside.
    if (delegationDepth(payload?.agent) > 0) return decision;

    const state = stateFor(payload?.agent);
    const raw = textOf(human);
    const messageId = String(human.id ?? '') || ('anon:' + createHash('sha1').update(raw).digest('hex').slice(0, 16));
    state.lastUser = { messageId, text: raw };

    if (state.seen.has(messageId)) return decision;
    state.seen.add(messageId);
    trimSet(state.seen, MAX_SEEN_MESSAGES);

    if (!settings.autoRecall) return decision;

    const query = trimQuery(raw, settings.queryChars);
    if (!query || [...query].length < settings.minQueryChars || isChitchat(query)) return decision;

    try {
      const recallStartedAt = Date.now();
      const result = recallQuery(currentStore(), query, {
        // Leave a little room for the wrapper and titles.
        budgetTokens: Math.max(100, settings.recallBudgetTokens - 64),
        maxNotes: settings.recallMaxNotes,
        includeCore: settings.includeCore,
        minRelevance: settings.recallMinRelevance,
        minScore: settings.recallMinScore,
        minCoverage: settings.recallMinCoverage,
        // Shadow mode records the same recall as a durable receipt in the
        // store (runs/rcp_*.json), so an A/B can be replayed with
        // `tabellio explain --receipt`, without touching the turn.
        saveReceipt: settings.shadow,
      });

      if (settings.shadow) {
        state.lastShadow = {
          query,
          at: Date.now(),
          refused: Boolean(result?.refused),
          hits: Array.isArray(result?.items) ? result.items.map((item) => item.id) : [],
          receiptPath: result?.receiptPath ?? null,
        };
        lastRecall = recordRecall({
          at: Date.now(),
          query,
          mode: 'shadow',
          refused: Boolean(result?.refused),
          count: Array.isArray(result?.items) ? result.items.length : 0,
          reason: result?.reason ?? null,
          titles: recallTitles(result),
          elapsedMs: Date.now() - recallStartedAt,
          receiptPath: result?.receiptPath ?? null,
        });
        ctx.logger?.info?.('tabellio-dsh: shadow recall recorded (' + (result?.refused ? 'refused' : (result?.items?.length ?? 0) + ' hit(s)') + ')');
        return decision;
      }

      if (result?.refused || !Array.isArray(result?.items) || result.items.length === 0) {
        lastRecall = recordRecall({
          at: Date.now(),
          query,
          mode: 'refused',
          refused: true,
          count: 0,
          reason: result?.reason ?? 'no_hits',
          titles: [],
          receiptPath: result?.receiptPath ?? null,
        });
        return decision;
      }

      // Injection is the expensive, trust-costing path: a lexically-matched but
      // irrelevant note is worse than silence. Questions that do not refer to
      // our own history skip injection even when recall found a hit.
      const gateVerdict = intentGateAllows(query, {
        gate: settings.recallIntentGate,
        topRelevance: Number(result.items[0]?.relevance ?? 0),
        confidentRelevance: settings.recallConfidentRelevance,
      });
      if (!gateVerdict.allowed) {
        lastRecall = recordRecall({
          at: Date.now(),
          query,
          mode: 'suppressed',
          refused: false,
          count: result.items.length,
          reason: gateVerdict.reason ?? 'no_memory_intent',
          titles: recallTitles(result),
          elapsedMs: Date.now() - recallStartedAt,
          receiptPath: result.receiptPath ?? null,
        });
        ctx.logger?.debug?.('tabellio-dsh: recall suppressed (no memory intent): ' + query.slice(0, 60));
        return decision;
      }

      // Optional LLM judge: lexical matches that merely share words with the
      // question are dropped before they cost trust. A failed judge keeps the
      // original hits (the model call must never remove memory by breaking).
      let judged = false;
      const runtime = judgeRuntime();
      if (runtime) {
        const judgeStartedAt = Date.now();
        let judgeReply = '';
        const filtered = await filterByJudge({
          ...runtime,
          query,
          items: result.items,
          maxNotes: settings.recallMaxNotes,
          store: currentStore(),
          timeoutMs: settings.judgeTimeoutMs,
          signal: payload?.signal,
          onReply: (text) => { judgeReply = text; },
        });
        judged = filtered.judged;
        judgeState.last = filtered.judged
          ? { at: Date.now(), stage: 'verdict', kept: filtered.items.length, elapsedMs: Date.now() - judgeStartedAt }
          : {
            at: Date.now(),
            stage: 'no_verdict',
            notes: result.items.length,
            elapsedMs: Date.now() - judgeStartedAt,
            // Keep the raw reply preview: a silent fail-open must be explainable.
            preview: judgeReply.slice(0, 200),
            chars: judgeReply.length,
          };
        if (filtered.judged && filtered.items.length === 0) {
          lastRecall = recordRecall({
            at: Date.now(),
            query,
            mode: 'judged_out',
            refused: false,
            count: 0,
            reason: 'llm_judge_kept_none',
            titles: [],
            receiptPath: result.receiptPath ?? null,
          });
          return decision;
        }
        result.items = filtered.items;
      }

      const text = formatRecall(result);
      if (!text) return decision;
      const key = result.items.map((item) => item.id).join('\u0000');

      if (settings.delivery === 'context') {
        // Quiet delivery: the model sees the recall as system context; the
        // conversation keeps no visible plugin message.
        latestRecallText = text;
        state.lastInjectedKey = key;
        lastRecall = recordRecall({
          at: Date.now(),
          query,
          mode: 'context',
          refused: false,
          count: result.items.length,
          reason: judged ? 'llm_judge' : null,
          judged,
          titles: recallTitles(result),
          elapsedMs: Date.now() - recallStartedAt,
          receiptPath: result.receiptPath ?? null,
        });
        return decision;
      }

      if (state.lastInjectedKey === key) {
        lastRecall = recordRecall({
          at: Date.now(),
          query,
          mode: 'deduped',
          refused: false,
          count: result.items.length,
          reason: 'same_notes_as_last_time',
          titles: recallTitles(result),
          elapsedMs: Date.now() - recallStartedAt,
          receiptPath: result.receiptPath ?? null,
        });
        return decision;
      }
      state.lastInjectedKey = key;
      lastRecall = recordRecall({
        at: Date.now(),
        query,
        mode: 'notice',
        refused: false,
        count: result.items.length,
        reason: judged ? 'llm_judge' : null,
        judged,
        titles: recallTitles(result),
        elapsedMs: Date.now() - recallStartedAt,
        receiptPath: result.receiptPath ?? null,
      });

      return {
        ...decision,
        messages: [
          ...decision.messages,
          {
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text }],
            source: {
              kind: 'plugin:' + PRODUCER,
              form: 'notice',
              summary: 'tabellio 召回 ' + result.items.length + ' 条',
            },
          },
        ],
      };
    } catch (error) {
      // Recall is best-effort: never break the turn.
      lastRecall = recordRecall({
        at: Date.now(),
        query,
        mode: 'error',
        refused: false,
        count: 0,
        reason: error?.message ?? String(error),
        titles: [],
        receiptPath: null,
      });
      ctx.logger?.warn?.('tabellio-dsh: recall failed: ' + (error?.message ?? error));
      return decision;
    }
  });

  // Turn end is the normal capture boundary. The event is serial and carries
  // { turn, signal, agent }; we only need the agent to find its pending text.
  ctx.on('agent/turn-stopping', (payload) => {
    try {
      captureFrom(payload?.agent, 'turn-stopping');
    } catch (error) {
      ctx.logger?.warn?.('tabellio-dsh: capture boundary failed: ' + (error?.message ?? error));
    }
  });

  // Disposal catches aborted turns that never reached turn-stopping. It also
  // releases the per-agent state so long-lived hosts do not grow forever.
  ctx.on('agent/disposed', (payload) => {
    try {
      captureFrom(payload?.agent, 'disposed');
    } catch (error) {
      ctx.logger?.warn?.('tabellio-dsh: disposal capture failed: ' + (error?.message ?? error));
    } finally {
      states.delete(keyFor(payload?.agent));
    }
  });
}
