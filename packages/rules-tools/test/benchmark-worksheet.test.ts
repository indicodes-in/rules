import { describe, expect, it } from "vitest";
import { validateParcelFacts } from "@indicodes/engine";
import {
  WORKSHEET_PARAMETERS,
  buildCases,
  parseWorksheet,
  scenarios,
  worksheetCsv,
} from "../src/benchmark-worksheet.js";

/* The readers' side of the double-read benchmark: a blank sheet of plot
   scenarios each reader fills in from the documents alone, and an import
   that pairs two filled sheets into case files. */

describe("scenarios", () => {
  it("are stable, uniquely numbered and valid engine facts", () => {
    const list = scenarios();
    expect(scenarios()).toEqual(list);
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
    for (const s of list) expect(validateParcelFacts(s.facts).ok).toBe(true);
  });

  it("probe both sides of the band edges, where readings go wrong", () => {
    const areas = scenarios().map((s) => s.facts.plot_area_sqm);
    for (const edge of [100, 250, 300, 750, 1000]) {
      expect(areas).toContain(edge);
      expect(areas).toContain(edge + 1);
    }
  });
});

describe("worksheet", () => {
  it("carries no answers — only the scenario and blank columns", () => {
    const csv = worksheetCsv(scenarios());
    const [header, first] = csv.trim().split("\n");
    for (const p of WORKSHEET_PARAMETERS) expect(header).toContain(p.id);
    // Scenario columns are filled, every answer column is empty.
    const cells = first!.split(",");
    const blanks = cells.slice(-(WORKSHEET_PARAMETERS.length + 1));
    expect(blanks.every((c) => c === "")).toBe(true);
  });
});

/** A worksheet with one scenario row filled as a reader would. */
function filled(answers: Record<string, string>, notes = "") {
  const csv = worksheetCsv(scenarios().slice(0, 1));
  const [header, row] = csv.trim().split("\n");
  const cols = header!.split(",");
  const cells = row!.split(",");
  for (const [k, v] of Object.entries(answers)) cells[cols.indexOf(k)] = v;
  cells[cols.indexOf("notes")] = notes;
  return `${header}\n${cells.join(",")}\n`;
}

describe("parseWorksheet", () => {
  it("reads numbers, yes/no, 'unsettled', and leaves blanks out", () => {
    const sheet = parseWorksheet(
      filled({ far: "225", basement_permissibility: "yes", max_height_m: "unsettled" }, '"p.64, table"'),
    );
    const row = sheet.get(scenarios()[0]!.id)!;
    expect(row.values.far).toEqual({ value: 225, unit: "far_x100" });
    expect(row.values.basement_permissibility).toEqual({ value: true, unit: null });
    expect(row.values.max_height_m).toEqual({ value: null, unit: null });
    expect(row.values.ground_coverage_pct).toBeUndefined();
    expect(row.notes).toBe("p.64, table");
  });

  it("refuses a cell it cannot read rather than guessing", () => {
    expect(() => parseWorksheet(filled({ far: "about 2" }))).toThrow(/far.*about 2/);
  });
});

describe("buildCases", () => {
  it("pairs two readers' sheets into one blind double-read case per answered scenario", () => {
    const a = { reader: "reader_a", read_on: "2026-10-01", csv: filled({ far: "225" }) };
    const b = { reader: "reader_b", read_on: "2026-10-02", csv: filled({ far: "225" }) };
    const cases = buildCases([a, b], { as_of: "2026-08-19", blind: true });
    expect(cases).toHaveLength(1);
    const c = cases[0]!;
    expect(c.kind).toBe("double_read");
    expect(c.as_of).toBe("2026-08-19");
    expect(c.readings.map((r) => [r.reader, r.blind])).toEqual([
      ["reader_a", true],
      ["reader_b", true],
    ]);
    expect(c.facts).toEqual(scenarios()[0]!.facts);
  });

  it("skips scenarios nobody answered", () => {
    const blank = worksheetCsv(scenarios());
    const a = { reader: "reader_a", read_on: "2026-10-01", csv: blank };
    const b = { reader: "reader_b", read_on: "2026-10-01", csv: blank };
    expect(buildCases([a, b], { as_of: "2026-08-19", blind: true })).toEqual([]);
  });
});
