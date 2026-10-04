import { describe, expect, it } from "vitest";
import { validateParcelFacts } from "../src/facts.js";

/** Synthetic input — values fake by design. */
function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

describe("validateParcelFacts", () => {
  it("accepts complete, well-typed facts", () => {
    const result = validateParcelFacts(input());
    expect(result).toEqual({ ok: true, facts: input() });
  });

  it("rejects non-objects", () => {
    for (const bad of [null, 42, "facts", [input()]]) {
      const result = validateParcelFacts(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects unknown facts — the vocabulary is closed", () => {
    const result = validateParcelFacts(input({ plot_area_sq_m: 150 }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('unknown fact "plot_area_sq_m"'))).toBe(true);
    }
  });

  it("reports every missing fact by name", () => {
    const result = validateParcelFacts({});
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors).toHaveLength(9);
  });

  it("rejects out-of-range and mistyped values", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [input({ plot_area_sqm: 0 }), "plot_area_sqm"],
      [input({ plot_area_sqm: -10 }), "plot_area_sqm"],
      [input({ plot_area_sqm: Number.NaN }), "plot_area_sqm"],
      [input({ plot_area_sqm: "150" }), "plot_area_sqm"],
      [input({ road_width_m: -1 }), "road_width_m"],
      [input({ roads_abutting: 1.5 }), "roads_abutting"],
      [input({ roads_abutting: -1 }), "roads_abutting"],
      [input({ is_corner_plot: "no" }), "is_corner_plot"],
      [input({ land_use: "" }), "land_use"],
      [input({ authority: 7 }), "authority"],
      [input({ special_area_flags: "lbz" }), "special_area_flags"],
      [input({ special_area_flags: [1] }), "special_area_flags"],
    ];
    for (const [bad, field] of cases) {
      const result = validateParcelFacts(bad);
      expect(result.ok, `${field} should be rejected`).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes(field)), `error names ${field}`).toBe(true);
      }
    }
  });
});
