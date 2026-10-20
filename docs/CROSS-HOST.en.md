# One store, three entry points: how hosts share memory

> TL;DR — the DSH plugin, the `tabellio` CLI and the `tabellio-mcp` server all read and write the same Markdown directory, through the same write gate and the same recall engine. No sync layer, no server, no copies.

## One directory

The default store is `~/memory/tabellio` (the plugin's `storePath` can change it). It is just files:

```
notes/              durable memory (Markdown + frontmatter)
notes/candidates/   candidates waiting for approval
notes/proposals/    automatic consolidation proposals
runs/               recall receipts (written in shadow mode)
index.json          local index, rebuildable at any time
```

The CLI, the MCP server and the DSH plugin open the same directory, so there is no "remembered in the plugin, invisible on the command line".

## Three entry points

| Entry point | Best for | How |
|---|---|---|
| DSH plugin | everyday conversation | auto-recall (quiet context), auto-capture (candidates only), six native tools, the "Memory" settings panel |
| CLI | bulk import, health checks, approvals, scripting | `tabellio status / search / read / remember --file / capture --file / inbox / doctor` |
| MCP | Claude Code, Cursor and other MCP hosts | `tabellio-mcp` (same repository as the CLI, same tool surface) |

There is one write path: content passes the write gate (length, fingerprint, credentials, duplicates), then becomes either a durable note or a candidate. **No entry point bypasses approval.**

## A three-minute walkthrough

```bash
# 0) read-only peek
node --input-type=module -e "import('tabellio').then(async m=>{const s=m.openStore(process.env.HOME+'/memory/tabellio');console.log(m.status(s).notes,'notes')})"

# 1) capture from the plugin: say "remember: releases go by tag" in DSH,
#    then see the candidate from the command line
tabellio inbox --json

# 2) approve (approval stays human)
tabellio inbox --accept <id>

# 3) write from the CLI, then ask DSH "how do we release?"
echo 'Releases go by tag: CI publishes vX.Y.Z.' > /tmp/release.md
tabellio remember --file /tmp/release.md --json
```

Capability parity is checkable offline (temp store, never touches a real library):

```bash
node tools/cross-host-demo.mjs
```

It uses the same API: durable note → candidate → approval → search → health check.

## What switching hosts takes

The core stays; you write a thin adapter with two hooks — "turn starts" (recall + inject) and "turn ends" (capture candidates) — plus wiring the host model call for `judge`. The contract lives in `tabellio/docs/03-hosts-and-interfaces.md` §7.

## Boundaries

- No auto-approval, no automatic merge/decay/delete.
- No second copy of the data; switching hosts does not move the library.
- The plugin is just the shell: if the DSH adapter breaks, the CLI and MCP still read and write the same memory.
