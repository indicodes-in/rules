/**
 * The readers' side of the double-read benchmark (spec §10).
 *
 * Readers are architects working from the documents, not engineers, so they
 * get a spreadsheet: one row per plot scenario, blank columns for what the
 * regulations permit. Nothing on the sheet comes from the engine — a reader
 * who can see our answer is checking it, not reading the code. Two filled
 * sheets are then paired into case files by `pnpm benchmark:import`.
 *
 * Scenarios lean on the band edges on purpose: that is where "up to" and
 * "above" get read differently, and where the next-lower-category minimum
 * bites. The areas are the corpus's band boundaries — structure, not answers.
 */

import type { DoubleReadCase, Reading, Values } from "./benchmark.js";

export interface WorksheetParameter {
  id: string;
  unit: string | null;
  kind: "number" | "boolean";
  /** Column hint for the reader. */
  hint: string;
}

/** What a reader is asked for. Parking is left out: it is a rate per built-up
 * area, which needs a design, not just a plot. */
export const WORKSHEET_PARAMETERS: readonly WorksheetParameter[] = [
  { id: "far", unit: "far_x100", kind: "number", hint: "FAR x100 (225 = FAR 2.25)" },
  { id: "ground_coverage_pct", unit: "pct", kind: "number", hint: "max ground coverage %" },
  { id: "max_height_m", unit: "m", kind: "number", hint: "max height, m" },
  { id: "setback_front_m", unit: "m", kind: "number", hint: "front setback, m" },
  { id: "setback_rear_m", unit: "m", kind: "number", hint: "rear setback, m" },
  { id: "setback_side_m", unit: "m", kind: "number", hint: "side setback, m" },
  { id: "dwelling_units", unit: "count", kind: "number", hint: "max dwelling units" },
  { id: "basement_permissibility", unit: null, kind: "boolean", hint: "basement allowed: yes/no" },
];

export interface Scenario {
  id: string;
  facts: {
    plot_area_sqm: number;
    road_width_m: number;
    roads_abutting: number;
    is_corner_plot: boolean;
    land_use: "residential_plotted";
    authority: "DDA";
    stilt_parking: boolean;
    basement_intended: boolean;
    special_area_flags: string[];
  };
}

const SCENARIO_COLUMNS = [
  "scenario",
  "plot_area_sqm",
  "road_width_m",
  "roads_abutting",
  "corner_plot",
  "stilt_parking",
  "basement_intended",
] as const;

/**
 * The fixed scenario list, most common plots first so a reader with an hour
 * covers the plots people actually have; then each band edge and the metre
 * above it; then road width, stilt and corner variations, which test whether
 * a reader finds a condition the corpus does not model.
 */
export function scenarios(): Scenario[] {
  type Row = [number, number?, { stilt?: boolean; corner?: boolean }?];
  const rows: Row[] = [
    // Common plots, 9 m road, no stilt.
    [75], [175], [400], [600], [875], [1250],
    // Band edges and the metre above.
    [100], [101], [250], [251], [300], [301], [500], [501], [750], [751],
    [1000], [1001], [1500], [1501], [2250], [2251], [3000], [3001], [3750], [3751],
    // Stilt parking.
    [175, 9, { stilt: true }], [400, 9, { stilt: true }], [875, 12, { stilt: true }],
    // Road width.
    [400, 12], [400, 18], [875, 24],
    // Corner plot on two roads.
    [400, 12, { corner: true }],
  ];
  return rows.map(([area, road = 9, opts = {}], i) => ({
    id: `s${String(i + 1).padStart(2, "0")}`,
    facts: {
      plot_area_sqm: area,
      road_width_m: road,
      roads_abutting: opts.corner ? 2 : 1,
      is_corner_plot: opts.corner ?? false,
      land_use: "residential_plotted",
      authority: "DDA",
      stilt_parking: opts.stilt ?? false,
      basement_intended: false,
      special_area_flags: [],
    },
  }));
}

const yesNo = (b: boolean) => (b ? "yes" : "no");

/** A blank sheet: scenario columns filled, answer columns and notes empty. */
export function worksheetCsv(list: Scenario[]): string {
  const header = [...SCENARIO_COLUMNS, ...WORKSHEET_PARAMETERS.map((p) => p.id), "notes"];
  const lines = [header.join(",")];
  for (const s of list) {
    const f = s.facts;
    lines.push(
      [
        s.id,
        f.plot_area_sqm,
        f.road_width_m,
        f.roads_abutting,
        yesNo(f.is_corner_plot),
        yesNo(f.stilt_parking),
        yesNo(f.basement_intended),
        ...WORKSHEET_PARAMETERS.map(() => ""),
        "",
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Minimal CSV: commas, and double-quoted fields (notes quote clauses). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const UNSETTLED = new Set(["unsettled", "?", "unclear"]);

function readCell(p: WorksheetParameter, raw: string, where: string): Values[string] | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "") return undefined;
  if (UNSETTLED.has(v)) return { value: null, unit: null };
  if (p.kind === "boolean") {
    if (v === "yes" || v === "y") return { value: true, unit: null };
    if (v === "no" || v === "n") return { value: false, unit: null };
  } else if (/^-?\d+(\.\d+)?$/.test(v)) {
    return { value: Number(v), unit: p.unit };
  }
  throw new Error(`${where} ${p.id}: cannot read "${raw.trim()}" — use a number, yes/no, or "unsettled"`);
}

export interface SheetRow {
  values: Values;
  notes: string;
}

/** A filled sheet, by scenario id. Rows with no answers are kept, empty. */
export function parseWorksheet(csv: string): Map<string, SheetRow> {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return new Map();
  const col = (name: string) => header.indexOf(name);
  const out = new Map<string, SheetRow>();
  for (const cells of rows) {
    const id = cells[col("scenario")]?.trim();
    if (!id) continue;
    const values: Values = {};
    for (const p of WORKSHEET_PARAMETERS) {
      const i = col(p.id);
      if (i === -1) continue;
      const read = readCell(p, cells[i] ?? "", `scenario ${id}`);
      if (read) values[p.id] = read;
    }
    out.set(id, { values, notes: (cells[col("notes")] ?? "").trim() });
  }
  return out;
}

export interface FilledSheet {
  reader: string;
  read_on: string;
  csv: string;
}

/**
 * One case per scenario that at least one reader answered. `blind` is the
 * importer's attestation that neither reader saw the engine's answers or the
 * other reading — the benchmark refuses cases without it.
 */
export function buildCases(
  sheets: FilledSheet[],
  opts: { as_of: string; blind: boolean },
): DoubleReadCase[] {
  const parsed = sheets.map((s) => ({ ...s, rows: parseWorksheet(s.csv) }));
  const cases: DoubleReadCase[] = [];
  for (const scenario of scenarios()) {
    const readings: Reading[] = [];
    const notes: string[] = [];
    for (const s of parsed) {
      const row = s.rows.get(scenario.id);
      if (!row || Object.keys(row.values).length === 0) continue;
      readings.push({ reader: s.reader, read_on: s.read_on, blind: opts.blind, values: row.values });
      if (row.notes) notes.push(`${s.reader}: ${row.notes}`);
    }
    if (readings.length === 0) continue;
    const f = scenario.facts;
    cases.push({
      case_id: `case_dr_${scenario.id}`,
      kind: "double_read",
      description:
        `Double read, scenario ${scenario.id}: ${f.plot_area_sqm} m², ${f.road_width_m} m road` +
        (f.stilt_parking ? ", stilt" : "") +
        (f.is_corner_plot ? ", corner" : ""),
      as_of: opts.as_of,
      facts: f,
      readings,
      ...(notes.length ? { annotations: notes.join(" | ") } : {}),
    });
  }
  return cases;
}
