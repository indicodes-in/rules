import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluatePlot as evaluate,
  PARAMETERS,
  validateParcelFacts,
  type PlotEvaluation as EvaluateResult,
  type Rule,
} from "@indicodes/engine";
import { loadDeclarations, loadRuleCorpus } from "../src/corpus.js";

/*
 * The logic sweep: the real, verified corpus run over thousands of plots,
 * checking properties that must hold for every one of them.
 *
 * Only properties the regulations or the product themselves guarantee. A
 * property that merely seems sensible (setbacks fitting inside the coverage,
 * say) is not the law's promise, and failing it would be a finding about the
 * rules, not a bug to "fix" here. No regulatory value appears in this file
 * (principle 3): every assertion compares the engine with itself.
 *
 * Same path as /evaluate: verified rules only, with the corpus declarations.
 */

const rulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "rules");
const ruleSet: Rule[] = loadRuleCorpus(rulesDir);
const declarations = loadDeclarations(rulesDir);
const DATE = "2026-09-01";

function run(area: number, opts: { stilt?: boolean; road?: number } = {}): EvaluateResult {
  const v = validateParcelFacts({
    plot_area_sqm: area,
    road_width_m: opts.road ?? 9,
    roads_abutting: 1,
    is_corner_plot: false,
    land_use: "residential_plotted",
    authority: "DDA",
    stilt_parking: opts.stilt ?? false,
    basement_intended: false,
    special_area_flags: [],
  });
  if (!v.ok) throw new Error(v.errors.join("; "));
  return evaluate(v.facts, ruleSet, DATE, "sweep", { ...declarations, allowDraft: false });
}

/** Every band edge in the corpus's plot-area conditions — where a reading of
 * "up to" against "above" decides the answer. Structure, not values. */
function bandEdges(): number[] {
  const edges = new Set<number>();
  for (const r of ruleSet) {
    for (const c of r.applicability.conditions ?? []) {
      if (c.fact !== "plot_area_sqm") continue;
      for (const v of [c.value].flat()) if (typeof v === "number") edges.add(v);
    }
  }
  return [...edges].sort((a, b) => a - b);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** 1 m² steps across the whole range, plus each edge and a hair either side. */
const AREAS = [
  ...new Set([
    ...Array.from({ length: 4000 }, (_, i) => i + 1),
    ...bandEdges().flatMap((e) => [e - 0.01, e, e + 0.01].map(round2)),
  ]),
]
  .filter((a) => a > 0)
  .sort((a, b) => a - b);

const SWEEP = AREAS.flatMap((area) =>
  [false, true].map((stilt) => ({ area, stilt, result: run(area, { stilt }) })),
);

const num = (r: EvaluateResult, p: string): number | null => {
  const v = r.parameters[p]?.value;
  return typeof v === "number" ? v : null;
};

/** Up to five offending examples, so a failure says where to look. */
function expectNone(violations: string[], what: string) {
  expect(violations.slice(0, 5), `${violations.length} plot(s) break "${what}"`).toEqual([]);
}

describe("logic sweep over the verified corpus", () => {
  it("covers the range densely, edges included", () => {
    expect(bandEdges().length).toBeGreaterThan(0);
    expect(SWEEP.length).toBeGreaterThan(8000);
  });

  it("every parameter is answered or explicitly declined — nothing falls through", () => {
    // Parking is a rate per built-up area; it is answered as the ECS count
    // computed from it (compute.ts), not as the bare rate.
    const answeredAs: Record<string, string> = { parking_ecs_per_100sqm: "parking_ecs" };
    const bad: string[] = [];
    for (const { area, stilt, result } of SWEEP) {
      for (const p of PARAMETERS) {
        if (result.parameters[p] || result.parameters[answeredAs[p] ?? ""]) continue;
        if (result.flags.some((f) => f.parameter === p)) continue;
        bad.push(`${area} m²${stilt ? " stilt" : ""}: ${p} neither answered nor flagged`);
      }
    }
    expectNone(bad, "answer or explicit decline");
  });

  /* MPD-2021 p.64 (ii): a plot may not get less coverage or FAR than the
     largest plot in the next lower category. So total floor area and total
     coverage area never fall as the plot grows — wherever the engine gives a
     figure. Where a row would undercut, it must decline instead. */
  for (const [param, label] of [
    ["buildable_area_sqm", "floor area never falls as the plot grows"],
    ["coverage_area_sqm", "coverage area never falls as the plot grows"],
  ] as const) {
    it(label, () => {
      const bad: string[] = [];
      for (const stilt of [false, true]) {
        let best: { area: number; value: number } | null = null;
        for (const s of SWEEP.filter((x) => x.stilt === stilt)) {
          const v = num(s.result, param);
          if (v === null) continue;
          if (best && v < best.value - 1e-9) {
            bad.push(`${s.area} m² gives ${round2(v)}, below ${round2(best.value)} at ${best.area} m²`);
          }
          if (!best || v > best.value) best = { area: s.area, value: v };
        }
      }
      expectNone(bad, label);
    });
  }

  it("has teeth: without the category minimum, floor area does fall", () => {
    /* The sweep would have caught the band-edge undercut before it was found
       by hand: served row by row, a plot just above an edge gets less floor
       area than the largest plot below it. Proves the check can fail. */
    let best = 0;
    let falls = 0;
    for (let area = 1; area <= 4000; area++) {
      const v = validateParcelFacts({
        plot_area_sqm: area, road_width_m: 9, roads_abutting: 1, is_corner_plot: false,
        land_use: "residential_plotted", authority: "DDA", stilt_parking: false,
        basement_intended: false, special_area_flags: [],
      });
      if (!v.ok) continue;
      const bare = evaluate(v.facts, ruleSet, DATE, "sweep", {
        notModelled: declarations.notModelled,
        allowDraft: false,
      });
      const floor = num(bare, "buildable_area_sqm");
      if (floor === null) continue;
      if (floor < best - 1e-9) falls++;
      best = Math.max(best, floor);
    }
    expect(falls).toBeGreaterThan(0);
  });

  it("height with stilt parking is never below height without", () => {
    const bad: string[] = [];
    for (let i = 0; i < SWEEP.length; i += 2) {
      const plain = SWEEP[i]!;
      const stilt = SWEEP[i + 1]!;
      const a = num(plain.result, "max_height_m");
      const b = num(stilt.result, "max_height_m");
      if (a !== null && b !== null && b < a) bad.push(`${plain.area} m²: ${b} with stilt < ${a} without`);
    }
    expectNone(bad, "stilt height ≥ plain height");
  });

  it("values stay in their domain", () => {
    const bad: string[] = [];
    for (const { area, stilt, result } of SWEEP) {
      const at = `${area} m²${stilt ? " stilt" : ""}`;
      const cov = num(result, "ground_coverage_pct");
      if (cov !== null && !(cov > 0 && cov <= 100)) bad.push(`${at}: coverage ${cov}%`);
      const far = num(result, "far");
      if (far !== null && !(far > 0)) bad.push(`${at}: FAR ${far}`);
      const du = num(result, "dwelling_units");
      if (du !== null && !(Number.isInteger(du) && du >= 1)) bad.push(`${at}: ${du} dwelling units`);
      for (const p of ["setback_front_m", "setback_rear_m", "setback_side_m", "max_height_m"]) {
        const v = num(result, p);
        if (v !== null && !(v >= 0)) bad.push(`${at}: ${p} ${v}`);
      }
      const footprint = num(result, "coverage_area_sqm");
      if (footprint !== null && footprint > area + 1e-9) bad.push(`${at}: coverage area ${footprint} > plot`);
    }
    expectNone(bad, "values in domain");
  });

  it("every value carries a citation (principle 2)", () => {
    const bad: string[] = [];
    for (const { area, stilt, result } of SWEEP) {
      for (const [p, v] of Object.entries(result.parameters)) {
        if (v.citations.length === 0) bad.push(`${area} m²${stilt ? " stilt" : ""}: ${p} uncited`);
      }
    }
    expectNone(bad, "cited");
  });

  it("the same plot always gets the same answer", () => {
    for (const area of [1, 99.99, 250, 250.01, 400, 1500, 3999]) {
      const strip = (r: EvaluateResult) => JSON.stringify({ p: r.parameters, f: r.flags });
      expect(strip(run(area))).toBe(strip(run(area)));
    }
  });
});
