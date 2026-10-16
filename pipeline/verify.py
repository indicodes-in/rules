"""Human sign-off helper (spec §4): flip reviewed draft rules to verified.

This records the decision a licensed human verifier makes AFTER looking at the
source page — it does not make that decision. The LLM drafted the rules
(`method: llm_extraction_v1`); a human (`--by`) accepts or rejects them. The
two-person rule is satisfied structurally: the verifier identity must differ
from the draft method, which it always does for a human name.

Usage (from the repo root), after reviewing the manifest + worklist:

    # Verify specific rules you've confirmed against the page:
    python -m pipeline.verify --by "Indicodes review" \
        --rule ubbl2016_compendium_2020.res_plotted.max_height_m.no_stilt \
        --rule ubbl2016_compendium_2020.res_plotted.max_height_m.with_stilt

    # Verify every draft rule in a folder EXCEPT ones still needing work:
    python -m pipeline.verify --by "Indicodes review" --dir rules/mpd2021 \
        --except mpd2021_mod_2022.res_plotted.far.upto_50 \
        --except mpd2021_mod_2022.res_plotted.ground_coverage_pct.100_250

    # Verify a definition after checking its text, box, date and aliases:
    python -m pipeline.verify --by "Indicodes review" --definition ubbl2016.dwelling_unit

    # Reject a draft that is wrong (kept in the repo as rejected, not deleted):
    python -m pipeline.verify --by "Indicodes review" --reject \
        --rule <id> --reason "page 156 is group-housing context; re-source"

Always run `pnpm rules:validate` afterwards — it is the authoritative gate.
Verified rules then load in production (no ENGINE_ALLOW_DRAFT needed).
"""

import argparse
import datetime
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RULES_ROOT = REPO_ROOT / "rules"
DRAFT_METHOD = "llm_extraction_v1"
# Methods that produce drafts; a verifier's name may never be one of them.
DRAFT_METHODS = {DRAFT_METHOD, "pdf_text_extraction_v1"}


def find_rule_file(rule_id: str) -> Path | None:
    matches = list(RULES_ROOT.glob(f"*/{rule_id}.json"))
    return matches[0] if matches else None


def list_draft_rule_ids(rules_dir: Path) -> list[str]:
    ids = []
    for path in sorted(rules_dir.glob("*.json")):
        rule = json.loads(path.read_text(encoding="utf-8"))
        if rule.get("verification", {}).get("status") == "draft":
            ids.append(rule["rule_id"])
    return ids


def has_null_output(rule: dict) -> bool:
    out = rule.get("output", {})
    return out.get("type") in {"scalar", "boolean"} and out.get("value") is None


def apply_decision(
    rule_id: str, *, verified_by: str, reject: bool, reason: str | None, today: str
) -> str:
    path = find_rule_file(rule_id)
    if path is None:
        return f"  ! {rule_id}: no such rule file"
    rule = json.loads(path.read_text(encoding="utf-8"))
    status = rule["verification"]["status"]
    if status != "draft":
        return f"  = {rule_id}: already {status} — left unchanged"

    if not reject and has_null_output(rule):
        return f"  ! {rule_id}: output value is null — cannot verify (fix the draft first)"
    if verified_by.strip().lower() == DRAFT_METHOD:
        return f"  ! {rule_id}: --by must be a human verifier, not the draft method"

    rule["verification"]["status"] = "rejected" if reject else "verified"
    rule["verification"]["verified_by"] = verified_by
    rule["verification"]["verified_on"] = today
    if reject and reason:
        existing = rule.get("notes", "").strip()
        rule["notes"] = (existing + " " if existing else "") + f"[REJECTED {today}: {reason}]"
    path.write_text(json.dumps(rule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    verb = "rejected" if reject else "verified"
    return f"  {'x' if reject else '+'} {rule_id}: {verb}"


def apply_definition_decision(
    definition_id: str, *, verified_by: str, reject: bool, reason: str | None, today: str
) -> str:
    """Definitions follow the rule gate (spec §3.7.3): real text, a date it
    came into force, a person. A reworded clause whose amending notification
    has not been found stays undated — and so cannot be verified."""
    path = RULES_ROOT / "definitions" / f"{definition_id}.json"
    if not path.is_file():
        return f"  ! {definition_id}: no such definition file"
    d = json.loads(path.read_text(encoding="utf-8"))
    status = d["verification"]["status"]
    if status != "draft":
        return f"  = {definition_id}: already {status} — left unchanged"
    if verified_by.strip().lower() in DRAFT_METHODS:
        return f"  ! {definition_id}: --by must be a human verifier, not the draft method"
    if not reject:
        if not d["text"].get("original"):
            return f"  ! {definition_id}: no text — find the clause first"
        if not d.get("effective_from"):
            return f"  ! {definition_id}: no effective_from — find the notification that made this wording first"
        if not d["citations"] or not d["citations"][0].get("page"):
            return f"  ! {definition_id}: no cited page — cannot verify"

    d["verification"]["status"] = "rejected" if reject else "verified"
    d["verification"]["verified_by"] = verified_by
    d["verification"]["verified_on"] = today
    if reject and reason:
        existing = d.get("notes", "").strip()
        d["notes"] = (existing + " " if existing else "") + f"[REJECTED {today}: {reason}]"
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"  {'x' if reject else '+'} {definition_id}: {'rejected' if reject else 'verified'}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipeline.verify")
    parser.add_argument("--by", required=True, help="human verifier identity (name + reg no.)")
    parser.add_argument("--rule", action="append", default=[], help="rule_id to act on (repeatable)")
    parser.add_argument("--definition", action="append", default=[],
                        help="definition_id to act on (repeatable)")
    parser.add_argument("--dir", default=None, help="verify all draft rules in this rules/ subfolder")
    parser.add_argument("--except", dest="excluded", action="append", default=[],
                        help="with --dir: rule_id to hold back (repeatable)")
    parser.add_argument("--reject", action="store_true", help="mark as rejected instead of verified")
    parser.add_argument("--reason", default=None, help="rejection reason (with --reject)")
    args = parser.parse_args(argv)

    targets: list[str] = list(args.rule)
    if args.dir:
        rules_dir = (REPO_ROOT / args.dir).resolve()
        if not rules_dir.is_dir():
            print(f"error: {args.dir} is not a directory", file=sys.stderr)
            return 2
        excluded = set(args.excluded)
        targets += [rid for rid in list_draft_rule_ids(rules_dir) if rid not in excluded]
    if not targets and not args.definition:
        print("error: nothing to do — pass --rule, --definition and/or --dir", file=sys.stderr)
        return 2
    if args.reject and args.dir:
        print("error: --reject works with explicit --rule only, not --dir (too broad)", file=sys.stderr)
        return 2

    today = datetime.date.today().isoformat()
    seen: set[str] = set()
    changed = 0
    for rule_id in targets:
        if rule_id in seen:
            continue
        seen.add(rule_id)
        line = apply_decision(
            rule_id, verified_by=args.by, reject=args.reject, reason=args.reason, today=today
        )
        print(line)
        if line.strip().startswith(("+", "x")):
            changed += 1

    for definition_id in dict.fromkeys(args.definition):
        line = apply_definition_decision(
            definition_id, verified_by=args.by, reject=args.reject, reason=args.reason, today=today
        )
        print(line)
        if line.strip().startswith(("+", "x")):
            changed += 1

    print(f"\n{changed} file(s) {'rejected' if args.reject else 'verified'} by {args.by!r} on {today}.")
    print("Next: run `pnpm rules:validate` (authoritative gate), then commit.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
