import { describe, expect, it } from "vitest";
import {
  EngineError,
  materializeEffectiveTo,
  resolveAll,
  resolveParameter,
} from "../src/resolver.js";
import { PARAMETERS, type ParcelFacts, type Rule, type RuleCondition } from "../src/types.js";

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
  supersedes?: string | null;
  status?: Rule["verification"]["status"];
  land_use?: string;
}): Rule {
  return {
    rule_id: overrides.rule_id,
    title: `SYNTHETIC — ${overrides.rule_id}`,
    parameter: overrides.parameter ?? "far",
    applicability: {
      land_use: overrides.land_use ?? "residential_plotted",
      authority: "DDA",
      conditions: overrides.conditions ?? [],
    },
    output: { type: "scalar", value: 123, unit: "far_x100" },
    effective_from: overrides.effective_from !== undefined ? overrides.effective_from : "2020-01-01",
    effective_to: overrides.effective_to !== undefined ? overrides.effective_to : null,
    supersedes: overrides.supersedes ?? null,
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

describe("resolveParameter — match cardinality (spec §5.2)", () => {
  it("resolves a single matching verified rule", () => {
    const rule = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
    });
    const outcome = resolveParameter("far", makeFacts(), [rule], DATE);
    expect(outcome).toEqual({ status: "resolved", rule });
  });

  it("flags no_applicable_rule when facts fall outside all bands — never extrapolates", () => {
    const rule = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
    });
    const outcome = resolveParameter("far", makeFacts({ plot_area_sqm: 9999 }), [rule], DATE);
    expect(outcome).toEqual({ status: "no_applicable_rule" });
  });

  it("flags rule_conflict with all matching rule ids — never tie-breaks silently", () => {
    const a = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
    });
    const b = makeRule({
      rule_id: "test_doc.res_plotted.far.band_all",
      conditions: [],
    });
    const outcome = resolveParameter("far", makeFacts(), [a, b], DATE);
    expect(outcome).toEqual({
      status: "rule_conflict",
      ruleIds: ["test_doc.res_plotted.far.band_all", "test_doc.res_plotted.far.band_b"],
    });
  });

  it("ignores rules for other parameters and other land uses", () => {
    const otherParam = makeRule({
      rule_id: "test_doc.res_plotted.max_height_m.base",
      parameter: "max_height_m",
    });
    const otherUse = makeRule({
      rule_id: "test_doc.other_use.far.base",
      land_use: "synthetic_other_use",
    });
    expect(resolveParameter("far", makeFacts(), [otherParam, otherUse], DATE)).toEqual({
      status: "no_applicable_rule",
    });
  });
});

describe("resolveParameter — effective-date selection", () => {
  const v1 = makeRule({
    rule_id: "test_doc.res_plotted.far.band_b",
    effective_from: "2020-01-01",
    effective_to: "2022-01-01",
  });
  const v2 = makeRule({
    rule_id: "test_doc.res_plotted.far.band_b_v2",
    effective_from: "2022-01-01",
    supersedes: "test_doc.res_plotted.far.band_b",
  });
  const ruleSet = [v1, v2];

  it("picks the version in force on the evaluation date", () => {
    expect(resolveParameter("far", makeFacts(), ruleSet, "2021-06-15")).toEqual({
      status: "resolved",
      rule: v1,
    });
    expect(resolveParameter("far", makeFacts(), ruleSet, "2023-01-01")).toEqual({
      status: "resolved",
      rule: v2,
    });
  });

  it("treats the boundary date as the successor's ([from, to) windows)", () => {
    expect(resolveParameter("far", makeFacts(), ruleSet, "2022-01-01")).toEqual({
      status: "resolved",
      rule: v2,
    });
  });

  it("finds nothing before the first version takes effect", () => {
    expect(resolveParameter("far", makeFacts(), ruleSet, "2019-12-31")).toEqual({
      status: "no_applicable_rule",
    });
  });

  it("rejects malformed evaluation dates", () => {
    expect(() => resolveParameter("far", makeFacts(), ruleSet, "01/06/2023")).toThrow(EngineError);
  });
});

describe("materializeEffectiveTo (loader dating, spec §3.5)", () => {
  it("closes a superseded rule's window at the successor's effective_from", () => {
    const v1 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      effective_from: "2020-01-01",
    });
    const v2 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b_v2",
      effective_from: "2022-01-01",
      supersedes: "test_doc.res_plotted.far.band_b",
    });
    const dated = materializeEffectiveTo([v1, v2]);
    expect(dated[0]!.effective_to).toBe("2022-01-01");
    expect(v1.effective_to).toBeNull(); // input not mutated

    // Without dating both versions match → conflict; with it, resolution is unambiguous.
    expect(resolveParameter("far", makeFacts(), [v1, v2], "2023-01-01").status).toBe(
      "rule_conflict",
    );
    expect(resolveParameter("far", makeFacts(), dated, "2023-01-01")).toMatchObject({
      status: "resolved",
      rule: { rule_id: "test_doc.res_plotted.far.band_b_v2" },
    });
  });

  it("keeps an explicit effective_to", () => {
    const v1 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      effective_to: "2021-07-01",
    });
    const v2 = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b_v2",
      effective_from: "2022-01-01",
      supersedes: "test_doc.res_plotted.far.band_b",
    });
    expect(materializeEffectiveTo([v1, v2])[0]!.effective_to).toBe("2021-07-01");
  });
});

describe("resolveParameter — draft exclusion (principle 4)", () => {
  const draft = makeRule({
    rule_id: "test_doc.res_plotted.far.band_b",
    status: "draft",
    effective_from: null,
    conditions: [{ fact: "plot_area_sqm", op: "between", value: [100, 250] }],
  });

  it("refuses draft rules by default", () => {
    expect(resolveParameter("far", makeFacts(), [draft], DATE)).toEqual({
      status: "no_applicable_rule",
    });
  });

  it("uses draft rules (incl. undated) only with allowDraft", () => {
    expect(resolveParameter("far", makeFacts(), [draft], DATE, { allowDraft: true })).toEqual({
      status: "resolved",
      rule: draft,
    });
  });

  it("never uses rejected rules, even with allowDraft", () => {
    const rejected = makeRule({
      rule_id: "test_doc.res_plotted.far.band_b",
      status: "rejected",
    });
    expect(resolveParameter("far", makeFacts(), [rejected], DATE, { allowDraft: true })).toEqual({
      status: "no_applicable_rule",
    });
  });
});

describe("condition semantics", () => {
  const band = (lo: number, hi: number): RuleCondition => ({
    fact: "plot_area_sqm",
    op: "between",
    value: [lo, hi],
  });

  it("between is exclusive-inclusive (lo, hi] at both boundaries — source tables read 'Above lo to hi'", () => {
    const rule = makeRule({ rule_id: "test_doc.res_plotted.far.band_b", conditions: [band(100, 250)] });
    expect(resolveParameter("far", makeFacts({ plot_area_sqm: 100 }), [rule], DATE).status).toBe(
      "no_applicable_rule",
    );
    expect(resolveParameter("far", makeFacts({ plot_area_sqm: 250 }), [rule], DATE).status).toBe(
      "resolved",
    );
  });

  it("adjacent bands assign a boundary plot to exactly one rule (the lower band, per 'to hi')", () => {
    const a = makeRule({ rule_id: "test_doc.res_plotted.far.band_a", conditions: [band(0, 100)] });
    const b = makeRule({ rule_id: "test_doc.res_plotted.far.band_b", conditions: [band(100, 250)] });
    expect(resolveParameter("far", makeFacts({ plot_area_sqm: 100 }), [a, b], DATE)).toMatchObject({
      status: "resolved",
      rule: { rule_id: "test_doc.res_plotted.far.band_a" },
    });
  });

  it("evaluates boolean eq, numeric comparisons, in, and neq", () => {
    const rule = makeRule({
      rule_id: "test_doc.res_plotted.far.corner_wide_road",
      conditions: [
        { fact: "is_corner_plot", op: "eq", value: true },
        { fact: "road_width_m", op: "gte", value: 9 },
        { fact: "roads_abutting", op: "in", value: [2, 3] },
        { fact: "basement_intended", op: "neq", value: true },
      ],
    });
    const matching = makeFacts({ is_corner_plot: true, roads_abutting: 2 });
    expect(resolveParameter("far", matching, [rule], DATE).status).toBe("resolved");
    expect(
      resolveParameter("far", { ...matching, road_width_m: 8.9 }, [rule], DATE).status,
    ).toBe("no_applicable_rule");
    expect(
      resolveParameter("far", { ...matching, basement_intended: true }, [rule], DATE).status,
    ).toBe("no_applicable_rule");
  });

  it("throws EngineError on malformed conditions (corpus bypassed validation)", () => {
    const rule = makeRule({
      rule_id: "test_doc.res_plotted.far.bad",
      conditions: [{ fact: "plot_area_sqm", op: "between", value: [100] }],
    });
    expect(() => resolveParameter("far", makeFacts(), [rule], DATE)).toThrow(EngineError);
  });
});

describe("resolveAll", () => {
  it("returns an outcome for every spec §3.1 parameter", () => {
    const outcomes = resolveAll(makeFacts(), [], DATE);
    expect(Object.keys(outcomes).sort()).toEqual([...PARAMETERS].sort());
    for (const parameter of PARAMETERS) {
      expect(outcomes[parameter]).toEqual({ status: "no_applicable_rule" });
    }
  });
});

/* Audit 2026-10-10 §06: edge cases reproduced against the public engine. */
describe("evaluation date is a real calendar date", () => {
  it.each(["2026-99-99", "2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-04-31"])(
    "rejects %s",
    (date) => {
      const rule = makeRule({ rule_id: "test_doc.res_plotted.far.any" });
      expect(() => resolveParameter("far", makeFacts(), [rule], date)).toThrow(EngineError);
    },
  );
  it("accepts a leap day in a leap year", () => {
    const rule = makeRule({ rule_id: "test_doc.res_plotted.far.any" });
    expect(resolveParameter("far", makeFacts(), [rule], "2024-02-29").status).toBe("resolved");
  });
});

describe("a successor the resolver cannot use does not end its predecessor", () => {
  const v1 = makeRule({ rule_id: "test_doc.res_plotted.far.band_c", effective_from: "2020-01-01" });
  const draftV2 = makeRule({
    rule_id: "test_doc.res_plotted.far.band_c_v2",
    effective_from: "2026-01-01",
    supersedes: "test_doc.res_plotted.far.band_c",
    status: "draft",
  });

  it("keeps the verified rule in force when its successor is only a draft", () => {
    const dated = materializeEffectiveTo([v1, draftV2]);
    expect(dated[0]!.effective_to).toBeNull();
    expect(resolveParameter("far", makeFacts(), dated, "2026-06-01")).toMatchObject({
      status: "resolved",
      rule: { rule_id: "test_doc.res_plotted.far.band_c" },
    });
  });

  it("lets a draft successor take over only where drafts are allowed", () => {
    const dated = materializeEffectiveTo([v1, draftV2], { allowDraft: true });
    expect(dated[0]!.effective_to).toBe("2026-01-01");
    expect(
      resolveParameter("far", makeFacts(), dated, "2026-06-01", { allowDraft: true }),
    ).toMatchObject({ status: "resolved", rule: { rule_id: "test_doc.res_plotted.far.band_c_v2" } });
  });

  it("never lets a rejected successor end anything", () => {
    const rejected = { ...draftV2, verification: { ...draftV2.verification, status: "rejected" as const } };
    expect(materializeEffectiveTo([v1, rejected], { allowDraft: true })[0]!.effective_to).toBeNull();
  });

  it("takes the earliest eligible successor when there are several", () => {
    const v2 = makeRule({ rule_id: "a_v2", effective_from: "2024-01-01", supersedes: "test_doc.res_plotted.far.band_c" });
    const v3 = makeRule({ rule_id: "a_v3", effective_from: "2023-01-01", supersedes: "test_doc.res_plotted.far.band_c", status: "draft" });
    expect(materializeEffectiveTo([v1, v2, v3])[0]!.effective_to).toBe("2024-01-01");
  });
});


/* Audit 2026-10-10 §02: the "newer document not yet read" warning belongs to
   the evaluation date — not to every evaluation, whenever it is dated. */
import { evaluatePlot } from "../src/evaluate.js";
describe("the currency warning follows the evaluation date", () => {
  const rule = makeRule({ rule_id: "test_doc.res_plotted.far.any" });
  const currency = {
    read_against: [{ doc_id: "old", label: "OLD-PLAN", note: null }],
    unread_successors: [
      { doc_id: "new", label: "NEW-PLAN", instrument: null, notified: "2026-08-20", rules_extracted: 0, note: null },
    ],
  };
  it("warns for a date on or after the successor was notified", () => {
    const r = evaluatePlot(makeFacts(), [rule], "2026-08-20", "v", { currency });
    expect(r.meta.currency?.unread_successors.map((u) => u.label)).toEqual(["NEW-PLAN"]);
  });
  it("does not warn for a date before it existed", () => {
    const r = evaluatePlot(makeFacts(), [rule], "2026-08-19", "v", { currency });
    expect(r.meta.currency).toBeUndefined();
  });
  it("keeps an undated successor, since it cannot be shown to come later", () => {
    const undated = { ...currency, unread_successors: [{ ...currency.unread_successors[0]!, notified: null }] };
    expect(evaluatePlot(makeFacts(), [rule], "2010-01-01", "v", { currency: undated }).meta.currency).toBeDefined();
  });
});
