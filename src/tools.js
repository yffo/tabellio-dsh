import { addCandidate, listCandidates, read, recallQuery, reviewCandidates, search, status } from 'tabellio';
import { formatRecallTool } from './render.js';
import { looksLikeCredentialLeak } from './capture.js';

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

/**
 * Build the native tool definitions. They are thin projections over the same
 * tabellio API the CLI/MCP use, so budgets, refusal and gates cannot drift.
 */
export function createToolDefinitions({ settings, getStore, getLastRecall = () => null }) {
  const lastRecallView = () => {
    const last = getLastRecall?.();
    if (!last || typeof last !== 'object') return { mode: 'none', at: 0, query: '', count: 0, reason: '' };
    return {
      mode: String(last.mode ?? 'none'),
      at: Number(last.at) || 0,
      query: String(last.query ?? '').slice(0, 60),
      count: Number(last.count) || 0,
      reason: String(last.reason ?? ''),
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
          const result = search(store, query, { maxNotes: Math.max(1, Math.min(Number(args?.limit) || 8, 30)) });
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
              },
              required: ['mode', 'at', 'query', 'count', 'reason'],
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
  ];
}

export function registerTools(ctx, deps) {
  for (const definition of createToolDefinitions(deps)) {
    ctx.tools.register(definition);
  }
}
