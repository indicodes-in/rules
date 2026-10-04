"""Second read (accuracy layer 1): re-read every rule from its source.

The drafting pass (pipeline.draft) read the PDFs once and wrote rules. This
reads them again, independently and without an LLM: for each rule it opens
the hashed source file, takes the words inside the citation's page + bbox,
and checks that

  - the source file is byte-identical to the one registered (sha256);
  - the stored quote (`original_text`) is in that region;
  - the rule's value is in that region — for FAR ×100 the ratio form
    (2.25 for 225) also counts;
  - the band numbers the rule is conditioned on are in that region
    (a warning only: a band is often implied by the neighbouring row).

What it proves, and what it does not. A pass means the number the rule
states is printed inside the box it cites, on the file it names. It does
NOT prove the number was taken from the right COLUMN — the classic misread,
where one row carries several numbers — nor that the right row was cited.
That is still the verifier's eye; this narrows it to the rules that fail
here, plus spot checks. It never changes a rule and never marks one
verified.

Usage (from the repo root; the PDFs live in sources/files, never committed):
    python -m pipeline.crosscheck                  # every rule folder
    python -m pipeline.crosscheck --dir rules/mpd2047 --json out.json

Exits 1 when any rule mismatches its source, so it can gate a verification
session.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Callable

import fitz  # PyMuPDF

REPO_ROOT = Path(__file__).resolve().parent.parent
NON_RULE_DIRS = {"schema", "definitions"}

# Padding around the cited box (fraction of the page): drafted boxes hug the
# text, and a glyph whose centre sits a hair outside should still count.
PAD = 0.004

MISMATCH = {"value_not_in_region", "quote_not_in_region", "hash_mismatch"}
WARNING = {"column_out_of_line", "band_not_in_region"}
UNCHECKED = {"file_missing", "no_text_layer", "uncheckable"}

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def region_words(page: fitz.Page, bbox: list[float]) -> list[str]:
    """Words whose centre falls inside the normalized, top-left-origin box,
    in the page's own reading order."""
    w, h = page.rect.width, page.rect.height
    x0, y0, x1, y1 = bbox
    rect = fitz.Rect((x0 - PAD) * w, (y0 - PAD) * h, (x1 + PAD) * w, (y1 + PAD) * h)
    words = []
    for wx0, wy0, wx1, wy1, text, *_ in page.get_text("words"):
        cx, cy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
        if rect.contains(fitz.Point(cx, cy)):
            words.append(text)
    return words


def numbers_in(words: list[str]) -> list[float]:
    """Every number in the words; thousands separators dropped (1,500)."""
    out: list[float] = []
    for word in words:
        for match in _NUMBER.findall(re.sub(r"(?<=\d),(?=\d)", "", word)):
            out.append(float(match))
    return out


def _has(numbers: list[float], value: float) -> bool:
    return any(abs(n - value) < 1e-9 for n in numbers)


def _quote_in(quote: str, words: list[str]) -> bool:
    """The quote is in the region, ignoring whitespace entirely — the text
    layer glues and splits words ("height(less") where the drafted quote
    spaced them. An ellipsis in the quote skips text; the pieces around it
    must still appear, in order."""
    region = "".join(words)
    at = 0
    for piece in re.split(r"\.\.\.|…", quote):
        compact = re.sub(r"\s+", "", piece)
        if not compact:
            continue
        found = region.find(compact, at)
        if found == -1:
            return False
        at = found + len(compact)
    return True


def stated_values(rule: dict) -> list[tuple[str, list[float]]]:
    """What the rule claims, as (label, acceptable printed forms)."""
    out = rule.get("output", {})
    if out.get("type") == "scalar" and isinstance(out.get("value"), (int, float)):
        v = float(out["value"])
        forms = [v, v / 100] if out.get("unit") == "far_x100" else [v]
        return [(f"{out['value']} {out.get('unit') or ''}".strip(), forms)]
    if out.get("type") == "formula":
        return [(f"{k}={p}", [float(p)]) for k, p in out.get("params", {}).items()
                if isinstance(p, (int, float))]
    return []


def band_numbers(rule: dict) -> list[float]:
    out: list[float] = []
    for cond in rule.get("applicability", {}).get("conditions", []) or []:
        if cond.get("fact") != "plot_area_sqm":
            continue
        for v in cond["value"] if isinstance(cond.get("value"), list) else [cond.get("value")]:
            if isinstance(v, (int, float)):
                out.append(float(v))
    return out


def check_rule(rule: dict, open_doc: Callable[[str], "fitz.Document | None"]) -> dict:
    """One rule against its first citation with a page and a box."""
    rid = rule.get("rule_id", "?")
    cite = next((c for c in rule.get("citations", []) if c.get("page") and c.get("bbox")), None)
    if cite is None:
        return {"rule_id": rid, "status": "uncheckable", "detail": "no citation with page + bbox"}
    doc = open_doc(cite["doc_id"])
    if doc is None:
        return {"rule_id": rid, "status": "file_missing", "detail": f"sources/files/{cite['doc_id']}.pdf"}
    if cite["page"] > doc.page_count:
        return {"rule_id": rid, "status": "uncheckable", "detail": f"page {cite['page']} beyond {doc.page_count}"}
    page = doc[cite["page"] - 1]
    where = f"{cite['doc_id']} p.{cite['page']}"
    if len(page.get_text().strip()) < 25:
        return {"rule_id": rid, "status": "no_text_layer", "detail": f"{where}: scanned, read it by eye"}

    words = region_words(page, cite["bbox"])
    numbers = numbers_in(words)
    region = " ".join(words)[:160]

    claims = stated_values(rule)
    quote = cite.get("original_text")
    if not claims and not quote:
        return {"rule_id": rid, "status": "uncheckable", "detail": "no numeric value or quote to compare"}
    for label, forms in claims:
        if not any(_has(numbers, f) for f in forms):
            return {"rule_id": rid, "status": "value_not_in_region",
                    "detail": f"{where}: {label} not in [{region}]"}
    if quote and not _quote_in(quote, words):
        return {"rule_id": rid, "status": "quote_not_in_region",
                "detail": f"{where}: quote [{quote[:80]}] not in [{region}]"}
    missing = [b for b in band_numbers(rule) if not _has(numbers, b)]
    if missing:
        return {"rule_id": rid, "status": "band_not_in_region",
                "detail": f"{where}: band {', '.join(f'{m:g}' for m in missing)} not in [{region}]"}
    return {"rule_id": rid, "status": "ok", "detail": where}


def check_sources(registry: dict, files_dir: Path) -> dict[str, str]:
    """Registered hash against the file on disk, per document."""
    status: dict[str, str] = {}
    for d in registry.get("documents", []):
        path = files_dir / f"{d['doc_id']}.pdf"
        if not path.exists():
            status[d["doc_id"]] = "file_missing"
        elif hashlib.sha256(path.read_bytes()).hexdigest() != d.get("file_hash"):
            status[d["doc_id"]] = "hash_mismatch"
        else:
            status[d["doc_id"]] = "ok"
    return status


def column_consistency(checked: list[tuple[dict, dict]], open_doc) -> None:
    """Catch a value taken from the wrong column, which the per-rule read
    cannot: the number IS printed in its row, just under another heading.

    Rules citing the same table (doc, page, clause) are grouped by row (their
    box). In each row, where does each parameter's value sit? Across rows the
    order of any two parameters should be the same — coverage before FAR on
    every row of a coverage-then-FAR table. A row going against the clear
    majority is marked, both rules of the pair. Only rules that already
    passed are compared; it never marks the majority."""
    tables: dict[tuple, dict[tuple, dict[str, tuple[int, dict]]]] = {}
    for rule, result in checked:
        if result["status"] != "ok":
            continue
        cite = next((c for c in rule.get("citations", []) if c.get("page") and c.get("bbox")), None)
        claims = stated_values(rule)
        doc = open_doc(cite["doc_id"]) if cite else None
        if not cite or not claims or doc is None:
            continue
        numbers = numbers_in(region_words(doc[cite["page"] - 1], cite["bbox"]))
        forms = claims[0][1]
        at = [i for i, n in enumerate(numbers) if any(abs(n - f) < 1e-9 for f in forms)]
        if not at:
            continue
        table = (cite["doc_id"], cite["page"], cite.get("clause"))
        row = tuple(cite["bbox"])
        # The last occurrence: band numbers lead the row, values follow.
        tables.setdefault(table, {}).setdefault(row, {})[rule["parameter"]] = (at[-1], result)

    for rows in tables.values():
        votes: dict[tuple[str, str], int] = {}
        for cells in rows.values():
            for p in cells:
                for q in cells:
                    if p < q and cells[p][0] != cells[q][0]:
                        key = (p, q)
                        votes[key] = votes.get(key, 0) + (1 if cells[p][0] < cells[q][0] else -1)
        for cells in rows.values():
            for (p, q), vote in votes.items():
                if p not in cells or q not in cells or cells[p][0] == cells[q][0]:
                    continue
                here = 1 if cells[p][0] < cells[q][0] else -1
                # Against a clear majority only: every other row agreeing.
                if abs(vote - here) >= 2 and (vote - here) * here < 0:
                    for param in (p, q):
                        res = cells[param][1]
                        res["status"] = "column_out_of_line"
                        res["detail"] += (f": {p} and {q} sit in the opposite order to the "
                                          f"other rows of this table — wrong column?")


def run(rule_dirs: list[Path], registry: dict, files_dir: Path) -> dict:
    sources = check_sources(registry, files_dir)
    cache: dict[str, "fitz.Document | None"] = {}

    def open_doc(doc_id: str):
        if doc_id not in cache:
            path = files_dir / f"{doc_id}.pdf"
            cache[doc_id] = fitz.open(path) if path.exists() else None
        return cache[doc_id]

    results = []
    checked: list[tuple[dict, dict]] = []
    for d in rule_dirs:
        for f in sorted(d.glob("*.json")):
            rule = json.loads(f.read_text(encoding="utf-8"))
            if "rule_id" not in rule or "output" not in rule:
                continue
            cite = next(iter(rule.get("citations", [])), {})
            if sources.get(cite.get("doc_id")) == "hash_mismatch":
                # Reading a different file than the one cited proves nothing.
                result = {"rule_id": rule["rule_id"], "status": "hash_mismatch",
                          "detail": f"{cite['doc_id']}.pdf differs from the registered hash"}
            else:
                result = check_rule(rule, open_doc)
            result["verification"] = rule.get("verification", {}).get("status")
            results.append(result)
            checked.append((rule, result))

    column_consistency(checked, open_doc)

    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {
        "sources": sources,
        "rules": results,
        "counts": counts,
        "mismatches": sum(1 for r in results if r["status"] in MISMATCH),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dir", action="append", help="rule folder(s); default: all under rules/")
    ap.add_argument("--json", help="also write the full report here")
    args = ap.parse_args(argv)

    rules_root = REPO_ROOT / "rules"
    dirs = [Path(d) for d in args.dir] if args.dir else [
        p for p in sorted(rules_root.iterdir()) if p.is_dir() and p.name not in NON_RULE_DIRS
    ]
    registry = json.loads((REPO_ROOT / "sources" / "sources.json").read_text(encoding="utf-8"))
    report = run(dirs, registry, REPO_ROOT / "sources" / "files")

    for doc_id, s in report["sources"].items():
        if s != "ok":
            print(f"SOURCE {s:<14} {doc_id}")
    order = {s: i for i, s in enumerate([*MISMATCH, *WARNING, *UNCHECKED, "ok"])}
    for r in sorted(report["rules"], key=lambda r: (order.get(r["status"], 9), r["rule_id"])):
        if r["status"] == "ok":
            continue
        print(f"{r['status']:<20} [{r['verification']}] {r['rule_id']}\n    {r['detail']}")
    total = len(report["rules"])
    ok = report["counts"].get("ok", 0)
    print(f"\n{ok}/{total} rules: value, quote and band all found in the cited region.")
    print("  " + ", ".join(f"{k}: {v}" for k, v in sorted(report["counts"].items())))
    print("A pass shows the number is printed in the cited box — not that it came from the right column.")

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 1 if report["mismatches"] else 0


if __name__ == "__main__":
    sys.exit(main())
