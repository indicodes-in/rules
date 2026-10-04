/**
 * Band-gap detection (spec §9). Pure, zero I/O.
 *
 * When a parameter resolves to no rule the cause is often not a missing rule
 * but a gap the *source table itself* leaves between two adjacent rows. The
 * UBBL 2016 setback table reads "Below 100" then "Above 100 and up to 250",
 * so a plot of exactly 100 m² falls between the printed rows — the regulation
 * does not say which one governs it.
 *
 * Reporting that as "not covered; report this plot" is wrong twice over: it
 * invites the user to report a non-bug, and it hides the real, citable reason
 * they got no number. This module finds the two neighbouring bands so the API
 * can name them. It never picks a side — choosing would be inventing a
 * regulatory value (CLAUDE.md principle 3).
 *
 * Bands are read from the rule files; no regulatory value appears here.
 */

import type { Citation, ConditionFact, Parameter, ParcelFacts, Rule, RuleCondition } from "./types.js";

/** Half-open description of one rule's reach along a single numeric fact. */
interface Band {
  rule: Rule;
  lo: number;
  loInc: boolean;
  hi: number;
  hiInc: boolean;
}

export interface BandNeighbour {
  rule_id: string;
  /** The band's bound facing the gap. */
  bound: number;
  /** Verbatim source row, whitespace-collapsed, when the citation carries one. */
  source_text: string | null;
  citations: Citation[];
}

export interface BandGap {
  fact: ConditionFact;
  /** The uncovered fact value the user actually supplied. */
  value: number;
  below: BandNeighbour;
  above: BandNeighbour;
}

/** The interval a single condition allows, or null when not a numeric band. */
function conditionBand(cond: RuleCondition): Omit<Band, "rule"> | null {
  const v = cond.value;
  switch (cond.op) {
    case "lt":
      return typeof v === "number" ? { lo: -Infinity, loInc: false, hi: v, hiInc: false } : null;
    case "lte":
      return typeof v === "number" ? { lo: -Infinity, loInc: false, hi: v, hiInc: true } : null;
    case "gt":
      return typeof v === "number" ? { lo: v, loInc: false, hi: Infinity, hiInc: false } : null;
    case "gte":
      return typeof v === "number" ? { lo: v, loInc: true, hi: Infinity, hiInc: false } : null;
    case "between": {
      if (!Array.isArray(v) || v.length !== 2) return null;
      const [lo, hi] = v;
      if (typeof lo !== "number" || typeof hi !== "number") return null;
      // Exclusive-inclusive (lo, hi] — same semantics as the resolver.
      return { lo, loInc: false, hi, hiInc: true };
    }
    default:
      return null;
  }
}

/**
 * The interval a rule reaches over, when it bands on exactly one numeric fact.
 * Lets callers see which band edge a plot sits near — the difference between
 * FAR 300 and FAR 225 can be half a square metre, and the user is the only
 * one who can act on that.
 */
export function ruleBand(
  rule: Rule,
): { fact: ConditionFact; lo: number; loInc: boolean; hi: number; hiInc: boolean } | null {
  const conds = rule.applicability.conditions;
  if (conds.length !== 1) return null;
  const band = conditionBand(conds[0]!);
  return band === null ? null : { fact: conds[0]!.fact, ...band };
}

function isEffectiveOn(rule: Rule, date: string): boolean {
  if (rule.effective_from !== null && rule.effective_from > date) return false;
  if (rule.effective_to !== null && rule.effective_to <= date) return false;
  return true;
}

function collapse(text: string | null): string | null {
  return text === null ? null : text.replace(/\s+/g, " ").trim();
}

function neighbour(band: Band, bound: number): BandNeighbour {
  return {
    rule_id: band.rule.rule_id,
    bound,
    source_text: collapse(band.rule.citations[0]?.original_text ?? null),
    citations: band.rule.citations,
  };
}

/**
 * Finds the two bands that bracket an uncovered fact value, when the rules
 * for `parameter` form a banded table over one numeric fact and the supplied
 * value falls between two of them.
 *
 * Only rules whose conditions all constrain that same single fact are
 * considered — anything richer isn't a band table, and guessing at its shape
 * would produce a confident but wrong explanation. Returns null when there is
 * no such bracketing pair (a genuinely missing rule, not a source gap).
 */
export function findBandGap(
  parameter: Parameter,
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  options: { allowDraft?: boolean } = {},
): BandGap | null {
  const allowDraft = options.allowDraft ?? false;
  const candidates = ruleSet.filter(
    (rule) =>
      rule.parameter === parameter &&
      (rule.verification.status === "verified" ||
        (allowDraft && rule.verification.status === "draft")) &&
      isEffectiveOn(rule, evaluationDate) &&
      rule.applicability.land_use === facts.land_use &&
      rule.applicability.authority === facts.authority,
  );

  // Group by the single fact each rule bands over.
  const byFact = new Map<ConditionFact, Band[]>();
  for (const rule of candidates) {
    const conds = rule.applicability.conditions;
    if (conds.length === 0) continue;
    const fact = conds[0]!.fact;
    if (!conds.every((c) => c.fact === fact)) continue;

    let lo = -Infinity;
    let loInc = false;
    let hi = Infinity;
    let hiInc = false;
    let usable = true;
    for (const cond of conds) {
      const b = conditionBand(cond);
      if (b === null) {
        usable = false;
        break;
      }
      if (b.lo > lo || (b.lo === lo && !b.loInc)) {
        lo = b.lo;
        loInc = b.lo === lo ? b.loInc && loInc : b.loInc;
      }
      if (b.hi < hi || (b.hi === hi && !b.hiInc)) {
        hi = b.hi;
        hiInc = b.hi === hi ? b.hiInc && hiInc : b.hiInc;
      }
    }
    if (!usable) continue;
    const list = byFact.get(fact);
    if (list) list.push({ rule, lo, loInc, hi, hiInc });
    else byFact.set(fact, [{ rule, lo, loInc, hi, hiInc }]);
  }

  for (const [fact, bands] of byFact) {
    const value = facts[fact];
    if (typeof value !== "number") continue;
    // If any band already covers the value this isn't a gap (the parameter
    // failed to resolve for some other reason).
    const covered = bands.some(
      (b) =>
        (b.lo < value || (b.lo === value && b.loInc)) &&
        (value < b.hi || (value === b.hi && b.hiInc)),
    );
    if (covered) continue;

    let below: Band | null = null;
    let above: Band | null = null;
    for (const b of bands) {
      if (b.hi <= value && (below === null || b.hi > below.hi)) below = b;
      if (b.lo >= value && (above === null || b.lo < above.lo)) above = b;
    }
    if (below && above && below.hi <= value && above.lo >= value) {
      return {
        fact,
        value,
        below: neighbour(below, below.hi),
        above: neighbour(above, above.lo),
      };
    }
  }
  return null;
}

/**
 * Every uncovered stretch in a parameter's band table, for corpus linting.
 * `to === from` means a single uncovered point (the "Below 100 / Above 100"
 * case). Used by `pnpm rules:validate` so an unintended gap is visible
 * before it reaches a user.
 */
export function bandGaps(
  ruleSet: readonly Rule[],
  parameter: Parameter,
): { fact: ConditionFact; from: number; to: number; below: string; above: string }[] {
  const bands: (Band & { fact: ConditionFact })[] = [];
  for (const rule of ruleSet) {
    if (rule.parameter !== parameter) continue;
    if (rule.verification.status !== "verified") continue;
    if (rule.effective_to !== null) continue; // superseded versions don't count
    const conds = rule.applicability.conditions;
    if (conds.length === 0) continue;
    const fact = conds[0]!.fact;
    if (!conds.every((c) => c.fact === fact)) continue;
    const b = conditionBand(conds[0]!);
    if (b === null || conds.length !== 1) continue;
    bands.push({ rule, fact, ...b });
  }

  const out: { fact: ConditionFact; from: number; to: number; below: string; above: string }[] = [];
  const facts = new Set(bands.map((b) => b.fact));
  for (const fact of facts) {
    const sorted = bands.filter((b) => b.fact === fact).sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const cur = sorted[i]!;
      const next = sorted[i + 1]!;
      if (next.lo > cur.hi) {
        out.push({ fact, from: cur.hi, to: next.lo, below: cur.rule.rule_id, above: next.rule.rule_id });
      } else if (next.lo === cur.hi && !cur.hiInc && !next.loInc) {
        // Both sides exclude the shared bound — the point itself is uncovered.
        out.push({ fact, from: cur.hi, to: cur.hi, below: cur.rule.rule_id, above: next.rule.rule_id });
      }
    }
  }
  return out;
}
