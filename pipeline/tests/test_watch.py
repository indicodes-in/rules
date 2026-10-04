"""Tests for the source watcher (pipeline.watch). No network: pages are
injected as strings."""

import json

import pipeline.watch as watch

# Shaped like DDA's /public_notice: the title lives in the row, not the link.
PAGE = """
<table>
<tr><td>1</td><td>Public Notice : Master Plan Section (Advertisement)</td>
    <td><a href="/sites/default/files/public-notice/dda_master_plan_notice.pdf">View</a> Size: 900 KB</td></tr>
<tr><td>2</td><td>Auction of shops, Rohini</td>
    <td><a href="/sites/default/files/public-notice/auction_rohini.pdf">View</a></td></tr>
<tr><td>3</td><td>Notification: amendment to Unified Building Bye-Laws 2016</td>
    <td><a href="https://dda.gov.in/sites/default/files/public-notice/ubbl_amend.pdf">View</a></td></tr>
</table>
<a href="/sites/default/files/2025-07/pio_list_2025.pdf">PIO list</a>
"""

SOURCE = {"id": "dda_public_notice", "name": "DDA public notices", "url": "https://dda.gov.in/public_notice"}


def test_items_take_the_title_from_the_row_and_absolutise_links():
    items = watch.items(PAGE, SOURCE["url"])
    by_href = {i["href"]: i["text"] for i in items}
    href = "https://dda.gov.in/sites/default/files/public-notice/dda_master_plan_notice.pdf"
    assert "Master Plan Section" in by_href[href]
    # A PDF link outside any row is still an item, titled by its own text.
    assert by_href["https://dda.gov.in/sites/default/files/2025-07/pio_list_2025.pdf"] == "PIO list"
    assert len(items) == 4


def test_relevance_keeps_plan_and_bye_law_notices_and_drops_the_rest():
    items = {i["text"]: watch.relevant(i) for i in watch.items(PAGE, SOURCE["url"])}
    assert [t for t, r in items.items() if r] == [
        "1 Public Notice : Master Plan Section (Advertisement) View Size: 900 KB",
        "3 Notification: amendment to Unified Building Bye-Laws 2016 View",
    ]


def test_only_unseen_items_are_new():
    seen = {"dda_public_notice": ["https://dda.gov.in/sites/default/files/public-notice/dda_master_plan_notice.pdf"]}
    report = watch.check([SOURCE], seen, fetch=lambda url: PAGE)
    new = report["sources"][0]["new"]
    assert {i["href"].rsplit("/", 1)[-1] for i in new} == {"auction_rohini.pdf", "ubbl_amend.pdf", "pio_list_2025.pdf"}
    assert [i["href"].rsplit("/", 1)[-1] for i in report["relevant"]] == ["ubbl_amend.pdf"]


def test_a_failing_source_is_reported_not_fatal():
    def fetch(url):
        raise OSError("timed out")

    report = watch.check([SOURCE], {}, fetch=fetch)
    assert report["sources"][0]["error"] == "timed out"
    assert report["relevant"] == []


def test_update_records_everything_currently_listed(tmp_path):
    state = tmp_path / "seen.json"
    report = watch.check([SOURCE], {}, fetch=lambda url: PAGE)
    watch.save_seen(state, {}, report)
    saved = json.loads(state.read_text(encoding="utf-8"))
    assert len(saved["dda_public_notice"]) == 4
    # Nothing is new the second time round.
    again = watch.check([SOURCE], saved, fetch=lambda url: PAGE)
    assert again["sources"][0]["new"] == []


def test_a_page_that_suddenly_lists_nothing_is_flagged():
    # A redesign or a block page would otherwise read as "nothing new" forever.
    report = watch.check([SOURCE], {"dda_public_notice": ["x"]}, fetch=lambda url: "<html></html>")
    assert report["sources"][0]["error"] == "no links found — page changed or blocked?"


def test_exit_code_says_new_nothing_or_blind():
    ok = watch.check([SOURCE], {}, fetch=lambda url: PAGE)
    assert watch.exit_code(ok) == 2  # something relevant is new
    quiet = watch.check([SOURCE], {"dda_public_notice": [i["href"] for i in watch.items(PAGE, SOURCE["url"])]},
                        fetch=lambda url: PAGE)
    assert watch.exit_code(quiet) == 0
    # Every source failing must not read as "nothing new" — e.g. a site
    # blocking the scheduled runner's network.
    def down(url):
        raise OSError("403")
    assert watch.exit_code(watch.check([SOURCE], {}, fetch=down)) == 3
