# Three-minute quickstart

Goal: install it, teach it one thing, and see it come back. No config file editing.

## 1. Install and restart (~1 min)

```bash
dsh plugin --profile desktop add tabellio-dsh
```

Restart DeepSeek Harness, then open **Settings → Memory**. A three-step wizard appears the first time:

1. **Smart memory** — keep it on. It looks for a local embedding server; without one it stays lexical.
2. **Where the service lives** — local auto-detect, or an OpenAI-compatible endpoint + API key + model (the key stays in the local store; the UI only shows "set").
3. **First memory** — optional, write one sentence.

## 2. Say "remember this" (~30 s)

> Remember: releases here always go through a tag and GitHub Actions; no manual uploads.

Open **Settings → Memory → Pending** and approve the candidate. Nothing becomes a real note without a human click.

Captured: explicit promises, corrections ("no, it should be…"), stable conventions ("the prod DB is read-only"), and optionally assistant conclusions (off by default). Credentials are never written.

## 3. Ask something (~30 s)

Next day:

> How do we release this project?

Relevant notes are injected silently into the context. Check what was used under **Overview → Last recall** (query, mode, count, latency, note titles) and **Last 7 days** (recalls, cost estimate, judge trend).

| Task | Where |
| --- | --- |
| Find a memory | Library → search → open note |
| Fix a memory | Open note → Edit (old version kept) |
| Retire a memory | Open note → Forget (archived, not deleted) |
| Tune recall | Settings → Memory → advanced |
| See misses | Overview → recall log, or ask the agent to use `tabellio_inbox` |

See [BACKUP.md](BACKUP.md) and [CROSS-HOST.md](CROSS-HOST.md) for backups and other hosts.
