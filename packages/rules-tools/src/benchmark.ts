/**
 * Validation benchmark runner (spec §10). Pure logic here; the CLI wrapper is
 * benchmark-cli.ts and `pnpm test:benchmark` at the root.
 *
 * What it tests the corpus against — and what it does not.
 *
 * The product claims to state what the regulations say, cited. So the answer
 * key is the regulations as competent people read them: BLIND DOUBLE READING.
 * Two experienced readers each work a plot scenario out from the documents
 * alone, without seeing the engine or each other. Where they agree, that is a
 * test case the engine must match; where they differ, the clause does not
 * settle the question, and that is recorded as an ambiguity for the
 * interpretations list rather than tested.
 *
 * Sanctioned plans were the original answer key, and are not one: an approval
 * can depart from the code for reasons that have nothing to do with the code
 * (relaxations, old rules, or plain discretion). A plan that disagrees with
 * the engine cannot say which of those it is. They are run and reported as
 * supporting evidence — a pattern of plans disagreeing the same way is a
 * signal the authority reads a clause differently — but never decide the gate.
 *
 * Case files are human-curated ([HUMAN] task) — the one place real regulatory
 * values appear outside rules/, because they are evidence to test the corpus
 * against, not a source the engine reads.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  evaluatePlot,
  validateParcelFacts,
  type EvaluateOptions,
  type PlotEvaluation,
  type Rule,
} from "@indicodes/engine";

/** The corpus declarations /evaluate applies (see loadDeclarations). */
export type Declarations = Pick<EvaluateOptions, "notModelled" | "categoryFloors">;

/** A value as stated for one parameter. `value: null` = "the documents do
 * not settle this" — a real answer, which the engine must match by declining. */
export interface StatedValue {
  value: number | boolean | null;
  unit: string | null;
}

export type Values = Record<string, StatedValue>;

export interface Reading {
  /** Pseudonymous reader id; the register of who is who is kept offline. */
  reader: string;
  read_on: string;
  /** Read without seeing the engine's answer or the other reading. */
  blind: boolean;
  values: Values;
}

interface CaseBase {
  case_id: string;
  /** True only for harness smoke fixtures — never satisfies the gate. */
  synthetic?: boolean;
  description: string;
  facts: Record<string, unknown>;
  annotations?: string;
}

export interface DoubleReadCase extends CaseBase {
  kind: "double_read";
  /** The documents were read as in force on this date; the resolver
   * evaluates at the same date. */
  as_of: string;
  readings: Reading[];
}

export interface SanctionedPlanCase extends CaseBase {
  kind: "sanctioned_plan";
  sanction_date: string;
  /** The PERMISSIBLE column of the approved drawing's area statement — not
   * what was proposed or built, which is usually less than the limit. */
  expected: Values;
}

export type BenchmarkCase = DoubleReadCase | SanctionedPlanCase;

export interface CaseResult {
  case_id: string;
  kind: BenchmarkCase["kind"];
  synthetic: boolean;
  /** No failures. For a sanctioned plan, "agrees with the engine". */
  passed: boolean;
  failures: string[];
  /** Parameters actually compared against the engine. */
  checked: string[];
  /** The key has a value; the engine declines. Coverage still missing —
   * the conservative behaviour, never counted as a wrong answer. */
  declined: string[];
  /** Readers disagree (or not all gave it): the clause does not settle it. */
  ambiguous: string[];
}

export interface BenchmarkReport {
  results: CaseResult[];
  doubleReadCases: number;
  doubleReadPassed: number;
  /** Parameters compared across real double-read cases. */
  checkedParameters: number;
  sanctionedCases: number;
  sanctionedAgreeing: number;
  /** Gate per spec §10: at least one real double-read comparison, and every
   * real double-read case matches. Sanctioned plans never decide it. */
  gatePassed: boolean;
}

export function loadCases(dir: string): BenchmarkCase[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith("case_") && f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as BenchmarkCase);
}

const same = (a: StatedValue, b: StatedValue) => a.value === b.value && a.unit === b.unit;

/** What the readers jointly establish: agreed values, and what they don't. */
function agreedValues(readings: Reading[]): { agreed: Values; ambiguous: string[] } {
  const agreed: Values = {};
  const ambiguous: string[] = [];
  const params = [...new Set(readings.flatMap((r) => Object.keys(r.values)))].sort();
  for (const p of params) {
    const stated = readings.map((r) => r.values[p]);
    if (stated.some((s) => s === undefined)) {
      ambiguous.push(`${p}: not given by every reader`);
      continue;
    }
    const [first, ...rest] = stated as StatedValue[];
    if (rest.every((s) => same(s, first!))) {
      agreed[p] = first!;
    } else {
      ambiguous.push(`${p}: readers differ (${stated.map((s) => String(s!.value)).join(" vs ")})`);
    }
  }
  return { agreed, ambiguous };
}

function readerProblems(readings: Reading[]): string[] {
  const ids = new Set(readings.map((r) => r.reader));
  const problems: string[] = [];
  if (readings.length < 2 || ids.size < readings.length) {
    problems.push("needs readings from at least two different readers");
  }
  for (const r of readings) {
    if (r.blind !== true) problems.push(`reading by ${r.reader} is not recorded as blind`);
  }
  return problems;
}

/** Compare one key value with the engine's output for that parameter. */
function compare(
  parameter: string,
  key: StatedValue,
  result: PlotEvaluation,
  kind: BenchmarkCase["kind"],
  out: Pick<CaseResult, "failures" | "checked" | "declined">,
) {
  const actual = result.parameters[parameter];
  const says = kind === "double_read" ? "readers agree on" : "plan permits";
  out.checked.push(parameter);
  if (key.value === null) {
    // The key says the documents do not settle this. The engine answering
    // anyway is exactly the confident extrapolation the product refuses.
    if (actual) {
      out.failures.push(`${parameter}: readers found this unsettled; engine gives ${String(actual.value)}`);
    }
    return;
  }
  if (!actual) {
    const flag = result.flags.find((f) => f.parameter === parameter);
    out.declined.push(`${parameter}: ${says} ${String(key.value)}; engine declines` + (flag ? ` (${flag.code})` : ""));
    return;
  }
  if (actual.value !== key.value) {
    out.failures.push(`${parameter}: ${says} ${String(key.value)}, engine gives ${String(actual.value)}`);
  }
  if (key.unit !== null && actual.unit !== key.unit) {
    out.failures.push(`${parameter}: expected unit ${key.unit}, engine gives ${String(actual.unit)}`);
  }
}

export function runCase(
  c: BenchmarkCase,
  ruleSet: readonly Rule[],
  declarations: Declarations = {},
): CaseResult {
  const base: CaseResult = {
    case_id: c.case_id,
    kind: c.kind,
    synthetic: c.synthetic ?? false,
    passed: false,
    failures: [],
    checked: [],
    declined: [],
    ambiguous: [],
  };

  const validated = validateParcelFacts(c.facts);
  if (!validated.ok) {
    return { ...base, failures: validated.errors.map((e) => `invalid facts: ${e}`) };
  }

  let key: Values;
  let date: string;
  if (c.kind === "double_read") {
    const problems = readerProblems(c.readings);
    if (problems.length) return { ...base, failures: problems };
    const { agreed, ambiguous } = agreedValues(c.readings);
    key = agreed;
    base.ambiguous = ambiguous;
    date = c.as_of;
  } else {
    key = c.expected;
    date = c.sanction_date;
  }

  const result = evaluatePlot(validated.facts, ruleSet, date, "benchmark", {
    ...declarations,
    allowDraft: false, // the gate runs against verified rules only (principle 4)
  });
  for (const [parameter, value] of Object.entries(key)) {
    compare(parameter, value, result, c.kind, base);
  }
  return { ...base, passed: base.failures.length === 0 };
}

export function runBenchmark(
  cases: BenchmarkCase[],
  ruleSet: readonly Rule[],
  declarations: Declarations = {},
): BenchmarkReport {
  const results = cases.map((c) => runCase(c, ruleSet, declarations));
  const real = results.filter((r) => !r.synthetic);
  const doubleRead = real.filter((r) => r.kind === "double_read");
  const sanctioned = real.filter((r) => r.kind === "sanctioned_plan");
  const checkedParameters = doubleRead.reduce((n, r) => n + r.checked.length, 0);
  const doubleReadPassed = doubleRead.filter((r) => r.passed).length;
  return {
    results,
    doubleReadCases: doubleRead.length,
    doubleReadPassed,
    checkedParameters,
    sanctionedCases: sanctioned.length,
    sanctionedAgreeing: sanctioned.filter((r) => r.passed).length,
    // An empty or all-ambiguous case set must never read as a green gate.
    gatePassed: checkedParameters > 0 && doubleReadPassed === doubleRead.length,
  };
}
