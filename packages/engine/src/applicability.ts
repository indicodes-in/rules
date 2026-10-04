/**
 * Inapplicability detection. Pure, zero I/O.
 *
 * A parameter that resolves to no rule has more than one possible cause, and
 * they mean opposite things to the reader:
 *
 *   1. the corpus is missing a rule            → worth reporting
 *   2. the SOURCE TABLE leaves a gap           → see gaps.ts; cite both rows
 *   3. the parameter does not apply to this    → say so and move on
 *      plot at all, given the facts given
 *
 * Case 3 was being reported as case 1. Every verified rule for
 * `stilt_far_exemption` is gated on `stilt_parking == true`, so a plot with no
 * stilt intended produced "No applicable verified rule — not covered; report
 * this plot." On an entirely ordinary plot that is two prompts to report a
 * non-problem, and a flag that cries wolf teaches people to ignore the flags
 * that matter — which is fatal for a product whose whole claim is that its
 * refusals are meaningful.
 *
 * The test is deliberately narrow. A parameter is inapplicable only when
 * EVERY rule for it is excluded by an equality condition on a fact the caller
 * actually supplied. If any rule fails for some other reason — a band, a date,
 * a fact we were not given — this returns null and the caller falls through to
 * the existing gap logic. Silence is only safe when we can name the reason.
 */

import type { ConditionFact, Parameter, ParcelFacts, Rule } from "./types.js";

export interface Inapplicable {
  /** The fact that rules this parameter out. */
  fact: ConditionFact;
  /** The value the caller supplied for it. */
  actual: unknown;
  /** The value every rule for this parameter requires. */
  required: unknown;
  /** Rules that would have applied had the fact differed. */
  rule_ids: string[];
}

function isEffectiveOn(rule: Rule, date: string): boolean {
  if (rule.effective_from !== null && rule.effective_from > date) return false;
  if (rule.effective_to !== null && rule.effective_to <= date) return false;
  return true;
}

/**
 * Why `parameter` does not apply, or null if that is not the reason it failed
 * to resolve.
 *
 * Only equality conditions count. A range condition that excludes a plot is a
 * band question, not an applicability one — a 90 m² plot is not "outside the
 * scope of setbacks", it is in a table row we have or have not encoded, and
 * gaps.ts is the module that knows the difference.
 */
export function findInapplicable(
  parameter: Parameter,
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  options: { allowDraft?: boolean } = {},
): Inapplicable | null {
  const candidates = ruleSet.filter(
    (r) =>
      r.parameter === parameter &&
      (options.allowDraft === true || r.verification.status === "verified") &&
      isEffectiveOn(r, evaluationDate),
  );
  if (candidates.length === 0) return null; // nothing to be inapplicable

  let fact: ConditionFact | null = null;
  let required: unknown;
  const ruleIds: string[] = [];

  for (const rule of candidates) {
    // Exactly one equality condition may be doing the excluding; anything
    // more entangled is not a case we are confident enough to silence.
    const blocking = rule.applicability.conditions.filter((c) => {
      if (c.op !== "eq") return false;
      const supplied = (facts as unknown as Record<string, unknown>)[c.fact];
      return supplied !== undefined && supplied !== c.value;
    });
    if (blocking.length !== 1) return null;

    const only = blocking[0]!;
    // Every rule must be excluded by the SAME fact, or "it does not apply
    // because X" is not a sentence we can honestly write.
    if (fact === null) {
      fact = only.fact;
      required = only.value;
    } else if (fact !== only.fact || required !== only.value) {
      return null;
    }
    ruleIds.push(rule.rule_id);
  }

  if (fact === null) return null;
  return {
    fact,
    actual: (facts as unknown as Record<string, unknown>)[fact],
    required,
    rule_ids: ruleIds.sort(),
  };
}
