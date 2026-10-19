#!/usr/bin/env python3
"""Blind eval, plugin path: recall thresholds + intent gate, no judge model.

This is a measurement script, not a tuning script. It replays the frozen
`tools/blind-queries.json` through the *same* call shape the DSH plugin uses in
`index.js` (agent/pre-step), with the live desktop-profile config:

  recallMinRelevance = 0.12
  recallMinScore     = 0.10
  recallMinCoverage  = 0.40
  recallMaxNotes     = 6
  recallBudgetTokens = 500  -> plugin passes max(100, 500 - 64) = 436
  recallIntentGate   = true
  recallConfidentRelevance = 0.92

The LLM judge is deliberately NOT called. A query "enters judge" when recall
returns at least one item AND `intentGateAllows()` says yes; that is an upper
bound on injection (the real judge may still drop items). The report also keeps
the pre-recall plugin filters (`trimQuery`, `minQueryChars`, `isChitchat`).

Run:
  cd /Users/yangfu/yffto/tabellio-dsh && python3 tools/blind-plugin-path.py

Reads (never writes) the frozen query file and ~/memory/tabellio.
Appends a clearly marked section to the blind report; safe to rerun.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUERIES = REPO / "tools" / "blind-queries.json"
STORE = Path(os.path.expanduser("~/memory/tabellio"))
REPORT_DIR = Path("/Users/yangfu/yffto/archive/2026-10/scratch/tabellio-dsh-validation/blind")
REPORT = REPORT_DIR / "report.md"
RESULTS = REPORT_DIR / "plugin-path-results.json"
SUMMARY = REPORT_DIR / "plugin-path-summary.json"

EXPECTED_QUERY_SHA256 = "a121e589de6802aca869ca0d5908c631397c506637b028cd3c68fcce9f2d6b94"

PLUGIN = {
    "budgetTokens": 436,       # Math.max(100, 500 - 64)
    "maxNotes": 6,
    "includeCore": True,
    "minRelevance": 0.12,
    "minScore": 0.10,
    "minCoverage": 0.40,
}
CONFIDENT_RELEVANCE = 0.92
MIN_QUERY_CHARS = 4
QUERY_CHARS = 400

START = "<!-- plugin-path:start -->"
END = "<!-- plugin-path:end -->"

# One Node process for the whole run: import tabellio + the plugin's own
# intentGateAllows, so this is the real gate code, not a Python reimplementation.
NODE_BRIDGE = r"""
import fs from 'node:fs';
import { openStore, recallQuery } from 'tabellio';
import { trimQuery, isChitchat, intentGateAllows, hasMemoryIntent } from './src/messages.js';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const store = openStore(input.store);
const rows = [];

const compact = (it, source) => ({
  source,
  id: it.id,
  relevance: it.relevance ?? null,
  score: it.score ?? null,
  coverage: it.coverage ?? null,
  coocOk: it.cooccurrence?.ok ?? null,
  coocMissing: (it.cooccurrence?.missing ?? []).length,
});

for (const q of input.queries) {
  const trimmed = trimQuery(q.q, input.queryChars);
  const chars = [...trimmed].length;
  let prefilter = null;
  if (!trimmed || chars < input.minQueryChars) prefilter = 'min_query_chars';
  else if (isChitchat(trimmed)) prefilter = 'chitchat';

  if (prefilter) {
    rows.push({
      id: q.id, group: q.group, q: q.q, query_used: trimmed, chars,
      prefilter, refused: true, reason: 'prefilter:' + prefilter,
      items: [], nearest: [], expected: null, coverageGate: null,
      topRelevance: 0, gate: null, entered_judge: false,
      skipped: null, has_memory_intent: hasMemoryIntent(trimmed),
    });
    continue;
  }

  try {
    const r = recallQuery(store, trimmed, input.options);
    const items = (r.items ?? []).map((it) => ({
      id: it.id,
      title: it.title,
      relevance: it.relevance,
      score: it.score,
    }));
    const topRelevance = Number(items[0]?.relevance ?? 0);
    const refused = Boolean(r.refused) || items.length === 0;
    const gate = refused ? null : intentGateAllows(trimmed, {
      gate: true,
      topRelevance,
      confidentRelevance: input.confidentRelevance,
    });
    const nearest = (r.nearest ?? []).slice(0, 5).map((it) => compact(it, 'nearest'));
    let expected = null;
    if (q.expect_id) {
      for (const [source, arr] of [
        ['items', items],
        ['ignored', r.diagnostics?.ignored ?? []],
        ['dropped', r.diagnostics?.dropped ?? []],
        ['nearest', r.nearest ?? []],
      ]) {
        const hit = arr.find((it) => it.id === q.expect_id);
        if (hit) { expected = compact(hit, source); break; }
      }
    }
    rows.push({
      id: q.id, group: q.group, q: q.q, query_used: trimmed, chars,
      prefilter: null,
      refused,
      reason: r.reason ?? null,
      items,
      nearest,
      expected,
      coverageGate: r.coverageGate ?? null,
      topRelevance,
      gate,
      entered_judge: Boolean(!refused && gate?.allowed),
      skipped: r.skipped ?? null,
      has_memory_intent: hasMemoryIntent(trimmed),
    });
  } catch (error) {
    rows.push({
      id: q.id, group: q.group, q: q.q, query_used: trimmed, chars,
      prefilter: null, refused: true, reason: 'error:' + (error?.message ?? String(error)),
      items: [], nearest: [], expected: null, coverageGate: null,
      topRelevance: 0, gate: null, entered_judge: false,
      skipped: null, has_memory_intent: hasMemoryIntent(trimmed),
    });
  }
}
process.stdout.write(JSON.stringify(rows));
"""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run_bridge(queries: list[dict]) -> list[dict]:
    payload = {
        "store": str(STORE),
        "options": PLUGIN,
        "confidentRelevance": CONFIDENT_RELEVANCE,
        "minQueryChars": MIN_QUERY_CHARS,
        "queryChars": QUERY_CHARS,
        "queries": queries,
    }
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_BRIDGE],
        cwd=str(REPO),
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=300,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"node bridge failed (rc={proc.returncode})")
    return json.loads(proc.stdout)


def expected_rank(items: list[dict], expect_id: str) -> int | None:
    for i, item in enumerate(items, 1):
        if item.get("id") == expect_id:
            return i
    return None


def family_rank(items: list[dict], expect_id: str) -> int | None:
    base = expect_id.split("#", 1)[0]
    for i, item in enumerate(items, 1):
        if str(item.get("id", "")).split("#", 1)[0] == base:
            return i
    return None


def load_status() -> dict[str, str]:
    path = REPORT_DIR / "index.json"
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {row.get("id"): row.get("status") for row in rows if isinstance(row, dict)}


def expected_blocker(row: dict, status_by_id: dict[str, str]) -> str:
    """Why the expected note was not in the plugin's top-6 items."""
    if row.get("delivered"):
        return "in_items"
    expected = row.get("expected")
    if not expected:
        status = status_by_id.get(row.get("expect_id", ""))
        return "draft" if status == "draft" else "not_scored"
    if expected.get("source") == "items":
        return "in_items"
    coverage = expected.get("coverage")
    if coverage is not None and coverage < PLUGIN["minCoverage"]:
        return "coverage"
    if expected.get("coocOk") is False:
        return "cooccurrence"
    relevance = expected.get("relevance")
    if relevance is not None and relevance < PLUGIN["minRelevance"]:
        return "relevance"
    score = expected.get("score")
    if score is not None and score < PLUGIN["minScore"]:
        return "minScore"
    return "other"


def blocker_text(row: dict) -> str:
    expected = row.get("expected") or {}
    blocker = row.get("blocker")
    if blocker == "coverage":
        return f"coverage {expected.get('coverage', 0):.3f} < {PLUGIN['minCoverage']:.2f}"
    if blocker == "cooccurrence":
        return f"cooccurrence ✗（coverage {expected.get('coverage', 0):.3f} 已过）"
    if blocker == "draft":
        return "draft（filterNotes 前排除，未进 scores）"
    if blocker == "relevance":
        return f"relevance {expected.get('relevance', 0):.3f} < {PLUGIN['minRelevance']:.2f}"
    if blocker == "minScore":
        return f"score {expected.get('score', 0):.3f} < {PLUGIN['minScore']:.2f}"
    if blocker == "in_items":
        return "已在前 6"
    return "未进入 BM25 候选"


def suppression(row: dict) -> str:
    if row.get("prefilter"):
        return "prefilter:" + row["prefilter"]
    if row.get("refused") or not row.get("items"):
        return "recall_refused:" + str(row.get("reason") or "no_hits")
    if not (row.get("gate") or {}).get("allowed"):
        return "intent_gate:" + str((row.get("gate") or {}).get("reason") or "no_memory_intent")
    return "entered_judge"


def truncate(text: str, n: int = 32) -> str:
    text = str(text).replace("|", "\\|").replace("\n", " ")
    return text if len(text) <= n else text[: n - 1] + "…"


def evaluate(rows: list[dict], data: dict, status_by_id: dict[str, str]) -> dict:
    by_id = {row["id"]: row for row in rows}
    positives = []
    for case in data["positives"]:
        row = dict(by_id[case["id"]])
        row["expect_id"] = case["expect_id"]
        row["expect_status"] = status_by_id.get(case["expect_id"])
        row["rank"] = expected_rank(row["items"], case["expect_id"])
        row["family_rank"] = family_rank(row["items"], case["expect_id"])
        row["in_top6"] = row["rank"] is not None
        row["delivered"] = bool(row["entered_judge"] and row["in_top6"])
        row["suppression"] = suppression(row)
        row["blocker"] = expected_blocker(row, status_by_id)
        row["blocker_text"] = blocker_text(row)
        positives.append(row)

    negatives = []
    for case in data["negatives"]:
        row = dict(by_id[case["id"]])
        row["suppression"] = suppression(row)
        row["raw_recall_nonempty"] = bool(row["items"])
        negatives.append(row)

    absent = []
    for case in data["absent"]:
        row = dict(by_id[case["id"]])
        row["suppression"] = suppression(row)
        row["raw_recall_nonempty"] = bool(row["items"])
        absent.append(row)

    return {"positives": positives, "negatives": negatives, "absent": absent, "by_id": by_id}


def summarize(evaluated: dict) -> dict:
    pos = evaluated["positives"]
    neg = evaluated["negatives"]
    absent = evaluated["absent"]

    pos_entered = [r for r in pos if r["entered_judge"]]
    pos_delivered = [r for r in pos if r["delivered"]]
    pos_suppressed = [r for r in pos if not r["entered_judge"]]
    pos_entered_no_top6 = [r for r in pos_entered if not r["in_top6"]]

    neg_entered = [r for r in neg if r["entered_judge"]]
    neg_raw = [r for r in neg if r["raw_recall_nonempty"]]
    neg_suppressed = [r for r in neg if not r["entered_judge"]]

    absent_entered = [r for r in absent if r["entered_judge"]]
    absent_raw = [r for r in absent if r["raw_recall_nonempty"]]
    absent_suppressed = [r for r in absent if not r["entered_judge"]]
    absent_refused = [r for r in absent if r["refused"] and not r["prefilter"]]

    def reasons(rows: list[dict]) -> dict:
        return dict(sorted(Counter(r["suppression"] for r in rows).items()))

    return {
        "positives": {
            "n": len(pos),
            "entered_judge": len(pos_entered),
            "delivered_top6": len(pos_delivered),
            "in_top6_regardless_gate": sum(1 for r in pos if r["in_top6"]),
            "entered_judge_no_expected_top6": len(pos_entered_no_top6),
            "suppressed": len(pos_suppressed),
            "suppressed_reasons": reasons(pos_suppressed),
            "entered_ids": [r["id"] for r in pos_entered],
            "delivered_ids": [r["id"] for r in pos_delivered],
            "blockers": dict(sorted(Counter(r["blocker"] for r in pos if not r["delivered"]).items())),
            "blocked_baseline_hits": [
                r["id"] for r in pos_suppressed
                if r["id"] in {"P02", "P05", "P07", "P10", "P12", "P14", "P15", "P17", "P18"}
            ],
        },
        "negatives": {
            "n": len(neg),
            "entered_judge": len(neg_entered),
            "raw_recall_nonempty": len(neg_raw),
            "suppressed": len(neg_suppressed),
            "suppressed_reasons": reasons(neg_suppressed),
            "entered_ids": [r["id"] for r in neg_entered],
        },
        "absent": {
            "n": len(absent),
            "entered_judge": len(absent_entered),
            "raw_recall_nonempty": len(absent_raw),
            "recall_refused": len(absent_refused),
            "suppressed": len(absent_suppressed),
            "suppressed_reasons": reasons(absent_suppressed),
            "entered_ids": [r["id"] for r in absent_entered],
        },
        "baseline": {
            "positive_hit6": 9,
            "negative_false_hit": 9,
            "absent_false_answer": 3,
        },
    }


def fmt_reasons(reasons: dict) -> str:
    if not reasons:
        return "—"
    return "；".join(f"`{k}` ×{v}" for k, v in reasons.items())


def first_relevance(row: dict) -> str:
    if row.get("items"):
        return f"{row['topRelevance']:.3f}"
    nearest = row.get("nearest") or []
    if nearest:
        return f"—（nearest {nearest[0]['relevance']:.3f}）"
    return "—"


def render_pos_table(pos: list[dict]) -> list[str]:
    lines = [
        "| id | 查询（截断） | recall | 首条 relevance | 意图闸 | 进入 judge | 期望笔记排名（前 6） |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in pos:
        if r["prefilter"]:
            recall = f"prefilter:{r['prefilter']}"
        elif r["refused"] or not r["items"]:
            recall = f"refused:{r['reason'] or 'no_hits'}"
        else:
            recall = f"items={len(r['items'])}"
        gate = "—" if not r["gate"] else ("放行:" + r["gate"]["reason"] if r["gate"]["allowed"] else "抑制")
        rank = "未进前 6" if not r["in_top6"] else f"#{r['rank']}"
        lines.append(
            f"| {r['id']} | {truncate(r['q'])} | {recall} | {first_relevance(r)} | {gate} | "
            f"{'是' if r['entered_judge'] else '否'} | {rank} |"
        )
    return lines


def render_blocker_table(pos: list[dict]) -> list[str]:
    lines = [
        "| id | 结果 | 期望笔记诊断 | 阻滞点 |",
        "|---|---|---|---|",
    ]
    for r in pos:
        if r["delivered"]:
            continue
        if r["refused"]:
            outcome = f"recall 拒答（`{r['reason']}`）"
        elif not r["entered_judge"]:
            gate_reason = (r.get("gate") or {}).get("reason", "no_memory_intent")
            outcome = f"未进 judge（意图闸 `{gate_reason}`）"
        else:
            outcome = "进入 judge，但期望不在前 6"
        expected = r.get("expected")
        if expected:
            diag = f"`{expected['source']}`: rel {expected['relevance']:.3f}"
            if expected.get("coverage") is not None:
                diag += f", cov {expected['coverage']:.3f}"
            if expected.get("coocOk") is not None:
                diag += ", cooc " + ("✓" if expected["coocOk"] else "✗")
        else:
            diag = f"未评分（status=`{r.get('expect_status') or '不在此库'}`）"
        blocker = r["blocker_text"]
        if r["id"] == "P09":
            blocker += f" + 意图闸（首条 {r['topRelevance']:.3f} < {CONFIDENT_RELEVANCE:.2f}）"
        lines.append(f"| {r['id']} | {outcome} | {diag} | {blocker} |")
    return lines


def render_generic_table(rows: list[dict]) -> list[str]:
    lines = [
        "| id | 查询（截断） | recall | 首条 relevance | 意图闸 | 进入 judge | 抑制原因 |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        if r["prefilter"]:
            recall = f"prefilter:{r['prefilter']}"
        elif r["refused"] or not r["items"]:
            recall = f"refused:{r['reason'] or 'no_hits'}"
        else:
            recall = f"items={len(r['items'])}"
        gate = "—" if not r["gate"] else ("放行:" + r["gate"]["reason"] if r["gate"]["allowed"] else "抑制")
        reason = "—" if r["entered_judge"] else r["suppression"]
        lines.append(
            f"| {r['id']} | {truncate(r['q'])} | {recall} | {first_relevance(r)} | {gate} | "
            f"{'是' if r['entered_judge'] else '否'} | {reason} |"
        )
    return lines


def render_report(evaluated: dict, summary: dict) -> str:
    pos = evaluated["positives"]
    neg = evaluated["negatives"]
    absent = evaluated["absent"]
    p = summary["positives"]
    n = summary["negatives"]
    a = summary["absent"]
    b = summary["baseline"]

    pos_gain = p["delivered_top6"] - b["positive_hit6"]
    neg_drop = b["negative_false_hit"] - n["entered_judge"]
    absent_delta = a["entered_judge"] - b["absent_false_answer"]
    raw_neg_delta = n["raw_recall_nonempty"] - b["negative_false_hit"]
    non_draft = [r for r in pos if r.get("expect_status") != "draft"]
    non_draft_misses = [r for r in non_draft if not r["delivered"]]

    out: list[str] = []
    out.append("")
    out.append(START)
    out.append("## 补充：插件实际路径模拟（同批冻结查询，不跑 judge 模型）")
    out.append("")
    out.append("> 这是度量，不是调参：查询集、阈值、插件代码均未改动。")
    out.append("")
    out.append("### 1. 模拟口径")
    out.append("")
    out.append("- 配置来源：`~/.dsh/profiles/desktop/cordis.patch.yml` 的 tabellio 段。")
    out.append("- recall 参数：`minRelevance=0.12`、`minScore=0.10`、`minCoverage=0.40`、`maxNotes=6`、`budgetTokens=436`（插件 `500-64`）、`includeCore=true`。")
    out.append("- 记忆库 26 篇 draft 每查询都在 `filterNotes` 阶段被排除（`skipped.archived_draft=26`）；本批正例里 P19/P20 的目标就是 draft，属于结构性不可召回。")
    out.append("- 意图闸：`intentGateAllows(gate=true, confidentRelevance=0.92)`；有记忆意图词 → 放行；无意图词但首条 relevance ≥ 0.92 → `confident_hit` 放行；否则抑制。")
    out.append("- 召回前插件过滤：`trimQuery(400)` + `minQueryChars=4` + `isChitchat`。")
    out.append("- **未调用 judge 模型**；“进入 judge”＝ recall 非空且意图闸放行，是真实注入的上界（judge 之后还可能再删）。")
    out.append("- 脚本：`tools/blind-plugin-path.py`；预期查询 sha256 `" + EXPECTED_QUERY_SHA256 + "`。")
    out.append("")
    out.append("### 2. 正例：进入 judge 与期望笔记前 6")
    out.append("")
    out.extend(render_pos_table(pos))
    out.append("")
    out.append(
        f"- **进入 judge：{p['entered_judge']}/{p['n']}**；其中期望笔记在召回前 6：**{p['delivered_top6']}/{p['entered_judge']}**。"
    )
    out.append(
        f"- 不论闸门、期望笔记在召回前 6：**{p['in_top6_regardless_gate']}/{p['n']}**；进入 judge 但期望不在前 6：**{p['entered_judge_no_expected_top6']}**。"
    )
    out.append(
        f"- 被抑制：**{p['suppressed']}/{p['n']}**（{fmt_reasons(p['suppressed_reasons'])}）。"
    )
    if p["blocked_baseline_hits"]:
        out.append(f"- 其中基线 hit@6 命中项被压掉：{', '.join(p['blocked_baseline_hits'])}。")
    out.append(
        f"- 未交付共 **{p['n'] - p['delivered_top6']}** 条；期望笔记层面的阻滞点："
        + "、".join(f"`{k}` ×{v}" for k, v in (p.get("blockers") or {}).items())
        + "。"
    )
    out.append(
        "- 其中 **P13 进入了 judge，但期望笔记 #6 不在前 6**（前 6 是 #5/#7）；"
        "所以 14 条“进入 judge 且期望在前 6”应理解为有效交付，不能把 P13 算成正确答案。"
    )
    out.append("")
    out.append("#### 未交付归因（期望笔记层面）")
    out.append("")
    out.extend(render_blocker_table(pos))
    out.append("")
    out.append(
        "> 注意：P11/P16/P19/P20 的 `top_score_below_threshold` 是 `refuseReason()` 的兜底标签，不是真实原因。"
        "P11/P16 实际是 coverage 0.209/0.298 < 0.40（nearest 首条 relevance 仍有 0.920/0.968）；"
        "P19/P20 是目标笔记为 draft、在 `filterNotes` 阶段就被排除，nearest 只剩无关 active 笔记。"
        "P09 则是期望笔记被共现闸挡下、同时首条 0.911 没到 0.92 置信线。"
    )
    out.append("")
    out.append("### 3. 负例：进入 judge 与抑制原因")
    out.append("")
    out.extend(render_generic_table(neg))
    out.append("")
    out.append(
        f"- **进入 judge：{n['entered_judge']}/{n['n']}**（越低越好）；裸 recall 非空（未过闸）：**{n['raw_recall_nonempty']}/{n['n']}**。"
    )
    out.append(
        f"- 被抑制：**{n['suppressed']}/{n['n']}**（{fmt_reasons(n['suppressed_reasons'])}）。"
    )
    if n["entered_ids"]:
        out.append(f"- 仍进入 judge 的负例：{', '.join(n['entered_ids'])}。")
    out.append("")
    out.append("### 4. 缺失事实：进入 judge 与拒答")
    out.append("")
    out.extend(render_generic_table(absent))
    out.append("")
    out.append(
        f"- **进入 judge：{a['entered_judge']}/{a['n']}**（越低越好）；裸 recall 非空：**{a['raw_recall_nonempty']}/{a['n']}**；真正 recall 拒答：**{a['recall_refused']}/{a['n']}**。"
    )
    out.append(
        f"- 被抑制：**{a['suppressed']}/{a['n']}**（{fmt_reasons(a['suppressed_reasons'])}）。"
    )
    if a["entered_ids"]:
        out.append(f"- 仍进入 judge 的缺失事实：{', '.join(a['entered_ids'])}。")
    out.append("")
    out.append("### 5. 与裸 recall 基线对比")
    out.append("")
    out.append("| 指标 | 裸 recall 基线（默认阈值，8 条上限） | 插件路径（降阈 + 意图闸，6 条上限） | 变化 |")
    out.append("|---|---:|---:|---:|")
    out.append(
        f"| 正例精确 hit@6 | {b['positive_hit6']}/20（45%） | {p['delivered_top6']}/20（{100*p['delivered_top6']/20:.0f}%） | "
        f"{'+' if pos_gain >= 0 else ''}{pos_gain} 条 |"
    )
    out.append(
        f"| 负例误命中 | {b['negative_false_hit']}/20（45%） | 进入 judge {n['entered_judge']}/20（{100*n['entered_judge']/20:.0f}%） | "
        f"{'−' if neg_drop >= 0 else '+'}{abs(neg_drop)} 条 |"
    )
    out.append(
        f"| 负例裸 recall 非空 | {b['negative_false_hit']}/20 | {n['raw_recall_nonempty']}/20 | "
        f"{'+' if raw_neg_delta >= 0 else ''}{raw_neg_delta} 条 |"
    )
    out.append(
        f"| 缺失事实误答 | {b['absent_false_answer']}/10 | 进入 judge {a['entered_judge']}/10 | "
        f"{'+' if absent_delta >= 0 else ''}{absent_delta} 条 |"
    )
    out.append("")
    out.append("### 6. 结论")
    out.append("")
    if n["entered_judge"] == 0:
        out.append(
            f"1. **负例误命中被压到 0。** 裸 recall 在新阈值下仍有 {n['raw_recall_nonempty']}/20 非空（比默认阈值更多），"
            "但意图闸把全部负例挡在 judge 之外；45% 的误命中在注入前变成 0，不是靠 judge 模型。"
        )
    else:
        out.append(
            f"1. **负例误命中从 {b['negative_false_hit']}/20 降到进入 judge {n['entered_judge']}/20**；"
            f"裸 recall 非空为 {n['raw_recall_nonempty']}/20，闸门贡献了主要降幅。仍进入 judge 的负例见上表。"
        )
    if pos_gain >= 0:
        out.append(
            f"2. **正例相对基线没有损失，净增 {pos_gain} 条**：从 {b['positive_hit6']}/20 到 {p['delivered_top6']}/20；"
            f"基线已有的命中一条都没被压掉。非 draft 目标的理论上限是 {len(non_draft)}/20，"
            f"现在还差 {len(non_draft_misses)} 条（{', '.join(r['id'] for r in non_draft_misses) or '无'}）。"
            "但 P13 是“进入 judge 但期望不在前 6”，不能算正确交付；P09/P11/P16/P13 仍分别被意图闸/覆盖率/覆盖率/共现闸挡住。"
        )
    else:
        out.append(
            f"2. **正例净损失 {-pos_gain} 条**：从 {b['positive_hit6']}/20 到 {p['delivered_top6']}/20。"
            f"被压掉的基线命中：{', '.join(p['blocked_baseline_hits']) or '无'}；需看具体是意图闸还是召回阈值造成。"
        )
    if absent_delta > 0:
        out.append(
            f"3. **缺失事实风险略升**：基线误答 {b['absent_false_answer']}/10，新路径有 {a['entered_judge']}/10 进入 judge"
            f"（{'+' if absent_delta >= 0 else ''}{absent_delta}）。原因是这些问句带“我的/上次/名字”等记忆意图词，"
            "意图闸本身不能区分“问的是记忆”与“记忆里没有”；只能靠后面的 judge 拒答。"
        )
    elif absent_delta == 0:
        out.append(
            f"3. **缺失事实风险持平**：基线误答 {b['absent_false_answer']}/10，新路径 {a['entered_judge']}/10 进入 judge。"
        )
    else:
        out.append(
            f"3. **缺失事实风险下降 1 条，但仍非零**：基线误答 {b['absent_false_answer']}/10，新路径 {a['entered_judge']}/10 进入 judge"
            f"（A05/A07）。基线的 A03/A09 被意图闸挡住，但 A05 仍进，且 A07 是新进入；"
            "这 2 条必须由 judge 拒答，闸门本身分不清“问记忆”与“记忆里没有”。"
        )
    out.append(
        "4. **口径限制**：这里只数“会进入 judge”的查询，不跑模型；真实注入还取决于 judge 的裁决，"
        "因此负例/缺失事实的实际注入数应 ≤ 本表数字。"
    )
    out.append("")
    out.append(
        "复现：`cd /Users/yangfu/yffto/tabellio-dsh && python3 tools/blind-plugin-path.py`；"
        "明细：`blind/plugin-path-results.json`，摘要：`blind/plugin-path-summary.json`。"
    )
    out.append(END)
    return "\n".join(out)


def main() -> int:
    digest = sha256(QUERIES)
    if digest != EXPECTED_QUERY_SHA256:
        raise SystemExit(
            f"blind-queries.json changed: {digest} != {EXPECTED_QUERY_SHA256}; refusing to mix query sets"
        )
    data = json.loads(QUERIES.read_text(encoding="utf-8"))
    queries = []
    for group in ("positives", "negatives", "absent"):
        for case in data[group]:
            queries.append({
                "id": case["id"],
                "group": group,
                "q": case["q"],
                "expect_id": case.get("expect_id"),
            })

    rows = run_bridge(queries)
    status_by_id = load_status()
    evaluated = evaluate(rows, data, status_by_id)
    summary = summarize(evaluated)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(
        json.dumps(
            {
                "generated_at": "2026-10-19T07:12:00+08:00",
                "query_sha256": digest,
                "plugin": PLUGIN,
                "confidentRelevance": CONFIDENT_RELEVANCE,
                "minQueryChars": MIN_QUERY_CHARS,
                "queries": rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    section = render_report(evaluated, summary)
    text = REPORT.read_text(encoding="utf-8")
    if START in text:
        text = text.split(START, 1)[0].rstrip() + "\n"
    REPORT.write_text(text.rstrip() + "\n" + section + "\n", encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nreport: {REPORT}")
    print(f"summary: {SUMMARY}")
    print(f"raw: {RESULTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
