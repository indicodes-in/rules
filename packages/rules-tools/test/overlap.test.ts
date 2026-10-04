import { describe, expect, it } from "vitest";
import { conditionsCanCooccur } from "../src/overlap.js";
import { crossFileChecks } from "../src/validate.js";
import { defaultOpts, makeRule } from "./helpers.js";

describe("conditionsCanCooccur", () => {
  it("adjacent between-bands do not overlap at the boundary ((lo, hi] semantics)", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
        [{ fact: "plot_area_sqm", op: "between", value: [250, 400] }],
      ),
    ).toBe(false);
  });

  it("lte at a band's lower edge does not overlap it ((lo, hi] excludes lo)", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "plot_area_sqm", op: "lte", value: 100 }],
        [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
      ),
    ).toBe(false);
  });

  it("gte at a band's upper edge DOES overlap it ((lo, hi] includes hi)", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "plot_area_sqm", op: "gte", value: 250 }],
        [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
      ),
    ).toBe(true);
  });

  it("lt boundary vs between starting at that boundary does not overlap", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "plot_area_sqm", op: "lt", value: 100 }],
        [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
      ),
    ).toBe(false);
  });

  it("unconditional rules always overlap", () => {
    expect(conditionsCanCooccur([], [])).toBe(true);
  });

  it("contradictory boolean facts do not overlap", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "is_corner_plot", op: "eq", value: true }],
        [{ fact: "is_corner_plot", op: "eq", value: false }],
      ),
    ).toBe(false);
  });

  it("constraints on different facts overlap (both satisfiable at once)", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "plot_area_sqm", op: "lt", value: 100 }],
        [{ fact: "road_width_m", op: "gte", value: 9 }],
      ),
    ).toBe(true);
  });

  it("eq point excluded by neq does not overlap", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "roads_abutting", op: "eq", value: 2 }],
        [{ fact: "roads_abutting", op: "neq", value: 2 }],
      ),
    ).toBe(false);
  });

  it("in-set intersected with a disjoint band does not overlap", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "roads_abutting", op: "in", value: [1, 2] }],
        [{ fact: "roads_abutting", op: "gte", value: 3 }],
      ),
    ).toBe(false);
    expect(
      conditionsCanCooccur(
        [{ fact: "roads_abutting", op: "in", value: [1, 2] }],
        [{ fact: "roads_abutting", op: "gte", value: 2 }],
      ),
    ).toBe(true);
  });

  it("treats unsupported value shapes as overlapping (conservative)", () => {
    expect(
      conditionsCanCooccur(
        [{ fact: "plot_area_sqm", op: "eq", value: "not_a_number" }],
        [{ fact: "plot_area_sqm", op: "lt", value: 10 }],
      ),
    ).toBe(true);
  });
});

describe("exactly-one-rule sweep (spec §5.2)", () => {
  const bandA = () =>
    makeRule({
      rule_id: "test_doc.res_plotted.far.band_a",
      conditions: [{ fact: "plot_area_sqm", op: "lte", value: 100 }],
    });

  it("flags two verified rules whose bands genuinely intersect", () => {
    const overlapping = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      // (50, 150] intersects bandA's ≤100 on (50, 100].
      conditions: [{ fact: "plot_area_sqm", op: "between", value: [50, 150] }],
    });
    const errors = crossFileChecks([bandA(), overlapping], defaultOpts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/exactly-one-rule/);
  });

  it("ignores draft rules in the sweep", () => {
    const draftOverlap = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      status: "draft",
      conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
    });
    expect(crossFileChecks([bandA(), draftOverlap], defaultOpts)).toEqual([]);
  });

  it("ignores rules for different parameters", () => {
    const otherParam = makeRule({
      rule_id: "test_doc.res_plotted.ground_coverage_pct.band_a",
      parameter: "ground_coverage_pct",
      output: { type: "scalar", value: 12, unit: "pct" },
      conditions: [{ fact: "plot_area_sqm", op: "lte", value: 100 }],
    });
    expect(crossFileChecks([bandA(), otherParam], defaultOpts)).toEqual([]);
  });

  it("allows identical applicability when effective windows are disjoint via supersession", () => {
    const v1 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a",
      effective_from: "2020-01-01",
      conditions: [{ fact: "plot_area_sqm", op: "lte", value: 100 }],
    });
    const v2 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a_v2",
      effective_from: "2022-01-01",
      supersedes: "test_doc.res_plotted.far.band_a",
      conditions: [{ fact: "plot_area_sqm", op: "lte", value: 100 }],
    });
    expect(crossFileChecks([v1, v2], defaultOpts)).toEqual([]);
  });

  it("flags identical applicability when windows overlap (no supersession)", () => {
    const v1 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a",
      conditions: [{ fact: "plot_area_sqm", op: "lte", value: 100 }],
    });
    const v2 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a_again",
      effective_from: "2021-01-01",
      conditions: [{ fact: "plot_area_sqm", op: "lte", value: 100 }],
    });
    const errors = crossFileChecks([v1, v2], defaultOpts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/exactly-one-rule/);
  });
});
