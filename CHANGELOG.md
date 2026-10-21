## 0.39.3（2026-10-22）

- **启动时认出「被钉住的旧召回值」**：设置解析后比对历史发布过的旧默认（`500 token / 6 条 / 覆盖率 0.33`），命中两个以上就在日志和面板「高级状态」里说一次，并给出删掉宿主 patch 那三行的做法。不做配置来源系统、不猜来源，认不出就沉默。
  为什么需要：2026-10-22 同一天两次同根因事故（宿主 profile patch、随包 bundle patch 都钉着旧值），两次都是「代码默认改了，用户拿到的还是旧值」，而日志、面板、doctor 全都没有异常——只能靠人翻文件发现。
- **面板「高级状态」显示生效召回预算**：`1200 token · 8 条 · 覆盖率 0.2`。想核对「新默认到底生效没有」不用再去翻配置。
- 203 测试（+6）。

## 0.39.2（2026-10-22）

- **安装补丁不再钉死召回预算**（`cordis.patch.yml`）：0.39.0/0.39.1 的 bundle patch 还写着 `recallBudgetTokens: 500`、`recallMaxNotes: 6`、`recallMinCoverage: 0.33`。DSH 的 patch 是整段替换 config，所以**每个新装用户拿到的都是 A/B 之前的召回配置**——120 题模拟用户库端到端答对 63.7%，而 0.39.x 的库默认是 76.3%。这和宿主 profile 里钉死旧值（2026-10-22 早先修过的那个坑）是同一个根因：配置在两个地方各写一份，升级只动了一处。
  现在补丁只保留产品选择（`capture: assist`、`delivery: context`），预算/阈值/judge/semantic 一律跟随 `src/config.js`。
- 新增 `test/patch.test.mjs`：解析 bundle patch，强制「每个键要么等于库默认，要么在白名单里」，并显式禁止再钉召回六项（`recallBudgetTokens` / `recallMaxNotes` / `recallMinCoverage` / `recallMinRelevance` / `recallMinScore` / `recallConfidentRelevance`）。以后再调默认值只改一处、发一次版，所有新装用户跟着走。
- 从旧版升级的用户：如果你的 profile patch（`~/.dsh/profiles/<name>/cordis.patch.yml`）里手抄过 `recallBudgetTokens: 500` / `recallMaxNotes: 6` / `recallMinCoverage: 0.33`，删掉这三行让它跟随默认；不删就会继续用旧预算（面板/日志里看不出来）。
- 197 测试（+4）。

## 0.39.1（2026-10-22）

- **修 `withDeadline` 的 deadline 定时器不 `unref`**：0.39.0 里 `setTimeout` 被 `unref()`，在 Node 20/22/24 的 `node:test` 下这个定时器是 race 的唯一活跃句柄，跑器会报 `Promise resolution is still pending but the event loop has already resolved` 并有后续用例被取消。生产宿主还有其他句柄所以看不出来，测试一跑就露。`finally` 已经保证 `clearTimeout`，不需要 unref。

## 0.39.0（2026-10-22）

- **judge 软截止**：新增 `judgeDeadlineMs`（默认 1500ms）。到点这一轮先注入未裁决的召回结果，裁决调用继续跑；晚到的裁决进缓存，下一次同样的问题直接用它。硬超时 `judgeTimeoutMs` 仍保留（6000ms）作为兜底。
  为什么要两种超时：`judgeTimeoutMs` 是 abort，慢调用等于白跑；软截止不 abort，慢裁决还能被复用。实测 56 题里 judge 的最慢一次 1.47s（本地 API），生产 audit 里 p90 3.15s 全是它在等宿主模型——软截止把「这一轮最多等多久」和「模型有多慢」解耦。
- **judge 判据实验** `bench/judge-eval.mjs`：拿 56 题 + 50 篇虚构语料直接测 judge 本身（现有 `run-eval.mjs` 走 CLI 检索，judge 不在那条路径上，测不到）。当前策略实测：gold 误杀 2/36（5.6%）、噪声丢弃 177/177、拒答题 19/20 全杀、p50 79ms / p90 150ms、单次 453 token（推理 100）。只判 `relevance < 0.9` 的 border 策略：误杀 0/35、噪声丢弃 77.5%、送审条数 4→2。
- **预算实测：P3「一套预算」不做**。生产库 28 条真实查询平均只召回 2 条、823 字，1400 字的渲染预算 0 次触发；56 题语料同样不触发。写了边际价值分配器对照，字符反而 +5.8%（它把第二条升成全文）。真正的瓶颈在上游选片预算。
- **渲染不再硬切正文**：单条正文超过整个预算时，原来会把正文截断在半句上；现在降级成摘要/指针并带 `…`，至少读者知道这里被截了。
- **超预算时先丢尾条，不再先降级第一条**（P0 级 bug）：块只超几十个字符时，旧逻辑先把**最相关的那条**（排第 1）降成裸标题，再丢尾条；实测 `personal-ops-q15`「给豆豆洗澡水温多少」的 102 字正文（含「水温调到 38 度」）因此整段丢失，模型答「没记过」。现在先丢尾条，只有剩最后一条仍超预算时才降级它。回归用例 `trimming drops the tail, never the first note body`。
- **核心档不再占检索额度**（依赖核心 0.1.13 的 push/pull 分账）：身份设定这类 `kind: core` 的笔记单独 2 条 / 120 token 的额度，问「A 怎么配置」时不会再有一条身份设定混进来。旧核心忽略该改动，行为不变。
- **召回默认值重定**：`recallMaxNotes` 6→8、`recallBudgetTokens` 500→1200、`recallMinCoverage` 0.33→0.2。依据是 5 份模拟用户语料（151 篇、120 题、真模型端到端作答）：旧默认答对 **63.7%**、注入 0.94 条/142 token；新默认 **76.3%**、0.84 条/126 token（judge 开、`injectMaxChars` 1400）。早先量到的 33.8% 含 bench 把召回条目 `content` 当 `body` 读、judge 只看到标题的 bug，已作废。旧配置的失败原因不是上下文太长，而是预算在第 3 名之前就把 gold 裁掉了。
- **judge 看完整召回窗口**：送审条数从固定 4 条改成 `recallMaxNotes`（默认 8）。同一批 120 题上，只判前 4 条时注入 4.14 条/500 token，判全部时 0.84 条/126 token，答对率相同（73.8–76.3%）——多送 4 条的 prompt 成本远小于被漏掉的多余注入。同时修掉 `bench/user-sim/e2e.mjs` 里 judge 读错正文字段（`body` vs 召回条目的 `content`）导致「judge 净亏 6 个点」的假结论。
- **语义融合传入全库名次**：`augmentWithSemantic` 把 `result.scores` 转成 `lexRanks` 交给 `mergeSemanticItems`（需要核心 0.1.13+；旧核心会忽略这个参数，行为不变）。这样同一个问题不会因为预算松紧而换出不同答案。
- **judge 失败路径只放行前 3 条**：软截止、空回复、报错都是 fail-open；召回窗口放大到 8 条之后，整包 fail-open 会比旧的 6 条默认更贵。现在失败时只注入排名最前的 3 条（正常裁决不受影响）。回归用例 `a missed judge deadline injects only the head of the ranking`。
- 193 测试（+8）。

## 0.38.2

- **judge 超时诊断与放宽**：默认超时 4000→6000ms；送去裁决的笔记摘要 240→200 字；失败时区分 `timeout` / `empty` / `error` 写进 `judgeState.last.error`，面板状态里的 `judge.last` 也能看到。live 抓到一次 2.9s 超时导致 `no_verdict`（fail-open、静默）——现在至少能解释。
- **文档**：新增 [三分钟上手](docs/QUICKSTART.md) / [English](docs/QUICKSTART.en.md) 与 [备份与迁移](docs/BACKUP.md)；`CROSS-HOST` 两份加「验证状态」表（DSH 运行中 / CLI·MCP 真实 / Claude Code 契约级 / Cursor·Codex 文档级 / 其余未做）；README 双语加文档入口。
- 182 测试 + 30 验收。

## 0.38.1

- **面板真实浏览器 E2E 修复**（用本地 React harness 渲染真实 DOM 逐项点过）：
  - 切页签后旧页签残留黑色下划线（React 样式对象复用导致 `border-bottom-color` 回到 `currentColor`）——基础样式显式给 `transparent`。
  - 「高级状态」里裁决模型名重复显示（`judgeLabel` 已含模型，kv 行又拼一次）。
  - 上次召回的 `llm_judge` 原因显示英文枚举——新增「模型裁决后保留」文案。
  - 设置页「测试连接」标签与按钮同名——按钮改为「开始测试」。
  - 笔记阅读页正文重复显示 `# 标题`（标题已单独渲染）——渲染时剥掉首行一级标题。
- 179 测试 + 30 验收。

## 0.38.0

- **Cursor / Codex 只读 MCP 接入**：`docs/CROSS-HOST.md`（及英文版）补上两段可直接粘贴的配置——Cursor `.cursor/mcp.json` 与 Codex `~/.codex/config.toml`——并说明 `npx --package tabellio@0.1.12 tabellio-mcp` 的正确写法（写成 `npx tabellio@0.1.12 tabellio-mcp` 会把可执行名当 CLI 参数）、`--allow-write` 的边界、`TABELLIO_STORE` 显式指定。
- 新增 `npm run check:mcp`（`tools/cross-host-mcp.mjs`）：临时库启动 MCP 服务器，验证默认只读工具面、`--allow-write` 写工具面、`tools/call` 往返、stdout 纯 JSON-RPC，并校验文档里的命令拼写；CI 与 release workflow 均加入。
- 179 测试 + 30 验收。

## 0.37.0

- **裁决趋势（近 4 周）**：`judgeTrend` 按周统计 judge 调用、被复核次数与同意率；「最近 7 天」卡新增一行，形如 `2/3 · 1/1 · — · —`（复核/调用），一眼看出模型裁决有没有长期跑偏。
- `weekly.report` 返回新增 `judgeTrend`；面板与端点同源。
- 179 测试 + 30 验收。

## 0.36.0

- **短模糊问句不再调 judge**：新增 `judgeMinChars`（默认 6，0 关闭）。去掉标点后短于该字数、且不含数字/拉丁词/引号的问句（如「上次召回」）直接不注入并记 `low_information_query`，省掉约 1.9s 的模型调用；带具体对象或足够长的问句照常裁决。
- 面板「召回原因」新增该原因的说明文案。
- 178 测试 + 30 验收。

## 0.35.0

- **「最近 7 天」汇总卡**：把召回次数、注入成本（字数与估算 token）、judge 保留/丢弃与复核数、新增记忆合成一张卡，替代原来分散的「召回质量」「记忆成本」两张卡（旧宿主没有 `weekly.report` 时自动回退旧卡片）。
- 新增 `weekly.report` 端点（days 1–31）与 `src/weekly.js` 聚合（只读本地日志）；工具/面板同源。
- 175 测试 + 30 验收。

## 0.34.0

- **上下文预算**：一轮注入最多 `injectMaxChars` 字（默认 1400，约 450 token），超出的条目变成「标题 + 120 字摘要」指针，全文留给 `tabellio_read`；`injectFullNotes` 控制前几条给全文（默认 2）。
- **会话内去重**：`injectRepeat: 'session'`（默认）让已经注入过的笔记不在同一会话里重复出现；`turn` 只压住相邻一轮，`off` 关闭。
- **可观测**：`lastRecall.chars` 与面板「上次召回」显示本轮注入字符/估算 token。
- 实测（10 条真实问题）：平均块 1332 → 941 字（-29%），最大块 2803 → 1425 字（-49%），全部落在 500 token 预算内。

## 0.33.3

- 依赖 `tabellio@^0.1.12`：语义融合改用 RRF（reciprocal rank fusion），强语义命中可以挤掉弱的词面命中，不再因为词面先填满 `maxNotes` 而永远进不来。真实库 30 题复核：插件宽档命中 17/20 → 19/20，负例注入数不变（该题集已参与过阈值讨论，只作机制验证）。
- 适配器测试名与断言同步（融合后顺序仍为强词面优先、语义补充其次）。

## 0.33.2

把核心的一致性自检接进参考适配器的 CI：插件作为「DSH 适配器」必须证明自己守住核心不变量。

- 新增 `npm run check:conformance`（调 `node node_modules/tabellio/tools/conformance.mjs`，22 项检查、临时库、不联网）。
- `.github/workflows/ci.yml` 与 `release.yml` 在测试后各加一步一致性自检。
- 依赖：`tabellio` 升到 `^0.1.9`（核心 0.1.9 发布包首次带 `tools/`）。
- 实测：插件 170 测试 + 验收 30 + 核心自检 22/22。

## 0.33.1

语义层改吃核心：索引格式、可索引条件、余弦排序与合并全部来自 `tabellio@^0.1.8`，插件只保留 embedding 服务适配与后台调度。

- `src/semantic.js` 删除本地索引读写、正文抽取、cosine、合并实现；`refreshIndex` 调核心 `indexSemantic`（注入 `embed`），`semanticTop` 调核心 `rankSemantic`，`mergeSemanticResult` 直接复用核心 `mergeSemanticItems`。
- 语义索引文件仍是 `<store>/runs/semantic-index.json`，但格式由核心定义（换模型自动失效）；首次升级会重建一次（正文哈希口径变了）。
- 测试：插件 170 / 验收 30；核心侧另有 `test/semantic.test.mjs` 覆盖增量、生命周期过滤、合并与落盘。
- 依赖：`tabellio` 升到 `^0.1.8`。

## 0.33.0

把「反馈排序」和「遗忘衰减」交还给核心：插件不再自己存 `panel-feedback.jsonl` / `outcome.jsonl`，也不再自己算排序权重。

- **反馈落点**：`tabellio_feedback` 工具与 `feedback.add` 面板端点改调核心 `recordFeedback`，事件统一写 `<store>/runs/feedback.jsonl`；核心读取时自动合并旧的两个插件文件，历史反馈不丢。
- **排序**：召回不再由插件二次排序，而是在调用核心 `recallQuery` 时传 `applyFeedback`（由 `feedbackRanking` 控制）与 `decay`（由 `decayDays` / `decayFloor` 控制）。核心只调顺序，不增删、不越过召回闸。
- **纠错归因仍留在插件**：`maybeRecordCorrection` 需要上一轮的注入状态与会话上下文，判定命中后写一条核心 `corrected` 事件；不再自建日志。
- **新增配置**：`decayDays`（默认 180，`0` 关闭）与 `decayFloor`（默认 0.6）；`trust: user_stated` 与 `evergreen` 笔记不衰减。
- **行为差异**：`outcomeFeedback` 只控制「是否做纠错归因」，不再控制排序。

## 0.32.1

- 面板主题修复：改用宿主真实 token（`--dsw-alias-*`，暗色模式不再白底），补齐缺失的 `COLORS.bg/surface/input` 与 `ui.errorLine/noteMain/kvKey/kvValue` 样式。
- 面板词条修复：补齐「记忆使用与成本」卡、冲突扫描提示、设置区若干英文词条（此前会显示原始 key）；新增静态守卫测试，`t()` 用到的 key 与引用的色板/样式必须在字典里存在。
- 176 测试 + 30 验收。

## 0.32.0

- 裁决短缓存：同一问题、同一批命中在 `judgeCacheMinutes`（默认 10 分钟）内复用上次裁决，不再重复调模型；命中集合变化或超时会重新裁决。面板「上次召回」会显示 `cache` 阶段，抽查日志里也记 `verdict: cache`。
- 新增配置 `judgeCacheMinutes`（0–1440，0 关闭）；README/README.en 配置表同步；174 测试。

## 0.31.0

- Claude Code 契约检查：新增 `tools/cross-host-claude.mjs`（`npm run check:claude-hooks`），在临时 HOME/临时库里验证 hook 安装写出的 settings 形状、SessionEnd 只把显式线索写成候选、SessionStart 只读提示、以及 MCP `initialize`/`tools/list`/`tools/call` 的 stdio 往返（stdout 仅 JSON-RPC）。CI 与 release 流水线都会跑；不需要模型、不联网、不碰真实配置。
- 文档 `docs/CROSS-HOST.md` 增 Claude Code 一节（含真实安装的预览/写入命令）。
- 172 个测试 + 30 条验收 + 两套跨宿主检查。

## 0.30.0

- 成本台账：每轮真正注入记忆时记一条 `runs/usage.jsonl`（注入字符、是否调 judge 与耗时、是否走语义），最多 2000 条；面板概览新增「记忆成本（近 7 天）」卡：注入轮数、字符与估算 tokens（按 3 字符≈1 估算）、judge 调用次数与平均耗时、语义查询次数。新增 `usage.summary` RPC。只统计记忆层自己的开销，不碰宿主对话账本。
- 172 个测试 + 30 条验收。

## 0.29.0

- 裁决复核：每次模型裁决都把「保留 / 丢弃了哪些记忆」记到 `runs/judge-log.jsonl`（最多 300 条）；面板概览新增「裁决复核」卡，可对每条裁决标「判得对 / 判错了」，近 7 天同意率可见。新增 `judge.recent` / `judge.review` RPC。日志与复核都不改任何笔记，坏了也不影响召回。
- 169 个测试 + 30 条验收。

## 0.28.0

- 冲突扫描并入每日巩固：`consolidate: daily/weekly` 时，除近似重复提案外还会扫「同主题、说法变了」的笔记对，结果写入 `runs/conflict-state.json`；面板「可能过时的记忆」卡显示上次扫描时间与对数（即使 0 对也可见）。
- 165 个测试 + 30 条验收。

## 0.27.0

- 记忆编辑：笔记阅读页新增「编辑」——改标题/正文后保存，会写入一条新版本并把旧版本标记为被取代（`superseded_by` + `valid_to`），自动召回改用新版本，旧文保留可审计。新增 `edit` RPC 端点与 `tabellio_edit` 工具（须人明确提出修改）。超过单条 400 字上限会明确拒绝。
- 164 个测试 + 30 条验收；工具总数 11 → 12。

## 0.26.0

- 语义索引定时增量刷新：默认每 5 分钟扫一遍新写/改过的笔记（只对变化的部分重新算向量），新记忆不用重启就能被语义召回；`semanticRefreshMinutes: 0` 可关闭。索引构建时也跳过 archived/draft/被取代/过期笔记。
- 158 个测试 + 30 条验收。

## 0.25.1

- 修语义补召回的越权：语义命中此前不检查笔记生命周期与信任级别，可能把已归档（你刚「忘掉」的）、已被取代的笔记或 `external` 参考文档重新注入。现在建索引时跳过 archived/draft/被取代/已过期，合并时再按 `recallTrusts`、status、`superseded_by`、`valid_to` 过滤；即使索引还没重建，忘掉的笔记也不会回来。
- 157 个测试 + 30 条验收。

## 0.25.0

- 「忘掉这条」：笔记阅读页新增按钮（确认后归档），新增 `forget` RPC 端点与 `tabellio_forget` 工具（默认只预览，`confirm:true` 才归档）。归档走核心 `consolidate` 的 archive 通道，只改元数据、不删文件，自动召回立即不再返回。
- 155 个测试 + 30 条验收。

## 0.24.0

- 笔记阅读页新增「时间线」：把写入（含 `written_by`）、每次被召回（时间 + 当时的问句，扫 `runs/` 回执）、参与过的纠正（`outcome.jsonl`）、面板标记（`panel-feedback.jsonl`）和取代关系合成一条按时间倒序的故事；新增 `timeline` RPC 端点。
- 153 个测试 + 30 条验收。

## 0.23.0

- 笔记阅读页新增「来源与使用」：写入来源（`provenance.written_by`）、信任级别与范围、是否已被取代、被召回次数与最近一次（扫 `runs/` 回执，最多最近 500 张）；新增 `provenance` RPC 端点。
- 151 个测试 + 30 条验收。

## 0.22.0

- 面板「概览」显示最近召回记录：每条带模式徽标、查询、命中条数与人话原因（没带记忆线索 / 命中太弱 / 问句太泛 / 模型判断不相关 / 与上轮相同等），「上次召回」也附带原因；不再把内部代码直接甩给用户。
- 148 个测试 + 30 条验收。

## 0.21.1

- 新增只读延迟基准 `tools/recall-bench.mjs` 与 `npm run bench:recall`；README 记录 1411 条笔记下的实测数字（词面 p95 约 225ms，叠加语义 p95 约 312ms，judge 命中后约 1.0–1.3s）。

## 0.21.0

- 面板「进阶设置」新增两个开关：助手结论沉淀（`captureAssistant`）与纠正反馈（`outcomeFeedback`），写入 `panel-settings.json` 即生效，不用改配置文件。
- 148 个测试 + 30 条验收。

## 0.20.0

- 新增可选的「助手结论沉淀」（`captureAssistant`，默认关）：监听完成的 assistant 消息，轮末把含结论/决定/规则线索的一段整理成「会话结论」候选（≤400 字，凭据内容拒收），由你批准后入库。
- 148 个测试 + 30 条验收。

## 0.19.1

- 结果反馈归因门槛改为「≥3 个共享词元」，避免「同项目、不同方面」的纠正被算到记忆头上；新增 `tools/outcome-eval.mjs`（36 条合成样本，P 0.923 / R 1.0）。`status.outcome` 暴露近 30 天纠正计数。

## 0.19.0

- 新增结果反馈（`src/outcome.js`）：注入后的下一轮出现纠正句、且与刚注入的笔记有 ≥2 个共享词元时，记一条 `outcome.jsonl` 信号；之后只在排序里小幅降权（最多 24%），不删笔记、不越闸。10 分钟窗口，不相关纠错不归因。
- 新配置 `outcomeFeedback`（默认 `true`）；146 个测试 + 30 条验收。

## 0.18.0

- 新增风险分级（`src/approval.js`）：每个候选判为 T0（可自动入库）/ T1（批量人工）/ T2（必须逐条，凭据/冲突/权威/隐私外发）。默认只做分级、不改流程。
- 自动入库默认关闭（`autoApprove: off`）；打开后仍需 `writeJudge: llm` 通过——对抗语料实测纯规则 T0 的 precision 只有 0.64（会把「以后都别跑测试」「以后都别备份」这类危险规则放进来），所以规则只当预筛，模型写侧判断当第二道闸，任何一步失败都回候选。
- 140 个测试 + 30 条验收全绿。

## 0.17.2

- 修：store 损坏（notes/ 不可解析）时召回静默返回空，事件路径无告警；现在空结果每分钟最多探测一次 store 健康并 warn，正常库不付代价。
- 134 个测试 + 30 条验收全绿。

## 0.17.1

- 修：多窗口/多会话并发时，静默注入的宿主级上下文可能串到另一个会话；检测到多个活跃会话时退回会话内通知，单会话仍走静默注入。

## 0.17.0

- 面板「可能过时的记忆」卡新增「预览并合并」：先看合并后的正文，再确认；确认后旧笔记标记被取代（可回滚），全程不离开面板。对应 RPC `conflicts.preview` / `conflicts.merge`（后者必须显式 `confirm:true`）。
- 修复 0.16.0 引入的两处英文/中文词条缩进问题。
- 133 个测试 + 30 条验收全绿。
- 修：多会话并发时，静默注入的宿主级上下文可能把 A 会话的召回带进 B 会话；现在检测到同时活跃的会话就退回「本轮通知」，并清空共享槽位。

## 0.16.0

- 使用反馈闭环的第一版：新工具 `tabellio_feedback`（有用 / 不对 / 过时）、面板笔记阅读页两个按钮、RPC `feedback.add`、`status.feedback` 计数。反馈只做小幅重排（最多 ±12%），从不增删或改写笔记；`feedbackRanking` 可关。
- 131 个测试 + 30 条验收全绿。

## 0.15.1

- 面板「概览」新增「可能过时的记忆」卡（只读）：显示新旧两条标题、重叠度与替换信号；处理方式仍是在对话里让助手先 dry-run 再合并。对应新 RPC 端点 `conflicts.list`。
- 126 个测试 + 30 条验收全绿。

## 0.15.0

- **冲突发现 + 人批准的取代**：新工具 `tabellio_conflicts`（只读：同主题、高重叠、出现替换措辞/数值不同/极性相反的笔记对）与 `tabellio_merge`（默认 dry-run；用户明确同意后才 confirm，落盘时旧笔记写 `valid_to` + `superseded_by`，可回滚）。核心的 5% 改动率保险丝对这类人工批准的小批量合并放开到 100%。
- `tabellio_recall` / `tabellio_search` 支持 `as_of`（按某个时间点召回/搜索）；插件内部把日期字符串转成核心 0.1.5 认识的 `asOfMs`。
- 冲突检测默认只看 `user_stated` / `system_derived`，按标题相似度过滤，避免把导入的参考资料误报成冲突。
- 125 个测试 + 30 条验收 + 12 条评测全绿。

## 0.14.1

- 反思提示词要求「一段摘要只谈一个主题」，来源 id 去重后再落候选（本地模型实测把两件不相关的事混进一段）。

## 0.14.0

- **反思 / 升维（`reflect: 'llm'`，默认 off）**：每日巩固时把最近 14 天的笔记压成 1–2 条「当前状态」摘要，**只写成候选**，面板批准后才入库；模型失败不写、来源不在窗口内直接丢弃、不自动合并。
- 巩固扫描改为异步（`maybeSweep` 返回 Promise），同一次扫描里先做重复检测、再做反思；两者互不影响。
- 面板设置区新增「反思」状态胶囊（最近新增几条摘要）。
- 119 个测试 + 30 条验收全绿。

## 0.13.0

- **写侧检查（`writeJudge`，默认 `off`，DSH 线上开 `llm`）**：候选生成后再问一次「这条信息几周后还有用吗」，只保留真正的长期事实；模型不可用/超时/解析失败时保留原候选（fail-open）。
- **记忆评测工具 `tools/memory-eval.mjs`**：临时库跑知识更新、时间推理、偏好、项目与弃答五类用例，输出每类通过数；CI 与 release 都会跑一遍（`npm run eval:memory`）。
- **意图闸补词**：规定 / 顺序 / 应该 / 是否 / 能不能 / 可不可以 / 怎样 / 放哪 / 在哪 / 吗——长问句不再被误拦；「今天天气怎么样」这类仍由 judge 兜底。
- **面板修复**：笔记阅读与首次引导改为面板内联页，不再被设置弹层/背景遮挡。
- 112 个测试 + 30 条验收 + 12 条评测用例全绿。

# Changelog

## 0.12.3
- 首次配置向导：三步（要智能记忆吗 → 本机/远程向量服务 → 存第一条记忆），自动在第一次打开面板时出现，可「稍后再说」；设置页底部提供「重新运行引导」。
- 远程向量服务的地址 / Key / 模型可直接在向导里填写；完成后写入 `panel-settings.json` 并触发一次重新加载。
- 106 个单元测试 + 30 条验收。

## 0.12.2
- 设置页重排：智能记忆开关 + 状态胶囊，进阶设置折叠为「语义检索」「使用偏好」两组卡片式表单，字段间距、帮助文字与折叠动效统一；运行状态改成键值列表。
- 裁决不再提供独立模型输入：judge 始终使用宿主当前对话模型（保存时不再把当前模型写死成 `judgeModel`），换模型自动跟随；高级用户仍可用配置文件固定。
- 106 个单元测试 + 30 条验收。

## 0.12.1
- 远程向量服务：`semanticApiKey`（面板填写，落 `panel-settings.json`；支持 `TABELLIO_SEMANTIC_API_KEY` 环境变量，面板只显示「已设置」，永不回显 Key）；嵌入与探测请求带 Bearer 头。
- 面板「获取模型」：新增 `semantic.models` 端点，从 `/v1/models` 拉取列表供选择；「测试连接」改为显式按钮并显示维度与耗时。
- 106 个单元测试 + 30 条验收。

## 0.12.0
- 零配置：`semantic` 默认 `auto`，自动探测本机常见向量端点（llama-swap / Ollama / LM Studio / :8000）与 `/v1/models`，没有服务就静默退回词面匹配；`judge` 默认 `llm`，命中时用宿主当前默认模型做一次小裁决（失败放行）。
- 面板设置收成一个「智能记忆」开关（开 = 语义 + 裁决，关 = 纯词面）；服务地址/模型、捕获、投递、每轮条数、巩固节奏收进「进阶设置」。
- 修复 `probeEmbedding` 调用未定义的 `embedMany`（“测试连接”必失败）——改为 `embedTexts`；自动发现因此可用。
- 出厂 `cordis.patch.yml` 同步：`semantic: auto`、`judge: llm`。
- 103 个单元测试 + 30 条验收。

## 0.11.0
- 面板整体重做：四个页签（概览 / 待批准 / 记忆库 / 设置），统一间距与字号、图标按钮、动效与焦点样式；候选与提案卡片、笔记阅读浮层、空态与骨架屏重做。
- 面板设置此前读不到、保存静默失效：插件没把 `getSettingsView/updateSettings/testSemantic/getSemanticState` 接进 RPC handler，现已接通并用面板真实走通「读取 → 修改 → 落 panel-settings.json」。
- 101 个单元测试 + 30 条验收。

## 0.10.0
- 「打开记忆面板」不再模拟点击宿主设置：改为插件自己的全宽浮层，完整复用设置里的记忆面板（待批准 / 搜索 / 最近召回 / 设置），Esc 或点空白关闭。
- 去掉此前基于 DOM 猜测定位设置触发器的实现。
- 101 个单元测试 + 30 条验收。

## 0.9.5
- 修 0.9.4 的跳转点错按钮：只认 aria-label 为「设置 / Settings」的触发器，并用 `[data-shortcut-modal="settings"]` 确认打开的是设置面板；找不到就退化为提示文字，绝不误触其它弹窗。
- 101 个单元测试 + 30 条验收。

## 0.9.4
- 标题栏「记忆」弹层加「打开完整面板」：直接打开设置并切到「记忆」分区；宿主界面结构变化时自动退化为一行提示文字，不报错。
- 101 个单元测试 + 30 条验收。

## 0.9.3
- 修「点批准没反应」：超过单条 400 字上限的候选，批准会被写闸拒绝（`too_long`），此前界面静默。现在面板与标题栏弹层都会显示原因（超字数/候选已不存在/其它）。
- 捕获端提前拦截：`tabellio_capture` 与自动捕获都不再写入超过 400 字的候选，避免产生批准不了的候选。
- 101 个单元测试 + 30 条验收。

## 0.9.2
- 修标题栏「记忆」胶囊显示成 `memChipLabel` 的问题：补齐 zh/en 词条（标签/标题/空态/更多/设置入口/批准/忽略/待批计数）。
- 胶囊现在显示库里的笔记数与待批准数（如「🧠 记忆 1407 · 2 待批准」）。

## 0.9.1
- 新增 `recallTrusts`：自动召回默认只信任 `user_stated` / `system_derived`；从旧 Engramory 库迁移的 612 条 `external` 文献仍可用面板/工具搜索，但不会被自动注入，避免 600+ 文档淹没日常对话。
- 100 个单元测试 + 30 条验收。

## 0.9.0 (2026-10-19)

- 会话顶部「记忆」入口：标题栏右侧常驻 chip，有候选/提案时显示红点与数量；点开可直接批准或忽略前 5 条，其余引导到设置页。
- 面板可配置项补全：自动捕获档位、记忆投递方式（静默 / 提示）、每轮最多给几条；加上 0.8.0 的语义 / judge / 巩固，共 9 项可在界面里改。
- 语义补充、judge、捕获等设置全部写入 `panel-settings.json` 并即时生效（投递方式切换无需重启）。
- 99 个测试 + 30 条验收。

## 0.8.0 (2026-10-19)

- 面板内设置：语义补充（开关/地址/模型/测试连接）、模型裁决（开关/模型）、后台巩固（关/每天/每周），保存即生效；写入记忆库的 `panel-settings.json`，覆盖插件配置默认值，不动宿主 YAML。
- 候选支持「全部批准 / 全部忽略」，来源显示为「来自对话 / 来自工具调用 / 从旧库导入」。
- 新增 RPC：`settings.get`、`settings.set`、`semantic.test`；`pickPanelSettings` 白名单校验。
- 99 个测试 + 30 条验收。

## 0.7.0 (2026-10-19)

- 设置面板重排为四块：待你批准 / 存一条记忆 / 找一条记忆 / 最近发生；技术细节收进折叠的「高级状态」，顶部加一句用途说明。
- 面板显示语义补充状态（已索引/正在建/不可用/未开启）与切换提示；judge 行显示所用模型，并新增近 7 天「裁决保留 vs 丢弃」统计。
- `status` 新增 `semantic` 字段；`audit.summary` 新增 `judge.kept/dropped`。
- 97 个测试 + 30 条验收。

## 0.6.0 (2026-10-19)

- 新增可选语义补充 `semantic: off|local`：后台构建本地嵌入索引（`runs/semantic-index.json`，增量），召回时把 BM25 漏掉的语义命中追加进来，仍走意图闸与 judge；嵌入服务不可达静默回退。
- 冻结盲测（20 正例 / 10 负例）：仅语义 top-6 覆盖 19/20，词面为 13/20；负例最高余弦 0.534，默认阈值 0.55。
- 94 个测试 + 30 条验收；默认关闭，需本地 `/v1/embeddings` 服务。

## 0.5.1 (2026-10-19)

- 召回质量周报：新增 `audit.summary` 端点（近 1–31 天分模式计数、最常被拒问题、最常召回笔记），面板顶部显示近 7 天质量卡。
- 88 个测试 + 30 条验收。

## 0.5.0 (2026-10-19)

- 新增召回回看：每次召回决策追加一行 `runs/recall-audit-YYYY-MM.jsonl`，面板显示最近 20 条（注入/意图闸/无命中/裁决丢弃/去重/出错），附 RPC `audit` 端点。
- 新代码需重启宿主后才开始累积记录。
- 85 个测试 + 30 条验收。

## 0.4.2 (2026-10-19)

- 面板状态区新增「后台巩固」：显示每日/每周节奏与上次运行时间（`status.consolidate`），让定时任务可见。
- 80 个测试 + 30 条验收。

## 0.4.1 (2026-10-19)

- 新增后台巩固 `consolidate: off|daily|weekly`：到期后在空闲时扫近似重复笔记、写合并提案（最多 3 条/次），不自动合并；状态存 `runs/consolidate-state.json`，失败只 warn。
- 80 个单元/集成测试 + 30 条验收；795 篇笔记实测扫描约 1.7s（0 提案，因无近似重复）。

## 0.4.0 (2026-10-19)

- 新增跨宿主一致性检查 `npm run check:cross-host`：临时库里验证插件 API → CLI 检索 → CLI 批准候选 → MCP 服务器召回正文 → 三方笔记数一致，失败非零退出，可放进发布 CI。
- `docs/CROSS-HOST.md` 增入口级走查说明；74 测试 + 30 验收不变。

## 0.3.3 (2026-10-19)

- 面板「全部笔记」支持按类型（语义/流程）和按时间（7/30/90 天）筛选；`notes` 端点回显并校验 `kind` / `days`。
- 74 个单元/集成测试 + 30 条验收。

## 0.3.2 (2026-10-19)

- 候选待批时，静默上下文每 6 小时最多提示一次（普通用户不必自己记得打开设置页），批准仍只在面板发生。
- 72 个单元/集成测试 + 30 条验收。

## 0.3.1 (2026-10-19)

- 设置面板新增「全部笔记」分页浏览：默认每页 20 条、按写入时间倒序，点标题读全文，「加载更早的笔记」继续翻页（`notes` 只读端点，limit 5–50、offset 校验）。
- 71 个单元/集成测试 + 30 条验收。

## 0.3.0 (2026-10-19)

- 设置面板可以直接写一条记忆（`remember` 只读以外的唯一写端点，走与 CLI 相同的写入闸）：输入框 + 保存即入库，不经过候选，因为输入的人就是批准的人。
- 面板搜索命中可点开全文（0.2.2 的 `read` 端点）保持。
- 69 个单元/集成测试 + 30 条验收。

## 0.2.3 (2026-10-19)

- 面板对旧宿主更宽容：`report` 端点不存在时周报区自动留空，不影响状态/候选/搜索。

## 0.2.2 (2026-10-19)

- 面板搜索命中后可以点标题直接看笔记全文（`read` 只读端点，正文上限 4000 字），不用切回对话让 agent 读。
- 68 个单元/集成测试 + 30 条验收。

## 0.2.1 (2026-10-19)

- 设置面板新增「最近 7 天」周报：新增条数 + 最新 3 条标题，数据来自只读的 `report` RPC 端点（与 `tabellio_report` 工具同一实现）。
- 67 个单元/集成测试 + 30 条验收。

## 0.2.0 (2026-10-19)

- 新增第七个工具 `tabellio_report`：按最近 N 天（默认 7）列出新增记忆、候选/提案待批数量，只读、不调模型。用户问「这周记了什么」时可直接用。
- 66 个单元/集成测试 + 30 条验收。

## 0.1.9 (2026-10-19)

- 个人评测语料（`tools/blind-queries.json`、`tools/recall-eval.py`）移出仓库，只在本地 `archive/` 保留；README 的评测命令改成接收外部数据集路径。发布包附带 `tools/cross-host-demo.mjs` 与 `tools/judge-eval.mjs`（通用脚本，不含个人数据），README 里的走查命令装完即可运行。
- README 增「模型裁决（可选）」实测快照：本地 35B 模型 30 条冻结问句，gold 保留 18/19、保留项相关率 85.7%。
- 62 个单元/集成测试 + 30 条验收。

## 0.1.8 (2026-10-19)

- 首次使用引导：面板在库为空时直接告诉用户下一步做什么（在对话里说「记住：…」，或交一份 Markdown 笔记），而不是只显示 0。
- npm 关键词补齐（`agent-memory` / `ai-memory` / `local-first` / `memory-plugin`），方便在插件市场被搜到。
- 62 个单元/集成测试 + 30 条验收。

## 0.1.7 (2026-10-19)

- 出厂召回阈值改为「对话场景」调过的值：`recallMinRelevance 0.12` / `recallMinScore 0.1` / `recallMinCoverage 0.33` / `recallConfidentRelevance 0.9`。此前出厂值沿用 tabellio 的短查询口径（0.15/0.18/0.6），新用户装上后长问句几乎召回不到东西（796 篇语料实测 1/12），现在是 6/12，再由意图闸与可选 judge 兜底。
- `cordis.patch.yml` 明确写出这四个键，避免补丁整段覆盖时回落到旧默认。
- 62 个单元/集成测试 + 30 条验收。

## 0.1.6 (2026-10-19)

- 「上次召回」补 `elapsedMs`（面板与 `last_recall` 都能看到召回耗时），慢库更容易被发现。
- 新增英文跨宿主说明 `docs/CROSS-HOST.en.md`（与中文版逐节对应）。
- 62 个单元/集成测试。

## 0.1.5 (2026-10-19)

- 每轮记忆可见性（0.1.5）：`last_recall` 增加 `titles`（本轮实际用到的记忆标题，最多 3 条），`tabellio_status`、面板「上次召回」都能直接看到「上一轮到底用了哪几条」。
- 新增跨宿主说明 `docs/CROSS-HOST.md` 与 `tools/cross-host-demo.mjs`：一个 Markdown 库，DSH 插件 / CLI / MCP 三个入口共用，含三分钟走查与能力对等的离线验证脚本。
- 62 个单元/集成测试。

## 0.1.4 (2026-10-19)

- `tabellio_status` 新增 `last_recall`（`mode` / `at` / `query` / `count` / `reason`）：Agent 自己也能看到「上一轮为什么没召回 / 召回了几条」，排查不用再开面板。
- 62 个单元/集成测试。

## 0.1.3 (2026-10-19)

- 开源仓库上线：https://github.com/yffo/tabellio-dsh（`repository` / `homepage` / `bugs` 元数据）；CI 在 push / PR 上跑 `npm test` 与功能验收。
- 无运行时行为变化。

## 0.1.2 (2026-10-19)

- 设置面板新增「自动巩固提案」：`proposals.list` / `proposals.review` 两个 RPC 端点（只读列表 + 批准/拒绝，走 tabellio 的 `reviewProposals` 闸门），面板里逐条显示来源笔记、相似度与目标，可一键批准合并或拒绝。
- 面板底部说明改为中英双语字典项（不再硬编码中文）。
- 英文 README（`README.en.md`）与中英文切换；配图改为仓库内手绘 SVG（`docs/assets/hero.svg`、`docs/assets/flow.svg`），无外部资源依赖。
- 61 个单元/集成测试（新增提案端点用例）。

## 0.1.1 (2026-10-19)

- 修复首次发布被 npm staged 占位（registry 上只有 `0.0.0-stage`）的问题：版本号从 0.1.0 前移到 0.1.1 后重新发布；内容与 0.1.0 相同。

## 0.1.0 (2026-10-19)

首个 DSH 宿主适配器。

- 原生工具：`tabellio_recall` / `tabellio_search` / `tabellio_read` / `tabellio_status` / `tabellio_capture` / `tabellio_inbox`。
- `agent/pre-step` 自动召回：每轮首个真人消息、预算内、refused 静默、同一 message 去重、同一批笔记不重复注入。
- `agent/turn-stopping` / `agent/disposed` 自动捕获：只抓显式线索，只写 `notes/candidates/`，批准仍走 `tabellio inbox`。
- 影子模式 `shadow`（默认 `false`）：召回照常执行但不注入，每次召回落一张 `runs/rcp_*.json` 回执，供 `tabellio explain/verify` 复盘与 A/B。
- `tabellio_status` 输出 `recall_mode`（`inject` / `shadow` / `off`）。
- 隐式捕获边界加固：含「密码/口令/密钥/token/api key」的句子一律不落候选（含策略句，宁可漏记），跳过时记 info 日志；「这次/今天/暂时」「先别用/别再用」等一次性限定、以及「让子代理…」委派句不落候选。
- 捕获规则对称化：问句结尾补齐「呢/怎么样/如何/好不好/行不行」；`explicit` 的「改成/改为/换成」无持久词视为调参；`implicit` 的「应该」需与「不对/错了/不是…而是/刚才/之前」同句才算纠正；候选超过每轮上限时按「记住 > 以后都/统一 > 其它」的强度排序截断（23 轮对抗模拟：implicit 精确率 .875、explicit 1.0，明文密钥 0）。
- 注入意图闸 `recallIntentGate`（默认开）：离题问句（如「今天天气怎么样？」）即使词面命中也不注入，避免把无关笔记塞进上下文；可配置关闭。
- 新工具 `tabellio_inbox`：`list` 列出候选，`accept`/`reject` 走与 CLI 相同的写入闸门；仅当用户明确要求批准时才调用（批准权仍在人）。
- 捕获模式 `capture`（默认 `explicit`）新增 `implicit`：额外识别「不对…应该」「写错了」「不是A而是B」「改成/换成」这类纠正线索，仍只写候选等人工批准。
- 投递方式 `delivery`（默认 `notice`）：`context` 把同一次召回注册成系统提示里的静默运行时上下文（`tabellio.recall`），对话不插入插件消息；无命中的下一轮自动清空。
- 配置 clamp、密钥/问句/假设句过滤、`capture: off` 边界。
- 捕获模式 `assist`（2026-10-19，来源普通用户语料测试）：在 explicit/implicit 之上识别陈述式约定（「线上库只读」「周二发版」「所有…都」「we use」），补上 27/33 无 cue 的漏捕；纠错线索改为三种模式共用。
- 凭据闸从「见词即杀」改为「策略 vs 值」：允许「统一放 1Password / 走 OIDC」这类策略句，仍拒绝任何赋值形态的凭据值；工具路径与自动捕获共用 `looksLikeCredentialLeak`。
- 自动捕获安全加固（2026-10-19 对抗语料）：整条消息级 fail-closed，`统一用/放` 这类藏值句式也拦；分句残段不再泄漏；`index.js` 写候选前加第二道密钥闸；`duplicate` 不再累计为写入失败（只读恢复后 pending 会收敛）。
- assist 模式补陈述式线索（一直用/我们用 X/都走/不用 X/不要写进仓库/只接受/不能挂/优先迁就/每学期…排），并支持「如果…每次…」的条件式长期规则；implicit 纠错仍要求纠错语境。
- 意图闸加置信直通：没有记忆意图词但首条 relevance ≥ `recallConfidentRelevance`（默认 0.92）时放行；盲测 40 条：工作问题 0.93–0.98、离题问题 ≤0.911。
- 模型裁决窗口跟随 `recallMaxNotes`（不再只裁前 4 条、丢掉召回尾部），未进裁决窗口的条目保留。
- judge 诊断补全：面板 status 增 `host`/`selection`/`last.stage`/`chars`/`preview`（模型原始回复前 200 字）；`maxTokens` 80→512，修「deepseek-flash 先花推理预算、回复为空 → 静默无裁决」（实测 1173ms `no_verdict`）；55 个测试。
- 可选模型裁决（`judge: 'llm'`，`src/judge.js`）：注入前让宿主模型只保留真正相关的笔记，超时/报错/格式不合法一律回退到词面命中（fail-open），影子模式不裁决；默认关闭。
- 设置面板「上次召回」摘要：展示最近一轮召回的时间、查询片段、结果（影子回执 / 已注入 / 静默上下文 / 未注入原因 / 拒答 / 去重）与命中数，面板里能直接看到记忆为什么没进来。
- 设置面板（`client/client.js` + `src/rpc.js`）：DSH 设置里的「记忆」页，展示库状态与待审候选，支持批准/忽略（同一写入闸门）；面板内可直接搜索库（`search` 端点，只读）并看到命中分数；通道 `/tabellio-dsh` 按 DSH 连接协议挂成 `webServer` prefix 路由（`client-request` → `server-response`，rpcId 回显，Host Connection 鉴权），无 `webServer` 时回退 `connection.rpc`，两者都没有时跳过面板。
- 补充问句守卫（还是…/是不是）、延期句（以后再说）、一次性替换与委派的一次性/长期区分。
- 压测修复（2026-10-19，来源 `/tmp/tabellio-test-b/report.md` 的 66 case）：工具路径 `tabellio_capture` 补密钥闸；召回文本转义 `</tabellio-memory>`；匿名消息 id 改整串哈希；无 `agent.id` 的宿主按对象/session 隔离状态；只读库失败改为 warn + 下一边界重试（部分成功时只重试失败项，不重复写入）；`ctx.get` 移入 try；`storePath: ''` 回退到展开后的默认路径。
- 子代理（`delegationDepth > 0`）不回注记忆、也不落影子回执：它们的开场消息是角色提示（实测会把 1.5k 字的测试员提示写进 `runs/`），跳过既省成本又不污染 A/B 数据。
- 自动召回闸门可配：`recallMinCoverage` / `recallMinScore` / `recallMinRelevance`（长自然问句保守阈值下几乎全拒，需按语料调松）。
- 发布前验收修复：`tabellio_search` 的 `limit` 改走 `maxNotes`（之前恒返回 8 条）；recall 工具 `budget_tokens` 如实返回本次预算；RPC/tools 的 `ids` 拒绝逗号串（防一次批多条）；HTTP 路由对 carrier/handler 抛错回 500 而不是抛穿；委派 agent 不再通过宿主级上下文继承父会话的召回文本；`密钥由 KMS 管理` 这类「由…管」策略句不再被凭据闸误杀。
- 安全加固（发布前对抗测试）：`tabellio_capture` 的 `source`/`tags` 与正文同过凭据闸，并限制 tags 数量/长度（防 frontmatter 绕过 8KB 上限）；凭据闸识别「无赋值粒子的裸值」（`密码 Hunter2`、`实际值 Abc123xyz`），不再被 1Password 占位词整体放行；召回渲染剥离控制字符；宿主无法报告自身 origin 时按 Host 头校验 Origin。
- 59 个单元/集成测试（面板通道覆盖鉴权、跨站 Origin 拒绝、envelope 校验与 webServer inject 挂载）；66 case 压测复跑 0 失败（原 55 通过项零回归、7 失败项全修复）；78 轮普通用户语料测试见 archive/2026-10/scratch/tabellio-dsh-validation/。真实 DSH 装载需重启后人工确认。
