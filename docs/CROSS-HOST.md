# 一个库，三个入口：跨宿主怎么共用记忆

> TL;DR — the DSH plugin, the `tabellio` CLI and the `tabellio-mcp` server all read and write the same Markdown directory, through the same write gate and the same recall engine. No sync layer, no server, no copies.

## 验证状态

| 宿主 | 状态 | 验过什么 |
| --- | --- | --- |
| DSH 插件 | **运行中** | 面板、召回、捕获、judge、巩固都在真实会话里跑过 |
| CLI | **真实可用** | 写入/检索/候选/批准/体检，测试与验收覆盖 |
| MCP | **真实可用** | `tools/list`、`tools/call`、只读/可写边界、stdout 纯 JSON |
| Claude Code | **契约级** | 钩子安装形状、SessionEnd 捕获、SessionStart 只读、MCP 往返；真实会话需本机 Anthropic 登录 |
| Cursor / Codex | **文档级** | 只读 MCP 配置片段与命令拼写已校验，未在真实宿主里跑 |
| Zed / VS Code / Windsurf / Cline / Continue | 未做 | 没有适配器，也没有文档承诺 |

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

核心不动，只写一层薄适配器：挑两个时机——「一轮开始」（召回并注入）和「一轮结束」（捕获候选）——再把宿主的模型调用接到 `judge`。契约见 `tabellio/docs/03-hosts-and-interfaces.md` §7。

## 边界

- 不自动批准、不自动合并/衰减/删除。
- 不复制数据到第二个库；换宿主不搬家。
- 插件只是壳：DSH 适配器坏了，CLI 与 MCP 仍然读写同一份记忆。

## Claude Code：钩子与 MCP 的契约检查

Claude Code 与 tabellio 的接法是两段**宿主自己会执行**的命令，所以它们必须能离线验：

```bash
npm run check:claude-hooks
```

这条检查在临时 HOME、临时库里依次验证：

1. `tabellio hook install --host claude --session-start --write` 写出的 `~/.claude/settings.json` 形状（`SessionEnd`/`SessionStart` 各一条 command hook，15 秒超时，绝对 bin 路径）；
2. `SessionEnd` 钩子吃一段真实形状的 transcript，**只**把显式线索（「以后…都…」）写成候选，不含密钥；
3. `SessionStart` 钩子只读候选数并输出 `additionalContext` 提示，不写库；
4. `tabellio-mcp` 的 `initialize` / `tools/list` / `tools/call` 往返，且 stdout 只有 JSON-RPC。

它不启动 Claude Code 本体，也不调用任何模型——真实会话需要宿主自己的登录与网络，那是用户侧的最后一步。装到真实环境（会改 `~/.claude/settings.json`，默认 dry-run，先看再写）：

```bash
tabellio hook install --host claude --session-start          # 预览
tabellio hook install --host claude --session-start --write  # 写入（自动备份）
```

## Cursor / Codex：MCP 只读接入

tabellio 的 MCP 服务器默认只读（`recall` / `search` / `read` / `list` / `status`）；写入口 `remember` / `capture` 需要显式 `--allow-write`。所以 Cursor、Codex 这类「只读检索」宿主不需要任何额外适配，只要把命令配进去。

Cursor（项目里的 `.cursor/mcp.json`，或全局 `~/.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "tabellio": {
      "command": "npx",
      "args": ["-y", "--package", "tabellio@0.1.12", "tabellio-mcp"],
      "env": { "TABELLIO_STORE": "/Users/you/memory/tabellio" }
    }
  }
}
```

Codex（`~/.codex/config.toml`）：

```toml
[mcp_servers.tabellio]
command = "npx"
args = ["-y", "--package", "tabellio@0.1.12", "tabellio-mcp"]
env = { TABELLIO_STORE = "/Users/you/memory/tabellio" }
```

要点：

- `npx --package` 后面的 `tabellio-mcp` 是包里的第二个可执行名；写成 `npx tabellio@0.1.12 tabellio-mcp` 会把 `tabellio-mcp` 当成 CLI 的参数（会报「未知命令」）。
- 想让 agent 也能写候选，在 `args` 末尾加 `--allow-write`；这仍然只写候选/笔记，批准与合并仍由人做。
- 库路径用 `TABELLIO_STORE` 显式指定，避免宿主以不同 HOME 启动时读到空的默认库。

一致性检查（不需要任何宿主）：

```bash
npm run check:mcp
```

它在临时库里启动 `tabellio-mcp`，验证默认工具面只读、`--allow-write` 才出现写工具、`tools/call` 往返正常、stdout 只有 JSON-RPC，并校验上面两段文档里的命令拼写没有退化。
