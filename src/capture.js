/**
 * Candidate extraction from a real user message.
 *
 * Three modes share one filter pipeline:
 *   explicit  — the user says it out loud ("记住…", "以后都…") or corrects a
 *               prior decision ("不对，应该用 pnpm");
 *   implicit  — corrections only, the quiet "you got that wrong" that people
 *               never label as a memory;
 *   assist    — explicit/implicit plus statement-form conventions ordinary
 *               people use without any cue word ("线上库只读", "周二发版").
 *
 * Everything here only produces candidates under notes/candidates/. A human
 * still approves them; the point is to *notice* a settled fact, not to trust
 * it blindly.
 */

const CUE_PATTERNS = [
  /记住|帮我记|记一下|别忘了|别忘记|要记得/,
  /(以后|今后|下次|往后|从现在开始|从今以后)[^。！？!?]{0,30}(都|要|别|不要|用|按|先|直接|一律|尽量)/,
  /(?:我|我们)(?:比较)?(?:喜欢|偏好|习惯|决定|约定|倾向)/,
  /(?:我|我们)(?:比较)?(?:希望|要求|想要)[^。！？!?]{0,24}(?:以后|今后|长期|都|一律|始终|每次|默认|统一)/,
  /(始终|总是|一律|默认|统一)/,
  /(改用|改成|换成|别再|别用|不要再用|以后用)/,
  /\b(?:remember|keep in mind|note that|don't forget)\b/i,
  /\b(?:from now on|going forward|in the future)\b/i,
  /\b(?:i|we)\s+(?:prefer|like|always|usually|decided|agreed|want|need)\b/i,
  /\bdefault to\b/i,
];

/** Corrections are memory too: they settle what the old answer got wrong. */
const CORRECTION_PATTERNS = [
  /不对[，,、]?\s*(?:应该|要|是|得|用|按)/,
  /(?:说|写|搞|弄|记)错(?:了)?/,
  /不是[^。！？!?]{1,40}而是/,
  /(?:应该|得)(?:是|用|按|写|放|走|先)/,
  /(?:改成|改为|换成|改用|纠正|更正|修正)/,
  /错在/,
  /(?:之前|刚才|前面|上次)(?:说|讲|提|写|记)[^。！？!?]{0,40}(?:其实|实际|是|都)/,
  /(?:记混|搞混|说反|记岔|写反|弄反)/,
  /不是[^。！？!?]{1,40}(?:，|,)?\s*(?:应该|要|得|按|改)/,
  /不是[^。！？!?]{1,40}(?:，|,)\s*是/,
  /(?:原来|之前|以前)[^。！？!?]{1,40}(?:现在|如今)[^。！？!?]{0,20}(?:习惯|喜欢|用|改)/,
  /不(?:喜欢|想要|再用)/,
];

/**
 * Statement-form conventions: the largest gap in ordinary-user testing (78
 * rounds: 27/33 explicit misses had no cue at all). These patterns require a
 * normative shape (都/一律/只/必须/别/不/优先/发版), not just a common word.
 */
const ASSIST_PATTERNS = [
  /(?:我|我们)[^。！？!?]{0,12}(?:一般|平时|平常|通常|大多|很少)/,
  /(?:必须(?!今天|现在|马上|尽快|立刻|先)|只允许|只能|只读|只写|禁止|不允许|不得|至少(?!跑|看|试|做|改|读))/,
  /(?:所有|全部|任何)[^。！？!?]{0,20}(?:都|一律)(?:用|按|走|要|得|是|存|放|必须|需要|保持)/,
  /(?:约定|规范|规矩)/,
  /统一(?!一下)/,
  /别(?:用|引|放|加|写|提交|排|发|存|混|把|让)/,
  /不(?:放到?|排|引|提交|加|存|再|允许)/,
  /(?:不要|不能|不得|不准)(?:写进?|提交|放到?|存在?|外发|共享|贴)/,
  /[A-Za-z][\w.@/-]*\s*优先/,
  /(?:一直|长期|始终)(?:在?用|在?走|按)(?:着|上)?/,
  /只(?:接受|允许|面向|服务|支持|限|收)/,
  /不能(?:挂|用|进|做|报|超过|低于|登|发|带|吃)/,
  /优先(?:迁就|协调|考虑|安排|处理|保证|满足|级)/,
  /^用\s*[A-Za-z][\w.@/-]*$/,
  /(?:我|我们|咱们)[^。！？!?]{0,16}(?:用|走)\s*[A-Za-z]/,
  /(?:都|一律|统一)(?:走|用|按|提交|放)/,
  /不(?:用|写|碰|动|提交)\s*[A-Za-z]/,
  /每(?:学期|季度|月|周|天|年|个)[^。！？!?]{0,24}(?:做|发|交|报|盘|开|跑|执行|对账|汇总|检查|排|安排)/,
  /周[一二三四五六日天][^。！？!?]{0,24}(?:发版|发布|上线|修|不排|freeze)/,
  /^用\s*[A-Za-z][\w.@/-]*$/,
  /\b(?:we|i)\s+(?:use|run|deploy|write|keep)\b/i,
  /\b(?:always|never)\b/i,
  /\bdon'?t\s+(?:add|use|commit|put|write|push)\b/i,
];

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/i,
  /(?:password|passwd|token|secret|api[_-]?key|密码|口令|密钥)\s*(?:是|为|[:=])\s*\S+/i,
];

const SECRET_HINT = /(密码|口令|密钥|私钥|\btoken\b|api[ _-]?key|secret|password|passwd|凭据|凭证)/i;

/**
 * Credential policy vs credential value (corpus run, 2026-10-19): blocking any
 * sentence that mentions credentials also dropped five legitimate policy
 * statements ("密码放 1Password"). Only an *assigned value* is a leak; a
 * sentence that merely says where secrets live is safe to remember.
 */
const ASSIGNED_SECRET =
  /(?:密码|口令|密钥|私钥|token|secret|password|passwd|api[ _-]?key)[^。；;！？!?\n]{0,14}?\s*(?:统一|一律|都|先|就)?\s*(?:用|放|存|放到?|存在?|设成|设置成|改成|改为|换成|是|为|=|:|：)?\s*([A-Za-z0-9][A-Za-z0-9!@#$%^&*_+\-./]{5,})/gi;
const PLACEHOLDER_VALUE =
  /^(?:1Password|Vault|OIDC|\.env|env|环境变量|占位|keychain|KMS|bitwarden|secret\s*manager|注入|临时|配置|密钥库|保险箱|密码管理器|团队库|公司库|个人库|vault)/i;
const CREDENTIAL_POLICY = /(?:以后|今后|统一|一律|都|别|不要|禁止|只|必须|放|存|用|走|贴|发|提交|共享|轮换|过期|由|管理|托管|交给|保管)/;
const BARE_VALUE = /\b[A-Za-z0-9][A-Za-z0-9!@#$%^&*_+\-./]{5,}\b/g;

/**
 * A token that looks like an actual secret: at least one letter and one digit,
 * no placeholder word. Covers "token 放 1Password，实际值 Abc123xyz" and
 * "测试库密码 Hunter2", where the value follows the hint without 是/为/:=.
 */
function looksLikeBareSecretValue(text) {
  for (const match of String(text ?? '').matchAll(BARE_VALUE)) {
    const token = match[0];
    if (PLACEHOLDER_VALUE.test(token)) continue;
    if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) continue;
    if (/^\d+$/.test(token)) continue;
    return true;
  }
  return false;
}

/** True when the sentence carries an actual credential value (not a policy). */
export function isCredentialValue(text) {
  const value = String(text ?? '');
  for (const match of value.matchAll(ASSIGNED_SECRET)) {
    if (!PLACEHOLDER_VALUE.test(match[1])) return true;
  }
  return hasSecretHint(value) && looksLikeBareSecretValue(value);
}

export function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasSecretHint(text) {
  return SECRET_HINT.test(String(text ?? ''));
}

/** True when a sentence mentions credentials but states no credential value. */
export function isCredentialPolicy(text) {
  return hasSecretHint(text) && !isCredentialValue(text) && CREDENTIAL_POLICY.test(String(text ?? ''));
}

/** One gate for both auto-capture and the capture tool: never persist a value. */
export function looksLikeCredentialLeak(text) {
  const value = String(text ?? '');
  if (containsSecret(value)) return true;
  return hasSecretHint(value) && !isCredentialPolicy(value);
}

/** Implicit corrections must carry a normative word, or "写错了，重来" is noise. */
const IMPLICIT_SHAPE = /(不对|错了|不是[^。！？!?]{1,40}而是|应该|别|不要|必须|统一|一律|都|习惯|偏好)/;

/** One-off scoping ("这次/本轮/今天先…") marks a transient instruction, not a convention. */
const TIME_SCOPED = /(这次|本轮|本次|这一轮|这版|这期|这款|这个版本|当前版本|今天|今晚|暂时|先这样|一会儿|等会|\bfor (?:now|this (?:run|task|time|session|one))\b)/i;
const PERMANENT = /(以后|今后|长期|一律|始终|永久|从现在开始|从今以后)/;

/** Words that turn a change verb into a durable convention rather than a one-off tweak. */
const DURABLE = /(以后|今后|长期|一律|始终|永久|从现在开始|从今以后|每次|所有|统一|默认|规范|约定)/;
const VALUE_REPLACE = /(改成|改为|换成)/;
/** A sentence that names the old decision and then changes it is durable, not a one-off. */
const PRIOR_STATEMENT = /(?:之前|刚才|前面|上次|原来)[^。！？!?]{0,40}(?:说|讲|提|写|记|是|用)/;
/** "先别用 X" is a transient instruction for this task, not a convention. */
const TRANSIENT = /(?:先|暂时|临时)[^。！？!?]{0,6}(?:别用|别再用|不要用|别动|别弄)/;
/** "应该/得" also appears in one-off advice; require contrast with what happened before. */
const CORR_CONTEXT = /(不对|错了|不是[^。！？!?]{1,40}而是|之前|刚才|其实|本来)/;

/** Delegation wording ("让子代理…写错了再回来") is an instruction to someone else, not a settled fact. */
const DELEGATED = /(让|请|叫|派)[^。！？!?]{0,12}(子代理|子任务|它|他|她)/;

const HYPOTHETICAL = /要不要|是不是|是否|该不该|能不能|可不可以|会不会|有没有|如果|假如|假设|要是/;
const QUESTION_TAIL = /(?:[?？]\s*$)|(?:(?:吗|嘛|么|呢)[。！!？?]*\s*$)|(?:(?:怎么样|如何|好不好|行不行|对不对)[。！!？?]*\s*$)/;
const CHOICE_QUESTION = /(?:用|选|走|上|开|配|改|设|放)\s*[^。！？!?]{1,20}\s*还是\s*[^。！？!?]{1,20}$/;
const DEFERRAL = /(?:以后|回头|之后|改天)(?:再|在)?(?:说|聊|讲|议|看)/;

export function clip(text, max) {
  const chars = [...String(text ?? '')];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

export function splitSentences(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const out = [];
  for (const line of normalized.split(/\n+/)) {
    const chunks = line.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [];
    for (const chunk of chunks) {
      const sentence = chunk.trim();
      if (sentence) out.push(sentence);
    }
  }
  return out;
}

export function isQuestion(text) {
  return QUESTION_TAIL.test(String(text ?? '').trim());
}

export function isHypothetical(text) {
  return HYPOTHETICAL.test(String(text ?? ''));
}

export function isChoiceQuestion(text) {
  return CHOICE_QUESTION.test(String(text ?? '').trim());
}

export function isDeferral(text) {
  return DEFERRAL.test(String(text ?? ''));
}

export function cueOf(text) {
  for (const pattern of CUE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

function correctionCueOf(text) {
  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (/^(?:应该|得)/.test(match[0]) && !CORR_CONTEXT.test(text)) continue;
    return match[0];
  }
  return null;
}

function assistCueOf(text) {
  for (const pattern of ASSIST_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/** Cue plus where it came from; the shape gate only applies to corrections. */
function matchCue(text, mode) {
  const explicit = cueOf(text);
  if (explicit) return { cue: explicit, source: 'explicit' };
  const correction = correctionCueOf(text);
  if (correction) return { cue: correction, source: 'correction' };
  if (mode === 'assist') {
    const statement = assistCueOf(text);
    if (statement) return { cue: statement, source: 'statement' };
  }
  return null;
}

/** Explicit cue, or (implicit/assist) a correction/statement cue. */
export function cueOfMode(text, mode = 'explicit') {
  return matchCue(text, mode)?.cue ?? null;
}

const normalize = (text) => String(text ?? '').toLowerCase().replace(/[\s。！？!?；;，,、：:]+/gu, '');

/**
 * Rank matches by how strongly they read as a durable preference. When more
 * sentences qualify than the per-turn budget allows, the ones with an explicit
 * "remember / from now on" cue must survive the cut.
 */
export function strengthOf(sentence) {
  if (/记住|帮我记|记一下|别忘了|别忘记/.test(sentence)) return 3;
  if (PERMANENT.test(sentence) || /(一律|始终|统一|规范|约定|默认)/.test(sentence)) return 2;
  return 1;
}

export function extractCandidates(text, { max = 2, maxChars = 240, mode = 'explicit' } = {}) {
  if (mode !== 'explicit' && mode !== 'implicit' && mode !== 'assist') return [];
  // Fail closed for the whole message, not per sentence: splitting on "！"
  // can strand a credential fragment ("Abc123!@#" -> "@#…") that no
  // sentence-level detector recognises. Safety beats partial recall here.
  if (looksLikeCredentialLeak(String(text ?? ''))) return [];
  const limit = Math.max(1, Math.min(Number(max) || 2, 5));
  const chars = Math.max(40, Number(maxChars) || 240);
  const hits = [];
  const seen = new Set();
  let position = 0;
  for (const sentence of splitSentences(text)) {
    const at = position;
    position += 1;
    if ([...sentence].length > chars) continue;
    if (isQuestion(sentence) || isChoiceQuestion(sentence)) continue;
    // "如果脚本失败，每次都要先看日志" is a durable conditional rule; a bare
    // "如果明天有空" stays out. Only an explicit recurrence marker lifts it.
    if (isHypothetical(sentence) && !/(?:每次|每当|一律)/.test(sentence)) continue;
    if (isDeferral(sentence)) continue;
    if (looksLikeCredentialLeak(sentence)) continue;
    if (TIME_SCOPED.test(sentence) && !PERMANENT.test(sentence)) continue;
    if (TRANSIENT.test(sentence) && !PERMANENT.test(sentence)) continue;
    // "把背景改成 #0b0b0c" is a one-off parameter; "统一改成 pnpm" or "记住…" is durable.
    if (VALUE_REPLACE.test(sentence) && !DURABLE.test(sentence) && !PRIOR_STATEMENT.test(sentence) && !/记住|帮我记|记一下|别忘了/.test(sentence)) {
      continue;
    }
    // One-off delegation ("让子代理修链接，写错了回来问我") is not a convention;
    // "以后都让子代理先跑 lint" is.
    if (DELEGATED.test(sentence) && !DURABLE.test(sentence) && !/(?:都|一律|每次)/.test(sentence)) continue;
    const matched = matchCue(sentence, mode);
    if (!matched) continue;
    if (matched.source === 'correction' && mode === 'implicit' && !IMPLICIT_SHAPE.test(sentence)) continue;
    const key = normalize(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    hits.push({ at, rank: strengthOf(sentence), sentence });
  }
  hits.sort((a, b) => b.rank - a.rank || a.at - b.at);
  return hits.slice(0, limit).map(({ sentence }) => {
    const title = `会话记忆：${clip(sentence, 28)}`;
    return { sentence, title, body: `# ${title}\n\n${sentence}` };
  });
}
