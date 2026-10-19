// tabellio-dsh client half: a settings-section memory panel.
//
// Hand-written module-loader bundle (no build step): plain JS, inline styles,
// React from the host module system. The panel is read-mostly: it shows store
// health and the candidate inbox, and approving a candidate is the only write —
// the exact same gate as `tabellio inbox`.
window.__ModuleLoader__.load({
  id: 'tabellio-dsh',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useState } = React;

    const name = 'tabellio-dsh';
    /** Client services this half reads (mirrors the package `dsh.client` list). */
    const inject = ['slots', 'connection', 'locale'];
    const NS = 'tabellio-dsh';
    const RPC_CHANNEL = '/tabellio-dsh';

    const zh = {
      section: '记忆',
      title: '🧠 记忆（tabellio）',
      subtitle: '本地 Markdown 记忆；批准后才成为正式笔记',
      purpose: '它记住你说过的重要事，聊天时自动带上相关记忆；写入前需要你批准。',
      pendingTitle: '待你批准',
      pendingEmpty: '没有待批准的内容。对话里出现约定或纠错时，候选会出现在这里。',
      candidatesTitle: '新候选',
      findTitle: '找一条记忆',
      activityTitle: '最近发生',
      advancedTitle: '高级状态',
      pending: '待批准',
      semLabel: '语义补充',
      semOff: '未开启',
      semBuilding: '正在建索引',
      semReady: '已索引 {n} 条',
      semError: '不可用（嵌入服务连不上）',
      semHint: '语义补充需要本地 /v1/embeddings 服务；不可用时会自动退回词面召回，不影响其他功能。',
      judgeQuality: '模型裁决（近 7 天）',
      judgeDropped: '丢弃',
      judgeHint: '用 DSH 当前默认模型做一次小裁决，只保留真正相关的记忆；关掉后只按关键词和覆盖率判断。',
      semSwitch: '更换语义服务：改 semanticEndpoint / semanticModel 指向任意 OpenAI 风格 /v1/embeddings；没有本地模型就设 semantic: off，召回自动用词面匹配。',
      loading: '读取中…',
      refresh: '刷新',
      notes: '笔记',
      candidates: '待审候选',
      proposals: '提案',
      store: '库',
      index: '索引',
      indexOk: '正常',
      indexStale: '旧了',
      indexMissing: '未生成',
      mode: '召回模式',
      modeInject: '注入',
      modeShadow: '影子（只记回执不注入）',
      modeOff: '关闭',
      capture: '捕获',
      capExplicit: '显式约定',
      capImplicit: '含纠错',
      capAssist: '辅助（含陈述）',
      capOff: '关闭',
      empty: '没有待审候选。对话里出现显式约定时，会自动落到候选区等你批准。',
      firstRun: '第一次用：在对话里说「记住：…」，或把一份 Markdown 笔记交给 tabellio；之后的候选会出现在这里等你批准。',
      approve: '批准入库',
      reject: '忽略',
      approved: '已批准 {n} 条。',
      rejected: '已忽略 {n} 条。',
      failedOne: '{n} 条处理失败。',
      chars: '{n} 字',
      readError: '读取记忆库失败：{err}',
      rpcError: '面板通道不可用：{err}',
      warnings: '警告',
      searchTitle: '搜索记忆',
      searchPlaceholder: '输入关键词，回车搜索…',
      searchButton: '搜索',
      searchEmpty: '没有匹配的笔记。',
      searchRefused: '这句不像在问记忆，换个说法再试。',
      searchError: '搜索失败：{err}',
      lastRecallLabel: '上次召回',
      lastRecallNone: '本会话还没有触发过召回',
      weeklyLabel: '最近 7 天',
      weeklyNone: '最近 7 天没有新记忆',
      weeklyMore: '另有 {n} 条',
      auditTitle: '最近召回记录',
      audShadow: '影子',
      audNotice: '注入',
      audContext: '静默注入',
      audSuppressed: '意图闸拦下',
      audRefused: '没命中',
      audJudged: '裁决丢弃',
      audDeduped: '与上次相同',
      audError: '出错',
      audUnknown: '其它',
      qualityLabel: '召回质量（近 7 天）',
      qualityTotal: '共 {n} 次',
      qualityInjected: '注入',
      qualityBlocked: '拦下',
      qualityMissed: '没命中',
      qualityTopMiss: '常被拒的问题',
      qualityNone: '还没有记录',
      notesAll: '全部笔记',
      notesCount: '共 {n} 条，点标题可读全文',
      notesMore: '加载更早的笔记',
      notesLoading: '加载中…',
      filterAllKinds: '全部类型',
      filterSemantic: '语义记忆',
      filterProcedural: '流程记忆',
      filterAllTime: '全部时间',
      filter7: '最近 7 天',
      filter30: '最近 30 天',
      filter90: '最近 90 天',
      closeNote: '收起',
      addLabel: '直接存一条记忆',
      addPlaceholder: '比如：以后发版都用 tag 加 CI，不走手动上传。',
      addButton: '存为记忆',
      addSaving: '保存中…',
      addSaved: '已存入：{title}',
      lrTitles: '用到的记忆',
      judgedTag: '已裁决',
      judgeLabel: '模型裁决',
      consolidateLabel: '后台巩固',
      consDaily: '每日',
      consWeekly: '每周',
      consOff: '关闭',
      consNever: '还没跑过',
      consLast: '上次 {when}',
      judgeOff: '关闭',
      judgeReady: '已启用',
      judgeNoSelection: '未拿到默认模型',
      judgeNoVerdict: '已调用，未返回裁决（回退词面）',
      judgeKept: '上次保留',
      judgeReply: '模型回复',
      lrShadow: '影子（只记回执）',
      lrNotice: '已注入对话',
      lrContext: '静默上下文',
      lrSuppressed: '未注入：不像在问记忆',
      lrRefused: '拒答：库里没有匹配',
      lrDeduped: '与上次同一批笔记，跳过',
      lrError: '召回出错',
      lrJudgedOut: '裁决判定不相关，未注入',
      lrHits: '{n} 条',
      proposalsTitle: '自动巩固提案',
      proposalsEmpty: '没有待审提案。',
      propSources: '{n} 篇笔记',
      propSimilarity: '相似度 {n}%',
      propApprove: '批准合并',
      propReject: '拒绝',
      propApproved: '已批准 {n} 条提案。',
      propRejected: '已拒绝 {n} 条提案。',
      footer: '候选只在候选区；批准后进入 notes/。自动捕获受 capture 配置约束，召回在 shadow 模式下只写回执。',
    };
    const en = {
      section: 'Memory',
      title: '🧠 Memory (tabellio)',
      subtitle: 'Local Markdown memory; a candidate becomes a note only after approval',
      purpose: 'It remembers what matters, brings relevant memories into the chat, and asks you to approve writes.',
      pendingTitle: 'Waiting for you',
      pendingEmpty: 'Nothing waiting. When a convention or correction comes up, a candidate will appear here.',
      candidatesTitle: 'New candidates',
      findTitle: 'Find a memory',
      activityTitle: 'Recent activity',
      advancedTitle: 'Advanced status',
      pending: 'pending',
      semLabel: 'Semantic',
      semOff: 'off',
      semBuilding: 'indexing',
      semReady: '{n} notes indexed',
      semError: 'unavailable (embedding service unreachable)',
      semHint: 'The semantic supplement needs a local /v1/embeddings service. When it is unavailable, recall falls back to lexical matching and everything else keeps working.',
      judgeQuality: 'Model judge (7 days)',
      judgeDropped: 'dropped',
      judgeHint: 'One small verdict per recall with the current DSH default model; only the relevant notes are kept. Turn it off to rely on lexical and coverage gates alone.',
      semSwitch: 'To switch: point semanticEndpoint / semanticModel at any OpenAI-style /v1/embeddings service. Without a local model set semantic: off and recall uses lexical matching.',
      loading: 'Loading…',
      refresh: 'Refresh',
      notes: 'Notes',
      candidates: 'Pending',
      proposals: 'Proposals',
      store: 'Store',
      index: 'Index',
      indexOk: 'Fresh',
      indexStale: 'Stale',
      indexMissing: 'Missing',
      mode: 'Recall mode',
      modeInject: 'Inject',
      modeShadow: 'Shadow (receipts only)',
      modeOff: 'Off',
      capture: 'Capture',
      capExplicit: 'Explicit cues',
      capImplicit: 'Cues + corrections',
      capAssist: 'Assist (statements)',
      capOff: 'Off',
      empty: 'No pending candidates. Explicit agreements from a conversation land here for approval.',
      firstRun: 'First run: say "remember: …" in a conversation, or hand a Markdown note to tabellio; candidates will wait for approval here.',
      approve: 'Approve',
      reject: 'Dismiss',
      approved: 'Approved {n}.',
      rejected: 'Dismissed {n}.',
      failedOne: '{n} failed.',
      chars: '{n} chars',
      readError: 'Could not read the memory store: {err}',
      rpcError: 'Panel channel unavailable: {err}',
      warnings: 'Warnings',
      searchTitle: 'Search memory',
      searchPlaceholder: 'Type a keyword, press Enter…',
      searchButton: 'Search',
      searchEmpty: 'No matching notes.',
      searchRefused: 'That did not look like a memory question; try rephrasing.',
      searchError: 'Search failed: {err}',
      lastRecallLabel: 'Last recall',
      lastRecallNone: 'No recall yet in this session',
      weeklyLabel: 'Last 7 days',
      weeklyNone: 'No new memories in the last 7 days',
      weeklyMore: '+{n} more',
      auditTitle: 'Recent recalls',
      audShadow: 'shadow',
      audNotice: 'injected',
      audContext: 'silent context',
      audSuppressed: 'intent gate',
      audRefused: 'no hit',
      audJudged: 'judge dropped',
      audDeduped: 'same as last',
      audError: 'error',
      audUnknown: 'other',
      qualityLabel: 'Recall quality (7 days)',
      qualityTotal: '{n} recalls',
      qualityInjected: 'injected',
      qualityBlocked: 'gated',
      qualityMissed: 'missed',
      qualityTopMiss: 'Often refused',
      qualityNone: 'no data yet',
      notesAll: 'All notes',
      notesCount: '{n} notes - tap a title to read it',
      notesMore: 'Load older notes',
      notesLoading: 'Loading...',
      filterAllKinds: 'All kinds',
      filterSemantic: 'Semantic',
      filterProcedural: 'Procedural',
      filterAllTime: 'All time',
      filter7: 'Last 7 days',
      filter30: 'Last 30 days',
      filter90: 'Last 90 days',
      closeNote: 'Close',
      addLabel: 'Save a memory',
      addPlaceholder: 'e.g. Releases always go through tags and CI, never manual uploads.',
      addButton: 'Save',
      addSaving: 'Saving…',
      addSaved: 'Saved: {title}',
      lrTitles: 'Memories used',
      judgedTag: 'judged',
      judgeLabel: 'LLM judge',
      judgeOff: 'Off',
      judgeReady: 'Enabled',
      judgeNoSelection: 'No default model selection',
      judgeNoVerdict: 'Called, no verdict (fell back to lexical)',
      judgeKept: 'Last kept',
      judgeReply: 'Model reply',
      lrShadow: 'shadow (receipt only)',
      lrNotice: 'injected into the chat',
      lrContext: 'quiet context',
      lrSuppressed: 'skipped: not a memory question',
      lrRefused: 'refused: nothing matched',
      lrDeduped: 'same notes as last time, skipped',
      lrError: 'recall failed',
      lrJudgedOut: 'judged irrelevant, not injected',
      lrHits: '{n} note(s)',
      proposalsTitle: 'Consolidation proposals',
      proposalsEmpty: 'No pending proposals.',
      propSources: '{n} notes',
      propSimilarity: 'similarity {n}%',
      propApprove: 'Approve merge',
      propReject: 'Reject',
      propApproved: 'Approved {n} proposals.',
      propRejected: 'Rejected {n} proposals.',
      footer: 'Candidates stay in the inbox until approved. Capture is bounded by config; shadow recall only writes receipts.',
    };

    const COLORS = {
      text: 'var(--dsh-text-primary, #1f2328)',
      dim: 'var(--dsh-text-secondary, #6b7280)',
      border: 'var(--dsh-border-color, rgba(127,127,127,0.28))',
      card: 'var(--dsh-fill-secondary, rgba(127,127,127,0.08))',
      accent: 'var(--dsh-accent-color, #4f6ef7)',
    };

    const styles = {
      section: { marginTop: 16, borderTop: '1px solid ' + COLORS.border, paddingTop: 12 },
      sectionTitle: { fontWeight: 600, fontSize: 13, marginBottom: 8 },
      subTitle: { color: COLORS.dim, fontSize: 12, margin: '10px 0 4px' },
      hint: { color: COLORS.dim, fontSize: 12, margin: '4px 0' },
      details: { marginTop: 16, borderTop: '1px solid ' + COLORS.border, paddingTop: 12 },
      summary: { cursor: 'pointer', fontWeight: 600, fontSize: 13, marginBottom: 8 },
      sectionTitle: { marginTop: 18, marginBottom: 6, fontSize: 13, fontWeight: 600, color: COLORS.dim },
      root: { padding: '4px 2px', color: COLORS.text, fontSize: 13, lineHeight: 1.55 },
      head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
      title: { fontSize: 16, fontWeight: 600, margin: 0 },
      recallTitles: { margin: '2px 0 0', fontSize: 11, color: 'var(--dsw-alias-text-secondary)' },
  sub: { color: COLORS.dim, fontSize: 12, margin: '2px 0 12px' },
      button: {
        border: '1px solid ' + COLORS.border,
        background: 'transparent',
        color: COLORS.text,
        borderRadius: 7,
        padding: '3px 10px',
        fontSize: 12,
        cursor: 'pointer',
      },
      primary: {
        border: '1px solid transparent',
        background: COLORS.accent,
        color: '#fff',
        borderRadius: 7,
        padding: '3px 10px',
        fontSize: 12,
        cursor: 'pointer',
      },
      metrics: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
      metric: {
        border: '1px solid ' + COLORS.border,
        borderRadius: 8,
        padding: '6px 10px',
        minWidth: 74,
      },
      metricLabel: { color: COLORS.dim, fontSize: 11 },
      metricValue: { fontSize: 17, fontWeight: 600 },
      card: {
        border: '1px solid ' + COLORS.border,
        background: COLORS.card,
        borderRadius: 9,
        padding: '9px 11px',
        marginBottom: 8,
      },
      cardTitle: { fontSize: 13, fontWeight: 600, margin: '0 0 3px', overflowWrap: 'anywhere' },
      cardMeta: { color: COLORS.dim, fontSize: 11, marginBottom: 7, overflowWrap: 'anywhere' },
      actions: { display: 'flex', gap: 8 },
      firstRun: { border: '1px solid var(--dsh-border, #d9d9d9)', borderRadius: 8, padding: '10px 12px', background: 'var(--dsh-surface-2, rgba(127,127,127,0.06))', fontSize: 13, lineHeight: 1.6 },
    notice: { fontSize: 12, color: COLORS.dim, margin: '8px 0' },
      error: { fontSize: 12, color: '#d1242f', margin: '8px 0', overflowWrap: 'anywhere' },
      footer: { color: COLORS.dim, fontSize: 11, marginTop: 10, borderTop: '1px solid ' + COLORS.border, paddingTop: 8 },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 },
      searchRow: { display: 'flex', gap: 8, margin: '12px 0 4px' },
      input: {
        flex: 1,
        minWidth: 0,
        padding: '5px 9px',
        fontSize: 12,
        color: COLORS.text,
        background: 'transparent',
        border: '1px solid ' + COLORS.border,
        borderRadius: 7,
      },
      hitRow: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        fontSize: 12,
        padding: '5px 2px',
        borderBottom: '1px dashed ' + COLORS.border,
      },
      hitTitle: { overflowWrap: 'anywhere' },
      hitScore: { color: COLORS.dim, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
      weeklyList: { margin: '2px 0 6px', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 },
      filters: { display: 'flex', gap: '8px', margin: '0 0 6px' },
      select: { fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #d4d4d8', background: '#fff', color: '#18181b' },
      weeklyItem: { overflowWrap: 'anywhere' },
      auditMode: { color: '#1E3A5F', fontWeight: 600 },
      writeBox: { margin: '10px 0 4px' },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        resize: 'vertical',
        minHeight: 64,
        fontSize: 13,
        lineHeight: 1.6,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid ' + COLORS.border,
        background: COLORS.input || COLORS.card,
        color: COLORS.text,
        fontFamily: 'inherit',
      },
      noteBody: {
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontSize: 13,
        lineHeight: 1.7,
        margin: '6px 0 0',
        padding: 10,
        borderRadius: 8,
        background: COLORS.card,
        border: '1px solid ' + COLORS.border,
        maxHeight: 320,
        overflow: 'auto',
      },
    };

    function MemoryPanel(props) {
      const { rpcCall, t } = props;
      const [state, setState] = useState({ loading: true, error: null, notice: '' });
      const [status, setStatus] = useState(null);
      const [items, setItems] = useState([]);
      const [proposalList, setProposalList] = useState([]);
      const [weekly, setWeekly] = useState(null);
      const [audited, setAudited] = useState(null);
      const [quality, setQuality] = useState(null);
      const [older, setOlder] = useState({ items: [], total: 0, loading: false });
      const [filters, setFilters] = useState({ kind: '', days: 0 });
      const [note, setNote] = useState(null);
      const [draft, setDraft] = useState('');
      const [saving, setSaving] = useState(false);
      const [busyId, setBusyId] = useState('');
      const [query, setQuery] = useState('');
      const [found, setFound] = useState(null);
      const [searching, setSearching] = useState(false);

      const load = useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
          const [nextStatus, inbox, listed] = await Promise.all([
            rpcCall('status', {}),
            rpcCall('inbox.list', {}),
            rpcCall('proposals.list', {}),
          ]);
          setStatus(nextStatus);
          setItems(Array.isArray(inbox.items) ? inbox.items : []);
          setProposalList(Array.isArray(listed.items) ? listed.items : []);
          try {
            setWeekly(await rpcCall('report', { days: 7, limit: 3 }) || null);
          } catch {
            setWeekly(null);
          }
          try {
            setQuality(await rpcCall('audit.summary', { days: 7 }) || null);
          } catch {
            setQuality(null);
          }
          try {
            const rows = await rpcCall('audit', { limit: 20 });
            setAudited({ items: Array.isArray(rows.items) ? rows.items : [], counts: rows.counts || {} });
          } catch {
            setAudited(null);
          }
          try {
            const page = await rpcCall('notes', { offset: 0, limit: 20 });
            setOlder({ items: Array.isArray(page.items) ? page.items : [], total: Number(page.total) || 0, loading: false });
          } catch {
            setOlder({ items: [], total: 0, loading: false });
          }
          setState((prev) => ({ ...prev, loading: false, error: null }));
        } catch (error) {
          setState((prev) => ({ ...prev, loading: false, error: error?.message ?? String(error) }));
        }
      }, [rpcCall]);

      useEffect(() => {
        load();
      }, [load]);

      const find = useCallback(async () => {
        const text = query.trim();
        if (!text || searching) return;
        setSearching(true);
        try {
          const result = await rpcCall('search', { query: text, limit: 8 });
          setFound({ query: text, ...result });
        } catch (error) {
          setFound({ query: text, error: error?.message ?? String(error) });
        } finally {
          setSearching(false);
        }
      }, [query, rpcCall, searching]);

      const saveMemory = useCallback(async () => {
        const content = draft.trim();
        if (!content || saving) return;
        setSaving(true);
        setState((prev) => ({ ...prev, notice: '', error: null }));
        try {
          const result = await rpcCall('remember', { content });
          setState((prev) => ({ ...prev, notice: t('addSaved').replace('{title}', String(result.title || result.id || '')) }));
          setDraft('');
          await load();
        } catch (error) {
          setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
        } finally {
          setSaving(false);
        }
      }, [draft, saving, rpcCall, load, t]);

      const openNote = useCallback(
        async (id) => {
          if (!id) return;
          setNote({ id, loading: true });
          try {
            const result = await rpcCall('read', { id });
            setNote({ ...result, loading: false });
          } catch (error) {
            setNote({ id, loading: false, error: error?.message ?? String(error) });
          }
        },
        [rpcCall],
      );

      const applyFilters = useCallback(async (patch) => {
        const next = { ...filters, ...patch };
        setFilters(next);
        setOlder({ items: [], total: 0, loading: true });
        try {
          const page = await rpcCall('notes', { offset: 0, limit: 20, ...next });
          setOlder({ items: Array.isArray(page.items) ? page.items : [], total: Number(page.total) || 0, loading: false });
        } catch (error) {
          setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
          setOlder({ items: [], total: 0, loading: false });
        }
      }, [filters, rpcCall]);

      const loadOlder = useCallback(async () => {
        setOlder((prev) => (prev.loading ? prev : { ...prev, loading: true }));
        try {
          const page = await rpcCall('notes', { offset: older.items.length, limit: 20, ...filters });
          setOlder((prev) => ({
            items: prev.items.concat(Array.isArray(page.items) ? page.items : []),
            total: Number(page.total) || prev.total,
            loading: false,
          }));
        } catch (error) {
          setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
          setOlder((prev) => ({ ...prev, loading: false }));
        }
      }, [older.items.length, filters, rpcCall]);

      const review = useCallback(
        async (action, ids) => {
          if (!ids.length) return;
          setBusyId(ids[0]);
          setState((prev) => ({ ...prev, notice: '' }));
          try {
            const result = await rpcCall('inbox.review', { action, ids });
            const done = action === 'accept' ? (result.accepted || []) : (result.rejected || []);
            const failed = result.failed || [];
            const key = action === 'accept' ? 'approved' : 'rejected';
            let notice = t(key).replace('{n}', String(done.length));
            if (failed.length) notice += ' ' + t('failedOne').replace('{n}', String(failed.length));
            setState((prev) => ({ ...prev, notice }));
            await load();
          } catch (error) {
            setState((prev) => ({ ...prev, notice: '', error: error?.message ?? String(error) }));
          } finally {
            setBusyId('');
          }
        },
        [rpcCall, load, t],
      );

      const reviewProposal = useCallback(
        async (action, ids) => {
          if (!ids.length) return;
          setBusyId(ids[0]);
          setState((prev) => ({ ...prev, notice: '' }));
          try {
            const result = await rpcCall('proposals.review', { action, ids });
            const done = action === 'accept' ? (result.accepted || []) : (result.rejected || []);
            const failed = result.failed || [];
            const key = action === 'accept' ? 'propApproved' : 'propRejected';
            let notice = t(key).replace('{n}', String(done.length));
            if (failed.length) notice += ' ' + t('failedOne').replace('{n}', String(failed.length));
            setState((prev) => ({ ...prev, notice }));
            await load();
          } catch (error) {
            setState((prev) => ({ ...prev, notice: '', error: error?.message ?? String(error) }));
          } finally {
            setBusyId('');
          }
        },
        [rpcCall, load, t],
      );

      const modeLabel = status
        ? { inject: t('modeInject'), shadow: t('modeShadow'), off: t('modeOff') }[status.mode] || status.mode
        : '';
      const lastRecallLabel = (last) => {
        if (!last || !last.at) return t('lastRecallNone');
        const time = new Date(last.at).toLocaleTimeString();
        const mode =
          { shadow: t('lrShadow'), notice: t('lrNotice'), context: t('lrContext'), suppressed: t('lrSuppressed'), refused: t('lrRefused'), deduped: t('lrDeduped'), judged_out: t('lrJudgedOut'), error: t('lrError') }[last.mode] ||
          String(last.mode || '');
        const text = String(last.query || '');
        const query = [...text].length > 24 ? [...text].slice(0, 24).join('') + '…' : text;
        const hits = mode + ' · ' + t('lrHits').replace('{n}', String(last.count ?? 0)) + (last.elapsedMs ? ' · ' + last.elapsedMs + 'ms' : '');
        return time + ' · 「' + query + '」 · ' + hits + (last.judged ? ' · ' + t('judgedTag') : '');
      };
      const auditModeLabel = (mode) => {
        const map = {
          shadow: 'audShadow', notice: 'audNotice', context: 'audContext',
          suppressed: 'audSuppressed', refused: 'audRefused', judged_out: 'audJudged',
          deduped: 'audDeduped', error: 'audError',
        };
        return t(map[mode] || 'audUnknown');
      };

      const consolidateLabel = (info) => {
        if (!info || info.mode === 'off') return t('consOff');
        const cadence = info.mode === 'weekly' ? t('consWeekly') : t('consDaily');
        if (!info.lastRun) return cadence + ' · ' + t('consNever');
        const when = new Date(Number(info.lastRun)).toLocaleString();
        return cadence + ' · ' + t('consLast').replace('{when}', when);
      };

      const judgeLabel = (judge) => {
        if (!judge || judge.mode !== 'llm') return t('judgeOff');
        const selection = judge.selection ? ' · ' + String(judge.selection.model || judge.selection.provider || '') : '';
        const last = judge.last || {};
        if (last.stage === 'verdict') return t('judgeReady') + selection + ' · ' + t('judgeKept') + ' ' + String(last.kept ?? 0) + ' ' + t('notes');
        if (last.stage === 'no_selection') return t('judgeNoSelection');
        if (last.stage === 'no_llm') return t('judgeNoSelection');
        if (last.stage === 'no_verdict') {
          let text = t('judgeNoVerdict');
          if (last.elapsedMs !== null && last.elapsedMs !== undefined) text += ' · ' + String(last.elapsedMs) + 'ms';
          const preview = String(last.preview || '').slice(0, 80);
          if (preview) text += ' · ' + t('judgeReply') + '「' + preview + '」';
          return text;
        }
        return t('judgeReady');
      };
      const captureLabel = status
        ? { explicit: t('capExplicit'), implicit: t('capImplicit'), assist: t('capAssist'), off: t('capOff') }[status.capture] || String(status.capture)
        : '';
      const indexLabel = status
        ? status.indexExists
          ? status.indexStale
            ? t('indexStale')
            : t('indexOk')
          : t('indexMissing')
        : '';

      const metric = (label, value) =>
        h(
          'div',
          { style: styles.metric },
          h('div', { style: styles.metricLabel }, label),
          h('div', { style: styles.metricValue }, value),
        );

      const sem = status ? status.semantic : null;
      const semState = !sem || sem.mode !== 'local'
        ? t('semOff')
        : sem.ready
          ? t('semReady').replace('{n}', String(sem.size))
          : sem.error ? t('semError') : t('semBuilding');
      const pendingTotal = status ? Number(status.candidates || 0) + Number(status.proposals || 0) : 0;

      const section = (title, children, key) =>
        h(
          'div',
          { key: key || title, style: styles.section },
          h('div', { style: styles.sectionTitle }, title),
          children,
        );
      const hint = (text) => h('p', { style: styles.hint }, text);

      const pendingSection = !status
        ? null
        : section(
            t('pendingTitle'),
            pendingTotal === 0
              ? hint(t('pendingEmpty'))
              : h(
                  React.Fragment,
                  null,
                  proposalList.length === 0
                    ? null
                    : h(
                        React.Fragment,
                        null,
                        h('div', { style: styles.subTitle }, t('proposalsTitle')),
                        proposalList.map((proposal) =>
                          h(
                            'div',
                            { key: 'prop-' + proposal.id, style: styles.card },
                            h('div', { style: styles.cardTitle }, (proposal.sourceTitles || []).join(' + ') || proposal.id),
                            h(
                              'div',
                              { style: styles.cardMeta },
                              t('propSources').replace('{n}', String(proposal.sourceCount))
                                + (typeof proposal.similarity === 'number' ? ' · ' + t('propSimilarity').replace('{n}', String(Math.round(proposal.similarity * 100))) : '')
                                + (proposal.created ? ' · ' + proposal.created : ''),
                            ),
                            h(
                              'div',
                              { style: styles.actions },
                              h(
                                'button',
                                { type: 'button', style: styles.primary, disabled: busyId !== '', onClick: () => reviewProposal('accept', [proposal.id]) },
                                t('propApprove'),
                              ),
                              h(
                                'button',
                                { type: 'button', style: styles.button, disabled: busyId !== '', onClick: () => reviewProposal('reject', [proposal.id]) },
                                t('propReject'),
                              ),
                            ),
                          ),
                        ),
                      ),
                  items.length === 0
                    ? null
                    : h(
                        React.Fragment,
                        null,
                        h('div', { style: styles.subTitle }, t('candidatesTitle')),
                        items.map((item) =>
                          h(
                            'div',
                            { key: item.id, style: styles.card },
                            h('div', { style: styles.cardTitle }, item.title),
                            h(
                              'div',
                              { style: styles.cardMeta },
                              (item.kind || 'semantic') + ' · ' + t('chars').replace('{n}', String(item.chars)) + (item.created ? ' · ' + item.created : '') + (item.source ? ' · ' + item.source : ''),
                            ),
                            h(
                              'div',
                              { style: styles.actions },
                              h(
                                'button',
                                { type: 'button', style: styles.primary, disabled: busyId !== '', onClick: () => review('accept', [item.id]) },
                                t('approve'),
                              ),
                              h(
                                'button',
                                { type: 'button', style: styles.button, disabled: busyId !== '', onClick: () => review('reject', [item.id]) },
                                t('reject'),
                              ),
                            ),
                          ),
                        ),
                      ),
                ),
          );

      const writeSection = section(
        t('addLabel'),
        h(
          'div',
          { style: styles.writeBox },
          h('textarea', {
            style: styles.textarea,
            rows: 3,
            value: draft,
            placeholder: t('addPlaceholder'),
            'aria-label': t('addLabel'),
            onChange: (event) => setDraft(event.target.value),
          }),
          h(
            'div',
            { style: styles.actions },
            h(
              'button',
              { type: 'button', style: styles.primary, disabled: saving || draft.trim() === '', onClick: saveMemory },
              saving ? t('addSaving') : t('addButton'),
            ),
          ),
        ),
      );

      const findSection = section(
        t('findTitle'),
        h(
          React.Fragment,
          null,
          h(
            'div',
            { style: styles.searchRow },
            h('input', {
              type: 'search',
              style: styles.input,
              value: query,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchTitle'),
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') find();
              },
            }),
            h(
              'button',
              { type: 'button', style: styles.button, disabled: searching || query.trim() === '', onClick: find },
              searching ? t('loading') : t('searchButton'),
            ),
          ),
          found
            ? found.error
              ? h('div', { style: styles.error }, t('searchError').replace('{err}', String(found.error)))
              : found.refused
                ? h('div', { style: styles.notice }, t('searchRefused'))
                : !Array.isArray(found.hits) || found.hits.length === 0
                  ? h('div', { style: styles.notice }, t('searchEmpty'))
                  : found.hits.map((hit) =>
                      h(
                        'div',
                        { key: 'hit-' + hit.id, style: styles.hitRow, onClick: () => openNote(hit.id) },
                        h('span', { style: styles.hitTitle }, hit.title || hit.id),
                        h(
                          'span',
                          { style: styles.hitScore },
                          typeof hit.score === 'number' ? Math.round(hit.score * 100) + '%' : '',
                        ),
                      ),
                    )
            : null,
          note
            ? h(
                'div',
                { style: styles.card },
                h(
                  'div',
                  { style: styles.cardTitle },
                  String(note.title || note.id || ''),
                  h(
                    'button',
                    { type: 'button', style: Object.assign({}, styles.button, { marginLeft: 8 }), onClick: () => setNote(null) },
                    t('closeNote'),
                  ),
                ),
                note.loading
                  ? h('div', { style: styles.notice }, t('loading'))
                  : note.error
                    ? h('div', { style: styles.error }, String(note.error))
                    : h(
                        React.Fragment,
                        null,
                        h('div', { style: styles.cardMeta }, (note.kind || 'semantic') + (note.scope ? ' · ' + note.scope : '') + (note.validFrom ? ' · ' + String(note.validFrom).slice(0, 10) : '')),
                        h('pre', { style: styles.noteBody }, String(note.body || '')),
                      ),
              )
            : null,
        ),
      );

      const activitySection = !status
        ? null
        : section(
            t('activityTitle'),
            h(
              React.Fragment,
              null,
              h('p', { style: styles.sub }, t('lastRecallLabel') + '：' + lastRecallLabel(status.lastRecall)),
              Array.isArray(status.lastRecall && status.lastRecall.titles) && status.lastRecall.titles.length
                ? h('p', { style: styles.recallTitles }, t('lrTitles') + '：' + status.lastRecall.titles.join(' / '))
                : null,
              quality && quality.total > 0
                ? h('div', null,
                  h('p', { style: styles.sub }, t('qualityLabel') + '：' + t('qualityTotal').replace('{n}', String(quality.total))
                    + ' · ' + t('qualityInjected') + ' ' + String((quality.byMode?.context || 0) + (quality.byMode?.notice || 0))
                    + ' · ' + t('qualityBlocked') + ' ' + String((quality.byMode?.suppressed || 0) + (quality.byMode?.judged_out || 0))
                    + ' · ' + t('qualityMissed') + ' ' + String((quality.byMode?.refused || 0) + (quality.byMode?.error || 0))),
                  quality.judge && (quality.judge.kept || quality.judge.dropped)
                    ? h('p', { style: styles.sub }, t('judgeQuality') + '：' + t('judgeKept') + ' ' + String(quality.judge.kept) + ' · ' + t('judgeDropped') + ' ' + String(quality.judge.dropped))
                    : null,
                  Array.isArray(quality.topMisses) && quality.topMisses.length
                    ? h('ul', { style: styles.weeklyList }, quality.topMisses.slice(0, 3).map((row, index) => h('li', { key: String(index), style: styles.weeklyItem },
                      t('qualityTopMiss') + '：', String(row.query), ' ×' + String(row.count))))
                    : null)
                : null,
              weekly
                ? h(
                    'div',
                    null,
                    h('p', { style: styles.sub }, t('weeklyLabel') + '：' + (weekly.notes_added > 0
                      ? String(weekly.notes_added) + ' 条新增' + (weekly.truncated > 0 ? '（' + t('weeklyMore').replace('{n}', String(weekly.truncated)) + '）' : '')
                      : t('weeklyNone'))),
                    Array.isArray(weekly.items) && weekly.items.length
                      ? h(
                          'ul',
                          { style: styles.weeklyList },
                          weekly.items.map((note) =>
                            h('li', { key: note.id, style: styles.weeklyItem }, String(note.valid_from || '').slice(0, 10) + ' ' + String(note.title || '')),
                          ),
                        )
                      : null,
                  )
                : null,
              older.items.length || older.total
                ? h(
                    'div',
                    null,
                    h('p', { style: styles.sub }, t('notesAll') + '：' + t('notesCount').replace('{n}', String(older.total))),
                    h(
                      'div',
                      { style: styles.filters },
                      h(
                        'select',
                        {
                          style: styles.select,
                          value: filters.kind,
                          onChange: (event) => applyFilters({ kind: event.target.value }),
                        },
                        h('option', { value: '' }, t('filterAllKinds')),
                        h('option', { value: 'semantic' }, t('filterSemantic')),
                        h('option', { value: 'procedural' }, t('filterProcedural')),
                      ),
                      h(
                        'select',
                        {
                          style: styles.select,
                          value: String(filters.days),
                          onChange: (event) => applyFilters({ days: Number(event.target.value) }),
                        },
                        h('option', { value: '0' }, t('filterAllTime')),
                        h('option', { value: '7' }, t('filter7')),
                        h('option', { value: '30' }, t('filter30')),
                        h('option', { value: '90' }, t('filter90')),
                      ),
                    ),
                    h(
                      'ul',
                      { style: styles.weeklyList },
                      older.items.map((note) =>
                        h(
                          'li',
                          {
                            key: note.id,
                            style: { ...styles.weeklyItem, cursor: 'pointer' },
                            onClick: () => openNote(note.id),
                          },
                          String(note.valid_from || '').slice(0, 10) + ' ' + String(note.title || ''),
                        ),
                      ),
                    ),
                    older.items.length < older.total
                      ? h(
                          'button',
                          { type: 'button', style: styles.button, onClick: loadOlder, disabled: older.loading },
                          older.loading ? t('notesLoading') : t('notesMore'),
                        )
                      : null,
                  )
                : null,
              audited && Array.isArray(audited.items) && audited.items.length
                ? h('div', null,
                  h('p', { style: styles.sub }, t('auditTitle')),
                  h('ul', { style: styles.weeklyList },
                    audited.items.slice(0, 8).map((entry, index) => h('li', { key: String(index), style: styles.weeklyItem },
                      h('span', { style: styles.auditMode }, auditModeLabel(entry.mode)),
                      ' · ',
                      String(entry.query || '—'),
                      entry.reason ? ' · ' + String(entry.reason) : '',
                    ))))
                : null,
            ),
          );

      const advancedSection = !status
        ? null
        : h(
            'details',
            { style: styles.details },
            h('summary', { style: styles.summary }, t('advancedTitle')),
            h('p', { style: styles.sub }, t('judgeLabel') + '：' + judgeLabel(status.judge)),
            hint(t('judgeHint')),
            h('p', { style: styles.sub }, t('consolidateLabel') + '：' + consolidateLabel(status.consolidate)),
            h('p', { style: styles.sub }, t('semLabel') + '：' + semState + (sem && sem.model ? ' · ' + String(sem.model) : '') + (sem && sem.endpoint ? ' · ' + String(sem.endpoint) : '')),
            hint(t('semHint')),
            hint(t('semSwitch')),
            h('p', { style: styles.sub }, t('store') + '：', h('span', { style: styles.code }, status.store)),
            h('p', { style: styles.sub }, t('capture') + '：' + captureLabel + ' · ' + t('index') + '：' + indexLabel),
            Array.isArray(status.warnings) && status.warnings.length
              ? h('div', { style: styles.notice }, t('warnings') + '：' + status.warnings.slice(0, 3).join('；'))
              : null,
          );

      return h(
        'div',
        { style: styles.root, 'data-tabellio-panel': '1' },
        h(
          'div',
          { style: styles.head },
          h('h2', { style: styles.title }, t('title')),
          h('button', { type: 'button', style: styles.button, onClick: load, disabled: state.loading }, t('refresh')),
        ),
        h('p', { style: styles.sub }, t('subtitle')),
        h('p', { style: styles.hint }, t('purpose')),

        state.error
          ? h('div', { style: styles.error }, String(state.error))
          : null,
        state.notice ? h('div', { style: styles.notice }, state.notice) : null,

        status
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { style: styles.metrics },
                metric(t('notes'), status.notes),
                metric(t('pending'), pendingTotal),
                metric(t('index'), indexLabel),
              ),
              h(
                'p',
                { style: styles.sub },
                t('capture') + '：' + captureLabel + ' · ' + t('mode') + '：' + modeLabel + ' · ' + t('semLabel') + '：' + semState,
              ),
              status.notes === 0
                ? h('div', { style: styles.firstRun }, t('firstRun'))
                : null,
              pendingSection,
              writeSection,
              findSection,
              activitySection,
              advancedSection,
            )
          : null,

        state.loading && !status
          ? h('div', { style: styles.notice }, t('loading'))
          : null,

        h(
          'div',
          { style: styles.footer },
          t('footer'),
        ),
      );
    }

    function apply(ctx) {
      const rpcCall = (endpoint, payload, signal) =>
        ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload, signal).then((result) => {
          if (!result || result.ok !== true) {
            throw new Error(result?.error?.message || 'RPC failed');
          }
          return result.value;
        });
      const translate = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'tabellio-dsh: locale dictionaries');
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'tabellio-dsh',
            order: 40,
            label: () => translate('section'),
            inject: () => ({ rpcCall, t: translate }),
          },
          MemoryPanel,
        ),
      );
    }

    return { name, inject, apply, MemoryPanel };
  },
});
