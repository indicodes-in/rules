/**
 * Engine domain types — structural mirror of rules/schema/rule.schema.json
 * (the schema is normative; the validator enforces it before rules reach
 * the engine) and the spec §5.1 fact vocabulary.
 */

/** Closed parameter set (spec §3.1). Extending this is a spec change. */
export const PARAMETERS = [
  "far",
  "ground_coverage_pct",
  "max_height_m",
  "setback_front_m",
  "setback_rear_m",
  "setback_side_m",
  "dwelling_units",
  "parking_ecs_per_100sqm",
  "basement_permissibility",
  "stilt_height_bonus_m",
  "stilt_far_exemption",
] as const;

export type Parameter = (typeof PARAMETERS)[number];

/** Facts usable in rule conditions (spec §5.1; land_use/authority are applicability-level). */
export const CONDITION_FACTS = [
  "plot_area_sqm",
  "road_width_m",
  "roads_abutting",
  "is_corner_plot",
  "stilt_parking",
  "basement_intended",
] as const;

export type ConditionFact = (typeof CONDITION_FACTS)[number];

export type ConditionOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "between";

export interface RuleCondition {
  fact: ConditionFact;
  op: ConditionOp;
  value: unknown;
}

export interface Citation {
  doc_id: string;
  clause: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  original_text: string | null;
  original_lang: "hi" | "en" | null;
  translated_text: string | null;
}

export type RuleOutput =
  | { type: "scalar"; value: number | null; unit: string }
  | { type: "boolean"; value: boolean | null }
  | { type: "formula"; formula_id: string; params: Record<string, number | null> }
  | { type: "flag"; code: string; message: string };

export interface Verification {
  status: "draft" | "verified" | "rejected";
  verified_by: string | null;
  verified_on: string | null;
  method: string;
  confidence: number | null;
}

export interface Rule {
  rule_id: string;
  title: string;
  parameter: Parameter;
  applicability: {
    land_use: string;
    authority: string;
    conditions: RuleCondition[];
  };
  output: RuleOutput;
  effective_from: string | null;
  effective_to: string | null;
  supersedes: string | null;
  citations: Citation[];
  verification: Verification;
  /** Verifier's internal record: band-boundary reasoning, extraction
   * provenance, open questions. Never shown to end users. */
  notes: string;
  /** Optional caveat for end users — a condition the bare number doesn't
   * express. Absent when the value stands on its own. */
  user_caveat?: string | null;
}

/**
 * Parcel facts (spec §5.1). The evaluation date is passed to the resolver
 * separately per the engine contract (parcelFacts, ruleSet, date).
 * special_area_flags never appear in rule conditions — special areas are
 * handled by the spatial service before the engine runs (spec §8).
 */
export interface ParcelFacts {
  plot_area_sqm: number;
  /** Max abutting road width. */
  road_width_m: number;
  roads_abutting: number;
  is_corner_plot: boolean;
  land_use: string;
  authority: string;
  stilt_parking: boolean;
  basement_intended: boolean;
  special_area_flags: string[];
}
