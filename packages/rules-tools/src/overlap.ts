/**
 * Applicability-overlap satisfiability (spec §5.2 invariant: exactly one
 * verified rule per parameter for any reachable fact combination).
 *
 * Two condition sets "can co-occur" when some fact assignment satisfies both
 * conjunctions simultaneously. Numeric facts are modeled as real intervals —
 * `between` is exclusive-inclusive (lo, hi] per the schema. `neq` exclusions
 * only empty a degenerate (single-point) interval; over a continuum they
 * cannot empty a wider one. Integer-valued facts (roads_abutting) are treated
 * as reals, and unsupported value shapes are treated as unconstrained — both
 * deliberately conservative: when unsure, report the overlap.
 */

import type { RuleCondition } from "./types.js";

const BOOLEAN_FACTS = new Set(["is_corner_plot", "stilt_parking", "basement_intended"]);

interface Interval {
  lo: number;
  loInc: boolean;
  hi: number;
  hiInc: boolean;
}

interface NumericConstraint {
  kind: "numeric";
  intervals: Interval[];
  excluded: number[];
}

interface BooleanConstraint {
  kind: "boolean";
  allowed: Set<boolean>;
}

/** Value shape we don't model — assume satisfiable (conservative). */
interface OpaqueConstraint {
  kind: "opaque";
}

type FactConstraint = NumericConstraint | BooleanConstraint | OpaqueConstraint;

function fullNumeric(): NumericConstraint {
  return {
    kind: "numeric",
    intervals: [{ lo: -Infinity, loInc: false, hi: Infinity, hiInc: false }],
    excluded: [],
  };
}

function intersectIntervals(a: Interval, b: Interval): Interval | null {
  const lo = Math.max(a.lo, b.lo);
  const loInc = (a.lo === lo ? a.loInc : true) && (b.lo === lo ? b.loInc : true);
  const hi = Math.min(a.hi, b.hi);
  const hiInc = (a.hi === hi ? a.hiInc : true) && (b.hi === hi ? b.hiInc : true);
  if (lo > hi) return null;
  if (lo === hi && !(loInc && hiInc)) return null;
  return { lo, loInc, hi, hiInc };
}

function constrainTo(c: NumericConstraint, interval: Interval): void {
  c.intervals = c.intervals
    .map((i) => intersectIntervals(i, interval))
    .filter((i): i is Interval => i !== null);
}

/** Applies one numeric predicate; returns false when the value shape is unsupported. */
function applyNumericOp(c: NumericConstraint, op: string, value: unknown): boolean {
  const point = (v: number): Interval => ({ lo: v, loInc: true, hi: v, hiInc: true });

  switch (op) {
    case "eq":
      if (typeof value !== "number") return false;
      constrainTo(c, point(value));
      return true;
    case "neq":
      if (typeof value !== "number") return false;
      c.excluded.push(value);
      return true;
    case "lt":
      if (typeof value !== "number") return false;
      constrainTo(c, { lo: -Infinity, loInc: false, hi: value, hiInc: false });
      return true;
    case "lte":
      if (typeof value !== "number") return false;
      constrainTo(c, { lo: -Infinity, loInc: false, hi: value, hiInc: true });
      return true;
    case "gt":
      if (typeof value !== "number") return false;
      constrainTo(c, { lo: value, loInc: false, hi: Infinity, hiInc: false });
      return true;
    case "gte":
      if (typeof value !== "number") return false;
      constrainTo(c, { lo: value, loInc: true, hi: Infinity, hiInc: false });
      return true;
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) return false;
      const [lo, hi] = value;
      if (typeof lo !== "number" || typeof hi !== "number") return false;
      // Exclusive-inclusive (lo, hi] — matches the engine's resolver and the
      // source tables' "Above lo to hi" band language.
      constrainTo(c, { lo, loInc: false, hi, hiInc: true });
      return true;
    }
    case "in": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "number")) return false;
      const kept: Interval[] = [];
      for (const v of value as number[]) {
        for (const i of c.intervals) {
          const hit = intersectIntervals(i, point(v));
          if (hit) {
            kept.push(hit);
            break;
          }
        }
      }
      c.intervals = kept;
      return true;
    }
    default:
      return false;
  }
}

function isEmptyNumeric(c: NumericConstraint): boolean {
  return c.intervals.every(
    (i) => i.lo === i.hi && c.excluded.includes(i.lo),
  ) || c.intervals.length === 0;
}

function applyBooleanOp(c: BooleanConstraint, op: string, value: unknown): boolean {
  if (typeof value !== "boolean") return false;
  if (op === "eq") {
    c.allowed = new Set([...c.allowed].filter((v) => v === value));
    return true;
  }
  if (op === "neq") {
    c.allowed = new Set([...c.allowed].filter((v) => v !== value));
    return true;
  }
  return false;
}

/**
 * True when some fact assignment satisfies both conjunctions at once.
 * Errs toward true (overlap) for anything it cannot model.
 */
export function conditionsCanCooccur(a: RuleCondition[], b: RuleCondition[]): boolean {
  const constraints = new Map<string, FactConstraint>();

  for (const cond of [...a, ...b]) {
    let c = constraints.get(cond.fact);
    if (c === undefined) {
      c = BOOLEAN_FACTS.has(cond.fact)
        ? { kind: "boolean", allowed: new Set([true, false]) }
        : fullNumeric();
      constraints.set(cond.fact, c);
    }
    if (c.kind === "opaque") continue;

    const ok =
      c.kind === "numeric"
        ? applyNumericOp(c, cond.op, cond.value)
        : applyBooleanOp(c, cond.op, cond.value);
    if (!ok) constraints.set(cond.fact, { kind: "opaque" });
  }

  for (const c of constraints.values()) {
    if (c.kind === "numeric" && isEmptyNumeric(c)) return false;
    if (c.kind === "boolean" && c.allowed.size === 0) return false;
  }
  return true;
}
