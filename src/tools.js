import { addCandidate, applyContentConsolidation, consolidate, listCandidates, proposeConsolidation, read, recallQuery, reviewCandidates, search, status, recordFeedback, feedbackSummary } from 'tabellio';
import { findConflicts } from './conflicts.js';
import { formatRecallTool } from './render.js';
import { buildReport, renderReport } from './report.js';
import { looksLikeCredentialLeak } from './capture.js';
const SIGNALS = new Set(['useful', 'wrong', 'stale']);
import { editNote } from './edit.js';

const jsonText = (_args, value) => [{ type: 'text', text: JSON.stringify(value) }];
const plainText = (text) => [{ type: 'text', text }];

const captureMessage = (result) => {
  if (result?.ok) return '已收为候选 [' + result.id + ']「' + (result.title || result.id) + '」（' + (result.chars ?? 0) + ' 字）。未进正式记忆；运行 tabellio inbox 批准。';
  switch (result?.reason) {
    case 'empty':
      return '内容为空，未收为候选。';
    case 'too_large':
      return '内容超过单条上限（' + (result.bytes ?? '?') + ' 字节），未收为候选。';
    case 'duplicate':
      return '库里已有相同内容（' + (result.duplicate_of?.id ?? '已存在') + '），未重复收为候选。';
    case 'id_exists':
      return '候选 id 已存在，未重复写入。';
    case 'invalid_id':
      return '候选 id 不合法，未写入。';
    case 'store_write_failed':
      return '候选写入失败；检查库目录权限。';
    case 'invalid_tags':
      return '标签超出上限（最多 8 个、每个 40 字、合计 300 字），未收为候选。';
    case 'invalid_source':
      return '来源标签过长（上限 160 字），未收为候选。';
    default:
      return '未收为候选：' + (result?.reason || 'unknown') + '。';
  }
};

const normalizeCandidateText = (content) => {
  const text = String(content ?? '').trim();
  if (!text) return '';
  if (/^---\s*\n/.test(text) || /^#{1,6}\s+/.test(text)) return text;
  const first = text.split(/\n/)[0].trim();
  const chars = [...first];
  const title = chars.slice(0, 28).join('') + (chars.length > 28 ? '…' : '');
  return '# 会话记忆：' + (title || '片段') + '\n\n' + text;
};
// tabellio's write gate caps one note at 400 chars; a longer candidate can
// never be approved (the gate answers too_long), so refuse it at capture time.
const MAX_CANDIDATE_CHARS = 400;
// tabellio@0.1.5 only understands `asOfMs`; accept human date strings and parse
// them here so the tool contract can stay `as_of: string`.
const asOfMs = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : NaN;
};


/**
 * Build the native tool definitions. They are thin projections over the same
 * tabellio API the CLI/MCP use, so budgets, refusal and gates cannot drift.
 */
export function createToolDefinitions({ settings, getStore, getLastRecall = () => null }) {
  const lastRecallView = () => {
    const last = getLastRecall?.();
    if (!last || typeof last !== 'object') return { mode: 'none', at: 0, query: '', count: 0, reason: '', titles: [] };
    return {
      mode: String(last.mode ?? 'none'),
      at: Number(last.at) || 0,
      query: String(last.query ?? '').slice(0, 60),
      count: Number(last.count) || 0,
      reason: String(last.reason ?? ''),
      titles: Array.isArray(last.titles) ? last.titles.map(String).slice(0, 3) : [],
    };
  };

  const recallMode = () => (!settings.autoRecall ? 'off' : settings.shadow ? 'shadow' : 'inject');
  return [
    {
      name: 'tabellio_recall',
      description:
        'Recall budgeted long-term memory from the local tabellio store, with note bodies. ' +
        'Use it before answering questions about past decisions, preferences, conventions or project history. ' +
        'A refusal is a normal, first-class result: it means no memory cleared the relevance/budget gate. ' +
        'This is local and read-only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you are trying to remember, in the user language.' },
          budgetTokens: { type: 'integer', description: 'Optional token budget (default from config, capped 4000).' },
          maxNotes: { type: 'integer', description: 'Optional maximum notes (1-20).' },
          as_of: { type: 'string', description: 'Optional ISO date/time: answer as the store stood then (expired and future notes drop out).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            store: { type: 'string' },
            ok: { type: 'boolean' },
            refused: { type: 'boolean' },
            reason: { type: 'string' },
            query: { type: 'string' },
            tokens: { type: 'integer' },
            budget_tokens: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                  kind: { type: 'string' },
                  trust: { type: 'string' },
                  scope: { type: 'string' },
                },
                required: ['id', 'title', 'content', 'kind', 'trust', 'scope'],
                additionalProperties: false,
              },
            },
            note: { type: 'string' },
          },
          required: ['store', 'ok', 'refused', 'reason', 'query', 'tokens', 'budget_tokens', 'items', 'note'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(formatRecallTool({ ...value, items: value.items, refused: value.refused, reason: value.reason })),
      },
      async execute(args) {
        const query = String(args?.query ?? '').trim();
        const storePath = getStore().store;
        if (!query) {
          return { store: storePath, ok: false, refused: true, reason: 'empty_query', query: '', tokens: 0, budget_tokens: settings.recallBudgetTokens, items: [], note: 'query 不能为空' };
        }
        try {
          const result = recallQuery(getStore(), query, {
            budgetTokens: Math.max(100, Math.min(Number(args?.budgetTokens) || settings.recallBudgetTokens, 4000)),
            maxNotes: Math.max(1, Math.min(Number(args?.maxNotes) || settings.recallMaxNotes, 20)),
            includeCore: settings.includeCore,
            ...(asOfMs(args?.as_of) !== null ? { asOfMs: asOfMs(args.as_of) } : {}),
          });
          return {
            store: storePath,
            ok: !result.refused,
            refused: Boolean(result.refused),
            reason: String(result.reason ?? ''),
            query,
            tokens: Number(result.tokens) || 0,
            budget_tokens: Number(result.budget?.requested) || settings.recallBudgetTokens,
            items: (result.items ?? []).map((item) => ({
              id: String(item.id),
              title: String(item.title ?? ''),
              content: String(item.content ?? ''),
              kind: String(item.kind ?? ''),
              trust: String(item.trust ?? ''),
              scope: String(item.scope ?? ''),
            })),
            note: result.refused ? '拒答：' + (result.reason ?? '未达阈值') : '内容来自本地 markdown；引用时保留 id。',
          };
        } catch (error) {
          return { store: storePath, ok: false, refused: true, reason: 'recall_failed', query, tokens: 0, budget_tokens: settings.recallBudgetTokens, items: [], note: String(error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_search',
      description:
        'Search the local tabellio memory store and return note pointers (id/title/score), not bodies. ' +
        'Use it when auto-recall missed or when you need candidate titles before opening one with tabellio_read. ' +
        'It matches wording, not meaning; rephrase once before concluding it is absent. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords in the user language.' },
          limit: { type: 'integer', description: 'Maximum hits (default 8, max 30).' },
          as_of: { type: 'string', description: 'Optional ISO date/time: search as of that moment.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            store: { type: 'string' },
            hits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  score: { type: 'number' },
                },
                required: ['id', 'title', 'score'],
                additionalProperties: false,
              },
            },
            tokens: { type: 'integer' },
            refused: { type: 'boolean' },
            reason: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['store', 'hits', 'tokens', 'refused', 'reason', 'note'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(
          value.hits.length
            ? value.hits.map((hit) => hit.id + '\t' + hit.score.toFixed(3) + '\t' + hit.title).join('\n') + '\n用 tabellio_read 打开需要的 id。'
            : '没有命中：' + (value.reason || '换个说法再搜一次'),
        ),
      },
      async execute(args) {
        const query = String(args?.query ?? '').trim();
        const store = getStore();
        if (!query) return { store: store.store, hits: [], tokens: 0, refused: true, reason: 'empty_query', note: 'query 不能为空' };
        try {
          const result = search(store, query, {
            maxNotes: Math.max(1, Math.min(Number(args?.limit) || 8, 30)),
            ...(asOfMs(args?.as_of) !== null ? { asOfMs: asOfMs(args.as_of) } : {}),
          });
          return {
            store: store.store,
            hits: (result.hits ?? []).map((hit) => ({ id: String(hit.id), title: String(hit.title ?? ''), score: Number(hit.score) || 0 })),
            tokens: Number(result.tokens) || 0,
            refused: Boolean(result.refused),
            reason: String(result.reason ?? ''),
            note: '这只是指针；正文用 tabellio_read。',
          };
        } catch (error) {
          return { store: store.store, hits: [], tokens: 0, refused: true, reason: 'search_failed', note: String(error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_read',
      description:
        'Read one note from the local tabellio store by id. Use after tabellio_search or tabellio_recall. Read-only.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Note id returned by search/recall.' } },
        required: ['id'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            path: { type: 'string' },
            warnings: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
          },
          required: ['ok', 'id', 'title', 'body', 'path', 'warnings', 'error'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(value.ok ? value.body : '读不到 ' + value.id + '：' + value.error),
      },
      async execute(args) {
        const id = String(args?.id ?? '').trim();
        if (!id) return { ok: false, id: '', title: '', body: '', path: '', warnings: [], error: 'id 不能为空' };
        try {
          const result = read(getStore(), id);
          return {
            ok: Boolean(result.ok),
            id,
            title: String(result.title ?? ''),
            body: String(result.body ?? ''),
            path: String(result.path ?? ''),
            warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
            error: result.ok ? '' : String(result.reason ?? result.error?.code ?? 'not_found'),
          };
        } catch (error) {
          return { ok: false, id, title: '', body: '', path: '', warnings: [], error: String(error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_status',
      description:
        'Inspect the local tabellio memory store: note/candidate/proposal counts, index freshness, parse failures and warnings. ' +
        'Read-only. Use it to tell the user whether memory is healthy or waiting for approval.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            store: { type: 'string' },
            exists: { type: 'boolean' },
            notes: { type: 'integer' },
            candidates: { type: 'integer' },
            proposals: { type: 'integer' },
            index_exists: { type: 'boolean' },
            index_stale: { type: 'boolean' },
            parse_failures: { type: 'integer' },
            warnings: { type: 'array', items: { type: 'string' } },
            recall_mode: { type: 'string', enum: ['inject', 'shadow', 'off'] },
            last_recall: {
              type: 'object',
              properties: {
                mode: { type: 'string' },
                at: { type: 'integer' },
                query: { type: 'string' },
                count: { type: 'integer' },
                reason: { type: 'string' },
                titles: { type: 'array', items: { type: 'string' } },
              },
              required: ['mode', 'at', 'query', 'count', 'reason', 'titles'],
              additionalProperties: false,
            },
            message: { type: 'string' },
          },
          required: ['store', 'exists', 'notes', 'candidates', 'proposals', 'index_exists', 'index_stale', 'parse_failures', 'warnings', 'recall_mode', 'last_recall', 'message'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(
          [
            '库：' + value.store,
            (value.exists ? '库存在' : '尚未创建') + '；笔记 ' + value.notes + ' 条；候选 ' + value.candidates + ' 条；提案 ' + value.proposals + ' 条。',
            '索引：' + (value.index_exists ? (value.index_stale ? '旧了' : '正常') : '未生成') + '；解析失败 ' + value.parse_failures + ' 个。',
            '召回模式：' + ({ inject: '注入', shadow: '影子（只记回执不注入）', off: '关闭' }[value.recall_mode] ?? value.recall_mode) + '。',
            value.last_recall.mode === 'none'
              ? '上次召回：本进程还没有执行过召回。'
              : '上次召回：' + value.last_recall.mode + (value.last_recall.reason ? '（' + value.last_recall.reason + '）' : '') + '，命中 ' + value.last_recall.count + ' 条。',
            ...(value.warnings.length ? ['警告：', ...value.warnings.map((warning) => '- ' + warning)] : []),
          ].join('\n'),
        ),
      },
      async execute() {
        const store = getStore();
        try {
          const result = status(store);
          return {
            store: store.store,
            exists: store.exists(),
            notes: Number(result.notes) || 0,
            candidates: Number(result.candidates) || 0,
            proposals: Number(result.proposals) || 0,
            index_exists: Boolean(result.indexExists),
            index_stale: Boolean(result.indexStale),
            parse_failures: Number(result.parseFailures) || 0,
            warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
            recall_mode: recallMode(),
            last_recall: lastRecallView(),
            message: result.notes === 0 ? '库是空的；还没有正式记忆。' : '只读体检完成。',
          };
        } catch (error) {
          return {
            store: store.store,
            exists: false,
            notes: 0,
            candidates: 0,
            proposals: 0,
            index_exists: false,
            index_stale: false,
            parse_failures: 0,
            warnings: [String(error?.message ?? error)],
            recall_mode: recallMode(),
            last_recall: lastRecallView(),
            message: 'status 失败',
          };
        }
      },
    },
    {
      name: 'tabellio_capture',
      description:
        'Propose something for long-term memory. This writes a candidate under notes/candidates/ only; it does NOT enter formal memory ' +
        'and does NOT affect recall until a human runs tabellio inbox and approves it. Use it for stable preferences, decisions, ' +
        'conventions or facts the user explicitly wants remembered. Do not capture speculation, secrets, or every conversational detail. ' +
        'Text mentioning credentials (password/token/API key/private key) is rejected.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The memory text. Prefer one self-contained fact, with a short markdown heading.' },
          source: { type: 'string', description: 'Optional provenance label (default: dsh:tool).' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        },
        required: ['content'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            reason: { type: 'string' },
            id: { type: 'string' },
            title: { type: 'string' },
            chars: { type: 'integer' },
            source: { type: 'string' },
            path: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['ok', 'reason', 'id', 'title', 'chars', 'source', 'path', 'message'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(value.message),
      },
      async execute(args) {
        const content = normalizeCandidateText(args?.content);
        if (!content) {
          return { ok: false, reason: 'empty', id: '', title: '', chars: 0, source: '', path: '', message: '内容为空，未收为候选。' };
        }
        // Candidates are written to disk in plain text before review, so the
        // tool path must apply the same credential gate as auto-capture.
        if (looksLikeCredentialLeak(content)) {
          return { ok: false, reason: 'secret_detected', id: '', title: '', chars: 0, source: '', path: '', message: '内容含凭据线索（密码/密钥/token/私钥等），未收为候选；请只记录「用哪个保管器」，不要记录密钥本身。' };
        }
        const source = String(args?.source ?? 'dsh:tool').trim() || 'dsh:tool';
        const tags = Array.isArray(args?.tags) ? args.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
        // source and tags land in candidate frontmatter too, so they get the
        // same credential gate and size limits as the body.
        const invalid = (reason, message) => ({ ok: false, reason, id: '', title: '', chars: 0, source: '', path: '', message });
        if ((source && looksLikeCredentialLeak(source)) || tags.some((tag) => looksLikeCredentialLeak(tag))) {
          return invalid('secret_detected', 'source/tags 含凭据线索，未收为候选；把凭据放到保管器里，只记「用哪个保管器」。');
        }
        if (source.length > 160) return invalid('invalid_source', 'source 过长（上限 160 字），未收为候选。');
        if (tags.length > 8 || tags.some((tag) => tag.length > 40) || tags.join(',').length > 300) {
          return invalid('invalid_tags', 'tags 超出上限（最多 8 个、每个 40 字、合计 300 字），未收为候选。');
        }
        const tooLong = [...content].length > MAX_CANDIDATE_CHARS;
        if (tooLong) {
          return invalid('too_long', '内容 ' + [...content].length + ' 字，超过单条笔记上限 400 字；请拆成多条分别记住（一条事实一个文件）。');
        }
        try {
          const result = addCandidate(
            getStore(),
            { text: content, source, kind: 'semantic', tags: ['dsh', ...tags] },
            { writtenBy: 'capture:dsh' },
          );
          return {
            ok: Boolean(result.ok),
            reason: String(result.reason ?? ''),
            id: String(result.id ?? ''),
            title: String(result.title ?? ''),
            chars: Number(result.chars) || 0,
            source,
            path: String(result.path ?? ''),
            message: captureMessage(result),
          };
        } catch (error) {
          return { ok: false, reason: 'store_write_failed', id: '', title: '', chars: 0, source, path: '', message: '候选写入失败：' + (error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_inbox',
      description:
        'Review the candidate queue of the local tabellio store. Candidates are proposed memories that are NOT active yet. ' +
        'Use action="list" to show them. Use action="accept" or "reject" ONLY when the human explicitly asked to approve or ' +
        'discard specific ids in this conversation — approval is the human\'s decision, never the agent\'s own judgement. ' +
        'Approving runs the same write gate the CLI uses; rejecting just archives the candidate.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'accept', 'reject'], description: 'Default: list.' },
          ids: { type: 'array', items: { type: 'string' }, description: 'Candidate ids to accept/reject (required for accept/reject).' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            action: { type: 'string', enum: ['list', 'accept', 'reject'] },
            count: { type: 'integer' },
            candidates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  created: { type: 'string' },
                  source: { type: 'string' },
                  chars: { type: 'integer' },
                  kind: { type: 'string' },
                  trust: { type: 'string' },
                  scope: { type: 'string' },
                },
                required: ['id', 'title', 'created', 'source', 'chars', 'kind', 'trust', 'scope'],
                additionalProperties: false,
              },
            },
            accepted: { type: 'array', items: { type: 'string' } },
            rejected: { type: 'array', items: { type: 'string' } },
            failed: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, reason: { type: 'string' } },
                required: ['id', 'reason'],
                additionalProperties: false,
              },
            },
            message: { type: 'string' },
          },
          required: ['ok', 'action', 'count', 'candidates', 'accepted', 'rejected', 'failed', 'message'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(
          value.action === 'list'
            ? (value.candidates.length
                ? value.candidates.map((c) => c.id + '\t' + c.chars + '字\t' + c.title).join('\n') + '\n用 tabellio_inbox action=accept ids=[...] 批准（需用户明确同意）。' 
                : '没有待批准的候选。')
            : value.message,
        ),
      },
      async execute(args) {
        const action = args?.action === 'accept' || args?.action === 'reject' ? args.action : 'list';
        const store = getStore();
        try {
          if (action === 'list') {
            const result = listCandidates(store);
            const candidates = (result.candidates ?? []).map((c) => ({
              id: String(c.id),
              title: String(c.title ?? ''),
              created: String(c.created ?? ''),
              source: String(c.source ?? ''),
              chars: Number(c.chars) || 0,
              kind: String(c.kind ?? ''),
              trust: String(c.trust ?? ''),
              scope: String(c.scope ?? ''),
            }));
            return { ok: true, action, count: candidates.length, candidates, accepted: [], rejected: [], failed: [], message: candidates.length ? '待批准候选 ' + candidates.length + ' 条。' : '没有待批准的候选。' };
          }
          const ids = Array.isArray(args?.ids) ? args.ids.map((id) => String(id ?? '').trim()).filter(Boolean) : [];
          if (!ids.length) {
            return { ok: false, action, count: 0, candidates: [], accepted: [], rejected: [], failed: [], message: 'accept/reject 需要 ids。' };
          }
          if (ids.some((id) => id.includes(','))) {
            return { ok: false, action, count: 0, candidates: [], accepted: [], rejected: [], failed: [], message: 'ids 不能包含逗号；请传数组，避免一次批准多条。' };
          }
          const result = reviewCandidates(store, action === 'accept' ? { accept: ids } : { reject: ids });
          const accepted = (result.accepted ?? []).map((item) => String(item.id));
          const rejected = (result.rejected ?? []).map((item) => String(item.id));
          const failed = (result.failed ?? []).map((item) => ({ id: String(item.id ?? ''), reason: String(item.reason ?? item.status ?? 'failed') }));
          const parts = [];
          if (accepted.length) parts.push('已批准 ' + accepted.length + ' 条：' + accepted.join('、'));
          if (rejected.length) parts.push('已拒绝 ' + rejected.length + ' 条：' + rejected.join('、'));
          if (failed.length) parts.push('失败 ' + failed.length + ' 条：' + failed.map((f) => f.id + '(' + f.reason + ')').join('、'));
          return { ok: Boolean(result.ok), action, count: accepted.length + rejected.length + failed.length, candidates: [], accepted, rejected, failed, message: parts.join('；') || '没有变化。' };
        } catch (error) {
          return { ok: false, action, count: 0, candidates: [], accepted: [], rejected: [], failed: [], message: 'inbox 失败：' + (error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_report',
      description:
        '生成最近 N 天的记忆周报：新增了哪些笔记、有多少候选/提案待批。只读，不调模型，不联网。用户问「这周记了什么/最近有什么新记忆」时用。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 90, description: '窗口天数，默认 7。' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多列出几条新增，默认 10。' },
        },
        required: [],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            days: { type: 'integer' },
            since: { type: 'string' },
            notes_total: { type: 'integer' },
            notes_added: { type: 'integer' },
            candidates: { type: 'integer' },
            proposals: { type: 'integer' },
            truncated: { type: 'integer' },
            added: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  valid_from: { type: 'string' },
                  kind: { type: 'string' },
                  scope: { type: 'string' },
                },
                required: ['id', 'title', 'valid_from', 'kind', 'scope'],
                additionalProperties: false,
              },
            },
            plain: { type: 'string' },
          },
          required: ['ok', 'days', 'since', 'notes_total', 'notes_added', 'candidates', 'proposals', 'truncated', 'added', 'plain'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(value.plain),
      },
      async execute(args) {
        const days = Math.min(90, Math.max(1, Math.trunc(Number(args?.days) || 7)));
        const limit = Math.min(50, Math.max(1, Math.trunc(Number(args?.limit) || 10)));
        try {
          const report = buildReport(getStore(), { days, limit });
          return { ok: true, ...report, plain: renderReport(report) };
        } catch (error) {
          const report = { days, since: '', notes_total: 0, notes_added: 0, candidates: 0, proposals: 0, added: [], truncated: 0 };
          return { ok: false, ...report, plain: '周报读取失败：' + (error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_conflicts',
      description:
        '列出「可能已经过时」的笔记对：同一主题、内容高度重叠，但较新的一条出现替换措辞/不同数值/相反极性。只读、不写、不调模型。' +
        '用户问「有没有互相矛盾/过时的记忆」时可先跑它，再把结果交给人判断。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, description: '只看最近 N 天内新增/更新的笔记作为「新」候选，默认 30。' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多返回几对，默认 10。' },
          min_overlap: { type: 'number', minimum: 0.1, maximum: 0.95, description: '词面重叠下限，默认 0.35。' },
        },
        required: [],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            scanned: { type: 'integer' },
            pairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  older_id: { type: 'string' },
                  older_title: { type: 'string' },
                  older_at: { type: 'integer' },
                  older_snippet: { type: 'string' },
                  newer_id: { type: 'string' },
                  newer_title: { type: 'string' },
                  newer_at: { type: 'integer' },
                  newer_snippet: { type: 'string' },
                  overlap: { type: 'number' },
                  signals: { type: 'array', items: { type: 'string' } },
                },
                required: ['older_id', 'older_title', 'older_at', 'older_snippet', 'newer_id', 'newer_title', 'newer_at', 'newer_snippet', 'overlap', 'signals'],
                additionalProperties: false,
              },
            },
            message: { type: 'string' },
          },
          required: ['ok', 'scanned', 'pairs', 'message'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(
          value.pairs.length
            ? value.pairs.map((pair, index) =>
                (index + 1) + '. [' + pair.newer_id + '] ' + pair.newer_title + '（新）\n' +
                '   vs [' + pair.older_id + '] ' + pair.older_title + '（旧）· 重叠 ' + Math.round(pair.overlap * 100) + '% · ' + pair.signals.join('/')).join('\n') +
              '\n确认要替换时用 tabellio_merge（先 dry-run，再经用户同意 confirm）。'
            : '没有发现明显冲突：' + value.message,
        ),
      },
      async execute(args) {
        try {
          const store = getStore();
          const found = findConflicts(store.scan(), {
            days: Math.min(365, Math.max(1, Math.trunc(Number(args?.days) || 30))),
            limit: Math.min(50, Math.max(1, Math.trunc(Number(args?.limit) || 10))),
            minOverlap: Math.min(0.95, Math.max(0.1, Number(args?.min_overlap) || 0.35)),
          });
          return {
            ok: true,
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
            message: found.pairs.length ? '按重叠度排序；请人确认哪条已过时。' : '库里没有同时满足重叠与替换信号的笔记对（共检查 ' + found.scanned + ' 条）。',
          };
        } catch (error) {
          return { ok: false, scanned: 0, pairs: [], message: '冲突检查失败：' + (error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_merge',
      description:
        '把两条以上「同一主题、新旧说法」的笔记合并成一条，并把旧笔记标成已被取代（valid_to + superseded_by）。默认只 dry-run；' +
        '只有用户明确同意替换/合并时，才用 confirm: true 落盘。执行前会重算提案，源笔记正文在此后被改过就会拒绝。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8, description: '要合并的笔记 id（2–8 条，含新旧两条）。' },
          confirm: { type: 'boolean', description: '默认 false=只预览。用户明确同意后才传 true。' },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            applied: { type: 'boolean' },
            reason: { type: 'string' },
            target_id: { type: 'string' },
            target_title: { type: 'string' },
            target_chars: { type: 'integer' },
            source_ids: { type: 'array', items: { type: 'string' } },
            warnings: { type: 'array', items: { type: 'string' } },
            message: { type: 'string' },
          },
          required: ['ok', 'applied', 'reason', 'target_id', 'target_title', 'target_chars', 'source_ids', 'warnings', 'message'],
          additionalProperties: false,
        },
        render: (_args, value) => plainText(value.message),
      },
      async execute(args) {
        const ids = [...new Set((Array.isArray(args?.ids) ? args.ids : []).map(String).filter(Boolean))].slice(0, 8);
        if (ids.length < 2) {
          return { ok: false, applied: false, reason: 'need_two_ids', target_id: '', target_title: '', target_chars: 0, source_ids: ids, warnings: [], message: '至少给两条笔记 id。' };
        }
        const confirm = args?.confirm === true;
        try {
          if (!confirm) {
            const plan = proposeConsolidation(getStore(), { mode: 'merge', ids });
            if (!plan.ok) {
              return { ok: false, applied: false, reason: String(plan.reason ?? 'plan_failed'), target_id: '', target_title: '', target_chars: 0, source_ids: ids, warnings: [], message: '不能合并：' + (plan.reason ?? 'unknown') + '。' };
            }
            const body = String(plan.target?.body ?? '');
            return {
              ok: true,
              applied: false,
              reason: '',
              target_id: String(plan.target_id ?? plan.target?.id ?? ''),
              target_title: body.split('\n')[0].replace(/^#\s*/, '').slice(0, 80),
              target_chars: [...body].length,
              source_ids: (plan.source_ids ?? ids).map(String),
              warnings: (plan.warnings ?? []).map((item) => String(item.message ?? item.code ?? '')),
              message: '预览：合并 ' + ids.length + ' 条 → 「' + body.split('\n')[0].replace(/^#\s*/, '').slice(0, 40) + '…」；确认无误后由用户同意再 confirm。',
            };
          }
          // The core's 5% change-ratio fuse is meant for automatic sweeps; this
          // merge is a human-approved action over at most 8 explicit ids.
          const result = applyContentConsolidation(getStore(), { mode: 'merge', ids, apply: true, maxChangeRatio: 1 });
          if (!result.ok) {
            return { ok: false, applied: false, reason: String(result.reason ?? 'apply_failed'), target_id: '', target_title: '', target_chars: 0, source_ids: ids, warnings: [], message: '合并未执行：' + (result.reason ?? 'unknown') + '。' };
          }
          return {
            ok: true,
            applied: true,
            reason: '',
            target_id: String(result.target_id ?? result.target?.id ?? ''),
            target_title: String(result.target?.title ?? result.target?.body?.split('\n')[0]?.replace(/^#\s*/, '') ?? '').slice(0, 80),
            target_chars: Number(result.target?.chars) || 0,
            source_ids: ids,
            warnings: (result.warnings ?? []).map((item) => String(item.message ?? item.code ?? '')),
            message: '已合并为 [' + String(result.target_id ?? result.target?.id ?? '') + ']，' + ids.length + ' 条旧笔记已标记被取代（可用核心 undo 回滚）。',
          };
        } catch (error) {
          return { ok: false, applied: false, reason: 'merge_failed', target_id: '', target_title: '', target_chars: 0, source_ids: ids, warnings: [], message: '合并失败：' + (error?.message ?? error) };
        }
      },
    },
    {
      name: 'tabellio_feedback',
      description:
        'Record whether a recall helped: signal="useful" when the human confirmed a remembered fact was right, ' +
        'signal="wrong" or "stale" when they said the memory was wrong or outdated. This only nudges future ranking; ' +
        'it never edits or deletes a note. Use it right after the human comments on a memory, not proactively.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Note id returned by tabellio_recall/search/read.' },
          signal: { type: 'string', enum: [...SIGNALS] },
          query: { type: 'string', description: 'Optional query that triggered the recall.' },
        },
        required: ['id', 'signal'],
      },
      output: {
        schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          id: { type: 'string' },
          signal: { type: 'string' },
          reason: { type: 'string' },
          counts: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'integer' },
              useful: { type: 'integer' },
              wrong: { type: 'integer' },
              stale: { type: 'integer' },
              corrected: { type: 'integer' },
            },
            required: ['total', 'useful', 'wrong', 'stale', 'corrected'],
          },
          message: { type: 'string' },
        },
        required: ['ok', 'id', 'signal', 'reason', 'counts', 'message'],
        },
        render: (args, value) => plainText(String(value.message)),
      },
      execute: async ({ id, signal, query }) => {
        const written = recordFeedback(getStore(), { id, signal, query, source: 'dsh:tool' });
        const summary = feedbackSummary(getStore(), { days: 3650 });
        const counts = { total: summary.total, ...summary.counts };
        const label = { useful: '有用', wrong: '不对', stale: '过时' }[String(signal)] ?? String(signal);
        return {
          ok: Boolean(written.ok),
          id: String(id ?? ''),
          signal: String(signal ?? ''),
          reason: written.ok ? '' : String(written.reason ?? 'write_failed'),
          counts,
          message: written.ok
            ? '已记录「' + label + '」（累计 ' + counts.total + ' 条反馈），只影响排序，不改笔记。'
            : '反馈未记录：' + (written.reason ?? 'unknown') + '。',
        };
      },
    },
    {
      name: 'tabellio_forget',
      description:
        'Forget a note: archive it so automatic recall stops returning it, without deleting the file (the audit trail keeps it). ' +
        'Requires explicit human intent; pass confirm=true only after the human asked to forget it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Note id from tabellio_recall/search/read.' },
          confirm: { type: 'boolean', description: 'true = actually archive; false/omitted = preview only.' },
        },
        required: ['id'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            archived: { type: 'boolean' },
            reason: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['ok', 'id', 'archived', 'reason', 'message'],
        },
        render: (args, value) => plainText(String(value.message)),
      },
      execute: async ({ id, confirm }) => {
        const noteId = String(id ?? '').trim();
        if (!noteId) return { ok: false, id: '', archived: false, reason: 'missing_id', message: '需要笔记 id。' };
        const store = getStore();
        const current = read(store, noteId);
        if (!current.ok) return { ok: false, id: noteId, archived: false, reason: 'not_found', message: '找不到这条笔记。' };
        if (current.note?.status === 'archived') {
          return { ok: true, id: noteId, archived: true, reason: 'already_archived', message: '这条记忆已经归档，不会再被自动召回。' };
        }
        if (confirm !== true) {
          return { ok: false, id: noteId, archived: false, reason: 'needs_confirmation', message: '确认后才会归档：请让用户明确同意，再带 confirm=true 调用。' };
        }
        const result = consolidate(store, { archive: [noteId], apply: true });
        if (!result.ok) {
          return { ok: false, id: noteId, archived: false, reason: String(result.reason ?? 'archive_failed'), message: '归档失败：' + (result.reason ?? 'unknown') + '。' };
        }
        return { ok: true, id: noteId, archived: true, reason: '', message: '已忘掉这条记忆，自动召回不再使用它（文件保留，可审计）。' };
      },
    },
    {
      name: 'tabellio_edit',
      description:
        'Replace a note with an edited version (the old text is kept and marked superseded by the new one). ' +
        'Only call after the human explicitly asked to change that memory; automatic recall switches to the new version.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Note id from tabellio_recall/search/read.' },
          content: { type: 'string', description: 'New body text (max 400 chars including the title line).' },
          title: { type: 'string', description: 'Optional new title (default: keep the current one).' },
        },
        required: ['id', 'content'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            superseded: { type: 'string' },
            old_retired: { type: 'boolean' },
            reason: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['ok', 'id', 'superseded', 'old_retired', 'reason', 'message'],
        },
        render: (args, value) => plainText(String(value.message)),
      },
      execute: async ({ id, content, title }) => {
        const noteId = String(id ?? '').trim();
        if (!noteId) return { ok: false, id: '', superseded: '', old_retired: false, reason: 'missing_id', message: '需要笔记 id。' };
        if (!String(content ?? '').trim()) return { ok: false, id: noteId, superseded: '', old_retired: false, reason: 'empty', message: '新正文不能为空。' };
        const result = editNote(getStore(), { id: noteId, content, title });
        if (!result.ok) {
          const messages = {
            not_found: '找不到这条笔记。',
            unchanged: '内容和原来一样，没有生成新版本。',
            too_long: '超过单条 400 字上限，请拆分或精简后再改。',
            empty: '新正文不能为空。',
          };
          return { ok: false, id: noteId, superseded: '', old_retired: false, reason: String(result.reason || 'edit_failed'), message: messages[result.reason] || ('修改失败：' + (result.reason || 'unknown')) };
        }
        return {
          ok: true,
          id: String(result.id),
          superseded: String(result.superseded || ''),
          old_retired: Boolean(result.oldRetired),
          reason: '',
          message: '已保存为新版本（' + String(result.id) + '），旧版本标记为被取代，自动召回改用新版本。',
        };
      },
    },
  ];
}

export function registerTools(ctx, deps) {
  for (const definition of createToolDefinitions(deps)) {
    ctx.tools.register(definition);
  }
}
