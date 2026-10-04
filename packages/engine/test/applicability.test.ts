import { describe, expect, it } from "vitest";
import { findInapplicable } from "../src/applicability.js";
import type { ParcelFacts, Rule, RuleCondition } from "../src/types.js";

/** Synthetic facts — values are fake by design (CLAUDE.md principle 3). */
function makeFacts(overrides: Partial<ParcelFacts> = {}): ParcelFacts {
  return {
    plot_area_sqm: 150,
    road_width_m: 9,
    roads_abutting: 1,
    is_corner_plot: false,
    land_use: "residential_plotted",
    authority: "DDA",
    stilt_parking: false,
    basement_intended: false,
    special_area_flags: [],
    ...overrides,
  };
}

/** Synthetic rule builder, verified by default. */
function makeRule(overrides: {
  rule_id: string;
  parameter?: Rule["parameter"];
  conditions?: RuleCondition[];
  effective_from?: string | null;
  effective_to?: string | null;
  status?: Rule["verification"]["status"];
}): Rule {
  return {
    rule_id: overrides.rule_id,
    title: `SYNTHETIC — ${overrides.rule_id}`,
    parameter: overrides.parameter ?? "far",
    applicability: {
      land_use: "residential_plotted",
      authority: "DDA",
      conditions: overrides.conditions ?? [],
    },
    output: { type: "scalar", value: 123, unit: "far_x100" },
    effective_from: overrides.effective_from !== undefined ? overrides.effective_from : "2020-01-01",
    effective_to: overrides.effective_to !== undefined ? overrides.effective_to : null,
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
      status: overrides.status ?? "verified",
      verified_by: overrides.status === "draft" ? null : "test_verifier",
      verified_on: overrides.status === "draft" ? null : "2020-01-02",
      method: "manual_entry",
      confidence: overrides.status === "draft" ? 0.9 : null,
    },
    notes: "Synthetic test rule — never regulatory truth.",
  };
}

const DATE = "2023-06-01";
const stilt = (): RuleCondition[] => [{ fact: "stilt_parking", op: "eq", value: true }];

describe("findInapplicable — 'does not apply' vs 'we are missing it'", () => {
  it("names the fact when every rule is gated on it", () => {
    const rules = [
      makeRule({ rule_id: "d.a", conditions: stilt() }),
      makeRule({ rule_id: "d.b", conditions: stilt() }),
    ];
    const na = findInapplicable("far", makeFacts({ stilt_parking: false }), rules, DATE);
    expect(na).toEqual({
      fact: "stilt_parking",
      actual: false,
      required: true,
      rule_ids: ["d.a", "d.b"],
    });
  });

  it("stays silent when the fact is satisfied — the parameter does apply", () => {
    const rules = [makeRule({ rule_id: "d.a", conditions: stilt() })];
    expect(findInapplicable("far", makeFacts({ stilt_parking: true }), rules, DATE)).toBeNull();
  });

  it("stays silent when there are no rules at all — that is a corpus gap, not a scope one", () => {
    expect(findInapplicable("far", makeFacts(), [], DATE)).toBeNull();
  });

  it("stays silent when rules disagree about which fact excludes the plot", () => {
    const rules = [
      makeRule({ rule_id: "d.a", conditions: stilt() }),
      makeRule({
        rule_id: "d.b",
        conditions: [{ fact: "basement_intended", op: "eq", value: true }],
      }),
    ];
    // "It does not apply because X" is not a sentence we can honestly write here.
    expect(findInapplicable("far", makeFacts(), rules, DATE)).toBeNull();
  });

  it("stays silent for a band miss — that is gaps.ts's question, not this one", () => {
    const rules = [
      makeRule({
        rule_id: "d.a",
        conditions: [{ fact: "plot_area_sqm", op: "between", value: [1000, 2000] }],
      }),
    ];
    expect(findInapplicable("far", makeFacts({ plot_area_sqm: 150 }), rules, DATE)).toBeNull();
  });

  it("ignores rules that are not in force on the evaluation date", () => {
    const rules = [
      makeRule({ rule_id: "d.a", conditions: stilt(), effective_to: "2021-01-01" }),
    ];
    expect(findInapplicable("far", makeFacts(), rules, DATE)).toBeNull();
  });

  it("ignores draft rules unless draft is allowed (principle 4)", () => {
    const rules = [makeRule({ rule_id: "d.a", conditions: stilt(), status: "draft" })];
    expect(findInapplicable("far", makeFacts(), rules, DATE)).toBeNull();
    expect(findInapplicable("far", makeFacts(), rules, DATE, { allowDraft: true })).not.toBeNull();
  });
});
