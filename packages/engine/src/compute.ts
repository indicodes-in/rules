/**
 * Derived-parameter computation (spec §5.3). Formula LOGIC lives here;
 * every regulatory CONSTANT (FAR, coverage %, ECS rate, bonus heights)
 * comes from resolved rules — no number in this file is regulatory.
 *
 * Each derived output cites the union of its input rules' citations plus
 * `derived_via` naming the formula, so derived numbers stay auditable.
 * A derived value is simply absent when its inputs did not resolve — the
 * inputs themselves already carry flags.
 */

import type { ResolutionOutcome } from "./resolver.js";
import type { Citation, ParcelFacts, Parameter } from "./types.js";

export interface DerivedValue {
  value: number;
  unit: string;
  citations: Citation[];
  derived_via: string;
  input_rule_ids: string[];
  /** Shown beside the value. Required wherever the displayed number is not
   * literally in the cited clause — the citation proves the *rate*, and the
   * reader is entitled to see how we got from that to the figure on screen. */
  note?: string;
  /** The arithmetic, with the inputs it used, in one line: shown in the open
   * beside a calculated value so it can be reproduced without opening the
   * sources (architect UX audit, 14 Oct 2026). Any assumption is named. */
  working?: string;
}

/** A display figure: at most two decimals, no trailing zeros. */
function fig(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export interface ComputeResult {
  derived: Record<string, DerivedValue>;
  /** Resolved formula-type rules the engine could not compute. */
  flags: Array<{ code: string; message: string; parameter: string; citations: Citation[] }>;
}

interface ScalarInput {
  value: number;
  citations: Citation[];
  rule_id: string;
}

function scalarOf(outcome: ResolutionOutcome | undefined): ScalarInput | null {
  if (outcome === undefined || outcome.status !== "resolved") return null;
  const output = outcome.rule.output;
  if (output.type !== "scalar" || typeof output.value !== "number") return null;
  return { value: output.value, citations: outcome.rule.citations, rule_id: outcome.rule.rule_id };
}

function union(...inputs: ScalarInput[]): { citations: Citation[]; ruleIds: string[] } {
  const citations: Citation[] = [];
  const ruleIds: string[] = [];
  for (const input of inputs) {
    citations.push(...input.citations);
    ruleIds.push(input.rule_id);
  }
  return { citations, ruleIds };
}

export function computeDerived(
  outcomes: Partial<Record<Parameter, ResolutionOutcome>>,
  facts: ParcelFacts,
): ComputeResult {
  const derived: Record<string, DerivedValue> = {};
  const flags: ComputeResult["flags"] = [];

  const far = scalarOf(outcomes.far);
  if (far) {
    derived["buildable_area_sqm"] = {
      value: (facts.plot_area_sqm * far.value) / 100,
      unit: "sqm",
      citations: far.citations,
      derived_via: "buildable_area",
      input_rule_ids: [far.rule_id],
      working: `${fig(facts.plot_area_sqm)} m² plot × FAR ${fig(far.value / 100)} = ${fig((facts.plot_area_sqm * far.value) / 100)} m²`,
    };
  }

  const coverage = scalarOf(outcomes.ground_coverage_pct);
  if (coverage) {
    derived["coverage_area_sqm"] = {
      value: (facts.plot_area_sqm * coverage.value) / 100,
      unit: "sqm",
      citations: coverage.citations,
      derived_via: "coverage_area",
      input_rule_ids: [coverage.rule_id],
      working: `${fig(facts.plot_area_sqm)} m² plot × ${fig(coverage.value)}% = ${fig((facts.plot_area_sqm * coverage.value) / 100)} m²`,
    };
  }

  const parking = outcomes.parking_ecs_per_100sqm;
  if (parking !== undefined && parking.status === "resolved") {
    const output = parking.rule.output;
    let rate: number | null = null;
    if (output.type === "scalar" && typeof output.value === "number") {
      rate = output.value;
    } else if (
      output.type === "formula" &&
      output.formula_id === "ecs_per_bua" &&
      typeof output.params["ecs_per_100sqm"] === "number"
    ) {
      rate = output.params["ecs_per_100sqm"];
    }

    const parkingInput: ScalarInput | null =
      rate === null
        ? null
        : { value: rate, citations: parking.rule.citations, rule_id: parking.rule.rule_id };

    if (
      output.type === "formula" &&
      output.formula_id === "ecs_fixed" &&
      typeof output.params["ecs"] === "number"
    ) {
      // A count for the plot, not a rate: no floor area involved, so it
      // stands even where FAR is withheld.
      derived["parking_ecs"] = {
        value: output.params["ecs"],
        unit: "count",
        citations: parking.rule.citations,
        derived_via: "ecs_fixed",
        input_rule_ids: [parking.rule.rule_id],
        working: `${fig(output.params["ecs"])} ECS, a fixed number for plots of this size`,
      };
    } else if (output.type === "flag") {
      // A `flag`-type rule states a requirement in prose (e.g. "parking within
      // the plot") rather than a computable rate. That is the rule working as
      // written — the flag it carries is already surfaced by the resolver, so
      // emitting "formula the engine cannot compute" here would report the
      // engine's own happy path as an internal error. Every plot ≤300 m² hit it.
    } else if (parkingInput === null) {
      flags.push({
        code: "formula_not_implemented",
        parameter: "parking_ecs_per_100sqm",
        message: `Rule "${parking.rule.rule_id}" uses a formula the engine cannot compute.`,
        citations: parking.rule.citations,
      });
    } else if (far === null) {
      flags.push({
        code: "derived_inputs_unresolved",
        parameter: "parking_ecs_per_100sqm",
        message:
          "No parking count without a floor area — see FAR.",
        citations: parking.rule.citations,
      });
    } else {
      const buildable = (facts.plot_area_sqm * far.value) / 100;
      const { citations, ruleIds } = union(far, parkingInput);
      const exact = (buildable / 100) * parkingInput.value;
      const rounded = Math.ceil(exact);
      const round = (n: number): string => String(Math.round(n * 100) / 100);
      derived["parking_ecs"] = {
        // ECS counts are integers (CLAUDE.md conventions); ceil per spec §5.3.
        value: rounded,
        unit: "count",
        citations,
        derived_via: "ecs_per_bua",
        input_rule_ids: ruleIds,
        // The count assumes the whole FAR allowance is built; say so.
        working:
          `${round(buildable)} m² floor area (the full FAR allowance) ÷ 100 × ${round(parkingInput.value)} ECS ` +
          `= ${round(exact)}${exact === rounded ? " ECS" : `, rounded up to ${rounded} ECS`}`,
        // The cited clause gives a rate, never this count. Someone opening the
        // citation to check "8" finds "1 ECS for every 100 sq.m." and no 8 —
        // so the arithmetic has to travel with the number. The rounding
        // direction in particular is ours: the bye-law states no rounding
        // rule, and "for every 100 sq.m." can be read as complete units,
        // which would round the other way.
        ...(exact === rounded
          ? {}
          : {
              note:
                // The arithmetic is in `working`; this says whose rounding it is.
                `Rounded up to ${rounded}. The clause gives the rate, not a rounding rule — the ` +
                `whole number is our conservative reading, not the source's. Confirm with the ` +
                `sanctioning authority.`,
            }),
      };
    }
  }

  // Stilt height bonus applies only when the parcel actually has stilt
  // parking; the rule's own conditions are already enforced by the resolver.
  const height = scalarOf(outcomes.max_height_m);
  const bonus = scalarOf(outcomes.stilt_height_bonus_m);
  if (facts.stilt_parking && height && bonus) {
    const { citations, ruleIds } = union(height, bonus);
    derived["max_height_with_stilt_m"] = {
      value: height.value + bonus.value,
      unit: "m",
      citations,
      derived_via: "stilt_height_bonus",
      input_rule_ids: ruleIds,
      working: `${fig(height.value)} m + ${fig(bonus.value)} m for stilt parking = ${fig(height.value + bonus.value)} m`,
    };
  }

  return { derived, flags };
}
