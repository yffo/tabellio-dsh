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
      lrTitles: '用到的记忆',
      judgedTag: '已裁决',
      judgeLabel: '模型裁决',
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
    };

    function MemoryPanel(props) {
      const { rpcCall, t } = props;
      const [state, setState] = useState({ loading: true, error: null, notice: '' });
      const [status, setStatus] = useState(null);
      const [items, setItems] = useState([]);
      const [proposalList, setProposalList] = useState([]);
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
        const hits = mode + ' · ' + t('lrHits').replace('{n}', String(last.count ?? 0));
        return time + ' · 「' + query + '」 · ' + hits + (last.judged ? ' · ' + t('judgedTag') : '');
      };
      const judgeLabel = (judge) => {
        if (!judge || judge.mode !== 'llm') return t('judgeOff');
        const last = judge.last || {};
        if (last.stage === 'verdict') return t('judgeReady') + ' · ' + t('judgeKept') + ' ' + String(last.kept ?? 0) + ' ' + t('notes');
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
                metric(t('candidates'), status.candidates),
                metric(t('proposals'), status.proposals),
                metric(t('mode'), modeLabel),
                metric(t('index'), indexLabel),
              ),
              h(
                'p',
                { style: styles.sub },
                t('store') + '：',
                h('span', { style: styles.code }, status.store),
                ' · ' + t('capture') + '：' + captureLabel,
              ),
              h('p', { style: styles.sub }, t('lastRecallLabel') + '：' + lastRecallLabel(status.lastRecall)),
              Array.isArray(status.lastRecall && status.lastRecall.titles) && status.lastRecall.titles.length
                ? h('p', { style: styles.recallTitles }, t('lrTitles') + '：' + status.lastRecall.titles.join(' / '))
                : null,
              h('p', { style: styles.sub }, t('judgeLabel') + '：' + judgeLabel(status.judge)),
              Array.isArray(status.warnings) && status.warnings.length
                ? h(
                    'div',
                    { style: styles.notice },
                    t('warnings') + '：' + status.warnings.slice(0, 3).join('；'),
                  )
                : null,
            )
          : null,

        state.loading && !status
          ? h('div', { style: styles.notice }, t('loading'))
          : null,

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
                      { key: 'hit-' + hit.id, style: styles.hitRow },
                      h('span', { style: styles.hitTitle }, hit.title || hit.id),
                      h(
                        'span',
                        { style: styles.hitScore },
                        typeof hit.score === 'number' ? Math.round(hit.score * 100) + '%' : '',
                      ),
                    ),
                  )
          : null,

        items.length === 0
          ? h('div', { style: styles.notice }, t('empty'))
          : items.map((item) =>
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
                    {
                      type: 'button',
                      style: styles.primary,
                      disabled: busyId !== '',
                      onClick: () => review('accept', [item.id]),
                    },
                    t('approve'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: styles.button,
                      disabled: busyId !== '',
                      onClick: () => review('reject', [item.id]),
                    },
                    t('reject'),
                  ),
                ),
              ),
            ),

        h('div', { style: styles.sectionTitle }, t('proposalsTitle')),
        proposalList.length === 0
          ? h('div', { style: styles.notice }, t('proposalsEmpty'))
          : proposalList.map((proposal) =>
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
