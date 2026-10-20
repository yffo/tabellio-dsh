// Minimal host stand-in for client/client.js: canned RPC, real DOM, real React.
const now = Date.now();
const candidate = {
  id: '01TESTCANDIDATE0000000000',
  title: '以后发版都走 tag + CI',
  body: '# 以后发版都走 tag + CI\n\n手动上传不要再用了。',
  sentences: ['以后发版都走 tag + CI。'],
  created: new Date(now - 3600_000).toISOString(),
  source: 'dsh:session:test',
  chars: 34,
  kind: 'semantic',
  trust: 'user_stated',
};
const status = {
  store: '/Users/you/memory/tabellio', notes: 1411, candidates: 1, proposals: 0,
  indexExists: true, indexStale: false, warnings: [],
  mode: 'inject', capture: 'assist', delivery: 'context', semantic: 'auto',
  semanticInfo: { mode: 'auto', model: 'qwen3-embedding-0.6b', endpoint: 'http://127.0.0.1:8080/v1/embeddings', ready: true, size: 1411, error: '' },
  judge: { mode: 'llm', host: 'inject', selection: { provider: 'deepseek-account', model: 'deepseek-flash' }, last: { at: now - 5000, stage: 'verdict', kept: 2, elapsedMs: 1900 } },
  writeJudge: { mode: 'llm', last: { at: now - 5000, stage: 'verdict', kept: 3 } },
  reflect: { mode: 'llm', last: { at: now - 86400_000, stage: 'ok', count: 2 } },
  consolidate: { mode: 'daily', lastRun: now - 7200_000 },
  conflicts: { mode: 'daily', last: { at: now - 86400_000, count: 1 } },
  feedback: { total: 9, useful: 5, wrong: 2, stale: 1, corrected: 1 },
  lastRecall: { at: now - 1200_000, query: '我们上次定的召回阈值是多少', mode: 'context', refused: false, count: 2, chars: 551, elapsedMs: 2096, judged: true, reason: 'llm_judge', titles: ['记忆召回阈值：核心默认', '记忆召回阈值：线上 DSH 覆盖'], receiptPath: '/tmp/rcp.json' },
};
const responses = {
  status,
  'inbox.list': { items: [candidate] },
  'proposals.list': { proposals: [] },
  report: { days: 7, notes_added: 47, notes_total: 1411, truncated: 44, items: [{ id: 'n1', title: '发布流程：tag + CI', date: '2026-10-21' }] },
  read: { id: 'n1', title: '发布流程：tag + CI', body: '# 发布流程：tag + CI\n\n发版必须推 tag，由 GitHub Actions 走 OIDC 发布。' },
  provenance: { written_by: 'panel:edit', trust: 'user_stated', status: 'active', valid_from: '2026-10-19', validTo: null, superseded_by: null, tags: ['release'], recalls: 3, lastRecallAt: now - 86400_000 },
  timeline: { events: [{ at: now - 86400_000, kind: 'created', text: '创建笔记' }, { at: now - 3600_000, kind: 'recall', text: '召回：发版流程' }] },
  notes: { total: 1411, offset: 0, limit: 20, items: [{ id: 'n1', title: '发布流程：tag + CI', date: '2026-10-21' }, { id: 'n2', title: '记忆召回阈值：核心默认', date: '2026-10-20' }] },
  search: { refused: false, hits: [{ id: 'n1', title: '发布流程：tag + CI', score: 0.72 }, { id: 'n2', title: '记忆召回阈值：核心默认', score: 0.59 }] },
  'audit.summary': { days: 7, total: 15, byMode: { context: 7, suppressed: 6, refused: 2 }, judge: { kept: 3, dropped: 1 }, topMisses: [{ query: '今天天气怎么样', count: 2 }], topTitles: [] },
  'audit': { items: [{ at: now - 5000, mode: 'suppressed', query: '上次召回', reason: 'low_information_query', count: 0, elapsedMs: 12 }], counts: {}, window: '2026-10' },
  'judge.recent': { events: [{ at: now - 5000, query: '召回阈值是多少', kept: ['记忆召回阈值：核心默认'], dropped: ['实时行情'], verdict: 'verdict', reviewed: null }], quality: { total: 12, reviewed: 3, agreed: 3 } },
  'usage.summary': { days: 7, recalls: 15, injected: 8, chars: 5200, tokensEst: 1733, judgeCalls: 8, judgeMsAvg: 1500, semanticCalls: 8, notes: 12 },
  'weekly.report': { days: 7, recall: { runs: 15, byMode: { context: 7, suppressed: 6, refused: 2 }, judge: { kept: 3, dropped: 1 } }, context: { injected: 8, chars: 5200, tokensEst: 1733 }, judge: { calls: 8, reviewed: 3, agreed: 3 }, judgeTrend: [{ total: 2, reviewed: 2, agreed: 2 }, { total: 3, reviewed: 1, agreed: 1 }, { total: 3, reviewed: 0, agreed: 0 }, { total: 0, reviewed: 0, agreed: 0 }], feedback: { useful: 5, wrong: 2, stale: 1, corrected: 1 }, notes: { total: 1411, added: 47 }, conflicts: { at: now - 86400_000, count: 1 } },
  'conflicts.list': { pairs: [{ older_id: 'a', newer_id: 'b', older_title: '旧发布流程', newer_title: '新发布流程', overlap: 0.72 }] },
  'settings.get': { semantic: { mode: 'auto' }, capture: { mode: 'assist' }, delivery: { mode: 'context' }, recallMaxNotes: 6, judge: { mode: 'llm' }, consolidate: { mode: 'daily' }, captureAssistant: false, outcomeFeedback: true, semanticEndpoint: 'http://127.0.0.1:8080/v1/embeddings', semanticModel: 'qwen3-embedding-0.6b', apiKeySet: false, endpointSet: false },
  'settings.set': { ok: true },
  'inbox.review': { ok: true, accepted: ['01TESTCANDIDATE0000000000'], rejected: [], failed: [] },
  'proposals.review': { ok: true },
  'judge.review': { ok: true },
  'feedback.add': { ok: true },
  edit: { ok: true, id: 'n1', superseded: 'n1old', oldRetired: true },
  forget: { ok: true, id: 'n1', status: 'archived' },
  remember: { ok: true, id: 'n9', title: '新记忆' },
  'conflicts.preview': { ok: true, target: { title: '新发布流程', body: '# 新发布流程\n\ntag + CI' }, sources: [{ title: '旧发布流程', body: '# 旧发布流程' }], warnings: [] },
  'conflicts.merge': { ok: true, target_id: 'b' },
  'usage.summary': { days: 7, recalls: 15, injected: 8, chars: 5200, tokensEst: 1733, judgeCalls: 8, judgeMsAvg: 1500, semanticCalls: 8, notes: 12 },
  'weekly.report': { days: 7, recall: { runs: 15, byMode: { context: 7, suppressed: 6, refused: 2 }, judge: { kept: 3, dropped: 1 } }, context: { injected: 8, chars: 5200, tokensEst: 1733 }, judge: { calls: 8, reviewed: 3, agreed: 3 }, judgeTrend: [{ total: 2, reviewed: 2, agreed: 2 }, { total: 0, reviewed: 0, agreed: 0 }, { total: 0, reviewed: 0, agreed: 0 }, { total: 0, reviewed: 0, agreed: 0 }], notes: { total: 1411, added: 47 }, feedback: { useful: 5, wrong: 2, stale: 1, corrected: 1 } },
  'semantic.models': { models: ['qwen3-embedding-0.6b'] },
  'semantic.test': { ok: true, dims: 1024, ms: 55 },
};
function rpcCall(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const value = responses[endpoint];
    if (value === undefined) return reject(new Error('unknown endpoint ' + endpoint));
    setTimeout(() => resolve(JSON.parse(JSON.stringify(value))), 5);
  });
}
const loaded = [];
window.__ModuleLoader__ = { load(spec) { loaded.push(spec); } };
const require = (name) => {
  if (name === 'react') return window.React;
  throw new Error('unexpected require ' + name);
};
function renderClient(code) {
  try {
    new Function('window', code)(window);
    const spec = loaded[0];
    const mod = spec.factory(require);
    const ctx = {
      connection: { rpc: { call: rpcCall } },
      locale: { bind: () => (key) => 'zh:' + key, register: (ns, dicts) => () => {} },
      slots: { inject: (name, cb) => { cb(); return () => {}; }, register: () => () => {} },
      effect: (fn) => { const d = fn(); return () => {}; },
    };
    mod.apply(ctx);
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(mod.MemoryPanel, { rpcCall: (endpoint, payload) => rpcCall(endpoint, payload), t: (key) => '[' + key + ']' }));
    document.title = 'panel-ok';
  } catch (error) {
    document.getElementById('root').textContent = 'HARNESS ERROR: ' + (error && error.message || error);
    document.title = 'panel-error';
  }
}
fetch('../../client/client.js').then((r) => r.text()).then(renderClient).catch((error) => {
  document.getElementById('root').textContent = 'LOAD ERROR: ' + error.message;
});
