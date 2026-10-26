# tabellio-dsh 🧠

<p>
  <a href="https://github.com/yffo/tabellio-dsh/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yffo/tabellio-dsh/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/tabellio-dsh"><img alt="npm" src="https://img.shields.io/npm/v/tabellio-dsh" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/npm/l/tabellio-dsh" /></a>
</p>

English | [简体中文](README.md)

**Memory for DeepSeek Harness that remembers — and still lets you decide.**

It watches the conversation for agreements and preferences worth keeping, drops them into a *candidate inbox*, and only stores them after you approve. Days later, ask "how did we decide that?" and it remembers on its own.

Everything lives in plain Markdown files on your own machine. Nothing is uploaded; network traffic stays on loopback — discovering a local embedding service (`semantic: auto`) and one small relevant/not-relevant judge call with the host's current model (`judge: llm`, can be turned off).

<p align="center">
  <img src="docs/assets/hero.svg" alt="tabellio-dsh: candidate inbox → you approve → recalled next time" width="820" />
</p>

---

## Why install it

Open a new conversation and the agent has amnesia: the preferences you mentioned yesterday, the workflow you agreed on, the mistake you corrected — all gone.

Most memory plugins go one of two ways: remember nothing, or dump entire conversations into a memory store. Either way you end up with noise: irrelevant hits bleed into answers, or nothing useful comes back at all.

tabellio-dsh takes a third path: **draft first, memory second.** It only turns things that look worth keeping into candidates; nothing enters the real store until you approve it. Every stored memory keeps its provenance, and recall has a budget and a cap so it never floods the conversation.

## What makes it different from other memory plugins

- **You approve, it remembers.** Auto-capture only writes candidates; it never touches the real store. Deleting and editing stay in your hands.
- **Recall is visible and explainable.** The Memory page under Settings tells you why the last turn recalled something — or why it did not.
- **Local and plain text.** Memory is just Markdown under `~/memory/tabellio`, readable in any editor and portable to another machine.

## Install

Requires DeepSeek Harness `0.2.x`.

```bash
dsh plugin --profile desktop add tabellio-dsh
```

**Restart DSH** afterwards. Open "Settings → Memory": if you can see the note count, candidate count and store path, it is working.

> **Upgrading from 0.39.1 or earlier?** Those releases pinned the recall budget at `500 tokens / 6 notes / coverage 0.33` in the bundle patch. If your `~/.dsh/profiles/<name>/cordis.patch.yml` carries `recallBudgetTokens`, `recallMaxNotes` or `recallMinCoverage`, delete those lines so they follow 0.39.2 defaults (`1200 / 8 / 0.2`); otherwise the old budget keeps winning and nothing in the panel shows it.

> On a development build? Install from a local directory: `dsh plugin --profile desktop add /path/to/tabellio-dsh`.

## First run: three things to do

1. **Chat normally.** Say "run the tests before every release" or "I don't like long answers".
2. **Open "Settings → Memory"** and click "Approve" on the candidate.
3. **Ask about it a few days later**: "what do we usually do before a release?" — it remembers.

That is all. No "please remember this" every time, no configuration required.

## How it remembers you

```
what you say
   │  ① spot agreements, preferences, corrections (max 2 per turn)
   ▼
candidate inbox notes/candidates/   ← drafts only, not memory yet
   │  ② you click Approve on the Memory page
   ▼
memory notes/                       ← local Markdown, searchable, editable, deletable
   │  ③ next time the topic comes up
   ▼
recalled automatically (budgeted, capped, silent on small talk)
```

<p align="center">
  <img src="docs/assets/flow.svg" alt="From conversation to candidate, to memory and recall" width="820" />
</p>

Things you may care about:

- **One nudge for waiting candidates.** When candidates are waiting for approval, the quiet context adds one line (at most once every six hours); open Settings → Memory to approve them.
- **One small model call by default.** When recall hits, the current DSH default model makes one tiny relevance decision. To spend nothing, switch off "Smart memory" under Settings. No data leaves your machine except that host-model call.
- **It does not store whole conversations.** It only picks sentences like agreements, preferences and corrections that are worth remembering long-term.
- **It does not write down passwords.** Sentences containing a plaintext password or token are skipped; policy lines such as "credentials live in 1Password" are kept.
- **It leaves small talk alone.** Memory is only brought into context when the question looks like it is about your history, agreements or preferences.

## FAQ

**Q: Why is the store empty after installing?**
It only produces candidates when something worth keeping appears; a fresh store is empty by design. Chat for a few days.

**Q: Why do candidates never disappear?**
Candidates leave the inbox only after you approve or dismiss them. The agent never approves on your behalf — that is deliberate.

**Q: Where is memory stored? Can I back it up?**
`~/memory/tabellio`. Copy the whole directory and you have a backup; even if you delete the index, it can be rebuilt from the Markdown files.

**Q: Can I turn off auto-capture?**
Yes. Set `capture` to `off` in Settings, or keep only `explicit` (it records only when you actually say "remember").

**Q: Does it slow conversations down?**
Recall runs once per turn, on the first human message, with a 1200-token budget and a cap of 8 notes (raised from 500/6 on 2026-10-22: too small a budget simply cuts gold below rank 2); small talk is skipped entirely.

**Q: Does it work with Claude Code / Cursor?**
The core library and CLI support multiple hosts; the DSH plugin currently adapts DSH only. Other host adapters are on the roadmap.

## Optional switches

Nothing here is required. To fine-tune, change them in your DSH profile config:

| Switch | Default | One line |
|---|---|---|
| `capture` | `assist` | What to remember: `assist` is easiest; `explicit` records only when you say "remember…"; `off` disables |
| `delivery` | `context` | How to deliver: `context` is silent (recommended); `notice` shows a message in the chat |
| `shadow` | `false` | Record recalls without injecting, to compare against other memory plugins |
| `judge` | `llm` | Re-check recalls with a model: more accurate, one small call per hit |
| `storePath` | `~/memory/tabellio` | Where memory lives |

All other advanced settings are in the [developer notes](#for-developers).

The optional switches above show the defaults shipped by the plugin patch (`cordis.patch.yml`). When a key is absent from the config, the code defaults are `capture: explicit` and `delivery: notice`.

## Settings panel (Settings → Memory)

The panel has four tabs, so state is never dumped all at once:

- **Overview** — how many memories, what is pending, index health, the last recall, 7-day recall quality, and the newest notes;
- **Waiting for you** — new candidates and merge proposals; approve or dismiss one or many, and nothing enters `notes/` until approved;
- **Library** — write a memory, search and open a full note, page through all notes with kind/time filters;
- **Settings** — one "Smart memory" switch (on = auto-discover a local embedding service and filter false recalls with the default model; off = lexical only). Endpoint/model, capture depth, delivery, notes per turn and consolidation live under "Advanced"; applied on save. The judge model and latency, semantic index size, store path and index warnings stay on the same page.

Ordinary users never touch a config file: the panel asks one question — is **Smart memory** on (default yes)? When on, it probes common local embedding ports (llama-swap, Ollama, LM Studio…), uses whatever answers, and falls back to lexical matching without errors when nothing does. Endpoint, model, capture depth, delivery, notes per turn and consolidation sit under "Advanced" and save to `panel-settings.json` inside the memory folder.

**Remote embeddings?** Point the endpoint at any OpenAI-style `/v1/embeddings`, click "Fetch models" to list what the server reports (or type a name), then "Test connection" to verify dimensions and latency. Remote services need an API key (stored in `panel-settings.json`, a plain local file); the safer option is the `TABELLIO_SEMANTIC_API_KEY` environment variable — the panel then shows "Set" and never echoes the key.

## Privacy

- All reads and writes are local; network traffic is loopback only (local embeddings) plus one host-model judge call, which can be disabled.
- No telemetry is collected.
- Plain Markdown; keep it on a disk you trust and encrypt.

## For developers

<details>
<summary>Architecture, tool surface, full config, tests and evaluation</summary>

### Architecture

- **Core `tabellio`**: storage, index, BM25 + co-occurrence scoring, write gate, receipts, consolidation. This plugin only adapts DSH; it does not duplicate core logic.
- **Adapter `tabellio-dsh`**: `agent/pre-step` recall, `agent/turn-stopping` capture, 7 native tools, settings panel (HTTP RPC with loopback + Origin checks: status, candidate approval, proposal approval, search, last recall, LLM judge).
- Switching hosts leaves the core untouched; only the adapter changes.

### Tools

`tabellio_recall` / `tabellio_search` / `tabellio_read` / `tabellio_status` / `tabellio_capture` / `tabellio_inbox` / `tabellio_report` / `tabellio_conflicts` (read-only: probable stale pairs) / `tabellio_merge` (human-approved merge that retires the old notes) / `tabellio_feedback` (records "helpful / wrong" and nudges ranking only — never edits a note). `tabellio_recall` and `tabellio_search` accept `as_of` for point-in-time queries.. The tools share the same budget, refusal rules and write gate as the CLI and MCP server.

### Full configuration table

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | When off, no tools and no event handlers are registered |
| `storePath` | `~/memory/tabellio` | Same store as the CLI/MCP; `~` is expanded |
| `autoRecall` | `true` | Recall once per turn on the first human message |
| `shadow` | `false` | Write receipts only, never inject; useful for A/B |
| `delivery` | `notice` | `notice` shows a visible message; `context` injects silently |
| `recallBudgetTokens` | `1200` | Recall budget, 100–4000 (too small cuts gold below rank 2) |
| `recallMaxNotes` | `8` | Maximum notes, 1–20 |
| `recallIntentGate` | `true` | Do not inject when the question has no memory intent |
| `recallConfidentRelevance` | `0.9` | Bypass the intent gate when the top hit is at least this relevant |
| `feedbackRanking` | `true` | Apply small ranking nudges from helpful / wrong feedback (never adds or removes notes) |
| `recallTrusts` | `user_stated`, `system_derived` | Which sources auto-recall trusts; imported docs (`external`) stay searchable but are never injected by default |
| `recallMinCoverage` | `0.2` | Coverage gate (noise floor); abstention is left to the judge and the answer model |
| `recallMinScore` | `0.1` | Minimum score |
| `recallMinRelevance` | `0.12` | Minimum relevance |
| `includeCore` | `true` | Whether core notes are included |
| `minQueryChars` | `4` | Shorter messages are not recalled |
| `queryChars` | `400` | Long messages keep head and tail |
| `refreshSeconds` | `30` | Store rescan interval; 0 rescans on every event |
| `capture` | `explicit` | `explicit` / `implicit` / `assist` / `off` |
| `semantic` | `auto` | `auto` / `local` / `off`: `auto` discovers a local embedding service, `local` pins the configured one, `off` is lexical |
| `semanticEndpoint` / `semanticModel` | `http://127.0.0.1:8080/v1/embeddings` / `qwen3-embedding-0.6b` | Preferred endpoint and model (`auto` keeps probing other common ports when it fails) |
| `semanticMinSimilarity` | `0.55` | Semantic hits below this cosine similarity are not added |
| `semanticTimeoutMs` | `800` | Per-embed timeout; a cold start (~2.5s after the model was unloaded) falls back to lexical instead of stretching the turn |
| `consolidate` | `off` | Background sweep: `daily`/`weekly` writes merge proposals for near-duplicate notes (proposals only; approval stays in the panel) |
| `maxCandidatesPerTurn` | `2` | Candidates per turn, 1–5 |
| `captureMaxSentenceChars` | `240` | Per-sentence cap, 40–1000 |
| `judge` | `llm` | `llm` / `off` |
| `judgeProvider` / `judgeModel` | empty | Leave empty to use the host default model |
| `judgeCacheMinutes` | `10` | Reuse a verdict for the same question and recall set within this window; `0` disables |
| `judgeTimeoutMs` | `6000` | Hard judge timeout, 500–15000; falls back to lexical matching |
| `judgeDeadlineMs` | `400` | Soft deadline: inject unjudged hits at the deadline, cache a late verdict for next time; 0 = wait for `judgeTimeoutMs`. Measured: <15% of verdicts land in 1.5s and 19/19 late verdicts kept at least one note, so the default is now 400ms |

### Tests and evaluation

```bash
npm test                      # 74 unit/integration cases
node tests/acceptance.mjs     # 30 functional acceptance checks
node tools/cross-host-demo.mjs  # cross-host API walkthrough (temp store)
python3 tools/blind-eval.py <dataset.json>  # frozen-query blind test (personal data stays outside the repo)
node tools/judge-eval.mjs <labeled-set.json>  # real-model judge sample
```

The four independent pre-release test reports are archived under `~/yffto/archive/2026-10/scratch/tabellio-dsh-validation/final/`.

### Boundaries

- Never auto-approves candidates, and never auto-merges/decays/deletes notes.
- Does not fake DSH lifecycle events.
- No uploads; loopback-only network access (local embeddings, host model).

</details>

## Docs

- [Three-minute quickstart](docs/QUICKSTART.en.md)
- [Backup and migration](docs/BACKUP.md)
- [Cross-host setup](docs/CROSS-HOST.en.md)

## License

MIT

## Evaluation

`node tools/memory-eval.mjs` runs 12 fixed cases on a throwaway store across five capabilities: knowledge updates (2/2), temporal (2/2), preferences (2/2), project facts (2/2), and abstention (4/4). It scores correctness, not hit rate; `--strict` fails below the recorded baseline.

