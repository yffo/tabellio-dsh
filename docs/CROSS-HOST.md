# 一个库，三个入口：跨宿主怎么共用记忆

> TL;DR — the DSH plugin, the `tabellio` CLI and the `tabellio-mcp` server all read and write the same Markdown directory, through the same write gate and the same recall engine. No sync layer, no server, no copies.

## 同一个目录

默认库目录是 `~/memory/tabellio`（插件配置 `storePath` 可改）。里面就是普通文件：

```
notes/          正式记忆（Markdown + frontmatter）
notes/candidates/  候选，等人批准
notes/proposals/   自动巩固提案
runs/           召回回执（shadow 模式会写）
index.json      本地索引，可随时重建
```

CLI、MCP、DSH 插件打开的都是这个目录，所以不存在「插件里记得、命令行里查不到」。

## 三个入口

| 入口 | 适合 | 怎么用 |
|---|---|---|
| DSH 插件 | 日常对话 | 自动召回（静默注入）、自动捕获（只写候选）、6 个原生工具、设置里的「记忆」面板 |
| CLI | 批量导入、体检、批准、脚本化 | `tabellio status / search / read / remember --file / capture --file / inbox / doctor` |
| MCP | Claude Code、Cursor 等支持 MCP 的宿主 | `tabellio-mcp`（与 CLI 同仓，工具面一致） |

写入路径只有一条：内容先过写入闸门（长度、指纹、密钥、重复），再按类型决定是正式笔记还是候选。**任何入口都不能绕过批准权**。

## 三分钟走查

```bash
# 0) 只看不动
node --input-type=module -e "import('tabellio').then(async m=>{const s=m.openStore(process.env.HOME+'/memory/tabellio');console.log(m.status(s).notes,'notes')})"

# 1) 用插件捕获一条：在 DSH 里说「记住：发版走 tag」
#    然后命令行看到候选
tabellio inbox --json

# 2) 批准（批准权在人）
tabellio inbox --accept <id>

# 3) 命令行写入，反过来在 DSH 里问「我们发版怎么走？」
echo '发版走 tag：vX.Y.Z 由 CI 自动发布。' > /tmp/release.md
tabellio remember --file /tmp/release.md --json
```

跨宿主的能力对等可以离线验证（不碰真实库，默认写到临时目录）：

```bash
node tools/cross-host-demo.mjs
```

它走的是同一条 API：写正式笔记 → 写候选 → 批准候选 → 检索 → 体检。

再加一条入口级的一致性检查（插件 API ↔ CLI ↔ MCP 服务器）：

```bash
npm run check:cross-host
```

它会在临时库里：插件 API 写一条 → CLI 检索到 → 插件写候选、CLI 批准 → MCP 服务器召回到正文 → CLI/API/插件三方的笔记数一致。任何一处不一致都会非零退出，适合放进发布前的 CI。

## 换宿主要做什么

核心不动，只写一层薄适配器：挑两个时机——「一轮开始」（召回并注入）和「一轮结束」（捕获候选）——再把宿主的模型调用接到 `judge`。契约见 `memory-service/docs/03-hosts-and-interfaces.md` §7。

## 边界

- 不自动批准、不自动合并/衰减/删除。
- 不复制数据到第二个库；换宿主不搬家。
- 插件只是壳：DSH 适配器坏了，CLI 与 MCP 仍然读写同一份记忆。
