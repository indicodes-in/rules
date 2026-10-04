"""Source watcher (accuracy layer 3: currency).

MPD-2047 was notified on 2026-08-20 and nothing in the repo noticed. This
checks the pages where the governing documents' changes are announced, lists
anything posted since the last review, and marks what looks like it could
touch the rules: master plan, bye-laws, building, gazette, residential.

It only announces. Deciding what a notice amends — "in para X, substitute…"
— is reading, not scraping: an extraction draft plus a person. Nothing here
changes a rule or a date.

Covered: pages that list their PDFs in plain HTML. NOT covered, because a
plain fetch sees no listing: the e-Gazette (a search form) and DDA's
MPD public-notice pages (built by script). Those stay a manual check.

Usage (from the repo root; standard library only):
    python -m pipeline.watch                 # report what is new
    python -m pipeline.watch --update        # after reviewing: mark all as seen
    python -m pipeline.watch --markdown out.md

State: sources/watch/seen.json (committed) — every link already reviewed.
Exits 2 when there is something new that looks relevant, so a scheduled job
can raise it; 3 when every source failed, so an outage is never "all quiet".
"""

import argparse
import html
import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin

REPO_ROOT = Path(__file__).resolve().parent.parent
SEEN_PATH = REPO_ROOT / "sources" / "watch" / "seen.json"

SOURCES = [
    {"id": "dda_public_notice", "name": "DDA — public notices", "url": "https://dda.gov.in/public_notice"},
    {"id": "dda_circulars", "name": "DDA — circulars", "url": "https://dda.gov.in/circulars"},
    {"id": "dda_orders", "name": "DDA — orders", "url": "https://dda.gov.in/orders"},
    {"id": "mcd_portal", "name": "MCD — portal notices and circulars", "url": "https://mcdonline.nic.in/portal/"},
]

# What could touch plotted-residential rules. Deliberately broad: a missed
# amendment is the failure this exists to prevent; a false alarm costs a look.
RELEVANT = re.compile(
    r"master\s*plan|\bmpd\b|bye[\s-]*laws?|building|gazette|\bs\.\s?o\.\s?\d|\bfar\b|"
    r"setback|plotted|residential|zonal\s+development|section\s*11",
    re.I,
)

USER_AGENT = "Indicodes source watcher (+https://www.indicodes.com)"


def _text(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


_ROW = re.compile(r"<tr\b.*?</tr>", re.S | re.I)
_PDF_LINK = re.compile(r"<a\b[^>]*href=\"([^\"]+\.pdf)\"[^>]*>(.*?)</a>", re.S | re.I)


def items(page: str, base_url: str) -> list[dict]:
    """Every PDF the page links, in page order, titled by its table row when
    it sits in one (DDA puts the title in a cell and "View" in the link)."""
    out: list[dict] = []
    seen: set[str] = set()

    def add(href: str, text: str):
        absolute = urljoin(base_url, html.unescape(href).strip())
        if absolute not in seen:
            seen.add(absolute)
            out.append({"href": absolute, "text": text or absolute.rsplit("/", 1)[-1]})

    for row in _ROW.findall(page):
        for href, _ in _PDF_LINK.findall(row):
            add(href, _text(row))
    for href, label in _PDF_LINK.findall(_ROW.sub("", page)):
        add(href, _text(label))
    return out


def relevant(item: dict) -> bool:
    return bool(RELEVANT.search(item["text"]) or RELEVANT.search(item["href"]))


def fetch_url(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode("utf-8", errors="replace")


def check(sources: list[dict], seen: dict, fetch: Callable[[str], str] = fetch_url) -> dict:
    report_sources = []
    flagged = []
    for src in sources:
        entry = {**src, "items": [], "new": [], "error": None}
        try:
            listed = items(fetch(src["url"]), src["url"])
        except Exception as err:  # one bad site must not hide the others
            entry["error"] = str(getattr(err, "reason", None) or err)
            report_sources.append(entry)
            continue
        if not listed:
            # A redesign or a block page would otherwise read as "nothing new".
            entry["error"] = "no links found — page changed or blocked?"
            report_sources.append(entry)
            continue
        known = set(seen.get(src["id"], []))
        entry["items"] = listed
        entry["new"] = [i for i in listed if i["href"] not in known]
        flagged += [{**i, "source": src["name"]} for i in entry["new"] if relevant(i)]
        report_sources.append(entry)
    return {"sources": report_sources, "relevant": flagged}


def load_seen(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def save_seen(path: Path, seen: dict, report: dict) -> None:
    """Mark everything currently listed as reviewed. Sources that failed keep
    their old state, so an outage never hides what it missed."""
    merged = {k: list(v) for k, v in seen.items()}
    for src in report["sources"]:
        if src["error"]:
            continue
        merged[src["id"]] = sorted(set(merged.get(src["id"], [])) | {i["href"] for i in src["items"]})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(merged, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def markdown(report: dict) -> str:
    lines = ["New notices that may touch the rules. Read each; if one amends MPD or the bye-laws, "
             "draft the change (pipeline.extract) and have it verified. Then run "
             "`python -m pipeline.watch --update` and commit `sources/watch/seen.json`.", ""]
    for i in report["relevant"]:
        lines.append(f"- **{i['source']}** — [{i['text'][:140]}]({i['href'].replace(' ', '%20')})")
    failed = [s for s in report["sources"] if s["error"]]
    if failed:
        lines += ["", "Not checked this time:"]
        lines += [f"- {s['name']}: {s['error']}" for s in failed]
    lines += ["", "Not watched by this job (check by hand): the e-Gazette search, and DDA's MPD "
              "public-notice pages, which a plain fetch cannot list."]
    return "\n".join(lines) + "\n"


def exit_code(report: dict) -> int:
    """3: every source failed (blind — must not read as quiet); 2: something
    relevant is new; 0: nothing new that matters."""
    if report["sources"] and all(s["error"] for s in report["sources"]):
        return 3
    return 2 if report["relevant"] else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--update", action="store_true", help="mark everything listed now as reviewed")
    ap.add_argument("--markdown", help="write the relevant-new list here (for an issue body)")
    args = ap.parse_args(argv)

    seen = load_seen(SEEN_PATH)
    report = check(SOURCES, seen)
    for s in report["sources"]:
        status = f"error: {s['error']}" if s["error"] else f"{len(s['items'])} listed, {len(s['new'])} new"
        print(f"{s['name']}: {status}")
    for i in report["relevant"]:
        print(f"  NEW  {i['source']}: {i['text'][:110]}\n       {i['href']}")
    if not seen:
        print("\nNo review state yet: everything reads as new. Review, then run with --update.")
    if args.markdown:
        Path(args.markdown).write_text(markdown(report), encoding="utf-8")
    if args.update:
        save_seen(SEEN_PATH, seen, report)
        print(f"Marked as reviewed → {SEEN_PATH.relative_to(REPO_ROOT)}")
        return 0
    return exit_code(report)


if __name__ == "__main__":
    sys.exit(main())
