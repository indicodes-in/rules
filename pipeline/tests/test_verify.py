"""Tests for the human sign-off helper (pipeline.verify)."""

import json
from pathlib import Path

import pytest

import pipeline.verify as verify


def _draft(rule_id: str, value=1) -> dict:
    return {
        "rule_id": rule_id,
        "title": "SYNTHETIC",
        "parameter": "far",
        "applicability": {"land_use": "residential_plotted", "authority": "DDA", "conditions": []},
        "output": {"type": "scalar", "value": value, "unit": "far_x100"},
        "effective_from": "2020-01-01",
        "effective_to": None,
        "supersedes": None,
        "citations": [{
            "doc_id": "test_doc", "clause": "§0", "page": 1, "bbox": [0.1, 0.2, 0.9, 0.4],
            "original_text": "x", "original_lang": "en", "translated_text": None,
        }],
        "verification": {"status": "draft", "verified_by": None, "verified_on": None,
                         "method": "llm_extraction_v1", "confidence": 0.9},
        "notes": "",
    }


@pytest.fixture
def rules_env(tmp_path, monkeypatch):
    rules_root = tmp_path / "rules"
    sub = rules_root / "test_doc"
    sub.mkdir(parents=True)
    monkeypatch.setattr(verify, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(verify, "RULES_ROOT", rules_root)
    return sub


def _write(sub: Path, rule: dict) -> None:
    (sub / f"{rule['rule_id']}.json").write_text(json.dumps(rule), encoding="utf-8")


def _read(sub: Path, rule_id: str) -> dict:
    return json.loads((sub / f"{rule_id}.json").read_text(encoding="utf-8"))


def test_verify_specific_rule_stamps_identity_and_date(rules_env):
    _write(rules_env, _draft("test_doc.res_plotted.far.a"))
    assert verify.main(["--by", "Reviewer A", "--rule", "test_doc.res_plotted.far.a"]) == 0
    v = _read(rules_env, "test_doc.res_plotted.far.a")["verification"]
    assert v["status"] == "verified"
    assert v["verified_by"] == "Reviewer A"
    assert v["verified_on"]  # today's date stamped


def test_verify_dir_except_holds_back(rules_env):
    _write(rules_env, _draft("test_doc.res_plotted.far.a"))
    _write(rules_env, _draft("test_doc.res_plotted.far.b"))
    _write(rules_env, _draft("test_doc.res_plotted.far.c"))
    verify.main([
        "--by", "Reviewer A", "--dir", "rules/test_doc",
        "--except", "test_doc.res_plotted.far.b",
    ])
    assert _read(rules_env, "test_doc.res_plotted.far.a")["verification"]["status"] == "verified"
    assert _read(rules_env, "test_doc.res_plotted.far.b")["verification"]["status"] == "draft"
    assert _read(rules_env, "test_doc.res_plotted.far.c")["verification"]["status"] == "verified"


def test_refuses_to_verify_null_value(rules_env):
    _write(rules_env, _draft("test_doc.res_plotted.far.n", value=None))
    verify.main(["--by", "Reviewer A", "--rule", "test_doc.res_plotted.far.n"])
    assert _read(rules_env, "test_doc.res_plotted.far.n")["verification"]["status"] == "draft"


def test_reject_records_reason_in_notes(rules_env):
    _write(rules_env, _draft("test_doc.res_plotted.far.x"))
    verify.main([
        "--by", "Reviewer A", "--reject",
        "--rule", "test_doc.res_plotted.far.x", "--reason", "group-housing scope",
    ])
    rule = _read(rules_env, "test_doc.res_plotted.far.x")
    assert rule["verification"]["status"] == "rejected"
    assert "group-housing scope" in rule["notes"]


def test_already_verified_left_unchanged(rules_env):
    r = _draft("test_doc.res_plotted.far.v")
    r["verification"]["status"] = "verified"
    r["verification"]["verified_by"] = "Someone Else"
    _write(rules_env, r)
    verify.main(["--by", "Reviewer A", "--rule", "test_doc.res_plotted.far.v"])
    assert _read(rules_env, "test_doc.res_plotted.far.v")["verification"]["verified_by"] == "Someone Else"


def test_reject_with_dir_is_refused(rules_env):
    _write(rules_env, _draft("test_doc.res_plotted.far.a"))
    assert verify.main(["--by", "M", "--reject", "--dir", "rules/test_doc"]) == 2


def _definition(definition_id: str, **over) -> dict:
    d = {
        "definition_id": definition_id,
        "term": "widget",
        "applies_to": {"land_use": "residential_plotted", "authority": "DDA"},
        "text": {"original": "Widget: SYNTHETIC.", "original_lang": "en", "translated": None},
        "effective_from": "2016-01-01",
        "effective_to": None,
        "supersedes": None,
        "citations": [{
            "doc_id": "test_doc", "clause": "1.1", "page": 3, "bbox": None,
            "original_text": "Widget: SYNTHETIC.", "original_lang": "en", "translated_text": None,
        }],
        "verification": {"status": "draft", "verified_by": None, "verified_on": None,
                         "method": "pdf_text_extraction_v1", "confidence": None},
        "notes": "",
    }
    d.update(over)
    return d


@pytest.fixture
def defs_env(rules_env):
    d = rules_env.parent / "definitions"
    d.mkdir()
    return d


def _write_def(defs: Path, d: dict) -> None:
    (defs / f"{d['definition_id']}.json").write_text(json.dumps(d), encoding="utf-8")


def test_verify_definition_stamps_identity(defs_env):
    _write_def(defs_env, _definition("test_doc.widget"))
    assert verify.main(["--by", "Reviewer A", "--definition", "test_doc.widget"]) == 0
    v = json.loads((defs_env / "test_doc.widget.json").read_text(encoding="utf-8"))["verification"]
    assert (v["status"], v["verified_by"]) == ("verified", "Reviewer A")


def test_undated_definition_cannot_be_verified(defs_env, capsys):
    _write_def(defs_env, _definition("test_doc.widget", effective_from=None))
    verify.main(["--by", "Reviewer A", "--definition", "test_doc.widget"])
    assert "no effective_from" in capsys.readouterr().out
    v = json.loads((defs_env / "test_doc.widget.json").read_text(encoding="utf-8"))["verification"]
    assert v["status"] == "draft"


def test_definition_verifier_cannot_be_the_extractor(defs_env, capsys):
    _write_def(defs_env, _definition("test_doc.widget"))
    verify.main(["--by", "pdf_text_extraction_v1", "--definition", "test_doc.widget"])
    assert "human verifier" in capsys.readouterr().out
