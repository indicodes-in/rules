import { describe, expect, it } from "vitest";
import { crossFileChecks } from "../src/validate.js";
import { defaultOpts, makeRule } from "./helpers.js";

describe("crossFileChecks", () => {
  it("passes a clean corpus", () => {
    const rules = [
      makeRule({
        rule_id: "test_doc.res_plotted.far.band_a",
        conditions: [{ fact: "plot_area_sqm", op: "lt", value: 100 }],
      }),
      makeRule({
        rule_id: "test_doc.res_plotted.far.band_b",
        conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
      }),
    ];
    expect(crossFileChecks(rules, defaultOpts)).toEqual([]);
  });

  it("flags rule_id ≠ filename", () => {
    const rules = [makeRule({ rule_id: "test_doc.res_plotted.far.band_a", fileStem: "other_name" })];
    const errors = crossFileChecks(rules, defaultOpts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/does not match filename/);
  });

  it("flags duplicate rule_ids", () => {
    const a = makeRule({ rule_id: "test_doc.res_plotted.far.band_a" });
    const b = makeRule({ rule_id: "test_doc.res_plotted.far.band_a" });
    b.filePath = "rules/test_doc/copy.json";
    const errors = crossFileChecks([a, b], defaultOpts);
    expect(errors.some((e) => e.includes("duplicate rule_id"))).toBe(true);
  });

  it("flags citations of unregistered documents", () => {
    const rules = [makeRule({ rule_id: "test_doc.res_plotted.far.band_a", doc_id: "ghost_doc" })];
    const errors = crossFileChecks(rules, defaultOpts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ghost_doc.*not registered/);
  });

  it("flags a supersedes target that does not exist", () => {
    const rules = [
      makeRule({ rule_id: "test_doc.res_plotted.far.band_a_v2", supersedes: "test_doc.res_plotted.far.band_a" }),
    ];
    const errors = crossFileChecks(rules, defaultOpts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/does not exist/);
  });

  it("flags supersession cycles", () => {
    const a = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a",
      supersedes: "test_doc.res_plotted.far.band_b",
      conditions: [{ fact: "plot_area_sqm", op: "lt", value: 100 }],
    });
    const b = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      supersedes: "test_doc.res_plotted.far.band_a",
      effective_from: "2021-01-01",
      conditions: [{ fact: "plot_area_sqm", op: "gte", value: 100 }],
    });
    const errors = crossFileChecks([a, b], defaultOpts);
    expect(errors.some((e) => e.includes("cycle"))).toBe(true);
  });

  it("flags an explicit effective_to overlapping the successor's effective_from", () => {
    const old = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a",
      effective_from: "2020-01-01",
      effective_to: "2022-06-01",
    });
    const next = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a_v2",
      effective_from: "2022-01-01",
      supersedes: "test_doc.res_plotted.far.band_a",
    });
    const errors = crossFileChecks([old, next], defaultOpts);
    expect(errors.some((e) => e.includes("overlapping this rule's effective_from"))).toBe(true);
  });

  it("flags a superseding rule that starts before the rule it supersedes", () => {
    const old = makeRule({ rule_id: "test_doc.res_plotted.far.band_a", effective_from: "2021-01-01" });
    const next = makeRule({
      rule_id: "test_doc.res_plotted.far.band_a_v2",
      effective_from: "2020-01-01",
      supersedes: "test_doc.res_plotted.far.band_a",
    });
    const errors = crossFileChecks([old, next], defaultOpts);
    expect(errors.some((e) => e.includes("precedes superseded rule"))).toBe(true);
  });

  it("flags unknown formula_ids", () => {
    const rules = [
      makeRule({
        rule_id: "test_doc.res_plotted.parking_ecs_per_100sqm.base",
        parameter: "parking_ecs_per_100sqm",
        output: { type: "formula", formula_id: "no_such_formula", params: { x: 1 } },
      }),
    ];
    const errors = crossFileChecks(rules, defaultOpts);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no_such_formula.*not in the engine formula registry/);
  });
});
