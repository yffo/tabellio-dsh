// Optional write-side worthiness check ("is this worth remembering?").
//
// Capture already filters on cues (explicit promises, corrections, standing
// conventions) and on secrets/length. That is a recall-oriented filter: it
// decides "is this phrased like a memory", not "will this matter in six
// weeks". When `writeJudge: 'llm'` is on, one small model call asks the second
// question before a candidate is written. Failures keep the candidates: the
// model may reduce noise, it must never silently drop a real memory.
export const WORTH_TIMEOUT_MS = 2500;
const SNIPPET_CHARS = 240;

export function buildWorthPrompt(candidates) {
  const lines = candidates.map((candidate, index) => {
    const text = String(candidate?.sentence ?? candidate?.body ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
    return `[${index + 1}] ${text}`;
  });
  return [
    'You are the write gate of a personal memory store.',
    'For each numbered candidate, decide whether it is a durable fact, preference or rule',
    'that will still matter weeks later. Reject: one-off task state, temporary parameters,',
    'small talk, credentials, and anything the user did not actually settle on.',
    'Answer with JSON only: {"keep":[1,2]} — empty array when none of them deserve saving.',
    '',
    'Candidates:',
    ...lines,
  ].join('\n');
}

/** Tolerant parser: JSON/fenced JSON, or "1 yes / 2 no" lines. Null = no verdict. */
export function parseWorthReply(reply, count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  const text = String(reply ?? '').trim();
  if (!text) return null;

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const list = Array.isArray(parsed?.keep) ? parsed.keep : Array.isArray(parsed?.worth) ? parsed.worth : null;
      if (list) {
        const kept = new Set();
        let integers = 0;
        for (const item of list) {
          const n = Number(item);
          if (!Number.isInteger(n)) continue;
          integers += 1;
          if (n >= 1 && n <= count) kept.add(n - 1);
        }
        return integers > 0 && kept.size === 0 ? null : kept;
      }
    } catch {
      // Fall through to the line format.
    }
  }

  const kept = new Set();
  let seen = false;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\[?(\d{1,3})\]?\s*[:.)-]?\s*(yes|no|true|false|是|否)/i.exec(line);
    if (!match) continue;
    const n = Number(match[1]);
    if (n < 1 || n > count) continue;
    seen = true;
    if (/yes|true|是/i.test(match[2])) kept.add(n - 1);
  }
  return seen ? kept : null;
}

/**
 * Ask the host model which candidates to keep. Returns a Set of kept indices,
 * or null when the check is unavailable or failed (caller keeps everything).
 */
export async function judgeWorth({ llm, selection, candidates, timeoutMs = WORTH_TIMEOUT_MS, signal, onReply }) {
  if (!llm || typeof llm.stream !== 'function') return null;
  if (!selection?.provider || !selection?.model) return null;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));

  try {
    const chunks = llm.stream({
      provider: selection.provider,
      model: selection.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildWorthPrompt(candidates) }] }],
      maxTokens: 256,
      temperature: 0,
      signal: controller.signal,
    });

    let reply = '';
    for await (const chunk of chunks) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text;
      if (chunk?.type === 'finish') break;
    }
    try {
      onReply?.(reply);
    } catch {
      // Diagnostics must never affect the turn.
    }
    return parseWorthReply(reply, candidates.length);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/** Filter candidates by the worthiness verdict. `judged:false` keeps them all. */
export async function filterCandidatesByWorth({ candidates, ...rest }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return { candidates: [], judged: false };
  const kept = await judgeWorth({ candidates, ...rest });
  if (!kept) return { candidates, judged: false };
  return { candidates: candidates.filter((_, index) => kept.has(index)), judged: true };
}
