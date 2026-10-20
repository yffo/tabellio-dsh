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
      writeJudgeLabel: '写侧检查',
      writeJudgeOff: '关闭',
      writeJudgeKept: '保留 {kept}/{asked}',
      reflectLabel: '反思',
      reflectOff: '关闭',
      reflectCreated: '新增 {n} 条摘要',
      semOff: '未开启',
      semBuilding: '正在建索引',
      semReady: '已索引 {n} 条',
      semError: '不可用（嵌入服务连不上）',
      semHint: '语义补充需要本地 /v1/embeddings 服务；不可用时会自动退回词面召回，不影响其他功能。',
      settingsTitle: '设置',
      settingsHint: '这里改的是存储目录里的 panel-settings.json，不用编辑宿主配置；保存后立即生效。',
      settingsSemanticLocal: '本地嵌入',
      settingsEndpoint: '服务地址',
      settingsApiKey: 'API Key',
      settingsApiKeySet: '已设置（留空保持不变）',
      settingsApiKeyHint: '本地服务可留空；远程填服务商的 Key',
      settingsFetchModels: '获取模型',
      settingsModels: '模型列表',
      settingsModelPick: '从服务端选择一个模型…',
      settingsModel: '模型',
      settingsTest: '测试连接',
      settingsTestOk: '连接成功：{dims} 维，{ms}ms',
      settingsTestFail: '连接失败：{err}',
      settingsJudgeLlm: '开启（用小模型裁决）',
      settingsJudgeModel: '裁决模型',
      settingsJudgeDefault: '留空 = 跟随 DSH 当前默认模型',
      settingsCapture: '自动捕获',
      settingsDelivery: '记忆怎么给你',
      settingsDeliveryContext: '静默写上（不占对话）',
      settingsDeliveryNotice: '作为一条提示消息',
      settingsMaxNotes: '每轮最多给几条记忆',
      settingsSourceHint: '还有召回阈值、预算等进阶项：需要时改配置的 recallMin*/recallBudgetTokens。',
      settingsAssistant: '助手结论沉淀',
      settingsAssistantHint: '轮末把含结论的回复存成候选（需你批准）',
      settingsOutcome: '纠正反馈',
      settingsOutcomeHint: '用你说过的「不对」给召回排序降权',
      settingsSave: '保存设置',
      settingsSaved: '设置已保存并生效。',
      wizardRerun: '重新运行引导',
      wizardTitle: '首次设置',
      wizardStep1Title: '先决定它有多主动',
      wizardStep1Text: '智能记忆 = 语义召回 + 模型裁决。关掉只做本地词面匹配，更省资源但更容易漏。',
      wizardOnTitle: '开启智能记忆（推荐）',
      wizardOnText: '自动发现本机向量服务；每轮命中时用当前对话模型判断相关性。',
      wizardOffTitle: '先用基础模式',
      wizardOffText: '不调用模型、不需要向量服务；只靠关键词匹配。',
      wizardStep2Title: '记忆从哪儿检索',
      wizardStep2Text: '本机有向量服务就自动发现；也可以直接填远程的 OpenAI 兼容地址。',
      wizardLocalTitle: '本机自动发现',
      wizardLocalText: '扫描常见端口；发现失败就退回词面匹配。',
      wizardRemoteTitle: '远程向量服务',
      wizardRemoteText: '填 /v1/embeddings 地址、Key 和模型名。',
      wizardEndpointPlaceholder: 'https://api.example.com/v1/embeddings',
      wizardKeyPlaceholder: 'API Key（本地服务可留空）',
      wizardModelPlaceholder: '模型名，例如 text-embedding-3-small',
      wizardStep3Title: '存一条试试',
      wizardStep3Text: '写一条你希望它长期记住的事；也可以留空，之后在对话里说「记住：…」。',
      wizardNotePlaceholder: '比如：以后发版都走 tag + CI，不手动上传。',
      wizardLater: '稍后再说',
      wizardBack: '上一步',
      wizardNext: '下一步',
      wizardFinish: '完成',
      wizardDoneNotice: '设置完成，记忆已就绪。',
      approveAll: '全部批准',
      sourceConversation: '来自对话',
      sourceTool: '来自工具调用',
      sourceImport: '从旧库导入',
      sourceUnknown: '来源未知',
      rejectAll: '全部忽略',
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
      forgetButton: '忘掉这条',
      forgetConfirm: '确认忘掉这条记忆？自动召回将不再使用它；文件会保留，仍可审计。',
      forgetDone: '已忘掉，自动召回不再使用它。',
      editButton: '编辑',
      editTitle: '标题',
      editBody: '正文',
      editHint: '保存后会生成新版本，旧版本标记为被取代；自动召回改用新版本。',
      editSave: '保存修改',
      editCancel: '取消',
      editSaved: '已保存为新版本，旧版本标记为被取代。',
      editUnchanged: '内容和原来一样，没有生成新版本。',
      editTooLong: '超过单条 400 字上限，请精简后再保存。',
      provTitle: '来源与使用',
      provTimeline: '时间线',
      provTimelineEmpty: '还没有使用记录',
      provFrom: '写入来源',
      provTrust: '信任级别',
      provStatus: '状态',
      provActive: '有效',
      provSuperseded: '已被取代',
      provRecalls: '被用过',
      provRecalledN: '召回 {n} 次',
      provNever: '还没被召回',
      provTags: '标签',
      auditLabel: '最近召回记录',
      reasonNoIntent: '这句不像在问记忆，没带线索词',
      reasonConfident: '高置信直通（没线索但相关度很高）',
      reasonLowScore: '命中太弱，低于相关度门槛',
      reasonLowCoverage: '问句太长或太泛，命中词覆盖不够',
      reasonCooccurrence: '缺关键组合词，核心共现要求没满足',
      reasonJudgeNone: '模型判断这些记忆不回答此问题',
      reasonSameNotes: '与上轮相同，没有重复注入',
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
    conflictsTitle: '可能过时的记忆',
    conflictsHint: '同一主题、说法变了的笔记对。合并是人工动作：先预览，确认后旧笔记会被标记为「已被取代」，可回滚。',
    conflictsMerge: '预览并合并',
    conflictsPreviewTitle: '合并预览',
    conflictsPreviewHint: '确认后生成一条新笔记，旧的两条标记为已被取代；不对会污染检索。',
    conflictsConfirm: '确认合并',
    conflictsCancel: '取消',
    conflictsMerged: '已合并为 ',
    conflictsPreviewFailed: '这两条现在不能合并',
      feedbackAsk: '这条记忆准吗？',
      feedbackUseful: '有用',
      feedbackWrong: '不对 / 过时',
      feedbackRecorded: '已记录，后续排序会参考；不会改动笔记本身。',
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
      memChipLabel: '🧠 记忆',
      memChipTitle: '记忆 · tabellio',
      memChipEmpty: '没有待批准的候选。',
      memChipMore: '还有 {n} 条待批准…',
      memChipSettings: '完整面板在「设置 → 记忆」',
      memChipOpenPanel: '打开记忆面板',
      memClose: '关闭',
      memChipPending: '{n} 待批准',
      reviewFailTooLong: '候选超过单条 400 字上限，不能直接入库；请拆成两条事实分别记。',
      reviewFailNotFound: '候选已不存在（可能刚被处理过）。',
      reviewFailGeneric: '操作未生效：{reason}',
      memApprove: '批准',
      memIgnore: '忽略',
      footer: '候选只在候选区；批准后进入 notes/。自动捕获受 capture 配置约束，召回在 shadow 模式下只写回执。',
      judgeQuality: 'judge：上次保留 {kept} · 丢弃 {dropped}',
      pendingEmptyHint: '等对话里出现约定或纠错时，这里会有候选。',
      tabOverview: '概览',
      tabPending: '待批准',
      tabLibrary: '记忆库',
      tabSettings: '设置',
      smartLabel: '智能记忆',
      smartOn: '开启（语义 + 模型裁决）',
      smartOff: '关闭（只做词面匹配）',
      smartHint: '开启后自动发现本机向量服务，并用当前默认模型过滤误召回；没有向量服务时自动退回词面匹配。',
      advancedSettings: '进阶设置',
      groupSemantic: '语义检索',
      groupSemanticHint: '默认自动发现本机向量服务；用远程服务时填地址和 Key，再点「测试连接」确认。',
      groupBehavior: '使用偏好',
      settingsApiKeyHint2: 'Key 只存在记忆库里；也可以用环境变量 TABELLIO_SEMANTIC_API_KEY，更安全。',
      settingsEndpointAuto: '留空 = 自动发现',
      settingsModelAuto: '留空 = 自动发现',
      pendingNeedYou: '需要你决定',
      pendingNone: '暂无',
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
      writeJudgeLabel: 'Write check',
      writeJudgeOff: 'off',
      writeJudgeKept: 'kept {kept}/{asked}',
      reflectLabel: 'Reflect',
      reflectOff: 'off',
      reflectCreated: '{n} summary(ies)',
      semOff: 'off',
      semBuilding: 'indexing',
      semReady: '{n} notes indexed',
      semError: 'unavailable (embedding service unreachable)',
      semHint: 'The semantic supplement needs a local /v1/embeddings service. When it is unavailable, recall falls back to lexical matching and everything else keeps working.',
      settingsTitle: 'Settings',
      settingsHint: 'These are stored in panel-settings.json inside the memory folder, not in host config, and apply immediately.',
      settingsSemanticLocal: 'Local embeddings',
      settingsEndpoint: 'Endpoint',
      settingsApiKey: 'API key',
      settingsApiKeySet: 'Set (leave blank to keep)',
      settingsApiKeyHint: 'Blank for local services; paste the provider key for remote ones',
      settingsFetchModels: 'Fetch models',
      settingsModels: 'Models',
      settingsModelPick: 'Pick a model the endpoint reports…',
      settingsModel: 'Model',
      settingsTest: 'Test connection',
      settingsTestOk: 'Connected: {dims} dims in {ms}ms',
      settingsTestFail: 'Connection failed: {err}',
      settingsJudgeLlm: 'On (small model verdict)',
      settingsJudgeModel: 'Judge model',
      settingsJudgeDefault: 'Empty = use the current DSH default model',
      settingsAssistant: 'Assistant conclusions',
      settingsAssistantHint: 'Offer concluded answers as candidates at turn end',
      settingsOutcome: 'Correction feedback',
      settingsOutcomeHint: 'Demote recalled notes after a correction',
      settingsSave: 'Save settings',
      settingsSaved: 'Settings saved and applied.',
      wizardRerun: 'Run setup again',
      wizardTitle: 'First-run setup',
      wizardStep1Title: 'How active should memory be?',
      wizardStep1Text: 'Smart memory = semantic recall + model judging. Turn it off for lexical-only matching: lighter, but easier to miss things.',
      wizardOnTitle: 'Enable smart memory (recommended)',
      wizardOnText: 'Automatically finds a local embedding service and asks the current chat model to keep only relevant notes.',
      wizardOffTitle: 'Start basic',
      wizardOffText: 'No model calls and no embedding server; keyword matching only.',
      wizardStep2Title: 'Where should recall look?',
      wizardStep2Text: 'A local embedding service is detected automatically, or point at any OpenAI-compatible remote endpoint.',
      wizardLocalTitle: 'Auto-detect locally',
      wizardLocalText: 'Scans common ports, falls back to lexical matching if none is found.',
      wizardRemoteTitle: 'Remote embedding service',
      wizardRemoteText: 'Enter the /v1/embeddings endpoint, key, and model name.',
      wizardEndpointPlaceholder: 'https://api.example.com/v1/embeddings',
      wizardKeyPlaceholder: 'API key (leave empty for local services)',
      wizardModelPlaceholder: 'Model name, e.g. text-embedding-3-small',
      wizardStep3Title: 'Save your first memory',
      wizardStep3Text: 'Write one thing you want remembered; or leave it empty and say "remember: ..." in chat later.',
      wizardNotePlaceholder: 'For example: releases always go through tag + CI, never manual uploads.',
      wizardLater: 'Later',
      wizardBack: 'Back',
      wizardNext: 'Next',
      wizardFinish: 'Finish',
      wizardDoneNotice: 'Setup complete. Memory is ready.',
      approveAll: 'Approve all',
      sourceConversation: 'from conversation',
      sourceTool: 'from a tool call',
      sourceImport: 'imported',
      sourceUnknown: 'unknown source',
      rejectAll: 'Reject all',
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
      forgetButton: 'Forget this',
      forgetConfirm: 'Forget this memory? Automatic recall will stop using it; the file stays for audit.',
      forgetDone: 'Forgotten; automatic recall will not use it.',
      editButton: 'Edit',
      editTitle: 'Title',
      editBody: 'Body',
      editHint: 'Saving creates a new version and marks the old one as superseded; automatic recall switches to the new one.',
      editSave: 'Save changes',
      editCancel: 'Cancel',
      editSaved: 'Saved as a new version; the old one is marked superseded.',
      editUnchanged: 'Nothing changed, so no new version was created.',
      editTooLong: 'Over the 400-char limit for one note; shorten it first.',
      provTitle: 'Origin and usage',
      provTimeline: 'Timeline',
      provTimelineEmpty: 'No usage recorded yet',
      provFrom: 'Written by',
      provTrust: 'Trust',
      provStatus: 'Status',
      provActive: 'Active',
      provSuperseded: 'Superseded',
      provRecalls: 'Used',
      provRecalledN: 'recalled {n} times',
      provNever: 'Never recalled yet',
      provTags: 'Tags',
      auditLabel: 'Recent recalls',
      reasonNoIntent: 'No memory cue in the message',
      reasonConfident: 'Confident match without a cue',
      reasonLowScore: 'Match too weak (below relevance gate)',
      reasonLowCoverage: 'Question too broad (coverage gate)',
      reasonCooccurrence: 'Required term pair missing',
      reasonJudgeNone: 'Model judged these notes off-topic',
      reasonSameNotes: 'Same notes as the previous turn',
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
    conflictsTitle: 'Probably outdated memories',
    conflictsHint: 'Pairs on the same topic that started to say different things. Merging is human-gated: preview first; on confirm the old notes are retired and can be rolled back.',
    conflictsMerge: 'Preview & merge',
    conflictsPreviewTitle: 'Merge preview',
    conflictsPreviewHint: 'On confirm a new note is written and the old pair is marked superseded.',
    conflictsConfirm: 'Confirm merge',
    conflictsCancel: 'Cancel',
    conflictsMerged: 'Merged into ',
    conflictsPreviewFailed: 'These two notes cannot be merged right now',
    feedbackAsk: 'Was this memory accurate?',
    feedbackUseful: 'Helpful',
    feedbackWrong: 'Wrong / stale',
    feedbackRecorded: 'Feedback recorded; it nudges ranking only and never edits the note.',
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
      memChipLabel: '🧠 Memory',
      memChipTitle: 'Memory · tabellio',
      memChipEmpty: 'Nothing waiting for approval.',
      memChipMore: '{n} more waiting...',
      memChipSettings: 'Full panel lives in Settings → Memory',
      memChipOpenPanel: 'Open memory panel',
      memClose: 'Close',
      memChipPending: '{n} pending',
      reviewFailTooLong: 'The candidate is over the 400-char per-note cap, so it cannot be approved as one note; split it into two facts.',
      reviewFailNotFound: 'The candidate no longer exists (it may have just been handled).',
      reviewFailGeneric: 'The action did not apply: {reason}',
      memApprove: 'Approve',
      memIgnore: 'Dismiss',
      footer: 'Candidates stay in the inbox until approved. Capture is bounded by config; shadow recall only writes receipts.',
      judgeQuality: 'judge: last kept {kept} · dropped {dropped}',
      pendingEmptyHint: 'Candidates appear here when a conversation contains a promise or a correction.',
      tabOverview: 'Overview',
      tabPending: 'Review',
      tabLibrary: 'Library',
      tabSettings: 'Settings',
      smartLabel: 'Smart memory',
      smartOn: 'On (semantic + model judge)',
      smartOff: 'Off (lexical only)',
      smartHint: 'Finds a local embedding service automatically and uses the current default model to filter false recalls; without one it falls back to lexical matching.',
      advancedSettings: 'Advanced',
      groupSemantic: 'Semantic recall',
      groupSemanticHint: 'A local embedding service is discovered automatically. For a remote one, fill in the endpoint and key, then test the connection.',
      groupBehavior: 'Preferences',
      settingsApiKeyHint2: 'The key lives in the memory store; TABELLIO_SEMANTIC_API_KEY is the safer option.',
      settingsEndpointAuto: 'blank = auto-detect',
      settingsModelAuto: 'blank = auto-detect',
      pendingNeedYou: 'needs your call',
      pendingNone: 'none',
    };

    const WIZARD_KEY = 'tabellio-dsh:wizard-done';
    const wizardDone = () => {
      try {
        return typeof window === 'undefined' || window.localStorage.getItem(WIZARD_KEY) === '1';
      } catch {
        return true;
      }
    };
    const markWizardDone = () => {
      try {
        window.localStorage.setItem(WIZARD_KEY, '1');
      } catch {
        // private mode or storage disabled: the wizard simply shows again next time
      }
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
      formRow: { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' },
      formLabel: { width: 96, flexShrink: 0, color: COLORS.dim, fontSize: 12 },
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

    // ---- Panel design system -------------------------------------------------
    // One warm accent, a restrained neutral scale, and a little motion. The panel
    // is a working surface inside the app, not a marketing page: borders carry the
    // structure, color is reserved for state and the single primary action.
    const TONES = {
      neutral: 'var(--dsh-text-secondary, #78716c)',
      good: '#15803D',
      warn: '#B45309',
      bad: '#B91C1C',
      info: '#1D4ED8',
      accent: '#C2410C',
    };

    const ICON_PATHS = {
      refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6'],
      plus: ['M12 5v14', 'M5 12h14'],
      search: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M16.5 16.5 21 21'],
      check: ['M20 6 9 17l-5-5'],
      close: ['M18 6 6 18', 'M6 6l12 12'],
      inbox: ['M4 13l2.5-7h11L20 13', 'M4 13h4l1 2h6l1-2h4v6H4z'],
      gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5 2 2 0 1 1-4 0 1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3 2 2 0 1 1-2.8-2.8 1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9 2 2 0 1 1 2.8-2.8 1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5 2 2 0 1 1 4 0 1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3 2 2 0 1 1 2.8 2.8 1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1z'],
      clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
      book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
      spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z'],
      trash: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 11v5', 'M14 11v5'],
      eye: ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
      arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
      edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
    };

    function icon(name, size = 16) {
      const paths = ICON_PATHS[name] || ICON_PATHS.spark;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': 'true', style: { flex: 'none' },
      }, paths.map((d, index) => h('path', { key: index, d })));
    }

    let panelCssInjected = false;
    function ensurePanelCss() {
      if (panelCssInjected || typeof document === 'undefined' || !document.head) return;
      panelCssInjected = true;
      const style = document.createElement('style');
      style.setAttribute('data-tabellio-dsh', 'styles');
      style.textContent = [
        '@keyframes tbFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }',
        '[data-tabellio-panel] ::selection { background: rgba(194, 65, 12, 0.18); }',
        '[data-tabellio-panel] button { transition: background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease, transform .06s ease; }',
        '[data-tabellio-panel] button:active:not(:disabled) { transform: translateY(1px); }',
        '[data-tabellio-panel] button:disabled { opacity: .55; cursor: default; }',
        '[data-tabellio-panel] :focus-visible { outline: 2px solid rgba(194, 65, 12, .45); outline-offset: 2px; border-radius: 6px; }',
        '[data-tabellio-panel] details > summary { list-style: none; }',
        '[data-tabellio-panel] details > summary::-webkit-details-marker { display: none; }',
        '[data-tabellio-panel] details > summary svg { transition: transform .16s ease; }',
        '[data-tabellio-panel] details[open] > summary svg { transform: rotate(180deg); }',
        '[data-tabellio-panel] input, [data-tabellio-panel] select, [data-tabellio-panel] textarea { transition: border-color .15s ease, box-shadow .15s ease; }',
        '[data-tabellio-panel] input:focus, [data-tabellio-panel] select:focus, [data-tabellio-panel] textarea:focus { border-color: rgba(194, 65, 12, .55); }',
        '[data-tabellio-panel] ::-webkit-scrollbar { width: 10px; height: 10px; }',
        '[data-tabellio-panel] ::-webkit-scrollbar-thumb { background: rgba(120, 113, 108, .28); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }',
        '[data-tabellio-panel] ::-webkit-scrollbar-thumb:hover { background: rgba(120, 113, 108, .45); background-clip: padding-box; }',
      ].join('\n');
      document.head.appendChild(style);
    }

    const ui = {
      root: {
        padding: '18px 20px 6px', color: COLORS.text, fontSize: 13.5, lineHeight: 1.6,
        display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 880,
      },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
      headerText: { minWidth: 0 },
      title: { margin: 0, fontSize: 19, fontWeight: 650, letterSpacing: '-0.015em' },
      titleChip: {
        display: 'inline-block', marginLeft: 8, padding: '1px 7px', borderRadius: 999,
        border: '1px solid ' + COLORS.border, color: COLORS.dim, fontSize: 11, fontWeight: 500,
        verticalAlign: '2px',
      },
      subtitle: { margin: '4px 0 0', color: COLORS.dim, fontSize: 12.5 },
      headerActions: { display: 'flex', gap: 6, flexShrink: 0 },
      iconButton: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
        borderRadius: 9, border: '1px solid ' + COLORS.border, background: 'transparent',
        color: COLORS.dim, cursor: 'pointer',
      },
      tabs: { display: 'flex', gap: 2, borderBottom: '1px solid ' + COLORS.border },
      tab: {
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 10px', marginBottom: -1,
        border: 'none', borderBottom: '2px solid transparent', background: 'transparent',
        color: COLORS.dim, fontSize: 13, cursor: 'pointer', borderRadius: '8px 8px 0 0',
      },
      tabActive: {
        color: TONES.accent, borderBottomColor: TONES.accent,
        background: 'rgba(194, 65, 12, 0.06)', fontWeight: 600,
      },
      tabBadge: {
        minWidth: 16, height: 16, padding: '0 5px', borderRadius: 999, background: TONES.accent,
        color: '#fff', fontSize: 10.5, lineHeight: '16px', textAlign: 'center', fontWeight: 600,
      },
      tabBody: { display: 'flex', flexDirection: 'column', gap: 14, animation: 'tbFade .18s ease-out' },
      stats: {
        display: 'flex', border: '1px solid ' + COLORS.border, borderRadius: 12, overflow: 'hidden',
        background: 'transparent',
      },
      stat: { flex: 1, padding: '10px 14px', minWidth: 0, borderRight: '1px solid ' + COLORS.border },
      statValue: { fontSize: 19, fontWeight: 650, letterSpacing: '-0.015em', fontVariantNumeric: 'tabular-nums' },
      statLabel: { fontSize: 12, color: COLORS.dim },
      statHint: { fontSize: 11, color: COLORS.dim, opacity: 0.8, marginTop: 1 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
        border: '1px solid ' + COLORS.border, borderRadius: 999, fontSize: 12,
      },
      dot: { width: 6, height: 6, borderRadius: 999, flexShrink: 0 },
      chipLabel: { color: COLORS.dim },
      chipValue: { fontWeight: 550 },
      card: { border: '1px solid ' + COLORS.border, borderRadius: 14, overflow: 'hidden', background: 'transparent' },
      cardHead: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        padding: '12px 16px', borderBottom: '1px solid ' + COLORS.border,
      },
      cardTitle: { margin: 0, fontSize: 14, fontWeight: 620 },
      cardBody: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
      empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '26px 18px', gap: 6 },
      emptyIcon: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44,
        borderRadius: 999, border: '1px dashed ' + COLORS.border, color: COLORS.dim, marginBottom: 2,
      },
      emptyTitle: { fontSize: 14, fontWeight: 600 },
      emptyText: { margin: 0, color: COLORS.dim, fontSize: 12.5, maxWidth: 420 },
      noteRow: {
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
        width: '100%', padding: '9px 2px', border: 'none', borderBottom: '1px dashed ' + COLORS.border,
        background: 'transparent', color: COLORS.text, fontSize: 13, cursor: 'pointer', textAlign: 'left',
      },
      noteTitle: { minWidth: 0, overflowWrap: 'anywhere' },
      noteMeta: { display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, color: COLORS.dim, fontSize: 11.5 },
      noteDate: { fontVariantNumeric: 'tabular-nums' },
      kindBadge: {
        padding: '0 6px', borderRadius: 6, border: '1px solid ' + COLORS.border,
        fontSize: 10.5, color: COLORS.dim, lineHeight: '16px',
      },
      notesHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
      list: { display: 'flex', flexDirection: 'column' },
      filters: { display: 'flex', gap: 8, flexWrap: 'wrap' },
      select: {
        fontSize: 12, padding: '4px 8px', borderRadius: 8, color: COLORS.text,
        border: '1px solid ' + COLORS.border, background: 'transparent',
      },
      searchRow: { display: 'flex', gap: 8 },
      searchIcon: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
        border: '1px solid ' + COLORS.border, borderRadius: 9, color: COLORS.dim, flexShrink: 0,
      },
      input: {
        flex: 1, minWidth: 0, padding: '8px 11px', fontSize: 13, color: COLORS.text,
        background: 'transparent', border: '1px solid ' + COLORS.border, borderRadius: 9,
      },
      inputSmall: { width: 76, padding: '6px 9px', fontSize: 13, color: COLORS.text, background: 'transparent', border: '1px solid ' + COLORS.border, borderRadius: 9 },
      textarea: {
        width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 72,
        fontSize: 13, lineHeight: 1.65, padding: '10px 12px', borderRadius: 10,
        border: '1px solid ' + COLORS.border, background: 'transparent', color: COLORS.text, fontFamily: 'inherit',
      },
      composer: { display: 'flex', flexDirection: 'column', gap: 8 },
      composerFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
      button: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        border: '1px solid ' + COLORS.border, background: 'transparent', color: COLORS.text,
        borderRadius: 9, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap',
      },
      buttonPrimary: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        border: '1px solid transparent', background: TONES.accent, color: '#fff',
        borderRadius: 9, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap',
      },
      buttonGhost: {
        display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid transparent',
        background: 'transparent', color: COLORS.dim, borderRadius: 8, padding: '5px 8px',
        fontSize: 12.5, cursor: 'pointer',
      },
      saveRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      group: { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', border: '1px solid ' + COLORS.border, borderRadius: 12 },
      groupHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
      groupLabel: { fontSize: 12.5, fontWeight: 600 },
      groupActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      reviewCard: {
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14,
        border: '1px solid ' + COLORS.border, borderRadius: 12, padding: '12px 14px',
      },
      reviewMain: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
      reviewTitle: { fontSize: 13.5, fontWeight: 560, overflowWrap: 'anywhere' },
      reviewMeta: { color: COLORS.dim, fontSize: 11.5, display: 'flex', gap: 8, flexWrap: 'wrap' },
      reviewActions: { display: 'flex', gap: 6, flexShrink: 0 },
      badge: {
        display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11,
        border: '1px solid ' + COLORS.border, color: COLORS.dim,
      },
      goodBadge: {
        display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11,
        border: '1px solid ' + COLORS.good, color: COLORS.good,
      },
      badBadge: {
        display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11,
        border: '1px solid ' + COLORS.bad, color: COLORS.bad,
      },
      recallReason: { marginTop: 4, fontSize: 12, color: COLORS.dim, lineHeight: 1.5 },
      auditList: { display: 'flex', flexDirection: 'column' },
      auditRow: { display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 0', borderBottom: '1px solid ' + COLORS.border },
      auditHead: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      auditQuery: { fontSize: 12.5, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      auditMeta: { fontSize: 11.5, color: COLORS.dim, lineHeight: 1.5 },
      timeline: { display: 'flex', flexDirection: 'column', gap: 2 },
      timelineRow: { display: 'flex', gap: 10, fontSize: 11.5, lineHeight: 1.6 },
      editForm: { display: 'flex', flexDirection: 'column', gap: 6 },
      editArea: { width: '100%', boxSizing: 'border-box', minHeight: 160, padding: '10px 12px', borderRadius: 10, border: '1px solid ' + COLORS.border, background: COLORS.surface, color: COLORS.text, fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical' },
      timelineAt: { color: COLORS.dim, minWidth: 118, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
      timelineText: { color: COLORS.text, minWidth: 0 },
      provBox: { marginTop: 14, paddingTop: 12, borderTop: '1px solid ' + COLORS.border, display: 'flex', flexDirection: 'column', gap: 6 },
      provTitle: { fontSize: 12, fontWeight: 650, color: COLORS.dim, letterSpacing: '.02em' },
      provRow: { display: 'flex', gap: 10, fontSize: 12, lineHeight: 1.6 },
      provLabel: { color: COLORS.dim, minWidth: 56 },
      recallLine: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
      recallQuery: { fontSize: 13.5, fontWeight: 550, overflowWrap: 'anywhere' },
      recallMeta: { color: COLORS.dim, fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap' },
      recallTitles: { margin: '2px 0 0', paddingLeft: 18, color: COLORS.dim, fontSize: 12.5 },
      metricRow: { display: 'flex', gap: 20, flexWrap: 'wrap' },
      metric: { minWidth: 92 },
      metricValue: { fontSize: 20, fontWeight: 650, letterSpacing: '-0.015em', fontVariantNumeric: 'tabular-nums' },
      metricLabel: { fontSize: 12, color: COLORS.dim },
      missList: { display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyle: 'none' },
      missRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: 12.5 },
      missText: { minWidth: 0, overflowWrap: 'anywhere', color: COLORS.text },
      missTag: { color: COLORS.dim, fontSize: 11.5, flexShrink: 0 },
      hitRow: {
        display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', padding: '8px 2px',
        border: 'none', borderBottom: '1px dashed ' + COLORS.border, background: 'transparent',
        color: COLORS.text, fontSize: 13, cursor: 'pointer', textAlign: 'left',
      },
      hitTitle: { minWidth: 0, overflowWrap: 'anywhere' },
      score: { color: COLORS.dim, flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 12 },
      muted: { color: COLORS.dim, fontSize: 12.5, margin: 0 },
      firstRun: {
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
        border: '1px dashed ' + COLORS.border, borderRadius: 12, color: COLORS.dim, fontSize: 12.5,
      },
      firstRunDot: {
        width: 8, height: 8, borderRadius: 999, background: TONES.accent, marginTop: 6, flexShrink: 0,
      },
      storeLine: { color: COLORS.dim, fontSize: 11.5, overflowWrap: 'anywhere' },
      okLine: { display: 'flex', alignItems: 'center', gap: 6, color: TONES.good, fontSize: 12.5 },
      warnBox: {
        display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px',
        border: '1px solid rgba(180, 83, 9, .35)', borderRadius: 10,
        background: 'rgba(180, 83, 9, .06)', color: TONES.warn, fontSize: 12,
      },
      errorBanner: {
        padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(185, 28, 28, .35)',
        background: 'rgba(185, 28, 28, .06)', color: TONES.bad, fontSize: 12.5, overflowWrap: 'anywhere',
      },
      fieldRow: { display: 'flex', gap: 8, alignItems: 'center', flex: 1 },
      testRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      details: { marginTop: 4, borderTop: '1px solid ' + COLORS.border, paddingTop: 4 },
      summary: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: COLORS.dim, padding: '10px 0 2px', userSelect: 'none' },
      formBody: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 2px 2px' },
      sect: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14, marginTop: 4, borderTop: '1px solid ' + COLORS.border },
      sectTitle: { margin: 0, fontSize: 12.5, fontWeight: 650, letterSpacing: '.02em' },
      sectHint: { margin: 0, color: COLORS.dim, fontSize: 12, lineHeight: 1.55 },
      rowHint: { margin: 0, color: COLORS.dim, fontSize: 11.5, lineHeight: 1.5 },
      statusLine: { margin: 0, color: COLORS.dim, fontSize: 12 },
      stack: { display: 'flex', flexDirection: 'column', gap: 4 },
      controlRow: { display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', alignItems: 'start', gap: 12, minHeight: 34 },
      controlLabel: { color: COLORS.dim, fontSize: 12.5, paddingTop: 9, lineHeight: 1.35 },
      wizardPanel: {
        position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 16,
        width: 'min(560px, calc(100vw - 40px))', padding: '20px 22px 18px',
        border: '1px solid ' + COLORS.border, borderRadius: 16, background: COLORS.card,
        boxShadow: '0 18px 50px rgba(28, 25, 23, .22)',
      },
      wizardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      wizardDots: { display: 'flex', gap: 6 },
      wizardDot: { width: 6, height: 6, borderRadius: 999, background: 'rgba(120, 113, 108, .28)' },
      wizardDotActive: { width: 18, height: 6, borderRadius: 999, background: TONES.accent, transition: 'width .18s ease' },
      wizardTitle: { margin: 0, fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' },
      wizardText: { margin: 0, color: COLORS.dim, fontSize: 13, lineHeight: 1.65 },
      choiceRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
      choice: {
        flex: '1 1 200px', textAlign: 'left', padding: '12px 14px', borderRadius: 12,
        border: '1px solid ' + COLORS.border, background: 'transparent', color: COLORS.text,
        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
      },
      choiceActive: { borderColor: 'rgba(194, 65, 12, .5)', background: 'rgba(194, 65, 12, .06)' },
      choiceTitle: { fontSize: 13.5, fontWeight: 600 },
      choiceText: { fontSize: 12, color: COLORS.dim, lineHeight: 1.55 },
      wizardFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 6 },
      smartRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '2px 0 2px' },
      smartText: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
      smartTitle: { fontSize: 13.5, fontWeight: 620 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '2px 0 2px' },
      sectPanel: { display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', marginTop: 12, border: '1px solid ' + COLORS.border, borderRadius: 12, background: 'rgba(120, 113, 108, .045)' },
      kvList: { display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 16px' },
      kvRow: { display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', gap: 12, alignItems: 'baseline', fontSize: 12.5 },
      kvLabel: { color: COLORS.dim, fontSize: 12 },
      toast: {
        position: 'sticky', top: 0, zIndex: 30, alignSelf: 'center', padding: '6px 14px',
        borderRadius: 999, background: 'rgba(28, 25, 23, .92)', color: '#fff', fontSize: 12,
        boxShadow: '0 6px 18px rgba(0,0,0,.18)',
      },
      skeleton: { display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' },
      skeletonRow: {
        height: 14, borderRadius: 6, background: 'rgba(120,113,108,.16)',
        animation: 'tbFade .9s ease-in-out infinite alternate',
      },
      overlayInline: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        margin: '0 0 12px',
      },
      wizardPanelInline: {
        width: '100%',
        maxWidth: '100%',
        background: COLORS.bg,
        border: '1px solid ' + COLORS.border,
        borderRadius: 14,
        padding: '22px 24px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      },
      overlayPanelInline: {
        width: '100%',
        maxWidth: '100%',
        background: COLORS.bg,
        border: '1px solid ' + COLORS.border,
        borderRadius: 14,
        padding: '18px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      },
      overlay: { position: 'fixed', inset: 0, zIndex: 1000 },
      overlayMask: {
        position: 'fixed', inset: 0, background: 'rgba(20, 18, 16, .38)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      },
      overlayPanel: {
        width: '100%', maxWidth: 720, maxHeight: '82vh', borderRadius: 16, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', background: 'var(--dsh-surface, #fff)',
        border: '1px solid ' + COLORS.border, boxShadow: '0 24px 60px rgba(0,0,0,.22)',
      },
      overlayHead: {
        flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '14px 18px', borderBottom: '1px solid ' + COLORS.border,
      },
      overlayTitle: { margin: 0, fontSize: 14.5, fontWeight: 620, overflowWrap: 'anywhere' },
      overlayMeta: { color: COLORS.dim, fontSize: 11.5, marginTop: 2 },
      actionRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0 2px', borderTop: '1px solid ' + COLORS.border, marginTop: 14, flexWrap: 'wrap' },
      overlayBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px 20px' },
      noteBody: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.75, margin: 0 },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5 },
      footer: { color: COLORS.dim, fontSize: 11.5, padding: '2px 0 10px', borderTop: '1px solid ' + COLORS.border, marginTop: 2, paddingTop: 8 },
    };

    function MemoryPanel(props) {
      const { rpcCall, t } = props;
      const [tab, setTab] = useState('overview');
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
      const [editing, setEditing] = useState(null);
      const [wizard, setWizard] = useState(() => ({
        open: !wizardDone(),
        step: 0,
        smart: true,
        mode: 'local',
        endpoint: '',
        model: '',
        apiKey: '',
        note: '',
        error: '',
        busy: false,
      }));
      const openWizard = () => setWizard({
        open: true, step: 0, smart: true, mode: 'local',
        endpoint: '', model: '', apiKey: '', note: '', error: '', busy: false,
      });
      const closeWizard = () => {
        markWizardDone();
        setWizard((prev) => ({ ...prev, open: false, error: '' }));
      };
      const finishWizard = async () => {
        setWizard((prev) => ({ ...prev, busy: true, error: '' }));
        try {
          const patch = {
            semantic: wizard.smart ? (wizard.mode === 'off' ? 'auto' : 'auto') : 'off',
            judge: wizard.smart ? 'llm' : 'off',
          };
          if (wizard.smart && wizard.mode === 'remote') {
            patch.semanticEndpoint = wizard.endpoint.trim();
            patch.semanticModel = wizard.model.trim();
            if (wizard.apiKey.trim()) patch.semanticApiKey = wizard.apiKey.trim();
          }
          await rpcCall('settings.set', patch);
          if (wizard.note.trim()) {
            await rpcCall('remember', { content: wizard.note.trim() });
          }
          markWizardDone();
          setWizard((prev) => ({ ...prev, open: false, busy: false }));
          await load();
          setState((prev) => ({ ...prev, notice: t('wizardDoneNotice'), error: null }));
        } catch (error) {
          setWizard((prev) => ({ ...prev, busy: false, error: error?.message ?? String(error) }));
        }
      };
      const [draft, setDraft] = useState('');
      const [saving, setSaving] = useState(false);
      const [busyId, setBusyId] = useState('');
      const [query, setQuery] = useState('');
      const [found, setFound] = useState(null);
      const [searching, setSearching] = useState(false);
      const [settingsView, setSettingsView] = useState(null);
      const [settingsDraft, setSettingsDraft] = useState(null);
      const [settingsSaving, setSettingsSaving] = useState(false);
      const [semanticTest, setSemanticTest] = useState(null);
      const [models, setModels] = useState({ loading: false, list: [], error: '' });
  const [conflicts, setConflicts] = useState(null);
  const [conflictPreview, setConflictPreview] = useState(null);
  const [judgeSample, setJudgeSample] = useState(null);

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
          try {
            const view = await rpcCall('settings.get', {});
            setSettingsView(view);
            setSettingsDraft({
              semanticApiKey: '',
              semantic: view.semantic?.mode || 'off',
              semanticEndpoint: view.semantic?.endpoint || '',
              semanticModel: view.semantic?.model || '',
              judge: view.judge?.mode || 'off',
              judgeModel: '',
              judgeProvider: view.judge?.provider || '',
              consolidate: view.consolidate?.mode || 'off',
              capture: view.capture?.mode || 'off',
              delivery: view.delivery?.mode || 'context',
              recallMaxNotes: String(view.recallMaxNotes || 6),
              captureAssistant: view.captureAssistant === true,
              outcomeFeedback: view.outcomeFeedback !== false,
            });
          } catch {
            setSettingsView(null);
          }
          setState((prev) => ({ ...prev, loading: false, error: null }));
        } catch (error) {
          setState((prev) => ({ ...prev, loading: false, error: error?.message ?? String(error) }));
        }
      }, [rpcCall]);

      useEffect(() => {
        load();
      }, [load]);

      const loadJudgeSample = useCallback(async () => {
        try {
          setJudgeSample(await rpcCall('judge.recent', { limit: 8 }));
        } catch {
          // older host: no sampling endpoints yet
        }
      }, [rpcCall]);

      useEffect(() => {
        rpcCall('conflicts.list', { days: 30, limit: 6 })
          .then((result) => setConflicts(result))
          .catch(() => {});
      }, [rpcCall]);

      useEffect(() => {
        loadJudgeSample();
      }, [loadJudgeSample]);

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
          setEditing(null);
          setNote({ id, loading: true });
          try {
            const [result, provenance, timeline] = await Promise.all([
              rpcCall('read', { id }),
              rpcCall('provenance', { id }).catch(() => null),
              rpcCall('timeline', { id }).catch(() => null),
            ]);
            setNote({ ...result, provenance, timeline, loading: false });
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
            if (failed.length) notice += ' ' + t('failedOne').replace('{n}', String(failed.length)) + ' ' + failureText(failed[0]?.reason);
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

      const savePanelSettings = useCallback(async () => {
        if (!settingsDraft) return;
        setSettingsSaving(true);
        try {
          const payload = { ...settingsDraft, recallMaxNotes: Number(settingsDraft.recallMaxNotes) || 6 };
          // An empty key field means "keep whatever is stored"; only send a key
          // the user actually typed in this session.
          if (!payload.semanticApiKey) delete payload.semanticApiKey;
          const view = await rpcCall('settings.set', payload);
          setSettingsView(view);
          setState((prev) => ({ ...prev, notice: t('settingsSaved'), error: null }));
          await load();
        } catch (error) {
          setState((prev) => ({ ...prev, notice: '', error: error?.message ?? String(error) }));
        } finally {
          setSettingsSaving(false);
        }
      }, [settingsDraft, rpcCall, load, t]);

      const runSemanticTest = useCallback(async () => {
        setSemanticTest({ loading: true });
        try {
          const result = await rpcCall('semantic.test', {
            endpoint: settingsDraft?.semanticEndpoint || undefined,
            model: settingsDraft?.semanticModel || undefined,
            apiKey: settingsDraft?.semanticApiKey || undefined,
          });
          setSemanticTest(result);
        } catch (error) {
          setSemanticTest({ ok: false, error: String(error?.message ?? error) });
        }
      }, [rpcCall, settingsDraft]);

      const fetchModels = useCallback(async () => {
        setModels({ loading: true, list: [], error: '' });
        try {
          const result = await rpcCall('semantic.models', {
            endpoint: settingsDraft?.semanticEndpoint || undefined,
            apiKey: settingsDraft?.semanticApiKey || undefined,
          });
          setModels({ loading: false, list: Array.isArray(result?.models) ? result.models : [], error: result?.error ? String(result.error) : '' });
        } catch (error) {
          setModels({ loading: false, list: [], error: String(error?.message ?? error) });
        }
      }, [rpcCall, settingsDraft]);

      // Review failures used to be silent: a >400-char candidate can never be
      // approved (the write gate answers too_long), so say it instead of
      // leaving the button looking dead.
      const failureText = (reason) => {
        if (reason === 'too_long') return t('reviewFailTooLong');
        if (reason === 'candidate_not_found') return t('reviewFailNotFound');
        return t('reviewFailGeneric').replace('{reason}', String(reason || 'unknown'));
      };
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
      const sourceLabel = (source) => {
        const text = String(source || '');
        if (text.startsWith('dsh:')) return t('sourceConversation');
        if (text.startsWith('capture:')) return t('sourceTool');
        if (text.startsWith('import:')) return t('sourceImport');
        return text || t('sourceUnknown');
      };
      const auditModeLabel = (mode) => {
        const map = {
          shadow: 'audShadow', notice: 'audNotice', context: 'audContext',
          suppressed: 'audSuppressed', refused: 'audRefused', judged_out: 'audJudged',
          deduped: 'audDeduped', error: 'audError',
        };
        return t(map[mode] || 'audUnknown');
      };

      const reasonLabel = (reason) => {
        if (!reason) return '';
        const map = {
          no_memory_intent: 'reasonNoIntent',
          confident_hit: 'reasonConfident',
          top_score_below_threshold: 'reasonLowScore',
          below_min_coverage: 'reasonLowCoverage',
          cooccurrence_required_pair_missing: 'reasonCooccurrence',
          llm_judge_kept_none: 'reasonJudgeNone',
          same_notes_as_last_time: 'reasonSameNotes',
        };
        return map[reason] ? t(map[reason]) : String(reason);
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

      ensurePanelCss();

      const sem = status ? status.semantic : null;
      const semState = !sem || sem.mode === 'off'
        ? t('semOff')
        : sem.probing
          ? t('semBuilding')
          : sem.ready
            ? t('semReady').replace('{n}', String(sem.size))
            : sem.error ? t('semError') : t('semBuilding');
      const pendingTotal = status ? Number(status.candidates || 0) + Number(status.proposals || 0) : 0;
      const hasPendingLabel = (count) => (count > 0 ? t('pendingNeedYou') : t('pendingNone'));
      const canReview = busyId === '';

      const chip = (label, value, tone) => h('div', { style: ui.chip, key: label + value },
        h('span', { style: Object.assign({}, ui.dot, { background: tone || TONES.neutral }) }),
        h('span', { style: ui.chipLabel }, label),
        h('span', { style: ui.chipValue }, value),
      );

      const stat = (label, value, hintText) => h('div', { style: ui.stat },
        h('div', { style: ui.statValue }, value),
        h('div', { style: ui.statLabel }, label),
        hintText ? h('div', { style: ui.statHint }, hintText) : null,
      );

      const card = (title, children, extra) => h('section', { style: ui.card },
        h('div', { style: ui.cardHead },
          h('h3', { style: ui.cardTitle }, title),
          extra || null,
        ),
        h('div', { style: ui.cardBody }, children),
      );

      const emptyState = (iconName, title, text, action) => h('div', { style: ui.empty },
        h('div', { style: ui.emptyIcon }, icon(iconName, 22)),
        h('div', { style: ui.emptyTitle }, title),
        text ? h('p', { style: ui.emptyText }, text) : null,
        action || null,
      );

      const noteRow = (note, key) => h('button', {
        key,
        type: 'button',
        style: ui.noteRow,
        onClick: () => openNote(note.id),
      },
        h('span', { style: ui.noteTitle }, String(note.title || note.id || '')),
        h('span', { style: ui.noteMeta }, h('span', { style: ui.noteDate }, String(note.valid_from || note.validFrom || '').slice(0, 10))),
      );

      const overview = status ? [
        h('div', { style: ui.stats, key: 'stats' },
          stat(t('notes'), String(status.notes)),
          stat(t('pending'), String(pendingTotal), hasPendingLabel(pendingTotal)),
          stat(t('index'), indexLabel),
        ),
        h('div', { style: ui.chips, key: 'chips' },
          chip(t('mode'), modeLabel, status.mode === 'inject' ? TONES.good : status.mode === 'shadow' ? TONES.info : TONES.neutral),
          chip(t('capture'), captureLabel, status.capture === 'off' ? TONES.neutral : TONES.accent),
          chip(t('semLabel'), semState, sem && sem.mode !== 'off' ? TONES.info : TONES.neutral),
          chip(t('consolidateLabel'), status.consolidate && status.consolidate.mode !== 'off' ? consolidateLabel(status.consolidate) : t('consOff'), status.consolidate && status.consolidate.mode !== 'off' ? TONES.good : TONES.neutral),
        ),
        status.notes === 0
          ? h('div', { key: 'firstrun', style: ui.firstRun }, h('div', { style: ui.firstRunDot }), t('firstRun'))
          : null,
        card(t('lastRecallLabel'), status.lastRecall
          ? h(React.Fragment, null,
              h('div', { style: ui.recallLine },
                h('span', { style: ui.badge }, auditModeLabel(status.lastRecall.mode)),
                h('span', { style: ui.recallQuery }, '「' + String(status.lastRecall.query || '').slice(0, 60) + '」'),
                h('span', { style: ui.recallMeta }, t('lrHits').replace('{n}', String(status.lastRecall.count ?? 0)) + (status.lastRecall.elapsedMs ? ' · ' + status.lastRecall.elapsedMs + 'ms' : '')),
              ),
              status.lastRecall.reason
                ? h('div', { style: ui.recallReason }, reasonLabel(status.lastRecall.reason))
                : null,
              h(React.Fragment, null,
              ),
              new Date(status.lastRecall.at).toLocaleString(),
              Array.isArray(status.lastRecall.titles) && status.lastRecall.titles.length
                ? h('div', { style: ui.recallTitles }, status.lastRecall.titles.map((title, index) => h('span', { key: index, style: ui.titleChip }, title)))
                : null,
            )
          : h('p', { style: ui.muted }, t('lastRecallNone'))),
        quality && quality.total > 0
          ? card(t('qualityLabel'), h(React.Fragment, null,
              h('div', { style: ui.metricRow },
                h('div', { style: ui.metric },
                  h('div', { style: ui.metricValue }, String(quality.total)),
                  h('div', { style: ui.metricLabel }, t('qualityTotal').replace('{n}', '').trim())),
                h('div', { style: ui.metric },
                  h('div', { style: ui.metricValue }, String((quality.byMode?.context || 0) + (quality.byMode?.notice || 0))),
                  h('div', { style: ui.metricLabel }, t('qualityInjected'))),
                h('div', { style: ui.metric },
                  h('div', { style: ui.metricValue }, String((quality.byMode?.suppressed || 0) + (quality.byMode?.judged_out || 0))),
                  h('div', { style: ui.metricLabel }, t('qualityBlocked'))),
                h('div', { style: ui.metric },
                  h('div', { style: ui.metricValue }, String((quality.byMode?.refused || 0) + (quality.byMode?.error || 0))),
                  h('div', { style: ui.metricLabel }, t('qualityMissed'))),
              ),
              quality.judge && (quality.judge.kept || quality.judge.dropped)
                ? h('p', { style: ui.muted }, t('judgeQuality') + '：' + t('judgeKept') + ' ' + String(quality.judge.kept) + ' · ' + t('judgeDropped') + ' ' + String(quality.judge.dropped))
                : null,
              Array.isArray(quality.topMisses) && quality.topMisses.length
                ? h('div', { style: ui.missList }, quality.topMisses.slice(0, 3).map((row, index) =>
                    h('div', { key: 'miss-' + index, style: ui.missRow },
                      h('span', { style: ui.missTag }, '×' + String(row.count)),
                      h('span', { style: ui.missText }, String(row.query)))))
                : null,
            ))
          : null,
        weekly
          ? card(t('weeklyLabel'), h(React.Fragment, null,
              h('p', { style: ui.muted }, weekly.notes_added > 0
                ? String(weekly.notes_added) + ' ' + t('notes') + (weekly.truncated > 0 ? '（' + t('weeklyMore').replace('{n}', String(weekly.truncated)) + '）' : '')
                : t('weeklyNone')),
              Array.isArray(weekly.items) && weekly.items.length
                ? h('div', { style: ui.list }, weekly.items.map((note) => noteRow(note, 'week-' + note.id)))
                : null,
            ))
          : null,
        judgeSample && Array.isArray(judgeSample.events) && judgeSample.events.length
          ? card(t('judgeReviewTitle'), h(React.Fragment, null,
              h('p', { style: ui.muted }, judgeSample.quality
                ? t('judgeReviewSummary').replace('{n}', String(judgeSample.quality.total)).replace('{m}', String(judgeSample.quality.reviewed)).replace('{k}', String(judgeSample.quality.agreed))
                : t('judgeReviewHint')),
              h('div', { style: ui.list }, judgeSample.events.slice(0, 5).map((event) =>
                h('div', { key: 'judge-' + event.at, style: ui.noteRow },
                  h('div', { style: ui.noteMain },
                    h('span', { style: ui.noteTitle }, event.query || '—'),
                    h('span', { style: ui.noteMeta }, t('judgeReviewMeta').replace('{kept}', String((event.kept || []).length)).replace('{dropped}', String((event.dropped || []).length))
                      + ((event.dropped || []).length ? ' · ' + event.dropped.slice(0, 2).join(' / ') : ''))),
                  event.reviewed === null
                    ? h('div', { style: ui.actionRow },
                        h('button', {
                          type: 'button',
                          style: ui.buttonGhost,
                          onClick: async () => {
                            try {
                              await rpcCall('judge.review', { at: event.at, ok: true });
                              setState((prev) => ({ ...prev, notice: t('judgeReviewSaved') }));
                              loadJudgeSample();
                            } catch (error) {
                              setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
                            }
                          },
                        }, t('judgeReviewRight')),
                        h('button', {
                          type: 'button',
                          style: Object.assign({}, ui.buttonGhost, { color: TONES.bad }),
                          onClick: async () => {
                            try {
                              await rpcCall('judge.review', { at: event.at, ok: false });
                              setState((prev) => ({ ...prev, notice: t('judgeReviewSaved') }));
                              loadJudgeSample();
                            } catch (error) {
                              setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
                            }
                          },
                        }, t('judgeReviewWrong')))
                    : h('span', { style: event.reviewed ? ui.goodBadge : ui.badBadge }, event.reviewed ? t('judgeReviewedRight') : t('judgeReviewedWrong')),
                ))),
            ))
          : null,
        conflicts && Array.isArray(conflicts.pairs)
          ? card(t('conflictsTitle'), h(React.Fragment, null,
              h('p', { style: ui.muted }, status && status.conflicts && status.conflicts.last
                ? t('conflictsScanned').replace('{when}', new Date(status.conflicts.last.at).toLocaleString()).replace('{n}', String(status.conflicts.last.count))
                : t('conflictsHint')),
              conflicts.pairs.length === 0
                ? h('p', { style: ui.muted }, t('conflictsNone'))
                : null,
              h('div', { style: ui.list }, conflicts.pairs.slice(0, 5).map((pair, index) =>
                h('div', { key: 'conflict-' + index, style: ui.noteRow },
                  h('div', { style: ui.noteMain },
                    h('span', { style: ui.noteTitle }, String(pair.newer_title || pair.newer_id || '')),
                    h('span', { style: ui.noteMeta }, 'vs ' + String(pair.older_title || pair.older_id || '') + ' · ' + Math.round((pair.overlap || 0) * 100) + '%'),
                  ),
                  h('button', {
                    type: 'button',
                    style: ui.buttonGhost,
                    onClick: async () => {
                      try {
                        const preview = await rpcCall('conflicts.preview', { ids: [pair.older_id, pair.newer_id] });
                        setConflictPreview({ ...preview, ids: [pair.older_id, pair.newer_id], busy: false });
                      } catch (error) {
                        setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
                      }
                    },
                  }, t('conflictsMerge')),
                ))),
            ))
          : null,
      ] : [];

      const pendingEmpty = emptyState('inbox', t('pendingEmpty'), t('pendingEmptyHint'),
        h('button', { type: 'button', style: Object.assign({}, ui.buttonPrimary, { marginTop: 12 }), onClick: () => setTab('library') }, t('addButton')));

      const pending = status ? [
        proposalList.length === 0 ? null : h('div', { key: 'props' },
          h('div', { style: ui.groupLabel }, t('proposalsTitle')),
          proposalList.map((proposal) => h('article', { key: 'prop-' + proposal.id, style: ui.reviewCard },
            h('div', { style: ui.reviewMain },
              h('div', { style: ui.reviewTitle }, (proposal.sourceTitles || []).join(' + ') || proposal.id),
              h('div', { style: ui.reviewMeta },
                t('propSources').replace('{n}', String(proposal.sourceCount))
                + (typeof proposal.similarity === 'number' ? ' · ' + Math.round(proposal.similarity * 100) + '%' : '')
                + (proposal.created ? ' · ' + proposal.created : '')),
            ),
            h('div', { style: ui.reviewActions },
              h('button', { type: 'button', style: ui.buttonPrimary, disabled: !canReview, onClick: () => reviewProposal('accept', [proposal.id]) }, icon('check', 13), t('propApprove')),
              h('button', { type: 'button', style: ui.buttonGhost, disabled: !canReview, onClick: () => reviewProposal('reject', [proposal.id]) }, t('propReject')),
            ),
          ))),
        items.length === 0 ? null : h('div', { key: 'cands' },
          h('div', { style: ui.groupHead },
            h('div', { style: ui.groupLabel }, t('candidatesTitle')),
            h('div', { style: ui.groupActions },
              h('button', { type: 'button', style: ui.buttonGhost, disabled: !canReview, onClick: () => review('accept', items.map((item) => item.id)) }, t('approveAll')),
              h('button', { type: 'button', style: ui.buttonGhost, disabled: !canReview, onClick: () => review('reject', items.map((item) => item.id)) }, t('rejectAll')),
            ),
          ),
          items.map((item) => h('article', { key: item.id, style: ui.reviewCard },
            h('div', { style: ui.reviewMain },
              h('div', { style: ui.reviewTitle }, item.title),
              h('div', { style: ui.reviewMeta },
                h('span', { style: ui.kindBadge }, item.kind || 'semantic'),
                h('span', null, t('chars').replace('{n}', String(item.chars))),
                item.created ? h('span', null, item.created) : null,
                h('span', null, sourceLabel(item.source)),
              ),
            ),
            h('div', { style: ui.reviewActions },
              h('button', { type: 'button', style: ui.buttonPrimary, disabled: !canReview, onClick: () => review('accept', [item.id]) }, icon('check', 13), t('approve')),
              h('button', { type: 'button', style: ui.buttonGhost, disabled: !canReview, onClick: () => review('reject', [item.id]) }, t('reject')),
            ),
          ))),
        pendingTotal === 0 ? pendingEmpty : null,
      ] : [];

      const library = status ? [
        card(t('addLabel'), h('div', { style: ui.composer },
          h('textarea', {
            style: ui.textarea,
            rows: 3,
            value: draft,
            placeholder: t('addPlaceholder'),
            'aria-label': t('addLabel'),
            onChange: (event) => setDraft(event.target.value),
          }),
          h('div', { style: ui.composerFoot },
            h('span', { style: ui.muted }, draft.trim() ? String(draft.trim().length) + ' ' + t('chars').replace('{n}', '').trim() : ''),
            h('button', { type: 'button', style: ui.buttonPrimary, disabled: saving || draft.trim() === '', onClick: saveMemory }, icon('plus', 13), saving ? t('addSaving') : t('addButton')),
          ),
        )),
        card(t('findTitle'), h('div', null,
          h('div', { style: ui.searchRow },
            h('span', { style: ui.searchIcon }, icon('search', 15)),
            h('input', {
              type: 'search',
              style: ui.input,
              value: query,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchTitle'),
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') find();
              },
            }),
            h('button', { type: 'button', style: ui.buttonPrimary, disabled: searching || query.trim() === '', onClick: find }, searching ? t('loading') : t('searchButton')),
          ),
          found
            ? found.error
              ? h('div', { style: ui.errorLine }, t('searchError').replace('{err}', String(found.error)))
              : found.refused
                ? h('div', { style: ui.muted }, t('searchRefused'))
                : !Array.isArray(found.hits) || found.hits.length === 0
                  ? h('div', { style: ui.muted }, t('searchEmpty'))
                  : h('div', { style: ui.list }, found.hits.map((hit) =>
                      h('button', { key: 'hit-' + hit.id, type: 'button', style: ui.hitRow, onClick: () => openNote(hit.id) },
                        h('span', { style: ui.hitTitle }, hit.title || hit.id),
                        h('span', { style: ui.score }, typeof hit.score === 'number' ? Math.round(hit.score * 100) + '%' : ''))))
            : null,
        )),
        card(t('notesAll'), h('div', null,
          h('div', { style: ui.notesHead },
            h('span', { style: ui.muted }, t('notesCount').replace('{n}', String(older.total))),
            h('div', { style: ui.filters },
              h('select', { style: ui.select, value: filters.kind, onChange: (event) => applyFilters({ kind: event.target.value }) },
                h('option', { value: '' }, t('filterAllKinds')),
                h('option', { value: 'semantic' }, t('filterSemantic')),
                h('option', { value: 'procedural' }, t('filterProcedural')),
              ),
              h('select', { style: ui.select, value: String(filters.days), onChange: (event) => applyFilters({ days: Number(event.target.value) }) },
                h('option', { value: '0' }, t('filterAllTime')),
                h('option', { value: '7' }, t('filter7')),
                h('option', { value: '30' }, t('filter30')),
                h('option', { value: '90' }, t('filter90')),
              ),
            ),
          ),
          older.items.length
            ? h('div', { style: ui.list }, older.items.map((note) => noteRow(note, 'note-' + note.id)))
            : h('p', { style: ui.muted }, older.loading ? t('notesLoading') : t('searchEmpty')),
          older.items.length < older.total
            ? h('button', { type: 'button', style: ui.buttonGhost, onClick: loadOlder, disabled: older.loading }, older.loading ? t('notesLoading') : t('notesMore'))
            : null,
        )),
      ] : [];

      const setField = (key) => (event) => setSettingsDraft((prev) => ({ ...prev, [key]: event.target.value }));
      const control = (label, node) => h('label', { style: ui.controlRow }, h('span', { style: ui.controlLabel }, label), node);
      const smartOn = Boolean(settingsDraft && settingsDraft.semantic !== 'off');
      const setSmart = (event) => {
        const on = event.target.value === 'on';
        setSettingsDraft((prev) => ({
          ...prev,
          semantic: on ? 'auto' : 'off',
          judge: on ? 'llm' : 'off',
        }));
      };
      const judgeModelText = status && status.judge && status.judge.selection && status.judge.selection.model
        ? String(status.judge.selection.model)
        : t('settingsJudgeDefault');
      const semanticText = sem && sem.mode !== 'off'
        ? sem.probing
          ? t('semBuilding')
          : sem.ready
            ? t('semReady').replace('{n}', String(sem.size)) + (sem.model ? ' · ' + String(sem.model) : '')
            : sem.error ? t('semError') : t('semBuilding')
        : t('semOff');

      const kv = (label, value) => h('div', { style: ui.kvRow },
        h('span', { style: ui.kvLabel }, label),
        h('span', null, value));

      const settingsPane = settingsDraft
        ? h(React.Fragment, null,
            card(t('settingsTitle'), h('div', { style: ui.formBody },
              h('div', { style: ui.smartRow },
                h('div', { style: ui.smartText },
                  h('div', { style: ui.smartTitle }, t('smartLabel')),
                  h('p', { style: ui.rowHint }, t('smartHint'))),
                h('select', {
                  style: Object.assign({}, ui.select, { minWidth: 128, padding: '7px 10px' }),
                  value: smartOn ? 'on' : 'off',
                  onChange: setSmart,
                  'aria-label': t('smartLabel'),
                },
                  h('option', { value: 'on' }, t('smartOn')),
                  h('option', { value: 'off' }, t('smartOff')))),
              h('div', { style: ui.chips },
                chip(t('semLabel'), semanticText, sem && sem.mode !== 'off' ? (sem.ready ? TONES.good : TONES.warn) : COLORS.dim),
                chip(t('writeJudgeLabel'),
                  !status || !status.writeJudge || status.writeJudge.mode !== 'llm'
                    ? t('writeJudgeOff')
                    : status.writeJudge.last && status.writeJudge.last.judged
                      ? t('writeJudgeKept').replace('{kept}', String(status.writeJudge.last.kept)).replace('{asked}', String(status.writeJudge.last.asked))
                      : t('writeJudgeKept').replace('{kept}', '-').replace('{asked}', '-'),
                  status && status.writeJudge && status.writeJudge.mode === 'llm' ? TONES.info : TONES.neutral),
                chip(t('reflectLabel'),
                  !status || !status.reflect || status.reflect.mode !== 'llm'
                    ? t('reflectOff')
                    : status.reflect.last && status.reflect.last.created
                      ? t('reflectCreated').replace('{n}', String(status.reflect.last.created))
                      : t('reflectOff'),
                  status && status.reflect && status.reflect.mode === 'llm' ? TONES.info : TONES.neutral),
                chip(t('judgeLabel'), judgeLabel(status && status.judge), status && status.judge && status.judge.mode === 'llm' ? TONES.good : COLORS.dim),
                chip(t('capture'), captureLabel, COLORS.dim),
                chip(t('index'), indexLabel, indexLabel === t('indexOk') ? TONES.good : COLORS.dim)),
              h('details', { style: ui.details },
                h('summary', { style: ui.summary }, icon('chevron', 14), h('span', null, t('advancedSettings'))),
                h('section', { style: ui.sectPanel },
                  h('h3', { style: ui.sectTitle }, t('groupSemantic')),
                  h('p', { style: ui.sectHint }, t('groupSemanticHint')),
                  control(t('settingsEndpoint'), h('input', { style: ui.input, value: settingsDraft.semanticEndpoint, onChange: setField('semanticEndpoint'), placeholder: t('settingsEndpointAuto') })),
                  control(t('settingsApiKey'), h('div', { style: ui.stack },
                    h('input', { style: ui.input, type: 'password', autoComplete: 'off', value: settingsDraft.semanticApiKey, onChange: setField('semanticApiKey'), placeholder: status?.semantic?.apiKeySet ? t('settingsApiKeySet') : t('settingsApiKeyHint') }),
                    h('span', { style: ui.rowHint }, t('settingsApiKeyHint2')))),
                  control(t('settingsModel'), h('div', { style: ui.fieldRow },
                    h('input', { style: ui.input, value: settingsDraft.semanticModel, onChange: setField('semanticModel'), placeholder: t('settingsModelAuto') }),
                    h('button', { type: 'button', style: ui.buttonGhost, disabled: models.loading, onClick: fetchModels }, models.loading ? t('loading') : t('settingsFetchModels')))),
                  models.list.length > 0
                    ? control(t('settingsModels'), h('select', { style: ui.select, value: '', onChange: (event) => { if (event.target.value) setSettingsDraft((prev) => ({ ...prev, semanticModel: event.target.value })); } },
                      h('option', { value: '' }, t('settingsModelPick')),
                      models.list.map((id) => h('option', { key: id, value: id }, id))))
                    : models.error ? h('p', { style: ui.warnBox }, t('settingsTestFail').replace('{err}', models.error)) : null,
                  control(t('settingsTest'), h('div', { style: ui.testRow },
                    h('button', { type: 'button', style: ui.buttonGhost, disabled: semanticTest?.loading === true, onClick: runSemanticTest }, icon('check', 14), h('span', null, semanticTest?.loading ? t('loading') : t('settingsTest'))),
                    semanticTest && !semanticTest.loading
                      ? h('span', { style: semanticTest.ok ? ui.okLine : ui.warnBox }, semanticTest.ok
                        ? t('settingsTestOk').replace('{dims}', String(semanticTest.dims)).replace('{ms}', String(semanticTest.ms))
                        : t('settingsTestFail').replace('{err}', String(semanticTest.error || '')))
                      : null)),
                ),
                h('section', { style: ui.sectPanel },
                  h('h3', { style: ui.sectTitle }, t('groupBehavior')),
                  control(t('settingsCapture'), h('select', { style: ui.select, value: settingsDraft.capture, onChange: setField('capture') },
                    h('option', { value: 'off' }, t('capOff')),
                    h('option', { value: 'explicit' }, t('capExplicit')),
                    h('option', { value: 'implicit' }, t('capImplicit')),
                    h('option', { value: 'assist' }, t('capAssist')))),
                  control(t('settingsDelivery'), h('select', { style: ui.select, value: settingsDraft.delivery, onChange: setField('delivery') },
                    h('option', { value: 'context' }, t('settingsDeliveryContext')),
                    h('option', { value: 'notice' }, t('settingsDeliveryNotice')))),
                  control(t('settingsMaxNotes'), h('input', { style: ui.inputSmall, type: 'number', min: 1, max: 20, value: settingsDraft.recallMaxNotes, onChange: setField('recallMaxNotes') })),
                  control(t('consolidateLabel'), h('select', { style: ui.select, value: settingsDraft.consolidate, onChange: setField('consolidate') },
                    h('option', { value: 'off' }, t('consOff')),
                    h('option', { value: 'daily' }, t('consDaily')),
                    h('option', { value: 'weekly' }, t('consWeekly')))),
                  control(t('settingsAssistant'), h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'inherit' } },
                    h('input', { type: 'checkbox', checked: Boolean(settingsDraft.captureAssistant), onChange: (event) => setSettingsDraft((prev) => ({ ...prev, captureAssistant: event.target.checked })) }),
                    h('span', null, t('settingsAssistantHint')))),
                  control(t('settingsOutcome'), h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'inherit' } },
                    h('input', { type: 'checkbox', checked: Boolean(settingsDraft.outcomeFeedback), onChange: (event) => setSettingsDraft((prev) => ({ ...prev, outcomeFeedback: event.target.checked })) }),
                    h('span', null, t('settingsOutcomeHint')))),
                  h('p', { style: ui.rowHint }, t('settingsSourceHint')),
                ),
              ),
              h('div', { style: ui.saveRow },
                h('button', { type: 'button', style: ui.buttonPrimary, disabled: settingsSaving, onClick: savePanelSettings }, settingsSaving ? t('addSaving') : t('settingsSave')),
                h('button', { type: 'button', style: ui.buttonGhost, onClick: openWizard }, icon('spark', 13), h('span', null, t('wizardRerun')))),

            )),
            card(t('advancedTitle'), h('div', { style: ui.kvList },
              kv(t('judgeLabel'), judgeLabel(status && status.judge) + (judgeModelText ? ' · ' + judgeModelText : '')),
              kv(t('consolidateLabel'), consolidateLabel(status && status.consolidate)),
              kv(t('semLabel'), semState + (sem && sem.model ? ' · ' + String(sem.model) : '')),
              kv(t('capture'), captureLabel + ' · ' + t('index') + '：' + indexLabel),
              kv(t('store'), h('code', { style: ui.code }, status ? status.store : '')),
              Array.isArray(status && status.warnings) && status.warnings.length
                ? h('div', { style: ui.warnBox }, status.warnings.slice(0, 3).join('；'))
                : null,
            )),
          )
        : emptyState('gear', t('settingsTitle'), t('loading'));

      const tabState = tab;
      const tabs = [
        { id: 'overview', label: t('tabOverview'), icon: 'spark' },
        { id: 'pending', label: t('tabPending'), icon: 'inbox', count: pendingTotal },
        { id: 'library', label: t('tabLibrary'), icon: 'book' },
        { id: 'settings', label: t('tabSettings'), icon: 'gear' },
      ];
      const body = tab === 'overview' ? overview : tab === 'pending' ? pending : tab === 'library' ? library : [settingsPane];

      const wizardScreen = wizard.open
        ? h('div', { style: ui.overlayInline },
            h('div', { style: ui.wizardPanelInline, role: 'region', 'aria-label': t('wizardTitle') },
              h('div', { style: ui.wizardHead },
                h('div', { style: ui.wizardDots },
                  [0, 1, 2].map((index) => h('span', { key: index, style: index === wizard.step ? ui.wizardDotActive : ui.wizardDot }))),
                h('button', { type: 'button', style: ui.iconButton, onClick: closeWizard, 'aria-label': t('closeNote') }, icon('x', 16))),
              wizard.step === 0
                ? h(React.Fragment, null,
                    h('h2', { style: ui.wizardTitle }, t('wizardStep1Title')),
                    h('p', { style: ui.wizardText }, t('wizardStep1Text')),
                    h('div', { style: ui.choiceRow },
                      h('button', {
                        type: 'button',
                        style: wizard.smart ? Object.assign({}, ui.choice, ui.choiceActive) : ui.choice,
                        onClick: () => setWizard((prev) => ({ ...prev, smart: true })),
                      },
                        h('div', { style: ui.choiceTitle }, t('wizardOnTitle')),
                        h('div', { style: ui.choiceText }, t('wizardOnText'))),
                      h('button', {
                        type: 'button',
                        style: wizard.smart ? ui.choice : Object.assign({}, ui.choice, ui.choiceActive),
                        onClick: () => setWizard((prev) => ({ ...prev, smart: false })),
                      },
                        h('div', { style: ui.choiceTitle }, t('wizardOffTitle')),
                        h('div', { style: ui.choiceText }, t('wizardOffText')))))
                : wizard.step === 1
                  ? h(React.Fragment, null,
                      h('h2', { style: ui.wizardTitle }, t('wizardStep2Title')),
                      h('p', { style: ui.wizardText }, t('wizardStep2Text')),
                      h('div', { style: ui.choiceRow },
                        h('button', {
                          type: 'button',
                          style: wizard.mode === 'local' ? Object.assign({}, ui.choice, ui.choiceActive) : ui.choice,
                          onClick: () => setWizard((prev) => ({ ...prev, mode: 'local' })),
                        },
                          h('div', { style: ui.choiceTitle }, t('wizardLocalTitle')),
                          h('div', { style: ui.choiceText }, t('wizardLocalText'))),
                        h('button', {
                          type: 'button',
                          style: wizard.mode === 'remote' ? Object.assign({}, ui.choice, ui.choiceActive) : ui.choice,
                          onClick: () => setWizard((prev) => ({ ...prev, mode: 'remote' })),
                        },
                          h('div', { style: ui.choiceTitle }, t('wizardRemoteTitle')),
                          h('div', { style: ui.choiceText }, t('wizardRemoteText')))),
                      wizard.mode === 'remote'
                        ? h('div', { style: ui.stack },
                            h('input', { style: ui.input, placeholder: t('wizardEndpointPlaceholder'), value: wizard.endpoint, onChange: (event) => setWizard((prev) => ({ ...prev, endpoint: event.target.value })) }),
                            h('input', { style: ui.input, type: 'password', autoComplete: 'off', placeholder: t('wizardKeyPlaceholder'), value: wizard.apiKey, onChange: (event) => setWizard((prev) => ({ ...prev, apiKey: event.target.value })) }),
                            h('input', { style: ui.input, placeholder: t('wizardModelPlaceholder'), value: wizard.model, onChange: (event) => setWizard((prev) => ({ ...prev, model: event.target.value })) }))
                        : null)
                  : h(React.Fragment, null,
                      h('h2', { style: ui.wizardTitle }, t('wizardStep3Title')),
                      h('p', { style: ui.wizardText }, t('wizardStep3Text')),
                      h('textarea', {
                        style: ui.textarea,
                        rows: 3,
                        placeholder: t('wizardNotePlaceholder'),
                        value: wizard.note,
                        onChange: (event) => setWizard((prev) => ({ ...prev, note: event.target.value })),
                      })),
              wizard.error ? h('div', { style: ui.errorBanner }, wizard.error) : null,
              h('div', { style: ui.wizardFoot },
                h('button', {
                  type: 'button',
                  style: ui.buttonGhost,
                  onClick: () => {
                    if (wizard.step === 0) closeWizard();
                    else setWizard((prev) => ({ ...prev, step: Math.max(0, prev.step - 1) }));
                  },
                }, wizard.step === 0 ? t('wizardLater') : t('wizardBack')),
                wizard.step < 2
                  ? h('button', { type: 'button', style: ui.buttonPrimary, onClick: () => setWizard((prev) => ({ ...prev, step: prev.step + 1 })) }, t('wizardNext'))
                  : h('button', { type: 'button', style: ui.buttonPrimary, disabled: wizard.busy, onClick: finishWizard }, wizard.busy ? t('addSaving') : t('wizardFinish')))))
        : null;

      const noteScreen = note
        ? h('div', { style: ui.overlayInline },
            h('div', { style: ui.overlayPanelInline, role: 'region', 'aria-label': String(note.title || note.id || '') },
              h('div', { style: ui.overlayHead },
                h('div', null,
                  h('div', { style: ui.overlayTitle }, String(note.title || note.id || '')),
                  h('div', { style: ui.overlayMeta }, (note.kind || 'semantic') + (note.scope ? ' · ' + note.scope : '') + (note.validFrom ? ' · ' + String(note.validFrom).slice(0, 10) : ''))),
                h('button', { type: 'button', style: ui.iconButton, onClick: () => setNote(null), 'aria-label': t('closeNote') }, icon('x', 16)),
              ),
              h('div', { style: ui.overlayBody },
                note.loading || note.error
                  ? h('p', { style: note.error ? ui.errorLine : ui.muted }, note.error ? String(note.error) : t('loading'))
                  : editing
                    ? h('div', { style: ui.editForm },
                        h('label', { style: ui.provLabel }, t('editTitle')),
                        h('input', { style: ui.input, value: editing.title, onChange: (event) => setEditing((prev) => ({ ...prev, title: event.target.value })) }),
                        h('label', { style: ui.provLabel }, t('editBody')),
                        h('textarea', { style: ui.editArea, rows: 8, value: editing.content, onChange: (event) => setEditing((prev) => ({ ...prev, content: event.target.value })) }),
                        h('p', { style: ui.rowHint }, t('editHint')),
                        editing.error ? h('p', { style: ui.errorLine }, editing.error) : null,
                        h('div', { style: ui.actionRow },
                          h('button', {
                            type: 'button',
                            style: ui.buttonPrimary,
                            disabled: editing.busy,
                            onClick: async () => {
                              setEditing((prev) => ({ ...prev, busy: true, error: '' }));
                              try {
                                const result = await rpcCall('edit', { id: note.id, title: editing.title, content: editing.content });
                                setEditing(null);
                                setNote(null);
                                setState((prev) => ({ ...prev, notice: t('editSaved'), error: null }));
                                load();
                                void result;
                              } catch (error) {
                                const message = String(error?.message || error);
                                const friendly = /too-long/i.test(message) ? t('editTooLong') : /unchanged/i.test(message) ? t('editUnchanged') : message;
                                setEditing((prev) => ({ ...prev, busy: false, error: friendly }));
                              }
                            },
                          }, editing.busy ? t('addSaving') : t('editSave')),
                          h('button', { type: 'button', style: ui.buttonGhost, onClick: () => setEditing(null) }, t('editCancel')),
                        ),
                      )
                    : h('pre', { style: ui.noteBody }, String(note.body || '')),
                note.loading || note.error || editing || !note.provenance
                  ? null
                  : h('div', { style: ui.provBox },
                      h('div', { style: ui.provTitle }, t('provTitle')),
                      h('div', { style: ui.provRow }, h('span', { style: ui.provLabel }, t('provFrom')), h('span', null, String(note.provenance.writtenBy || '—'))),
                      h('div', { style: ui.provRow }, h('span', { style: ui.provLabel }, t('provTrust')), h('span', null, String(note.provenance.trust || '—') + (note.provenance.scope ? ' · ' + note.provenance.scope : ''))),
                      h('div', { style: ui.provRow }, h('span', { style: ui.provLabel }, t('provStatus')), h('span', null, note.provenance.supersededBy ? t('provSuperseded') + ' → ' + note.provenance.supersededBy : t('provActive'))),
                      h('div', { style: ui.provRow }, h('span', { style: ui.provLabel }, t('provRecalls')), h('span', null, note.provenance.recalled && note.provenance.recalled.count
                        ? t('provRecalledN').replace('{n}', String(note.provenance.recalled.count)) + (note.provenance.recalled.lastAt ? ' · ' + new Date(note.provenance.recalled.lastAt).toLocaleString() : '')
                        : t('provNever'))),
                      Array.isArray(note.provenance.tags) && note.provenance.tags.length
                        ? h('div', { style: ui.provRow }, h('span', { style: ui.provLabel }, t('provTags')), h('span', null, note.provenance.tags.join(' · ')))
                        : null,
                      h('div', { style: ui.provTitle, marginTop: 8 }, t('provTimeline')),
                      h('div', { style: ui.timeline },
                        Array.isArray(note.timeline?.events) && note.timeline.events.length
                          ? note.timeline.events.map((event, index) => h('div', { key: index, style: ui.timelineRow },
                              h('span', { style: ui.timelineAt }, new Date(event.at).toLocaleString()),
                              h('span', { style: ui.timelineText }, String(event.text || ''))))
                          : h('p', { style: ui.muted }, t('provTimelineEmpty'))
                      ),
                    ),
                note.loading || note.error || editing ? null : h('div', { style: ui.actionRow },
                  h('button', {
                    type: 'button',
                    style: ui.buttonGhost,
                    onClick: () => setEditing({ title: String(note.title || ''), content: String(note.body || ''), busy: false, error: '' }),
                  }, icon('edit', 14), h('span', null, t('editButton'))),
                  h('span', { style: ui.muted }, t('feedbackAsk')),
                  h('button', {
                    type: 'button',
                    style: ui.buttonGhost,
                    onClick: async () => {
                      try {
                        await rpcCall('feedback.add', { id: note.id, signal: 'useful' });
                        setState((prev) => ({ ...prev, notice: t('feedbackRecorded') }));
                      } catch (error) {
                        setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
                      }
                    },
                  }, icon('check', 14), h('span', null, t('feedbackUseful'))),
                  h('button', {
                    type: 'button',
                    style: ui.buttonGhost,
                    onClick: async () => {
                      try {
                        await rpcCall('feedback.add', { id: note.id, signal: 'wrong' });
                        setState((prev) => ({ ...prev, notice: t('feedbackRecorded') }));
                      } catch (error) {
                        setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
                      }
                    },
                  }, icon('x', 14), h('span', null, t('feedbackWrong'))),
                  h('button', {
                    type: 'button',
                    style: Object.assign({}, ui.buttonGhost, { color: TONES.bad }),
                    onClick: async () => {
                      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('forgetConfirm'))) return;
                      try {
                        await rpcCall('forget', { id: note.id });
                        setNote(null);
                        setState((prev) => ({ ...prev, notice: t('forgetDone'), error: null }));
                        await load();
                      } catch (error) {
                        setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
                      }
                    },
                  }, icon('trash', 14), h('span', null, t('forgetButton'))),
                )),
            ))
        : null;

      const conflictOverlay = conflictPreview
        ? h('div', { style: ui.overlayInline },
            h('div', { style: ui.overlayPanelInline, role: 'region', 'aria-label': t('conflictsPreviewTitle') },
              h('div', { style: ui.overlayHead },
                h('div', null,
                  h('div', { style: ui.overlayTitle }, t('conflictsPreviewTitle')),
                  h('div', { style: ui.overlayMeta }, t('conflictsPreviewHint')),
                ),
                h('button', { type: 'button', style: ui.iconButton, onClick: () => setConflictPreview(null), 'aria-label': t('conflictsCancel') }, icon('x', 16)),
              ),
              h('div', { style: ui.overlayBody },
                conflictPreview.ok === false
                  ? h('p', { style: ui.errorLine }, t('conflictsPreviewFailed') + (conflictPreview.reason ? '：' + String(conflictPreview.reason) : ''))
                  : h('pre', { style: ui.noteBody }, String(conflictPreview.body || '')),
                (conflictPreview.warnings || []).length
                  ? h('p', { style: ui.rowHint }, conflictPreview.warnings.join('；'))
                  : null,
                h('div', { style: ui.actionRow },
                  h('button', {
                    type: 'button',
                    style: ui.buttonPrimary,
                    disabled: conflictPreview.busy || conflictPreview.ok === false,
                    onClick: async () => {
                      setConflictPreview((prev) => ({ ...prev, busy: true }));
                      try {
                        const result = await rpcCall('conflicts.merge', { ids: conflictPreview.ids, confirm: true });
                        setConflictPreview(null);
                        setState((prev) => ({ ...prev, notice: t('conflictsMerged') + String(result.target_id || '') }));
                        load();
                        setConflicts(null);
                      } catch (error) {
                        setConflictPreview((prev) => ({ ...prev, busy: false }));
                        setState((prev) => ({ ...prev, error: error?.message ?? String(error) }));
                      }
                    },
                  }, conflictPreview.busy ? t('loading') : t('conflictsConfirm')),
                  h('button', { type: 'button', style: ui.buttonGhost, onClick: () => setConflictPreview(null) }, t('conflictsCancel')),
                ),
              ),
            ))
        : null;

      return h('div', { style: ui.root, 'data-tabellio-panel': '1' },
        h('header', { style: ui.header },
          h('div', { style: ui.headerText },
            h('h2', { style: ui.title }, t('title')),
            h('p', { style: ui.subtitle }, t('subtitle')),
          ),
          h('div', { style: ui.headerActions },
            h('button', { type: 'button', style: ui.iconButton, onClick: load, disabled: state.loading, 'aria-label': t('refresh') }, icon('refresh', 16)),
          ),
        ),
        state.error ? h('div', { style: ui.errorBanner }, state.error) : null,
        state.notice ? h('div', { style: ui.toast }, state.notice) : null,
        h('nav', { style: ui.tabs, role: 'tablist' }, tabs.map((item) =>
          h('button', {
            key: item.id,
            type: 'button',
            role: 'tab',
            'aria-selected': tabState === item.id,
            style: tabState === item.id ? Object.assign({}, ui.tab, ui.tabActive) : ui.tab,
            onClick: () => {
              setNote(null);
              setWizard((prev) => ({ ...prev, open: false }));
              setTab(item.id);
            },
          },
            icon(item.icon, 15),
            h('span', null, item.label),
            item.count > 0 ? h('span', { style: ui.tabBadge }, String(item.count)) : null,
          ))),
        h('div', { key: wizard.open ? 'wizard' : note ? 'note' : tabState, style: ui.tabBody, className: 'tb-tabbody' },
          wizard.open ? wizardScreen
            : note ? noteScreen
              : status || tab === 'settings' ? body : h('div', { style: ui.skeleton },
                h('div', { style: ui.skeletonRow }),
                h('div', { style: ui.skeletonRow }),
                h('div', { style: ui.skeletonRow }),
              ),
        ),
        wizard.open || note ? null : h('footer', { style: ui.footer }, t('footer')),
      );
    }

    const indicatorStyles = {
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
        borderRadius: '999px', border: '1px solid var(--dsh-border, #e5e1d8)',
        background: 'transparent', color: 'inherit', fontSize: '12px', cursor: 'pointer',
      },
      dot: { width: '7px', height: '7px', borderRadius: '50%', background: '#E4572E', display: 'inline-block' },
      wrap: { position: 'relative', display: 'inline-flex' },
      backdrop: { position: 'fixed', inset: 0, zIndex: 40 },
      pop: {
        position: 'absolute', right: 0, top: '30px', zIndex: 41, width: '300px',
        border: '1px solid var(--dsh-border, #e5e1d8)', borderRadius: '10px',
        background: 'var(--dsh-surface, #fff)', boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '10px',
      },
      popTitle: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' },
      row: { borderTop: '1px solid var(--dsh-border-soft, #f0ece2)', padding: '8px 0', fontSize: '13px' },
      rowTitle: { marginBottom: '4px', lineHeight: 1.4 },
      small: { fontSize: '12px', color: 'var(--dsh-muted, #8a8478)', padding: '4px 0' },
      rowActions: { display: 'flex', gap: '6px' },
      jump: {
        marginTop: '8px', padding: 0, border: 'none', background: 'transparent',
        color: 'var(--dsh-accent, #2563eb)', fontSize: '12px', cursor: 'pointer',
        textDecoration: 'underline', textUnderlineOffset: '2px',
      },
      overlay: { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      overlayMask: { position: 'absolute', inset: 0, background: 'rgba(20, 18, 14, 0.32)' },
      overlayPanel: {
        position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column',
        width: 'min(880px, calc(100vw - 48px))', height: 'min(720px, calc(100vh - 64px))',
        border: '1px solid var(--dsh-border, #e5e1d8)', borderRadius: '12px',
        background: 'var(--dsh-surface, #fff)', boxShadow: '0 16px 48px rgba(0,0,0,.18)',
        overflow: 'hidden',
      },
      overlayHeader: {
        flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid var(--dsh-border-soft, #f0ece2)',
        fontSize: '14px', fontWeight: 600,
      },
      overlayClose: {
        border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px',
        lineHeight: 1, color: 'var(--dsh-muted, #8a8478)', padding: '4px 6px',
      },
      overlayBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 20px 20px' },
    };

    /** Header chip: pending memories are visible at the top of the session. */
    function MemoryIndicator({ rpcCall, t }) {
      const [open, setOpen] = React.useState(false);
      const [counts, setCounts] = React.useState({ candidates: 0, proposals: 0, notes: 0 });
      const [items, setItems] = React.useState([]);
      const [busyId, setBusyId] = React.useState('');
      const [error, setError] = React.useState('');
      const [panelOpen, setPanelOpen] = React.useState(false);

      const refresh = React.useCallback(async () => {
        try {
          const status = await rpcCall('status', {});
          setCounts({ candidates: Number(status.candidates) || 0, proposals: Number(status.proposals) || 0, notes: Number(status.notes) || 0 });
        } catch {
          // The chip is decoration: a failed poll never surfaces an error.
        }
      }, [rpcCall]);

      React.useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 30000);
        return () => clearInterval(timer);
      }, [refresh]);

      React.useEffect(() => {
        if (!panelOpen) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setPanelOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [panelOpen]);

      const loadPending = React.useCallback(async () => {
        setError('');
        try {
          const inbox = await rpcCall('inbox.list', {});
          setItems(Array.isArray(inbox.items) ? inbox.items : []);
        } catch (cause) {
          setError(String(cause?.message ?? cause));
        }
      }, [rpcCall]);

      const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next) loadPending();
      };

      const review = async (id, action) => {
        setBusyId(id);
        try {
          const result = await rpcCall('inbox.review', { action, ids: [id] });
          const failed = Array.isArray(result?.failed) ? result.failed : [];
          setError(failed.length ? failureText(failed[0]?.reason) : '');
          await Promise.all([loadPending(), refresh()]);
        } catch (cause) {
          setError(String(cause?.message ?? cause));
        } finally {
          setBusyId('');
        }
      };

      const total = counts.candidates + counts.proposals;
      return h('div', { style: indicatorStyles.wrap },
        h('button', { type: 'button', style: indicatorStyles.chip, onClick: toggle, title: t('memChipTitle') },
          total > 0 ? h('span', { style: indicatorStyles.dot }) : null,
          t('memChipLabel'),
          counts.notes > 0 ? ' ' + counts.notes : '',
          total > 0 ? ' · ' + t('memChipPending').replace('{n}', String(total)) : '',
        ),
        open ? h('div', { style: indicatorStyles.backdrop, onClick: () => setOpen(false) }) : null,
        open ? h('div', { style: indicatorStyles.pop },
          h('div', { style: indicatorStyles.popTitle }, t('memChipTitle')),
          error ? h('div', { style: styles.error }, error) : null,
          items.length === 0
            ? h('div', { style: indicatorStyles.small }, t('memChipEmpty'))
            : items.slice(0, 5).map((item) => h('div', { key: item.id, style: indicatorStyles.row },
                h('div', { style: indicatorStyles.rowTitle }, item.title),
                h('div', { style: indicatorStyles.small }, item.source || ''),
                h('div', { style: indicatorStyles.rowActions },
                  h('button', { type: 'button', style: styles.primary, disabled: busyId === item.id, onClick: () => review(item.id, 'accept') }, t('memApprove')),
                  h('button', { type: 'button', style: styles.button, disabled: busyId === item.id, onClick: () => review(item.id, 'reject') }, t('memIgnore')),
                ),
              )),
          items.length > 5 ? h('div', { style: indicatorStyles.small }, t('memChipMore').replace('{n}', String(items.length - 5))) : null,
          h('button', {
            type: 'button',
            style: indicatorStyles.jump,
            onClick: () => { setOpen(false); setPanelOpen(true); },
          }, t('memChipOpenPanel')),
          h('div', { style: indicatorStyles.small }, t('memChipSettings')),
        ) : null,
        panelOpen ? h('div', { style: indicatorStyles.overlay },
          h('div', { style: indicatorStyles.overlayMask, onClick: () => setPanelOpen(false) }),
          h('div', { style: indicatorStyles.overlayPanel, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('memChipTitle') },
            h('div', { style: indicatorStyles.overlayHeader },
              h('span', null, t('memChipTitle')),
              h('button', { type: 'button', style: indicatorStyles.overlayClose, onClick: () => setPanelOpen(false), 'aria-label': t('memClose') }, '×'),
            ),
            h('div', { style: indicatorStyles.overlayBody }, h(MemoryPanel, { rpcCall, t })),
          ),
        ) : null,
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
      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'tabellio-dsh.memory-indicator',
            order: 30,
            inject: () => ({ rpcCall, t: translate }),
          },
          MemoryIndicator,
        ),
      );
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

    return { name, inject, apply, MemoryPanel, MemoryIndicator };
  },
});
