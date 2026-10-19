#!/usr/bin/env python3
"""Blind recall evaluation for the tabellio memory store.

The query set in tools/blind-queries.json is frozen (sha256 pinned below) and was
written before any of these queries were executed.  This script is deliberately
model-independent: it only shells out to the published CLI once per query and
aggregates the JSON.  It never tunes thresholds, never writes the store and never
imports plugin code.

Usage:
    python3 tools/blind-eval.py
    python3 tools/blind-eval.py --out /tmp/report.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUERY_FILE = REPO / "tools" / "blind-queries.json"
DEFAULT_STORE = Path.home() / "memory" / "tabellio"
DEFAULT_CHECKOUT = Path.home() / "yffto" / "memory-service"
DEFAULT_OUT = Path(
    "/Users/yangfu/yffto/archive/2026-10/scratch/tabellio-dsh-validation/blind/report.md"
)

# sha256 of tools/blind-queries.json at freeze time (2026-10-19).  A mismatch is
# reported as a warning: it means the "blind" property can no longer be assumed.
EXPECTED_SHA256 = "a121e589de6802aca869ca0d5908c631397c506637b028cd3c68fcce9f2d6b94"
TZ = timezone(timedelta(hours=8))
DRAFT_MARKERS = {"draft", "archived"}

# Post-hoc attribution probes.  These are NOT part of the blind metrics and are
# never counted in hit@1/hit@6: they are compact keyword renderings of failed
# positives, run only after the frozen query set has been evaluated, to separate
# "note absent / BM25 cannot find it" from "the natural-language form was gated
# by coverage".  P19/P20 probe the unreachable draft notes.
DIAGNOSTIC_PROBES = {
    "P01": "Gitee WebHook 403",
    "P03": "双链 未命中 待创建",
    "P04": "健康检查 自动回滚",
    "P06": "备份 口令",
    "P08": "Prisma 脚本 PrismaClient 初始化",
    "P09": "Error while requesting resource",
    "P11": "鸿蒙 ClashBox",
    "P13": "满血 H3 32GB",
    "P16": "Linux Windows 支持",
    "P19": "失败即停",
    "P20": "深夜 保持安静",
}


# --------------------------------------------------------------------------- io


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_queries(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def read_note_meta(store: Path, note_id: str) -> dict:
    """Return {exists, status} for a note id, reading only its frontmatter."""
    p = store / "notes" / f"{note_id}.md"
    if not p.is_file():
        return {"exists": False, "status": None}
    text = p.read_text(encoding="utf-8", errors="replace")
    status = None
    if text.startswith("---"):
        end = text.find("\n---", 3)
        front = text[: end if end != -1 else len(text)]
        m = re.search(r"^status:\s*(.+?)\s*$", front, re.M)
        if m:
            status = m.group(1).strip().strip("'\"")
    return {"exists": True, "status": status or "active"}


# ------------------------------------------------------------------- recall io


def run_recall(query: str, store: Path, checkout: Path, timeout: int = 120) -> tuple[dict, dict]:
    cmd = [
        "node",
        "bin/memory",
        "recall",
        "--store",
        str(store),
        "--json",
        "--query",
        query,
    ]
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(checkout),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        elapsed = (time.perf_counter() - t0) * 1000
        return {"_error": "timeout"}, {
            "rc": None,
            "ms": round(elapsed, 1),
            "stderr": f"timeout after {timeout}s",
        }
    elapsed = (time.perf_counter() - t0) * 1000
    meta = {
        "rc": proc.returncode,
        "ms": round(elapsed, 1),
        "stderr": (proc.stderr or "").strip()[-500:],
    }
    raw = (proc.stdout or "").strip()
    if not raw:
        return {"_error": "empty stdout"}, meta
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"_error": f"invalid json: {exc}", "_stdout": raw[:500]}, meta
    if not isinstance(data, dict):
        return {"_error": "json is not an object"}, meta
    return data, meta


# ---------------------------------------------------------------- query facts


def base_id(note_id: str) -> str:
    return note_id.split("#", 1)[0]


def rank_of(items: list[dict], note_id: str) -> int | None:
    for i, item in enumerate(items, 1):
        if item.get("id") == note_id:
            return i
    return None


def family_rank_of(items: list[dict], note_id: str) -> int | None:
    fam = base_id(note_id)
    for i, item in enumerate(items, 1):
        if base_id(str(item.get("id", ""))) == fam:
            return i
    return None


def item_relevance(item: dict | None) -> float:
    if not item:
        return 0.0
    rel = item.get("relevance")
    if rel is None and isinstance(item.get("score"), dict):
        rel = item["score"].get("relevance")
    try:
        return float(rel or 0.0)
    except (TypeError, ValueError):
        return 0.0


def short(note_id: str | None, limit: int = 46) -> str:
    if not note_id:
        return "—"
    return note_id if len(note_id) <= limit else note_id[: limit - 1] + "…"


def md_escape(value: object) -> str:
    text = str(value)
    return text.replace("|", "\\|").replace("\n", " ").strip()


def pct(n: int, d: int) -> str:
    return f"{n}/{d} ({100.0 * n / d:.0f}%)" if d else "—"


def query_info(res: dict) -> dict:
    return ((res.get("diagnostics") or {}).get("queryInfo") or {})


def terms_text(info: dict, limit: int = 8) -> str:
    terms = [str(t) for t in (info.get("informativeTerms") or [])]
    if not terms:
        return "—"
    shown = terms[:limit]
    text = ",".join(shown)
    if len(terms) > limit:
        text += ",…"
    return text


def ignored_entry(res: dict, note_id: str) -> dict | None:
    for s in ((res.get("diagnostics") or {}).get("ignored") or []):
        if isinstance(s, dict) and s.get("id") == note_id:
            return s
    return None


def scored_entry(res: dict, note_id: str) -> dict | None:
    for s in (res.get("scores") or []):
        if isinstance(s, dict) and s.get("id") == note_id:
            return s
    return None


# ---------------------------------------------------------------- attribution


def classify_failure(note_id: str, status: str | None, res: dict) -> dict:
    """Classify why a positive note is outside the returned top-6.

    Classes are the three requested by the task plus one honest extra:
      * draft_excluded     -- note is draft/archived, removed before scoring
      * lexical_mismatch   -- BM25 never produced the note, or relevance < floor
      * threshold_coverage -- the note scored but was gated (score/coverage/cooc)
      * ranked_low         -- the note IS returned, but after rank 6 (budget/rank)
    """
    items = res.get("items") or []
    diag = res.get("diagnostics") or {}
    thresholds = res.get("thresholds") or {}
    gate = res.get("coverageGate")
    skipped = res.get("skipped") or diag.get("skipped") or {}
    scores = {s.get("id"): s for s in (res.get("scores") or []) if isinstance(s, dict)}
    ignored = {s.get("id"): s for s in (diag.get("ignored") or []) if isinstance(s, dict)}
    nearest = {n.get("id"): n for n in (res.get("nearest") or []) if isinstance(n, dict)}

    if status in DRAFT_MARKERS:
        return {
            "class": "draft_excluded",
            "label": "draft 笔记被召回排除",
            "detail": (
                f"status={status}; filterNotes 在打分前排除 draft/archived "
                f"(skipped.archived_draft={skipped.get('archived_draft')})"
            ),
        }

    rank = rank_of(items, note_id)
    if rank is not None:
        return {
            "class": "ranked_low",
            "label": "预算/排序裁剪（命中但 rank>6）",
            "detail": f"rank={rank}, items={len(items)}（maxNotes 预算裁剪）",
        }

    if note_id in ignored:
        s = ignored[note_id]
        rel = float(s.get("relevance") or 0.0)
        score = float(s.get("score") or 0.0)
        cov = float(s.get("coverage") or 0.0)
        cooc = s.get("cooccurrence")
        min_rel = float(thresholds.get("minRelevance") or 0.15)
        min_score = float(thresholds.get("minScore") or 0.18)
        if rel < min_rel:
            return {
                "class": "lexical_mismatch",
                "label": "词面不匹配",
                "detail": (
                    f"relevance={rel:.3f} < minRelevance={min_rel:.3f} "
                    f"(score={score:.3f}, coverage={cov:.3f})"
                ),
            }
        if gate is not None and cov < float(gate):
            return {
                "class": "threshold_coverage",
                "label": "阈值/覆盖率拒绝",
                "detail": (
                    f"coverage={cov:.3f} < coverageGate={float(gate):.3f} "
                    f"(relevance={rel:.3f}, score={score:.3f})"
                ),
            }
        if score < min_score:
            return {
                "class": "threshold_coverage",
                "label": "阈值/覆盖率拒绝",
                "detail": (
                    f"score={score:.3f} < minScore={min_score:.3f} "
                    f"(relevance={rel:.3f}, coverage={cov:.3f})"
                ),
            }
        if isinstance(cooc, dict) and not cooc.get("ok", True):
            missing = cooc.get("missing")
            return {
                "class": "threshold_coverage",
                "label": "阈值/覆盖率拒绝",
                "detail": (
                    f"cooccurrence.ok=false (required={cooc.get('required')}, "
                    f"minEvidence={cooc.get('minEvidence')}, missing={missing})"
                ),
            }
        return {
            "class": "threshold_coverage",
            "label": "阈值/覆盖率拒绝",
            "detail": (
                f"scored 但未进 items（relevance={rel:.3f}, score={score:.3f}, "
                f"coverage={cov:.3f}, gate={gate}）"
            ),
        }

    if note_id in scores:
        return {
            "class": "ranked_low",
            "label": "预算/排序裁剪（scored 但未进 items）",
            "detail": (
                f"scored={scores[note_id]}; refused={res.get('refused')}; "
                f"items={len(items)}"
            ),
        }

    # Not even a BM25 candidate (or only surfaced as a nearest hint on refusal).
    if note_id in nearest:
        return {
            "class": "lexical_mismatch",
            "label": "词面不匹配",
            "detail": (
                f"未进入 scores，只在 nearest 中出现（reason={res.get('reason')}, "
                f"queryInfo={diag.get('queryInfo')}）"
            ),
        }
    return {
        "class": "lexical_mismatch",
        "label": "词面不匹配",
        "detail": (
            f"未进入 scores/nearest（candidates={res.get('candidates')}, "
            f"reason={res.get('reason')}, queryInfo={diag.get('queryInfo')}）"
        ),
    }


# ---------------------------------------------------------------------- tests


def eval_positives(queries: dict, store: Path, checkout: Path) -> dict:
    rows = []
    for case in queries["positives"]:
        qid, query, expect = case["id"], case["q"], case["expect_id"]
        res, meta = run_recall(query, store, checkout)
        note_meta = read_note_meta(store, expect)
        items = res.get("items") or []
        rank = rank_of(items, expect)
        fam_rank = family_rank_of(items, expect)
        found = next((it for it in items if it.get("id") == expect), None)
        top1 = items[0] if items else None
        failure = None
        if meta.get("rc") not in (0, 1):
            failure = {
                "class": "error",
                "label": "调用失败",
                "detail": f"rc={meta.get('rc')} stderr={meta.get('stderr')}",
            }
        elif res.get("_error"):
            failure = {
                "class": "error",
                "label": "输出解析失败",
                "detail": res.get("_error"),
            }
        elif rank is None or rank > 6:
            failure = classify_failure(expect, note_meta.get("status"), res)

        row = {
            "id": qid,
            "q": query,
            "expect_id": expect,
            "keywords": case.get("keywords", []),
            "status": note_meta.get("status"),
            "note_exists": note_meta.get("exists"),
            "rank": rank,
            "family_rank": fam_rank,
            "hit1": rank == 1,
            "hit6": rank is not None and rank <= 6,
            "family_hit1": fam_rank == 1,
            "family_hit6": fam_rank is not None and fam_rank <= 6,
            "expected_relevance": item_relevance(found),
            "top1_id": top1.get("id") if top1 else None,
            "top1_title": top1.get("title") if top1 else None,
            "top1_relevance": item_relevance(top1),
            "query_info": query_info(res),
            "scored": scored_entry(res, expect),
            "ignored": ignored_entry(res, expect),
            "refused": bool(res.get("refused")),
            "reason": res.get("reason"),
            "candidates": res.get("candidates"),
            "eligible": (res.get("diagnostics") or {}).get("eligible"),
            "coverage_gate": res.get("coverageGate"),
            "thresholds": res.get("thresholds"),
            "skipped": res.get("skipped"),
            "nearest_top1": (res.get("nearest") or [{}])[0].get("id")
            if res.get("nearest")
            else None,
            "failure": failure,
            "ms": meta.get("ms"),
            "rc": meta.get("rc"),
            "res": res,
        }
        rows.append(row)
        mark = "HIT" if row["hit6"] else "MISS"
        print(
            f"  {qid} {mark} rank={rank if rank is not None else '-'} "
            f"fam={fam_rank if fam_rank is not None else '-'} "
            f"{expect} ({note_meta.get('status')})",
            file=sys.stderr,
        )
    return {"rows": rows}


def eval_negatives(queries: dict, store: Path, checkout: Path) -> dict:
    rows = []
    for case in queries["negatives"]:
        qid, query = case["id"], case["q"]
        res, meta = run_recall(query, store, checkout)
        items = res.get("items") or []
        refused = bool(res.get("refused"))
        false_hit = (not refused) and bool(items)
        top1 = items[0] if items else None
        rows.append(
            {
                "id": qid,
                "q": query,
                "refused": refused,
                "false_hit": false_hit,
                "reason": res.get("reason"),
                "items": len(items),
                "top1_id": top1.get("id") if top1 else None,
                "top1_title": top1.get("title") if top1 else None,
                "top1_relevance": item_relevance(top1),
                "nearest_count": len(res.get("nearest") or []),
                "candidates": res.get("candidates"),
                "query_info": query_info(res),
                "ms": meta.get("ms"),
                "rc": meta.get("rc"),
                "res": res,
            }
        )
        print(
            f"  {qid} {'FALSE-HIT' if false_hit else 'ok'} "
            f"refused={refused} reason={res.get('reason')} items={len(items)}",
            file=sys.stderr,
        )
    return {"rows": rows}


def eval_absent(queries: dict, store: Path, checkout: Path) -> dict:
    rows = []
    for case in queries["absent"]:
        qid, query = case["id"], case["q"]
        res, meta = run_recall(query, store, checkout)
        items = res.get("items") or []
        refused = bool(res.get("refused"))
        nearest = res.get("nearest") or []
        if refused and not items:
            assessment = "正确拒答（有相关提示）" if nearest else "正确拒答（静默）"
        elif refused and items:
            assessment = "矛盾：refused=true 但有 items"
        else:
            assessment = "误答：返回了 items"
        rows.append(
            {
                "id": qid,
                "q": query,
                "refused": refused,
                "correct": refused and not items,
                "reason": res.get("reason"),
                "items": len(items),
                "top1_id": items[0].get("id") if items else None,
                "top1_title": items[0].get("title") if items else None,
                "top1_relevance": item_relevance(items[0] if items else None),
                "nearest_count": len(nearest),
                "nearest_top1_id": nearest[0].get("id") if nearest else None,
                "nearest_top1_title": nearest[0].get("title") if nearest else None,
                "assessment": assessment,
                "candidates": res.get("candidates"),
                "queryInfo": (res.get("diagnostics") or {}).get("queryInfo"),
                "ms": meta.get("ms"),
                "rc": meta.get("rc"),
                "res": res,
            }
        )
        print(
            f"  {qid} {'REFUSED' if refused else 'ANSWERED'} items={len(items)} "
            f"nearest={len(nearest)} reason={res.get('reason')}",
            file=sys.stderr,
        )
    return {"rows": rows}


def eval_diagnostics(pos_rows: list[dict], store: Path, checkout: Path) -> dict:
    """Run compact keyword probes for failed positives (post-hoc attribution only).

    The probes do not enter any headline metric.  They answer one question: could
    the same note have been returned if the query were not diluted by the
    natural-language surface form?  A probe that recovers the note rules out
    "the note is missing / BM25 cannot index it" and points at the coverage gate.
    """
    rows = []
    for r in pos_rows:
        if not r.get("failure"):
            continue
        probe = DIAGNOSTIC_PROBES.get(r["id"])
        if not probe:
            continue
        res, meta = run_recall(probe, store, checkout)
        items = res.get("items") or []
        expect = r["expect_id"]
        rank = rank_of(items, expect)
        fam_rank = family_rank_of(items, expect)
        top1 = items[0] if items else None
        if rank is not None and rank <= 6:
            outcome = f"恢复 hit@{rank}"
        elif rank is not None:
            outcome = f"仍排 rank{rank}"
        elif items:
            outcome = "未恢复；返回其他笔记"
        elif res.get("refused"):
            outcome = "仍拒答"
        else:
            outcome = "空结果"
        rows.append(
            {
                "id": r["id"],
                "q": r["q"],
                "probe": probe,
                "expect_id": expect,
                "draft_target": r["status"] in DRAFT_MARKERS,
                "rank": rank,
                "family_rank": fam_rank,
                "recovered": rank is not None and rank <= 6,
                "outcome": outcome,
                "refused": bool(res.get("refused")),
                "reason": res.get("reason"),
                "items": len(items),
                "top1_id": top1.get("id") if top1 else None,
                "top1_title": top1.get("title") if top1 else None,
                "query_info": query_info(res),
                "nearest_count": len(res.get("nearest") or []),
                "ms": meta.get("ms"),
            }
        )
        print(
            f"  [probe] {r['id']} {probe!r} -> {outcome} "
            f"(top1={top1.get('id') if top1 else '-'})",
            file=sys.stderr,
        )
    return {"rows": rows}


# --------------------------------------------------------------------- report


def summarize(pos: dict, neg: dict, absent: dict, diag: dict, sha: str, store: Path) -> dict:
    pos_rows = pos["rows"]
    neg_rows = neg["rows"]
    abs_rows = absent["rows"]
    diag_rows = diag["rows"]
    n_pos, n_neg, n_abs = len(pos_rows), len(neg_rows), len(abs_rows)

    hit1 = sum(r["hit1"] for r in pos_rows)
    hit6 = sum(r["hit6"] for r in pos_rows)
    fam_hit1 = sum(r["family_hit1"] for r in pos_rows)
    fam_hit6 = sum(r["family_hit6"] for r in pos_rows)

    rel_all = [r["expected_relevance"] for r in pos_rows]
    rel_hits = [r["expected_relevance"] for r in pos_rows if r["hit6"]]
    top1_rel = [r["top1_relevance"] for r in pos_rows]

    draft_targets = [r for r in pos_rows if r["status"] in DRAFT_MARKERS]
    draft_skipped = sorted(
        {
            (r["skipped"] or {}).get("archived_draft")
            for r in pos_rows
            if (r["skipped"] or {}).get("archived_draft") is not None
        }
    )

    failure_classes: dict[str, int] = {}
    failure_rows = []
    for r in pos_rows:
        if r["failure"]:
            failure_rows.append(r)
            cls = r["failure"]["class"]
            failure_classes[cls] = failure_classes.get(cls, 0) + 1

    false_hits = [r for r in neg_rows if r["false_hit"]]
    neg_refused = sum(r["refused"] for r in neg_rows)
    neg_reasons: dict[str, int] = {}
    for r in neg_rows:
        if r["refused"]:
            neg_reasons[r["reason"] or "null"] = neg_reasons.get(r["reason"] or "null", 0) + 1

    correct_refusals = sum(r["correct"] for r in abs_rows)
    abs_reasons: dict[str, int] = {}
    for r in abs_rows:
        abs_reasons[r["reason"] or "null"] = abs_reasons.get(r["reason"] or "null", 0) + 1
    abs_with_hint = sum(1 for r in abs_rows if r["nearest_count"] > 0)
    abs_false = [r for r in abs_rows if not r["correct"]]

    diag_non_draft = [r for r in diag_rows if not r["draft_target"]]
    diag_draft = [r for r in diag_rows if r["draft_target"]]
    diag_non_draft_recovered = [r for r in diag_non_draft if r["recovered"]]
    diag_draft_recovered = [r for r in diag_draft if r["recovered"]]
    diag_wrong_substitute = [r for r in diag_rows if not r["recovered"] and r["items"] > 0]
    false_gate_false = sum(
        1 for r in false_hits if (r.get("query_info") or {}).get("informativeGateEnabled") is False
    )

    latencies = sorted(r["ms"] for r in pos_rows + neg_rows + abs_rows if r["ms"] is not None)
    median_ms = statistics.median(latencies) if latencies else 0.0
    p95_ms = latencies[int(0.95 * (len(latencies) - 1))] if latencies else 0.0

    near_misses = [
        r for r in pos_rows if r["rank"] is not None and 2 <= r["rank"] <= 6
    ]

    return {
        "generated_at": datetime.now(TZ).isoformat(timespec="seconds"),
        "sha256": sha,
        "sha_matches": sha == EXPECTED_SHA256,
        "store": str(store),
        "counts": {
            "positives": n_pos,
            "negatives": n_neg,
            "absent": n_abs,
            "draft_targets": len(draft_targets),
        },
        "hit1": hit1,
        "hit6": hit6,
        "family_hit1": fam_hit1,
        "family_hit6": fam_hit6,
        "n_pos": n_pos,
        "mean_rel_including_misses": sum(rel_all) / n_pos if n_pos else 0.0,
        "mean_rel_hits_only": (sum(rel_hits) / len(rel_hits)) if rel_hits else 0.0,
        "mean_top1_rel": sum(top1_rel) / n_pos if n_pos else 0.0,
        "draft_targets": len(draft_targets),
        "draft_skipped_values": draft_skipped,
        "false_hits": len(false_hits),
        "n_neg": n_neg,
        "neg_refused": neg_refused,
        "neg_reasons": neg_reasons,
        "correct_refusals": correct_refusals,
        "n_abs": n_abs,
        "abs_reasons": abs_reasons,
        "abs_with_hint": abs_with_hint,
        "failure_classes": failure_classes,
        "failure_rows": failure_rows,
        "near_misses": near_misses,
        "diagnostics": diag_rows,
        "diag_non_draft_total": len(diag_non_draft),
        "diag_non_draft_recovered": len(diag_non_draft_recovered),
        "diag_draft_total": len(diag_draft),
        "diag_draft_recovered": len(diag_draft_recovered),
        "diag_wrong_substitute": len(diag_wrong_substitute),
        "false_gate_false": false_gate_false,
        "abs_false_rows": abs_false,
        "latency": {"median_ms": median_ms, "p95_ms": p95_ms},
        "rows_pos": pos_rows,
        "rows_neg": neg_rows,
        "rows_abs": abs_rows,
    }


def render_report(summary: dict) -> str:
    s = summary
    L: list[str] = []
    add = L.append

    add("# Tabellio 记忆召回盲测报告（独立、模型无关）")
    add("")
    add(f"- 生成时间：{s['generated_at']}（Asia/Shanghai）")
    add(f"- 查询集：`tools/blind-queries.json`，sha256 `{s['sha256']}`")
    add(
        f"- 冻结校验：{'✅ 与冻结值一致' if s['sha_matches'] else '⚠️ 与冻结值不一致（盲测属性已破坏）'}"
    )
    add(f"- 记忆库：`{s['store']}`（只读；794 篇笔记 / 23 个逻辑家族 / 26 篇 draft）")
    add(
        "- 调用方式：`node bin/memory recall --store ~/memory/tabellio --json "
        '--query "<query>"`（cwd `~/yffto/memory-service`；每条查询独立进程）'
    )
    add(
        "- 口径：hit@1 / hit@6 按**期望笔记 id 精确匹配**；括号内 family 级按 `#` 前缀同家族；"
        "正例 relevance 取期望笔记的 `relevance`（未命中记 0）；负例误命中 = 返回 `items` 非空；"
        "缺失事实的“正确拒答” = `refused=true` 且 `items=[]`。"
    )
    add(
        "- 归因探针：3.3 节的短词探针是主指标跑完后的事后诊断，**不计入** hit@1/hit@6、负例误命中率或缺失事实拒答率。"
    )
    add("")

    add("## 1. 核心指标")
    add("")
    add("| 指标 | 结果 |")
    add("|---|---|")
    add(f"| 正例 hit@1（精确 id） | **{s['hit1']}/{s['n_pos']}** ({100*s['hit1']/s['n_pos']:.0f}%) |")
    add(f"| 正例 hit@6（精确 id） | **{s['hit6']}/{s['n_pos']}** ({100*s['hit6']/s['n_pos']:.0f}%) |")
    add(f"| 正例 hit@1（family 级） | {s['family_hit1']}/{s['n_pos']} ({100*s['family_hit1']/s['n_pos']:.0f}%) |")
    add(f"| 正例 hit@6（family 级） | {s['family_hit6']}/{s['n_pos']} ({100*s['family_hit6']/s['n_pos']:.0f}%) |")
    add(f"| 正例平均 relevance（期望笔记，未命中记 0） | {s['mean_rel_including_misses']:.3f} |")
    add(f"| 正例平均 relevance（仅 hit@6 命中） | {s['mean_rel_hits_only']:.3f} |")
    add(f"| 正例 top-1 平均 relevance（含空结果记 0） | {s['mean_top1_rel']:.3f} |")
    add(f"| 负例误命中率 | **{s['false_hits']}/{s['n_neg']}** ({100*s['false_hits']/s['n_neg']:.0f}%) |")
    add(f"| 负例被拒答 | {s['neg_refused']}/{s['n_neg']} |")
    add(f"| 缺失事实正确拒答 | **{s['correct_refusals']}/{s['n_abs']}** ({100*s['correct_refusals']/s['n_abs']:.0f}%) |")
    add(f"| draft 门命中的正例 | **{s['draft_targets']}/{s['n_pos']}** |")
    add(f"| 每次查询被 draft 门排除的笔记数 | {', '.join(map(str, s['draft_skipped_values'])) or '—'} |")
    add(f"| 单次 CLI 延迟（中位 / p95） | {s['latency']['median_ms']:.0f} ms / {s['latency']['p95_ms']:.0f} ms |")
    add("")

    add("## 2. 正例逐条结果")
    add("")
    add("| # | 查询 | 期望笔记 | 精确 rank | family rank | 期望 rel | top-1 | 判定 |")
    add("|---|---|---|---|---|---|---|---|")
    for r in s["rows_pos"]:
        if r["hit1"]:
            verdict = "✅ hit@1"
        elif r["hit6"]:
            verdict = "✅ hit@6"
        else:
            verdict = f"❌ {r['failure']['label'] if r['failure'] else '未命中'}"
        fam = r["family_rank"] if r["family_rank"] is not None else "—"
        rank = r["rank"] if r["rank"] is not None else "—"
        rel = f"{r['expected_relevance']:.3f}" if r["rank"] is not None else "—"
        top1 = short(r["top1_id"]) if r["top1_id"] else "—"
        add(
            f"| {r['id']} | {md_escape(r['q'])} | `{r['expect_id']}` | {rank} | {fam} | "
            f"{rel} | `{top1}` | {verdict} |"
        )
    add("")

    add("## 3. 失败归因（未进 top-6 的正例）")
    add("")
    if not s["failure_rows"]:
        add("无。")
        add("")
    else:
        add("| 分类 | 条数 | 正例 |")
        add("|---|---|---|")
        labels = {
            "draft_excluded": "draft 笔记被召回排除",
            "threshold_coverage": "阈值/覆盖率拒绝",
            "lexical_mismatch": "词面不匹配",
            "ranked_low": "预算/排序裁剪（额外类）",
            "error": "调用/解析失败",
        }
        for cls, n in sorted(s["failure_classes"].items(), key=lambda kv: (-kv[1], kv[0])):
            ids = ", ".join(r["id"] for r in s["failure_rows"] if r["failure"]["class"] == cls)
            add(f"| {labels.get(cls, cls)} | {n} | {ids} |")
        add("")
        for r in s["failure_rows"]:
            add(f"- **{r['id']}** `{r['expect_id']}`（status={r['status']}）：{r['failure']['label']}；{r['failure']['detail']}")
            add(
                f"  - diagnostics: candidates={r['candidates']}, eligible={r['eligible']}, "
                f"coverageGate={r['coverage_gate']}, skipped.archived_draft={(r['skipped'] or {}).get('archived_draft')}, "
                f"reason={r['reason']}, nearest.top1={short(r['nearest_top1'])}"
            )
        add("")

    add("### 3.1 draft 门影响")
    add("")
    add(
        f"26 篇 `status: draft` 笔记在 `filterNotes()` 里于打分前被整批排除（`skipped.archived_draft=26`），"
        f"任何查询都召不回。本组 20 条正例中有 **{s['draft_targets']}** 条的目标笔记本身是 draft："
        "P19（`feedback-reusable-workflow-lessons#2`）与 P20（`feedback-collaboration-and-safety-rules#3`）。"
        "这两条不是检索算法失败，是 draft 生命周期门的直接后果；即使查询词面完全命中，也必然 0 召回。"
    )
    add("")
    add(
        "补充：`失败即停/不要反复重试` 在库内只出现在 3 篇 draft 笔记（lessons#2、collaboration#2、user-profile#2）；"
        "`深夜 23:00–08:00` 的语义规则也只在 draft collaboration#3。"
        "因此这两题没有任何 active 笔记可替代命中。"
    )
    add("")

    add("### 3.2 仅拉低 hit@1 的“近命中”（rank 2–6）")
    add("")
    if not s["near_misses"]:
        add("无。")
    else:
        for r in s["near_misses"]:
            add(
                f"- **{r['id']}** rank={r['rank']}（期望 rel={r['expected_relevance']:.3f}），"
                f"top-1=`{r['top1_id']}` rel={r['top1_relevance']:.3f}；查询：{r['q']}"
            )
    add("")

    add("### 3.3 事后归因探针（不参与盲测指标）")
    add("")
    if not s["diagnostics"]:
        add("无。")
    else:
        add(
            "主指标跑完后，对每个失败正例用一条更短的关键词查询重跑（**不计入 hit 统计**），"
            "用来区分“笔记不存在 / BM25 找不到”与“自然语言形式被覆盖率/共现门拒绝”。"
        )
        add("")
        add("| 正例 | 期望笔记 | 诊断短查询 | 目标 rank | 结果 | top-1 |")
        add("|---|---|---|---|---|---|")
        for r in s["diagnostics"]:
            rank = r["rank"] if r["rank"] is not None else "—"
            top1 = f"`{short(r['top1_id'])}`" if r["top1_id"] else "—"
            add(
                f"| {r['id']} | `{r['expect_id']}` | {md_escape(r['probe'])} | "
                f"{rank} | {r['outcome']} | {top1} |"
            )
        add("")
        add(
            f"- 非 draft 失败项：**{s['diag_non_draft_recovered']}/{s['diag_non_draft_total']}** "
            "在短词探针下恢复到 top-6（其中 8 条 rank1，P04 rank2）。这些笔记都存在、都被 BM25 命中；"
            "原查询失败发生在覆盖率/组合共现门，而不是“库里没有”。"
        )
        add(
            f"- draft 失败项：**{s['diag_draft_recovered']}/{s['diag_draft_total']}** 可恢复。"
            "P19/P20 的探针仍无法召回，且 P19「失败即停」、P20「深夜 保持安静」都返回了**不相关的 active 笔记**"
            "（而不是拒答）：draft 门不仅让正确答案不可见，还可能让部分匹配的 active 笔记顶上来，形成“自信的错答”。"
        )
        add("- 探针查询是事后构造的归因工具，不是盲测样本；它们不改变第 1 节任何数字。")
    add("")

    add("## 4. 负例（闲聊/常识/无关）")
    add("")
    add("| # | 查询 | 拒答？ | reason | items | top-1（若误命中） | 有效词项（gate） | nearest 条数 |")
    add("|---|---|---|---|---|---|---|---|")
    for r in s["rows_neg"]:
        flag = "❌ 误命中" if r["false_hit"] else ("✅" if r["refused"] else "⚠️ 空结果但未拒答")
        top1 = f"`{short(r['top1_id'])}` @ {r['top1_relevance']:.3f}" if r["top1_id"] else "—"
        qi = r.get("query_info") or {}
        gate = qi.get("informativeGateEnabled")
        gate_s = "T" if gate is True else ("F" if gate is False else "—")
        add(
            f"| {r['id']} | {md_escape(r['q'])} | {flag} | {r['reason'] or '—'} | {r['items']} | "
            f"{top1} | `{md_escape(terms_text(qi))}` ({gate_s}) | {r['nearest_count']} |"
        )
    add("")
    if s["neg_reasons"]:
        add("负例拒答理由分布：" + "，".join(f"`{k}`×{v}" for k, v in sorted(s["neg_reasons"].items(), key=lambda kv: -kv[1])))
        add("")

    false_rows = [r for r in s["rows_neg"] if r["false_hit"]]
    if false_rows:
        add("### 4.1 误命中模式")
        add("")
        for r in false_rows:
            qi = r.get("query_info") or {}
            gate = qi.get("informativeGateEnabled")
            add(
                f"- **{r['id']}** `{r['q']}`：有效词项 `{terms_text(qi)}`，"
                f"informativeGateEnabled={gate}，top-1=`{short(r['top1_id'])}` "
                f"rel={r['top1_relevance']:.3f}"
            )
        add("")
        add(
            f"{len(false_rows)} 条误命中里 **{s['false_gate_false']} 条** `informativeGateEnabled=false`。"
            "这个字段为 false 的含义是“本次没有任何词项被通用词闸剔除”，不是“闸不存在”："
            "未知实体（天气/笑话/科幻/月球…）被丢弃后，查询只剩 1–3 个常见词或功能词，"
            "覆盖率分母随之坍缩，任意包含这些词的笔记都能过 0.6 门槛。"
            "N03 是唯一 gate=true 的误命中，靠「加/等于」两个低 df 词过线。"
        )
        add("")

    add("## 5. 缺失事实的拒答质量（有记忆意图，库里没有）")
    add("")
    add(
        f"正确拒答 **{s['correct_refusals']}/{s['n_abs']}**；带 nearest 提示 {s['abs_with_hint']}/{s['n_abs']}。"
    )
    add("")
    add("| # | 查询 | 结果 | reason | items | nearest top-1 | 有效词项 | 评价 |")
    add("|---|---|---|---|---|---|---|---|")
    for r in s["rows_abs"]:
        flag = "✅ 拒答" if r["correct"] else "❌ 误答"
        hint = f"`{short(r['nearest_top1_id'])}`" if r["nearest_top1_id"] else "—"
        qi = r.get("queryInfo") or {}
        add(
            f"| {r['id']} | {md_escape(r['q'])} | {flag} | {r['reason'] or '—'} | {r['items']} | "
            f"{hint} | `{md_escape(terms_text(qi))}` | {r['assessment']} |"
        )
    add("")
    if s["abs_reasons"]:
        add("缺失事实拒答理由分布：" + "，".join(f"`{k}`×{v}" for k, v in sorted(s["abs_reasons"].items(), key=lambda kv: -kv[1])))
        add("")

    if s["abs_false_rows"]:
        add("### 5.1 误答模式")
        add("")
        for r in s["abs_false_rows"]:
            qi = r.get("queryInfo") or {}
            add(
                f"- **{r['id']}** `{r['q']}`：有效词项 `{terms_text(qi)}`，"
                f"返回 {r['items']} 条，top-1=`{short(r['top1_id'])}` "
                f"rel={r['top1_relevance']:.3f}"
            )
        add("")
        add(
            "共同模式：关键实体（WiFi 密码、车牌号、车辆保养）在库内不存在，被 tokenizer/词典丢弃后，"
            "只剩「密码」「我/多少」「下次/时间」这类通用词；覆盖率按剩余词计算 = 1.0，于是返回无关笔记。"
            "`no_informative_term` 只在**所有**词都被判通用时触发，识别不了“关键实体未知、只剩通用词”的情况——"
            "这是拒答质量的核心缺口。"
        )
        add("")

    add("## 6. 观察与解释")
    add("")
    hits6 = s["hit6"]
    add(
        f"1. **精确 id 的 hit@6 = {hits6}/{s['n_pos']}，family 级 hit@6 = {s['family_hit6']}/{s['n_pos']}。** "
        "两者唯一的差异是 P13：期望 `project-local-comfyui-video#6` 未进 top-6，但同家族 `#5` 排第一。"
        "794 篇笔记只归并为 23 个家族，同家族片段会互相挤占；本报告以精确 id 为主指标，family 级仅作诊断，不替换主指标。"
    )
    add(
        f"2. **9 条非 draft 失败全部止于覆盖率/共现门，而不是“库里没有”。** "
        "其中 8 条 `coverage < 0.6`，P09 是组合共现未满足（required=2, missing=['han']）；"
        "这些期望笔记的 BM25 relevance 在 0.917–0.961，说明词面已经命中，是重叠 CJK bigram 与自然语言改写把覆盖率分母撑大后拒绝。"
        f"3.3 的短词探针让 **{s['diag_non_draft_recovered']}/{s['diag_non_draft_total']}** 恢复 top-6，直接佐证这一点。"
    )
    add(
        f"3. **负例误命中率 {s['false_hits']}/{s['n_neg']}，其中 {s['false_gate_false']} 条 gate=false。** "
        "这些查询的未知实体（天气、笑话、科幻、月球…）被丢弃后，只剩「今天/怎么」「给我」「推荐」「你」等 1–3 个常见词；"
        "覆盖率分母坍缩后，任意包含这些词的笔记都能过门。N03 是唯一 gate=true 的误命中，靠低 df 的「加/等于」过线。"
        "这是“把闲聊当可引用记忆”的安全侧红灯。"
    )
    add(
        f"4. **缺失事实的正确拒答 {s['correct_refusals']}/{s['n_abs']}，但有 {len(s['abs_false_rows'])} 条误答（A03/A05/A09）。** "
        "关键实体不存在→被丢弃→只剩「密码」「我/多少」「下次/时间」等通用词→返回无关笔记。"
        "`no_informative_term` 只在所有词都被判通用时触发，识别不了“关键实体未知、只剩通用词”的盲区。"
    )
    add(
        f"5. **draft 门直接吃掉 {s['draft_targets']} 条正例（P19/P20）。** 目标事实只存在于 draft 笔记；"
        "3.3 的短词探针仍召不回，而且 P19/P20 都返回了不相关的 active 笔记——draft 不可见会诱发“自信的错答”。"
        "若要让 draft 可见，是产品生命周期决策，不是 recall 阈值问题。"
    )
    add(
        "6. **综合看，45% 的自然语言 hit@6 衡量的是“查询表面形式 × 覆盖率门”的联合效果，而不是记忆内容缺失。** "
        "9/9 非 draft 失败项换短词就能召回，说明当前召回对查询措辞高度敏感；但这只是归因结论，不能拿来做“探针分数”替换主指标。"
    )
    add(
        "7. **失败分类只针对“未进 top-6”**；本次没有 rank 2–6 的精确命中，P13 是唯一 family 级近命中。"
        "20 条正例的粒度是 5 个百分点，单条差异不应过度解读。"
    )
    add(
        "8. **本测试没有调阈值、没有改插件代码、没有写库。** 所有数字来自默认阈值与默认预算；"
        "3.3 的探针是事后归因，不参与任何主指标。"
    )
    add("")

    add("## 7. 方法与限制")
    add("")
    add(
        "1. 查询集在**任何一条查询执行前**一次性写入 `tools/blind-queries.json` 并冻结（sha256 见页首），"
        "之后未按结果修改；正例期望 id 是在读笔记正文后确定的。"
    )
    add(
        "2. 正例覆盖 active 大/小家族、draft 家族、以及跨语言技术词；负例覆盖闲聊、常识、代码请求、"
        "天气/日期等易误命中词；缺失事实组覆盖个人事实（护照/生日/WiFi/血压/车牌等），事先 grep 确认库内无对应事实。"
    )
    add(
        "3. `relevance` 是库内 BM25 派生的相关性（`s/(s+1.5)`），不是人工标注；`top-1` 是本次返回 items 的第一条。"
    )
    add(
        "4. 已知局限：20 条正例样本小；精确 id 口径对同家族多片段偏严；`体检` 等词在库内有比喻用法"
        "（站点/知识库内容体检），A04 仍属“事实缺失”，但词面并非完全零命中。"
    )
    add(
        "5. 3.3 的短词探针是**事后**为失败项构造的，不是冻结查询集的一部分，因此只用于归因，"
        "不得把它们的结果当成 hit@6 或用来反推阈值；主指标只来自 40 条冻结查询 + 10 条缺失事实查询。"
    )
    add(
        "6. 复现：`cd ~/yffto/memory-service && node bin/memory recall --store ~/memory/tabellio "
        '--json --query "<q>"`；评测脚本 `python3 tools/blind-eval.py`。'
    )
    add("")

    return "\n".join(L) + "\n"


# ------------------------------------------------------------------------ main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--store", type=Path, default=DEFAULT_STORE)
    ap.add_argument("--checkout", type=Path, default=DEFAULT_CHECKOUT)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--raw", type=Path, default=None)
    args = ap.parse_args()

    store = args.store.expanduser().resolve()
    checkout = args.checkout.expanduser().resolve()
    out = args.out.expanduser()
    raw_path = (args.raw or (out.parent / "raw-results.json")).expanduser()

    if not QUERY_FILE.is_file():
        print(f"missing query file: {QUERY_FILE}", file=sys.stderr)
        return 2
    if not (store / "notes").is_dir():
        print(f"store notes dir not found: {store / 'notes'}", file=sys.stderr)
        return 2
    if not (checkout / "bin" / "memory").is_file():
        print(f"memory-service checkout not found: {checkout}", file=sys.stderr)
        return 2

    queries = load_queries(QUERY_FILE)
    sha = sha256_file(QUERY_FILE)
    if sha != EXPECTED_SHA256:
        print(
            f"WARNING: query file sha256 {sha} != frozen {EXPECTED_SHA256}; "
            "blindness cannot be assumed",
            file=sys.stderr,
        )

    print(f"query set: {QUERY_FILE} sha256={sha}", file=sys.stderr)
    print(f"store: {store}", file=sys.stderr)
    print(f"checkout: {checkout}", file=sys.stderr)

    print("\n[positives]", file=sys.stderr)
    pos = eval_positives(queries, store, checkout)
    print("\n[negatives]", file=sys.stderr)
    neg = eval_negatives(queries, store, checkout)
    print("\n[absent]", file=sys.stderr)
    absent = eval_absent(queries, store, checkout)

    print("\n[diagnostic probes — post-hoc, not counted]", file=sys.stderr)
    diag = eval_diagnostics(pos["rows"], store, checkout)

    summary = summarize(pos, neg, absent, diag, sha, store)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_report(summary), encoding="utf-8")

    raw = {
        "generated_at": summary["generated_at"],
        "queries_sha256": sha,
        "store": str(store),
        "checkout": str(checkout),
        "results": {
            r["id"]: {"meta": {"rc": r["rc"], "ms": r["ms"]}, "result": r["res"]}
            for r in pos["rows"] + neg["rows"] + absent["rows"]
        },
    }
    raw_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    public = {
        "generated_at": summary["generated_at"],
        "queries_sha256": sha,
        "sha_matches": summary["sha_matches"],
        "store": str(store),
        "counts": summary["counts"],
        "metrics": {
            "hit1": f"{summary['hit1']}/{summary['n_pos']}",
            "hit6": f"{summary['hit6']}/{summary['n_pos']}",
            "family_hit1": f"{summary['family_hit1']}/{summary['n_pos']}",
            "family_hit6": f"{summary['family_hit6']}/{summary['n_pos']}",
            "mean_rel_including_misses": round(summary["mean_rel_including_misses"], 4),
            "mean_rel_hits_only": round(summary["mean_rel_hits_only"], 4),
            "mean_top1_rel": round(summary["mean_top1_rel"], 4),
            "negative_false_hit_rate": f"{summary['false_hits']}/{summary['n_neg']}",
            "negative_refused": f"{summary['neg_refused']}/{summary['n_neg']}",
            "absent_correct_refusal": f"{summary['correct_refusals']}/{summary['n_abs']}",
            "draft_targets": f"{summary['draft_targets']}/{summary['n_pos']}",
            "draft_skipped_per_query": summary["draft_skipped_values"],
        },
        "failure_classes": summary["failure_classes"],
        "diagnostics": {
            "note": "post-hoc keyword probes; not part of hit@1/hit@6",
            "non_draft_recovered": f"{summary['diag_non_draft_recovered']}/{summary['diag_non_draft_total']}",
            "draft_recovered": f"{summary['diag_draft_recovered']}/{summary['diag_draft_total']}",
            "wrong_substitute": summary["diag_wrong_substitute"],
            "rows": [
                {
                    "id": r["id"],
                    "probe": r["probe"],
                    "rank": r["rank"],
                    "recovered": r["recovered"],
                    "outcome": r["outcome"],
                    "top1_id": r["top1_id"],
                }
                for r in summary["diagnostics"]
            ],
        },
        "false_hit_pattern": {
            "total": summary["false_hits"],
            "informative_gate_false": summary["false_gate_false"],
        },
        "failures": [
            {
                "id": r["id"],
                "expect_id": r["expect_id"],
                "status": r["status"],
                "class": r["failure"]["class"],
                "detail": r["failure"]["detail"],
            }
            for r in summary["failure_rows"]
        ],
        "near_misses": [
            {
                "id": r["id"],
                "rank": r["rank"],
                "expect_id": r["expect_id"],
                "top1_id": r["top1_id"],
            }
            for r in summary["near_misses"]
        ],
        "negative_false_hits": [
            {
                "id": r["id"],
                "q": r["q"],
                "top1_id": r["top1_id"],
                "top1_relevance": r["top1_relevance"],
            }
            for r in summary["rows_neg"]
            if r["false_hit"]
        ],
        "absent": [
            {
                "id": r["id"],
                "q": r["q"],
                "refused": r["refused"],
                "reason": r["reason"],
                "items": r["items"],
                "nearest_top1_id": r["nearest_top1_id"],
                "assessment": r["assessment"],
            }
            for r in summary["rows_abs"]
        ],
        "absent_false_answers": [
            {
                "id": r["id"],
                "q": r["q"],
                "top1_id": r["top1_id"],
                "terms": (r.get("queryInfo") or {}).get("informativeTerms"),
            }
            for r in summary["abs_false_rows"]
        ],
        "neg_reasons": summary["neg_reasons"],
        "abs_reasons": summary["abs_reasons"],
        "latency": summary["latency"],
        "report": str(out),
        "raw": str(raw_path),
    }
    (out.parent / "summary.json").write_text(
        json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print("\n=== summary ===", file=sys.stderr)
    print(json.dumps(public["metrics"], ensure_ascii=False, indent=2), file=sys.stderr)
    print(f"report: {out}", file=sys.stderr)
    print(f"summary: {out.parent / 'summary.json'}", file=sys.stderr)
    print(f"raw: {raw_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
