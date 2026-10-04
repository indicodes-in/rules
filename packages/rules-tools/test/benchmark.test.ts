import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Rule } from "@indicodes/engine";
import {
  loadCases,
  runBenchmark,
  type DoubleReadCase,
  type Reading,
  type SanctionedPlanCase,
} from "../src/benchmark.js";
import { loadDeclarations, loadRuleCorpus } from "../src/corpus.js";

/** Synthetic rule — values fake by design (CLAUDE.md principle 3). */
const farRule: Rule = {
  rule_id: "test_doc.res_plotted.far.band_b",
  title: "SYNTHETIC",
  parameter: "far",
  applicability: {
    land_use: "residential_plotted",
    authority: "DDA",
    conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
  },
  output: { type: "scalar", value: 123, unit: "far_x100" },
  effective_from: "2018-01-01",
  effective_to: null,
  supersedes: null,
  citations: [
    {
      doc_id: "test_doc",
      clause: "§0.0 (synthetic)",
      page: 1,
      bbox: null,
      original_text: null,
      original_lang: "en",
      translated_text: null,
    },
  ],
  verification: {
    status: "verified",
    verified_by: "test_verifier",
    verified_on: "2018-01-02",
    method: "manual_entry",
    confidence: null,
  },
  notes: "Synthetic test rule.",
};

const FACTS = {
  plot_area_sqm: 150,
  road_width_m: 9,
  roads_abutting: 1,
  is_corner_plot: false,
  land_use: "residential_plotted",
  authority: "DDA",
  stilt_parking: false,
  basement_intended: false,
  special_area_flags: [],
};

function reading(reader: string, values: Reading["values"], overrides: Partial<Reading> = {}): Reading {
  return { reader, read_on: "2026-10-01", blind: true, values, ...overrides };
}

/** Two blind readers who agree on FAR 123 — a real (non-synthetic) case. */
function doubleRead(overrides: Partial<DoubleReadCase> = {}): DoubleReadCase {
  const far = { value: 123, unit: "far_x100" };
  return {
    case_id: "case_dr_001",
    kind: "double_read",
    description: "plotted residential, band b",
    as_of: "2019-05-14",
    facts: FACTS,
    readings: [reading("reader_a", { far }), reading("reader_b", { far })],
    ...overrides,
  };
}

function sanctioned(overrides: Partial<SanctionedPlanCase> = {}): SanctionedPlanCase {
  return {
    case_id: "case_sp_001",
    kind: "sanctioned_plan",
    description: "anonymized sanctioned plan",
    sanction_date: "2019-05-14",
    facts: FACTS,
    expected: { far: { value: 123, unit: "far_x100" } },
    ...overrides,
  };
}

let tempDir: string | null = null;
afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("benchmark — blind double reading (the gate, spec §10)", () => {
  it("passes when the engine matches what both readers agree on", () => {
    const r = runBenchmark([doubleRead()], [farRule]).results[0]!;
    expect(r).toMatchObject({ passed: true, failures: [], checked: ["far"] });
  });

  it("fails when the engine differs from the agreed reading", () => {
    const far = { value: 999, unit: "far_x100" };
    const c = doubleRead({ readings: [reading("reader_a", { far }), reading("reader_b", { far })] });
    const r = runBenchmark([c], [farRule]).results[0]!;
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toContain("readers agree on 999, engine gives 123");
  });

  it("a parameter the readers disagree on is ambiguous, not a failure", () => {
    // Two competent readings that differ are the finding: the clause does not
    // settle it. That feeds the interpretations list; it tests nothing here.
    const c = doubleRead({
      readings: [
        reading("reader_a", { far: { value: 999, unit: "far_x100" } }),
        reading("reader_b", { far: { value: 123, unit: "far_x100" } }),
      ],
    });
    const r = runBenchmark([c], [farRule]).results[0]!;
    expect(r.passed).toBe(true);
    expect(r.checked).toEqual([]);
    expect(r.ambiguous[0]).toContain("far");
  });

  it("readers agreeing the documents do not settle it: the engine must decline too", () => {
    const unsettled = { value: null, unit: null };
    // In band: the engine answers 123 where both readers found no answer.
    const answered = doubleRead({
      readings: [reading("reader_a", { far: unsettled }), reading("reader_b", { far: unsettled })],
    });
    const r1 = runBenchmark([answered], [farRule]).results[0]!;
    expect(r1.passed).toBe(false);
    expect(r1.failures[0]).toContain("readers found this unsettled");
    // Out of band: the engine declines as well — agreement.
    const declined = doubleRead({
      facts: { ...FACTS, plot_area_sqm: 5000 },
      readings: [reading("reader_a", { far: unsettled }), reading("reader_b", { far: unsettled })],
    });
    expect(runBenchmark([declined], [farRule]).results[0]!.passed).toBe(true);
  });

  it("the engine declining where readers agree on a value is a gap, not a failure", () => {
    // Declining is the conservative behaviour; it is reported as coverage the
    // engine still lacks, never counted as a wrong answer.
    const c = doubleRead({ facts: { ...FACTS, plot_area_sqm: 5000 } });
    const r = runBenchmark([c], [farRule]).results[0]!;
    expect(r.passed).toBe(true);
    expect(r.declined[0]).toContain("far");
  });

  it("needs two independent, blind readers to count at all", () => {
    const far = { value: 123, unit: "far_x100" };
    const one = doubleRead({ readings: [reading("reader_a", { far })] });
    const same = doubleRead({ readings: [reading("reader_a", { far }), reading("reader_a", { far })] });
    const seen = doubleRead({
      readings: [reading("reader_a", { far }), reading("reader_b", { far }, { blind: false })],
    });
    for (const c of [one, same, seen]) {
      const r = runBenchmark([c], [farRule]).results[0]!;
      expect(r.passed).toBe(false);
      expect(r.failures[0]).toMatch(/two different readers|blind/);
    }
  });

  it("derived parameters are comparable too (buildable area)", () => {
    const area = { value: 184.5, unit: "sqm" }; // 150 × 123/100
    const c = doubleRead({
      readings: [reading("reader_a", { buildable_area_sqm: area }), reading("reader_b", { buildable_area_sqm: area })],
    });
    expect(runBenchmark([c], [farRule]).results[0]!.passed).toBe(true);
  });
});

describe("benchmark — sanctioned plans (supporting evidence only)", () => {
  it("reports agreement and disagreement but never decides the gate", () => {
    // An approval can depart from the code for reasons that are not the
    // code's, so a plan that disagrees is evidence to look at, not a verdict.
    const agreeing = sanctioned();
    const disagreeing = sanctioned({ case_id: "case_sp_002", expected: { far: { value: 999, unit: "far_x100" } } });
    const report = runBenchmark([agreeing, disagreeing], [farRule]);
    expect(report.sanctionedCases).toBe(2);
    expect(report.sanctionedAgreeing).toBe(1);
    expect(report.results[1]!.failures[0]).toContain("plan permits 999, engine gives 123");
    // Sanctioned plans alone can never pass the gate…
    expect(report.gatePassed).toBe(false);
    // …and a disagreeing plan never blocks it.
    expect(runBenchmark([doubleRead(), disagreeing], [farRule]).gatePassed).toBe(true);
  });
});

describe("benchmark — the gate", () => {
  it("never passes on synthetic-only or empty case sets", () => {
    expect(runBenchmark([doubleRead({ synthetic: true })], [farRule]).gatePassed).toBe(false);
    expect(runBenchmark([], [farRule]).gatePassed).toBe(false);
    expect(runBenchmark([doubleRead()], [farRule]).gatePassed).toBe(true);
  });

  it("one failing double-read case blocks it (100% required)", () => {
    const far = { value: 1, unit: "far_x100" };
    const failing = doubleRead({
      case_id: "case_dr_002",
      readings: [reading("reader_a", { far }), reading("reader_b", { far })],
    });
    expect(runBenchmark([doubleRead(), failing], [farRule]).gatePassed).toBe(false);
  });

  it("a case whose readers agree on nothing checks nothing and cannot carry the gate", () => {
    const c = doubleRead({
      readings: [
        reading("reader_a", { far: { value: 1, unit: "far_x100" } }),
        reading("reader_b", { far: { value: 2, unit: "far_x100" } }),
      ],
    });
    const report = runBenchmark([c], [farRule]);
    expect(report.checkedParameters).toBe(0);
    expect(report.gatePassed).toBe(false);
  });

  it("loads case_*.json files from a directory, sorted", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "indicodes-bench-"));
    writeFileSync(path.join(tempDir, "case_002.json"), JSON.stringify(doubleRead({ case_id: "b" })));
    writeFileSync(path.join(tempDir, "case_001.json"), JSON.stringify(sanctioned({ case_id: "a" })));
    writeFileSync(path.join(tempDir, "README.md"), "not a case");
    expect(loadCases(tempDir).map((c) => c.case_id)).toEqual(["a", "b"]);
    expect(loadCases(path.join(tempDir, "missing"))).toEqual([]);
  });
});

describe("benchmark — runs the rules as production does", () => {
  /* The harness evaluated without the corpus's own declarations, so where the
     live site withholds FAR (the next-lower-category minimum) the benchmark
     computed one — a reading could "pass" on a number no reader ever sees.
     Real corpus; the readers' value is a placeholder, never a regulatory one. */
  it("withholds FAR at 300 m² like /evaluate does, reporting a gap", () => {
    const rulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "rules");
    const far = { value: 1, unit: "far_x100" };
    const c = doubleRead({
      facts: { ...FACTS, plot_area_sqm: 300 },
      as_of: "2026-08-19",
      readings: [reading("reader_a", { far }), reading("reader_b", { far })],
    });
    const r = runBenchmark([c], loadRuleCorpus(rulesDir), loadDeclarations(rulesDir)).results[0]!;
    expect(r.failures).toEqual([]);
    expect(r.declined[0]).toContain("category_floor");
  });
});
