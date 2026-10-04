/**
 * Rule resolution (spec §5.2). Pure functions, zero I/O.
 *
 * For a parameter, a rule matches when it is verified (drafts only with
 * options.allowDraft — the API maps ENGINE_ALLOW_DRAFT to it; the engine
 * never reads the environment), effective on the evaluation date with
 * [effective_from, effective_to) semantics, and every applicability
 * condition is satisfied by the facts. Exactly one match resolves; zero
 * matches flag no_applicable_rule (never extrapolate, spec §9); more than
 * one flags rule_conflict — the resolver never tie-breaks silently.
 *
 * Malformed rules (unknown op, non-numeric comparison) throw EngineError:
 * they indicate a corpus that bypassed `pnpm rules:validate`, not a user
 * input problem.
 */

import { PARAMETERS, type Parameter, type ParcelFacts, type Rule, type RuleCondition } from "./types.js";

export class EngineError extends Error {
  override name = "EngineError";
}

export interface ResolverOptions {
  /** Local dev only (ENGINE_ALLOW_DRAFT). Production refuses draft rules. */
  allowDraft?: boolean;
}

export type ResolutionOutcome =
  | { status: "resolved"; rule: Rule }
  | { status: "no_applicable_rule" }
  | { status: "rule_conflict"; ruleIds: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new EngineError(`evaluation date must be YYYY-MM-DD, got "${date}"`);
  }
}

function isEffectiveOn(rule: Rule, date: string): boolean {
  // Drafts may lack dates; verified rules never do (CI enforces spec §3.4).
  // An undated rule is treated as always in force — it can only have been
  // admitted via allowDraft.
  if (rule.effective_from !== null && rule.effective_from > date) return false;
  if (rule.effective_to !== null && rule.effective_to <= date) return false;
  return true;
}

function asNumber(value: unknown, cond: RuleCondition): number {
  if (typeof value !== "number") {
    throw new EngineError(
      `condition on "${cond.fact}" (${cond.op}) requires a numeric value, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function conditionSatisfied(cond: RuleCondition, facts: ParcelFacts): boolean {
  const actual: unknown = facts[cond.fact];
  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "neq":
      return actual !== cond.value;
    case "lt":
      return typeof actual === "number" && actual < asNumber(cond.value, cond);
    case "lte":
      return typeof actual === "number" && actual <= asNumber(cond.value, cond);
    case "gt":
      return typeof actual === "number" && actual > asNumber(cond.value, cond);
    case "gte":
      return typeof actual === "number" && actual >= asNumber(cond.value, cond);
    case "in":
      if (!Array.isArray(cond.value)) {
        throw new EngineError(`condition on "${cond.fact}" (in) requires an array value`);
      }
      return cond.value.some((v) => v === actual);
    case "between": {
      if (!Array.isArray(cond.value) || cond.value.length !== 2) {
        throw new EngineError(`condition on "${cond.fact}" (between) requires [lo, hi]`);
      }
      const lo = asNumber(cond.value[0], cond);
      const hi = asNumber(cond.value[1], cond);
      // Exclusive-inclusive (lo, hi]: mirrors the source tables' band language
      // ("Above 50 to 100" = >50 and ≤100), so a plot of exactly 100 m² lands
      // in the 50–100 row, as the regulation reads. Each boundary still
      // belongs to exactly one band.
      return typeof actual === "number" && actual > lo && actual <= hi;
    }
    default:
      throw new EngineError(`unknown condition op "${String(cond.op)}"`);
  }
}

export function resolveParameter(
  parameter: Parameter,
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  options: ResolverOptions = {},
): ResolutionOutcome {
  assertDate(evaluationDate);
  const allowDraft = options.allowDraft ?? false;

  const matches = ruleSet.filter(
    (rule) =>
      rule.parameter === parameter &&
      (rule.verification.status === "verified" ||
        (allowDraft && rule.verification.status === "draft")) &&
      isEffectiveOn(rule, evaluationDate) &&
      rule.applicability.land_use === facts.land_use &&
      rule.applicability.authority === facts.authority &&
      rule.applicability.conditions.every((c) => conditionSatisfied(c, facts)),
  );

  if (matches.length === 1) return { status: "resolved", rule: matches[0]! };
  if (matches.length === 0) return { status: "no_applicable_rule" };
  return { status: "rule_conflict", ruleIds: matches.map((r) => r.rule_id).sort() };
}

export function resolveAll(
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  options: ResolverOptions = {},
): Record<Parameter, ResolutionOutcome> {
  const outcomes = {} as Record<Parameter, ResolutionOutcome>;
  for (const parameter of PARAMETERS) {
    outcomes[parameter] = resolveParameter(parameter, facts, ruleSet, evaluationDate, options);
  }
  return outcomes;
}

/**
 * The loader's implicit dating (spec §3.5), as a pure function: when rule B
 * supersedes rule A and A has no explicit effective_to, A ends where B
 * begins. With multiple successors the earliest effective_from wins.
 * Amendments never mutate old rules — this returns new objects.
 */
export function materializeEffectiveTo(ruleSet: readonly Rule[]): Rule[] {
  const successorFrom = new Map<string, string>();
  for (const rule of ruleSet) {
    if (rule.supersedes === null || rule.effective_from === null) continue;
    const existing = successorFrom.get(rule.supersedes);
    if (existing === undefined || rule.effective_from < existing) {
      successorFrom.set(rule.supersedes, rule.effective_from);
    }
  }
  return ruleSet.map((rule) => {
    const to = successorFrom.get(rule.rule_id);
    return rule.effective_to === null && to !== undefined ? { ...rule, effective_to: to } : rule;
  });
}
