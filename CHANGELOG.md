# Changelog

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
