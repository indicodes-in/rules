import { describe, expect, it } from "vitest";
import { evaluatePlot } from "../src/evaluate.js";
import type { PlotMinimum } from "../src/declarations.js";
import type { ParcelFacts } from "../src/types.js";

/* Synthetic facts and provisions — values fake by design (CLAUDE.md principle 3). */
const facts = (plot_area_sqm: number): ParcelFacts => ({
  plot_area_sqm, road_width_m: 9, roads_abutting: 1, is_corner_plot: false,
  land_use: "residential_plotted", authority: "DDA", stilt_parking: false, basement_intended: false, special_area_flags: [],
});
const provision = (min: number, status: "verified" | "draft", from = "2020-01-01", to: string | null = null): PlotMinimum => ({
  id: `test_doc.plot_minimum.${min}`,
  min_plot_area_sqm: min,
  effective_from: from,
  effective_to: to,
  exception: "a synthetic scheme may reduce it",
  citation: { doc_id: "test_doc", clause: "§min (synthetic)", page: 3, bbox: null, original_text: null, original_lang: "en", translated_text: null },
  verification: { status, verified_by: status === "verified" ? "test" : null, verified_on: null },
});

describe("plot minimum (BR-01)", () => {
  it("declines below the minimum, citing it and naming the exception", () => {
    const r = evaluatePlot(facts(20), [], "2026-10-15", "sha", { plotMinimums: [provision(32, "verified")] });
    expect(r.parameters).toEqual({});
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]).toMatchObject({ code: "below_minimum_plot", citations: [{ page: 3 }] });
    expect(r.flags[0]!.message).toMatch(/below the 32 m² minimum/);
    expect(r.flags[0]!.message).toMatch(/a synthetic scheme may reduce it/);
  });

  it("lets the minimum itself through", () => {
    const r = evaluatePlot(facts(32), [], "2026-10-15", "sha", { plotMinimums: [provision(32, "verified")] });
    expect(r.flags.some((f) => f.code === "below_minimum_plot")).toBe(false);
  });

  it("uses a draft only when drafts are allowed", () => {
    const draft = [provision(32, "draft")];
    expect(evaluatePlot(facts(20), [], "2026-10-15", "sha", { plotMinimums: draft }).flags.some((f) => f.code === "below_minimum_plot")).toBe(false);
    expect(evaluatePlot(facts(20), [], "2026-10-15", "sha", { plotMinimums: draft, allowDraft: true }).flags[0]?.code).toBe("below_minimum_plot");
  });

  it("follows the dates each provision governs", () => {
    const old = provision(32, "verified", "2007-01-01", "2026-08-19");
    expect(evaluatePlot(facts(20), [], "2026-10-15", "sha", { plotMinimums: [old] }).flags.some((f) => f.code === "below_minimum_plot")).toBe(false);
    expect(evaluatePlot(facts(20), [], "2020-01-01", "sha", { plotMinimums: [old] }).flags[0]?.code).toBe("below_minimum_plot");
  });
});
