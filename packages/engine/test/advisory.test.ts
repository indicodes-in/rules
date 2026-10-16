import { describe, expect, it } from "vitest";
import { evaluatePlot } from "../src/evaluate.js";
import type { ParcelFacts, Rule } from "../src/types.js";

/** Synthetic facts and rule — values are fake by design (CLAUDE.md principle 3). */
const facts = (plot_area_sqm: number): ParcelFacts => ({
  plot_area_sqm,
  road_width_m: 9,
  roads_abutting: 1,
  is_corner_plot: false,
  land_use: "residential_plotted",
  authority: "DDA",
  stilt_parking: false,
  basement_intended: false,
  special_area_flags: [],
});

const stiltRule: Rule = {
  rule_id: "test_doc.res_plotted.stilt_mandatory.band",
  title: "SYNTHETIC stilt requirement",
  parameter: "stilt_mandatory",
  applicability: {
    land_use: "residential_plotted",
    authority: "DDA",
    conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 750] }],
  },
  output: { type: "boolean", value: true },
  effective_from: "2020-01-01",
  effective_to: null,
  supersedes: null,
  citations: [
    { doc_id: "test_doc", clause: "§0 (synthetic)", page: 9, bbox: null, original_text: null, original_lang: "en", translated_text: null },
  ],
  verification: { status: "verified", verified_by: "test_verifier", verified_on: "2020-01-02", method: "manual_entry", confidence: null },
} as Rule;

describe("advisory parameters", () => {
  it("states a stilt requirement, cited, inside its band", () => {
    const r = evaluatePlot(facts(224), [stiltRule], "2026-10-15", "test_sha");
    expect(r.parameters.stilt_mandatory).toMatchObject({ value: true, citations: [{ page: 9 }] });
  });

  /* Outside the band the source imposes no requirement: saying "Not covered
     yet" there would cry wolf on every small or large plot. */
  it("says nothing where no rule imposes one", () => {
    const r = evaluatePlot(facts(80), [stiltRule], "2026-10-15", "test_sha");
    expect(r.parameters.stilt_mandatory).toBeUndefined();
    expect(r.flags.some((f) => f.parameter === "stilt_mandatory")).toBe(false);
  });
});
