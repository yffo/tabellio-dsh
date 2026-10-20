# 备份、迁移、恢复

tabellio 的库就是本地目录里的纯文本文件，没有数据库、没有后台进程。

## 库里有什么

默认位置：`~/memory/tabellio/`

| 路径 | 内容 | 要不要备份 |
| --- | --- | --- |
| `notes/*.md` | 正式笔记（Markdown + frontmatter） | **要** |
| `notes/candidates/*.md` | 待批准候选 | 建议 |
| `notes/proposals/*.md` | 合并提案 | 建议 |
| `runs/*.json` | 召回回执、语义索引、审计与成本日志 | 可选（可重建，但回执不可再生） |
| `panel-settings.json` | 面板里改过的设置（含远程 API Key） | 可选；含密钥，别公开 |

## 备份

```bash
# 只备份正式笔记（最小、最安全）
rsync -a --delete ~/memory/tabellio/notes/ ~/backups/tabellio-notes/

# 整体快照（含候选、回执、设置）
tar -czf ~/backups/tabellio-$(date +%F).tgz -C ~/memory tabellio
```

也可以把 `~/memory/tabellio` 放进一个私有 git 仓库里提交——笔记是纯文本，diff 可读。**不要**把含 `panel-settings.json` 的目录推到公开仓库。

## 迁移到另一台机器

1. 新机器装好 `tabellio-dsh`，先启动一次让它建出默认目录；
2. 把旧机器的 `notes/` 拷到 `~/memory/tabellio/notes/`；
3. 重启宿主，打开面板确认笔记数；必要时在 `tabellio` 仓库里跑 `node bin/memory status --rebuild-index`。

语义索引（`runs/semantic-index.json`）与 embedding 模型绑定，换模型会自动重建；不需要手工迁移。

## 恢复

```bash
# 从 tar 快照恢复（先停宿主）
tar -xzf ~/backups/tabellio-2026-10-21.tgz -C ~/memory
```

恢复后同样重启宿主并重建索引。写入闸、批准记录都在笔记 frontmatter 里，跟着文件一起回来。

## 体检

```bash
cd ~/yffto/tabellio
node bin/memory status --json     # 笔记/候选/提案/索引/警告
node bin/memory doctor            # 只读体检，不修
```
