"""Tests for the second read (pipeline.crosscheck).

Every fixture PDF is synthetic, built here with PyMuPDF — no real document
and no real regulatory value (CLAUDE.md principle 3).
"""

import hashlib
import json
from pathlib import Path

import fitz
import pytest

import pipeline.crosscheck as crosscheck

ROW = "4 Above 111 to 222 33 444 5"


@pytest.fixture
def pdf(tmp_path: Path) -> Path:
    """One page: a table row near the top, an unrelated number far below."""
    doc = fitz.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((60, 100), ROW, fontsize=11)
    page.insert_text((60, 700), "Height 999 m", fontsize=11)
    path = tmp_path / "test_doc.pdf"
    doc.save(path)
    return path


# The row sits around y = 100 of 800 → roughly 0.11–0.13 normalized.
ROW_BBOX = [0.08, 0.10, 0.9, 0.135]


def _rule(value=444, unit="far_x100", bbox=None, quote=ROW, band=(111, 222), rule_id="test_doc.far.b"):
    return {
        "rule_id": rule_id,
        "parameter": "far",
        "applicability": {
            "land_use": "residential_plotted",
            "authority": "DDA",
            "conditions": [{"fact": "plot_area_sqm", "op": "between", "value": list(band)}],
        },
        "output": {"type": "scalar", "value": value, "unit": unit},
        "citations": [{
            "doc_id": "test_doc", "clause": "§0", "page": 1,
            "bbox": ROW_BBOX if bbox is None else bbox,
            "original_text": quote, "original_lang": "en", "translated_text": None,
        }],
        "verification": {"status": "draft"},
    }


def _check(rule, pdf_path):
    doc = fitz.open(pdf_path)
    return crosscheck.check_rule(rule, lambda doc_id: doc if doc_id == "test_doc" else None)


def test_value_quote_and_band_found_in_the_cited_region(pdf):
    result = _check(_rule(), pdf)
    assert result["status"] == "ok", result


def test_a_value_not_in_the_region_is_flagged(pdf):
    result = _check(_rule(value=445), pdf)
    assert result["status"] == "value_not_in_region"
    assert "445" in result["detail"]


def test_the_region_matters_not_the_page(pdf):
    # 999 is on the page, but not inside the cited box: a second read that
    # searched the whole page would pass the wrong row.
    result = _check(_rule(value=999, unit="m"), pdf)
    assert result["status"] == "value_not_in_region"


def test_a_quote_the_region_does_not_contain_is_flagged(pdf):
    result = _check(_rule(quote="4 Above 111 to 222 33 777 5"), pdf)
    assert result["status"] == "quote_not_in_region"


def test_band_numbers_missing_from_the_region_are_a_warning(pdf):
    # The row is right but the band came from somewhere else — worth a look,
    # not a mismatch (bands are often implied by the neighbouring row).
    result = _check(_rule(band=(111, 300)), pdf)
    assert result["status"] == "band_not_in_region"
    assert "300" in result["detail"]


def test_far_x100_accepts_the_ratio_form(tmp_path):
    doc = fitz.open()
    doc.new_page(width=600, height=800).insert_text((60, 100), "FAR 4.44 for plots 111 to 222", fontsize=11)
    path = tmp_path / "ratio.pdf"
    doc.save(path)
    rule = _rule(quote="FAR 4.44 for plots 111 to 222")
    assert _check(rule, path)["status"] == "ok"


def test_a_page_without_a_text_layer_is_unchecked_not_passed(tmp_path):
    doc = fitz.open()
    doc.new_page(width=600, height=800)  # blank: no text layer, like a scan
    path = tmp_path / "scan.pdf"
    doc.save(path)
    assert _check(_rule(), path)["status"] == "no_text_layer"


def test_a_citation_without_page_or_box_is_uncheckable(pdf):
    rule = _rule()
    rule["citations"][0]["bbox"] = None
    assert _check(rule, pdf)["status"] == "uncheckable"


def test_source_hash_mismatch_is_caught(pdf, tmp_path):
    good = hashlib.sha256(pdf.read_bytes()).hexdigest()
    registry = {"documents": [
        {"doc_id": "test_doc", "file_hash": good, "storage_url": "x"},
        {"doc_id": "other", "file_hash": "0" * 64, "storage_url": "x"},
    ]}
    other = tmp_path / "other.pdf"
    other.write_bytes(pdf.read_bytes())
    status = crosscheck.check_sources(registry, tmp_path)
    assert status["test_doc"] == "ok"
    assert status["other"] == "hash_mismatch"


def test_run_reports_and_fails_on_mismatch(pdf, tmp_path):
    rules_dir = tmp_path / "rules" / "test_doc"
    rules_dir.mkdir(parents=True)
    (rules_dir / "a.json").write_text(json.dumps(_rule(rule_id="a")), encoding="utf-8")
    (rules_dir / "b.json").write_text(json.dumps(_rule(value=445, rule_id="b")), encoding="utf-8")
    registry = {"documents": [
        {"doc_id": "test_doc", "file_hash": hashlib.sha256(pdf.read_bytes()).hexdigest(), "storage_url": "x"},
    ]}
    report = crosscheck.run([rules_dir], registry, pdf.parent)
    by_id = {r["rule_id"]: r["status"] for r in report["rules"]}
    assert by_id == {"a": "ok", "b": "value_not_in_region"}
    assert report["mismatches"] == 1


def _one_line_pdf(tmp_path: Path, text: str) -> Path:
    doc = fitz.open()
    doc.new_page(width=600, height=800).insert_text((60, 100), text, fontsize=11)
    path = tmp_path / "line.pdf"
    doc.save(path)
    return path


def test_spacing_differences_in_the_quote_are_not_a_mismatch(tmp_path):
    # The text layer glues "height(less"; the drafted quote says "height (less".
    path = _one_line_pdf(tmp_path, "Row 111 to 222: FAR 444, height(less than 5 m)")
    rule = _rule(quote="Row 111 to 222: FAR 444, height (less than 5 m)")
    assert _check(rule, path)["status"] == "ok"


def test_an_ellipsis_in_the_quote_skips_text(tmp_path):
    path = _one_line_pdf(tmp_path, "Plots 111 to 222 get FAR 444 (subject to note 3) in all cases")
    rule = _rule(quote="Plots 111 to 222 get FAR 444 ... in all cases")
    assert _check(rule, path)["status"] == "ok"
    # …but the pieces must still be there, in order.
    rule = _rule(quote="Plots 111 to 222 get FAR 444 ... in no case")
    assert _check(rule, path)["status"] == "quote_not_in_region"


def test_a_value_from_the_wrong_column_is_caught_by_the_other_rows(tmp_path):
    """Three table rows, coverage column then FAR column. The rules for row 3
    swap them — each number IS printed in its row, so the per-rule read
    passes; only the column order, against the other two rows, gives it away."""
    doc = fitz.open()
    page = doc.new_page(width=600, height=800)
    rows = ["1 Above 10 to 20 30 400 5", "2 Above 20 to 40 31 410 6", "3 Above 40 to 60 32 420 7"]
    for i, text in enumerate(rows):
        page.insert_text((60, 100 + 40 * i), text, fontsize=11)
    path = tmp_path / "test_doc.pdf"
    doc.save(path)

    def rule(rid, param, value, unit, band, row):
        top = (100 + 40 * row - 12) / 800
        r = _rule(value=value, unit=unit, band=band, rule_id=rid, quote=None,
                  bbox=[0.08, top, 0.9, top + 0.025])
        r["parameter"] = param
        r["citations"][0]["clause"] = "table"
        return r

    rules_dir = tmp_path / "rules" / "test_doc"
    rules_dir.mkdir(parents=True)
    specs = [
        ("c1", "ground_coverage_pct", 30, "pct", (10, 20), 0), ("f1", "far", 400, "far_x100", (10, 20), 0),
        ("c2", "ground_coverage_pct", 31, "pct", (20, 40), 1), ("f2", "far", 410, "far_x100", (20, 40), 1),
        # Row 3 misread: coverage took the FAR column and vice versa.
        ("c3", "ground_coverage_pct", 420, "pct", (40, 60), 2), ("f3", "far", 32, "far_x100", (40, 60), 2),
    ]
    for spec in specs:
        (rules_dir / f"{spec[0]}.json").write_text(json.dumps(rule(*spec)), encoding="utf-8")
    registry = {"documents": [
        {"doc_id": "test_doc", "file_hash": hashlib.sha256(path.read_bytes()).hexdigest(), "storage_url": "x"},
    ]}
    report = crosscheck.run([rules_dir], registry, tmp_path)
    by_id = {r["rule_id"]: r["status"] for r in report["rules"]}
    assert by_id["c3"] == by_id["f3"] == "column_out_of_line"
    assert {by_id[k] for k in ("c1", "f1", "c2", "f2")} == {"ok"}
