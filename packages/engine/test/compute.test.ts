import { describe, expect, it } from "vitest";
import { computeDerived } from "../src/compute.js";
import type { ResolutionOutcome } from "../src/resolver.js";
import type { ParcelFacts, Parameter, Rule, RuleOutput } from "../src/types.js";

/** Synthetic values throughout (CLAUDE.md principle 3). */
function makeFacts(overrides: Partial<ParcelFacts> = {}): ParcelFacts {
  return {
    plot_area_sqm: 200,
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

function resolved(parameter: Parameter, ruleId: string, output: RuleOutput): ResolutionOutcome {
  const rule: Rule = {
    rule_id: ruleId,
    title: `SYNTHETIC — ${ruleId}`,
    parameter,
    applicability: { land_use: "residential_plotted", authority: "DDA", conditions: [] },
    output,
    effective_from: "2020-01-01",
    effective_to: null,
    supersedes: null,
    citations: [
      {
        doc_id: "test_doc",
        clause: `§${ruleId}`,
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
      verified_on: "2020-01-02",
      method: "manual_entry",
      confidence: null,
    },
    notes: "",
  };
  return { status: "resolved", rule };
}

const farOutcome = resolved("far", "test_doc.res_plotted.far.x", {
  type: "scalar",
  value: 150,
  unit: "far_x100",
});

describe("computeDerived (spec §5.3)", () => {
  it("derives buildable and coverage areas from resolved scalars", () => {
    const { derived, flags } = computeDerived(
      {
        far: farOutcome,
        ground_coverage_pct: resolved("ground_coverage_pct", "test_doc.res_plotted.ground_coverage_pct.x", {
          type: "scalar",
          value: 40,
          unit: "pct",
        }),
      },
      makeFacts(),
    );
    expect(flags).toEqual([]);
    expect(derived["buildable_area_sqm"]).toMatchObject({
      value: 300, // 200 × 150/100 — synthetic numbers
      unit: "sqm",
      derived_via: "buildable_area",
      input_rule_ids: ["test_doc.res_plotted.far.x"],
    });
    expect(derived["coverage_area_sqm"]?.value).toBe(80);
  });

  it("derives integer parking ECS from a formula rule, citing both inputs", () => {
    const { derived } = computeDerived(
      {
        far: farOutcome,
        parking_ecs_per_100sqm: resolved(
          "parking_ecs_per_100sqm",
          "test_doc.res_plotted.parking_ecs_per_100sqm.x",
          { type: "formula", formula_id: "ecs_per_bua", params: { ecs_per_100sqm: 1.33 } },
        ),
      },
      makeFacts(),
    );
    // buildable 300 → 300/100 × 1.33 = 3.99 → ceil 4
    expect(derived["parking_ecs"]).toMatchObject({ value: 4, unit: "count", derived_via: "ecs_per_bua" });
    expect(derived["parking_ecs"]?.input_rule_ids).toEqual([
      "test_doc.res_plotted.far.x",
      "test_doc.res_plotted.parking_ecs_per_100sqm.x",
    ]);
    expect(derived["parking_ecs"]?.citations).toHaveLength(2);
  });

  it("accepts a scalar ECS rate as well", () => {
    const { derived } = computeDerived(
      {
        far: farOutcome,
        parking_ecs_per_100sqm: resolved(
          "parking_ecs_per_100sqm",
          "test_doc.res_plotted.parking_ecs_per_100sqm.x",
          { type: "scalar", value: 2, unit: "ecs_per_100sqm" },
        ),
      },
      makeFacts(),
    );
    expect(derived["parking_ecs"]?.value).toBe(6);
  });

  it("flags parking when FAR is unresolved instead of guessing", () => {
    const { derived, flags } = computeDerived(
      {
        parking_ecs_per_100sqm: resolved(
          "parking_ecs_per_100sqm",
          "test_doc.res_plotted.parking_ecs_per_100sqm.x",
          { type: "formula", formula_id: "ecs_per_bua", params: { ecs_per_100sqm: 2 } },
        ),
      },
      makeFacts(),
    );
    expect(derived["parking_ecs"]).toBeUndefined();
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: "derived_inputs_unresolved", parameter: "parking_ecs_per_100sqm" });
  });

  it("flags unknown formulas", () => {
    const { flags } = computeDerived(
      {
        far: farOutcome,
        parking_ecs_per_100sqm: resolved(
          "parking_ecs_per_100sqm",
          "test_doc.res_plotted.parking_ecs_per_100sqm.x",
          { type: "formula", formula_id: "mystery_formula", params: { x: 1 } },
        ),
      },
      makeFacts(),
    );
    expect(flags[0]?.code).toBe("formula_not_implemented");
  });

  it("applies the stilt height bonus only when stilt parking is on", () => {
    const outcomes = {
      max_height_m: resolved("max_height_m", "test_doc.res_plotted.max_height_m.x", {
        type: "scalar",
        value: 15,
        unit: "m",
      }),
      stilt_height_bonus_m: resolved("stilt_height_bonus_m", "test_doc.res_plotted.stilt_height_bonus_m.x", {
        type: "scalar",
        value: 2.5,
        unit: "m",
      }),
    };
    const withStilt = computeDerived(outcomes, makeFacts({ stilt_parking: true }));
    expect(withStilt.derived["max_height_with_stilt_m"]).toMatchObject({
      value: 17.5,
      derived_via: "stilt_height_bonus",
    });
    expect(withStilt.derived["max_height_with_stilt_m"]?.citations).toHaveLength(2);

    const withoutStilt = computeDerived(outcomes, makeFacts({ stilt_parking: false }));
    expect(withoutStilt.derived["max_height_with_stilt_m"]).toBeUndefined();
  });

  it("derives nothing from an empty resolution", () => {
    const { derived, flags } = computeDerived({}, makeFacts());
    expect(derived).toEqual({});
    expect(flags).toEqual([]);
  });
});
