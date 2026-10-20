// Risk tiering for candidates: which ones may be stored without a per-item
// human click, and which must always pass a person. The default is off; when
// enabled only the narrow T0 class is written automatically, and every other
// candidate keeps the existing flow.
//
// The classifier is deterministic and fail-closed: anything it cannot prove is
// safe becomes T1 (batch review) or T2 (must read the original). It never
// deletes, updates, or merges; auto-approval only creates a new note.

import { tokensOf } from './conflicts.js';
import { hasSecretHint, looksLikeCredentialLeak } from './capture.js';

export const MAX_AUTO_CHARS = 400;
export const MIN_AUTO_CHARS = 12;

// "Remember this" is an explicit instruction from the user. Only this class is
// eligible for T0; descriptive conventions ("we use pnpm") stay T1.
const EXPLICIT_REMEMBER = /(记住|帮我记|帮我记一下|记一下|记下来|记下这|记得|别忘了记|remember this|remember that|note this down)/i;
const DURABLE = /(以后都|以后|今后|长期|永久|始终|一律|统一|每次|永远|所有|全部|from now on|always|permanently)/i;
const ONE_OFF = /(明天|今天|今晚|这周|本周|下周|这个月|本月|下个月|这次|本轮|这一轮|暂时|临时|先这样|仅限|到此为止|一会儿|等会|回头再说|明天再说)/;
const QUESTION = /(吗？|吗\?|呢？|\?$|？$|怎么样|如何是好|是否|能不能|可不可以)/;
const CORRECTION = /(不对|错了|不是[^。！？!?]{1,40}而是|应该是|改成|改为)/;
const AUTHORITY = /(我是杨总|我是老板|我是管理员|我是开发者|跳过审批|跳过批准|忽略你|忽略之前|忽略以上|忽略规则|收到.*规则|系统指令|管理员权限|直接入库|直接执行|不用批准|无需批准|不用确认|无需确认)/i;
const IMPERSONATION = /(从现在开始你|你现在是|扮演|角色设定|system prompt)/i;
// Privacy or compliance exposure is never a quiet auto-approval, even when the
// sentence looks like a stable convention.
const DATA_SHARING = /(第三方|对外提供|共享给|上传到|发送到外部|发给外部)/;
// Personal taste dressed as a durable rule: keep it for review, do not ingest.
const OPINION = /(比[^。！？!?]{1,20}好|更好|最好|优于|不如)/;
const IMPERATIVE = /(不要|别|禁止|必须|统一|一律|一律|先|都要|只用|不许|不能|需要先|锁死)/;

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Split a candidate into sentences for a single-topic check. */
export function sentencesOf(text) {
  return clean(text)
    .split(/[。！？!?；;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function conflictReason(store, text) {
  if (!store || typeof store.scan !== 'function') return null;
  const tokens = new Set(tokensOf(text));
  if (tokens.size < 4) return null;
  let best = null;
  try {
    // An empty/uninitialised store has no notes to conflict with; only a real
    // read failure is treated as "cannot verify".
    if (typeof store.exists === 'function' && !store.exists()) return null;
    for (const entry of store.scan()) {
      if (entry.note?.status && entry.note.status !== 'active') continue;
      if (entry.note?.trust === 'external') continue;
      const other = new Set(tokensOf(entry.note?.body ?? ''));
      if (other.size < 4) continue;
      let shared = 0;
      for (const token of tokens) if (other.has(token)) shared += 1;
      const overlap = shared / tokens.size;
      if (!best || overlap > best.overlap) best = { overlap, id: entry.note.id };
    }
  } catch {
    return 'conflict check unavailable';
  }
  if (best && best.overlap >= 0.6) return 'similar note exists (' + best.id + ', overlap ' + best.overlap.toFixed(2) + ')';
  return null;
}

/**
 * Classify one candidate sentence.
 * @returns {{tier: 't0'|'t1'|'t2', reasons: string[]}}
 */
export function classifyText(text, { store = null, checkConflict = true } = {}) {
  const body = clean(text);
  const reasons = [];
  const tier = (value, reason) => {
    if (reason) reasons.push(reason);
    return value;
  };

  if (!body) return { tier: 't1', reasons: ['empty'] };
  if (body.length < MIN_AUTO_CHARS || body.length > MAX_AUTO_CHARS) {
    return { tier: 't1', reasons: [body.length > MAX_AUTO_CHARS ? 'too long for one note' : 'too short'] };
  }
  if (AUTHORITY.test(body) || IMPERSONATION.test(body)) return { tier: 't2', reasons: ['authority or role manipulation'] };
  if (hasSecretHint(body) || looksLikeCredentialLeak(body)) return { tier: 't2', reasons: ['credential content'] };
  if (DATA_SHARING.test(body)) return { tier: 't2', reasons: ['external data sharing'] };
  if (ONE_OFF.test(body)) return { tier: 't1', reasons: ['time scoped'] };
  if (OPINION.test(body)) return { tier: 't1', reasons: ['personal opinion, not a rule'] };
  if (QUESTION.test(body)) return { tier: 't1', reasons: ['question, not a statement'] };
  if (CORRECTION.test(body)) return { tier: 't1', reasons: ['correction needs context'] };
  const sentences = sentencesOf(body);
  if (sentences.length > 2) return { tier: 't1', reasons: ['multi-topic'] };
  const explicitCue = EXPLICIT_REMEMBER.test(body);
  // "以后都…" plus an imperative is itself an explicit durable instruction.
  const durableImperative = DURABLE.test(body) && IMPERATIVE.test(body);
  if (!explicitCue && !durableImperative) return { tier: 't1', reasons: ['no explicit remember instruction'] };
  // Even an explicit "remember" without any durable wording can be a one-off;
  // require one durable marker or a second clause that states the rule.
  if (!DURABLE.test(body) && !/[：:]\s*.+/.test(body)) {
    return { tier: 't1', reasons: ['explicit cue but no durable intent'] };
  }
  if (checkConflict) {
    const conflict = conflictReason(store, body);
    if (conflict) return { tier: 't2', reasons: [conflict] };
  }
  return { tier: 't0', reasons };
}

/**
 * Decide how a captured sentence should be handled.
 * autoApprove: 'off' keeps every candidate for review; 't0' lets explicit,
 * durable, single-topic statements be stored with an `auto-approved` tag.
 */
export function routeCandidate(text, { store = null, autoApprove = 'off' } = {}) {
  const verdict = classifyText(text, { store });
  if (autoApprove === 't0' && verdict.tier === 't0') return { ...verdict, action: 'auto' };
  return { ...verdict, action: 'candidate' };
}
