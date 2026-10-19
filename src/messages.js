/** Chat pleasantries and acknowledgements that should not trigger a search. */
export const CHITCHAT = /^(?:继续|接着|再说|然后呢|嗯+|哦+|好(?:的|吧|啊)?|行|可以|谢谢|多谢|收到|明白|了解|没问题|ok|okay|continue|go on|thanks|thank you|yes|no|yep|nope)[。，,.！!？?~～\s]*$/iu;

export function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/** DSH marks genuine user input with source.kind === 'user'. */
export function isHumanMessage(message) {
  return message?.role === 'user' && message?.source?.kind === 'user';
}

export function latestHuman(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isHumanMessage(messages[i])) return messages[i];
  }
  return null;
}

export function isChitchat(text) {
  return CHITCHAT.test(String(text ?? '').trim());
}

/** Keep the head's topic sentences and the tail; middle pasted bodies are noise. */
/**
 * Memory-intent gate: does this question plausibly refer to something we
 * stored (a past decision, a convention, a name), rather than to the world in
 * general? Recall can match off-topic questions against unrelated notes by
 * pure lexical coincidence, so injection requires one of these markers.
 */
const MEMORY_INTENT = /(上次|上回|之前|以前|早先|刚才|我们|咱们|我的|约定|惯例|流程|规则|偏好|习惯|决定|说过|讲过|提过|提到|记录过|笔记|记忆|备忘录|代号|名字|叫什么|怎么定|来龙去脉|历史|当时)/;

export function hasMemoryIntent(text) {
  return MEMORY_INTENT.test(String(text ?? ''));
}

/**
 * Decide whether an ordinary question may receive recalled memory. A genuine
 * history reference passes; a very strong lexical hit (blind eval: work
 * questions 0.93+, off-topic questions <=0.911) may also pass; everything else
 * waits for a clearer question.
 */
export function intentGateAllows(query, { gate = true, topRelevance = 0, confidentRelevance = 0.92 } = {}) {
  if (!gate) return { allowed: true, reason: null };
  if (hasMemoryIntent(query)) return { allowed: true, reason: 'memory_intent' };
  if (Number(topRelevance) >= Number(confidentRelevance)) return { allowed: true, reason: 'confident_hit' };
  return { allowed: false, reason: 'no_memory_intent' };
}

export function trimQuery(raw, maxChars = 400) {
  const text = String(raw ?? '').trim();
  const limit = Math.max(80, Number(maxChars) || 400);
  if ([...text].length <= limit) return text;
  const half = Math.floor(limit / 2);
  const headPart = text
    .slice(0, half * 2)
    .split(/(?<=[。！？!?\n])/)
    .slice(0, 3)
    .join('')
    .slice(0, half);
  return `${headPart}\n${text.slice(-half)}`;
}

export function delegationDepth(agent) {
  return Math.max(Number(agent?.session?.header?.delegationDepth) || 0, Number(agent?.options?.subagentDepth) || 0);
}
