/**
 * Evaluates one plot against a rule corpus (spec §5.4 contract): resolved
 * parameters with citations, flags for everything the engine declines to
 * compute, and dated meta. Pure — no I/O; the caller loads the corpus and its
 * declarations. This is the whole answer a plot gets from the rules; the app
 * adds only geometry around it.
 */

import { computeDerived } from "./compute.js";
import { findInapplicable } from "./applicability.js";
import type { CategoryFloor, CorpusCurrency } from "./declarations.js";
import { findBandGap, ruleBand, type BandGap } from "./gaps.js";
import { resolveAll, resolveParameter, type ResolutionOutcome, type ResolverOptions } from "./resolver.js";
import { PARAMETERS, type Citation, type Parameter, type ParcelFacts, type Rule } from "./types.js";

/** Required on every results surface (CLAUDE.md working agreements). */
/** Fact names as an architect says them, for user-facing flag text. */
const FACT_LABELS: Record<string, string> = {
  stilt_parking: "stilt parking",
  basement_intended: "a basement",
  is_corner_plot: "a corner plot",
  roads_abutting: "roads abutting",
  road_width_m: "road width",
  plot_area_sqm: "plot area",
  land_use: "land use",
  authority: "the authority",
};

function factLabel(fact: string): string {
  return FACT_LABELS[fact] ?? fact;
}

/** `true`/`false` read as yes/no in a sentence; everything else as written. */
function factValue(value: unknown): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value);
}

export const DISCLAIMER =
  "Decision support, not statutory sanction. Verify with the sanctioning authority.";

export interface ParameterResult {
  value: number | boolean | null;
  unit: string | null;
  citations: Citation[];
  /** Set for directly resolved parameters. */
  rule_id?: string;
  /** Set for derived parameters (spec §5.3) instead of rule_id. */
  derived_via?: string;
  input_rule_ids?: string[];
  /** The rule's `user_caveat`, when it carries one — a condition the bare
   * number doesn't express (fire clearance, regularization relief, a side
   * asymmetry we can't represent). Deliberately NOT `notes`: that field is
   * the verifier's working record, and piping it here put band-boundary
   * arithmetic and "verifier to confirm" in front of architects. */
  note?: string;
}

export interface Flag {
  code: string;
  message: string;
  parameter?: string;
  citations: Citation[];
}

/** Everything a plot gets from the rules. */
export interface PlotEvaluation {
  parameters: Record<string, ParameterResult>;
  flags: Flag[];
  meta: {
    evaluation_date: string;
    rule_corpus_version: string;
    disclaimer: string;
    /* How current the corpus is. A cited number with no indication of what it
       was read against, when something newer has been published, is only half
       an answer. Optional: an older deploy has no declaration. */
    currency?: CorpusCurrency;
  };
}

/** Display unit for the facts a band table can be indexed by. */
const FACT_UNITS: Record<string, string> = {
  plot_area_sqm: "m²",
  road_width_m: "m",
  roads_abutting: "",
};

/**
 * Names both neighbouring rows so the user can see the gap is in the
 * regulation, not in our corpus — and can check it against the source.
 */
function bandGapMessage(parameter: string, gap: BandGap): string {
  const unit = FACT_UNITS[gap.fact] ?? "";
  const amount = `${gap.value}${unit ? ` ${unit}` : ""}`;
  const quote = (text: string | null, fallback: string): string =>
    text ? `“${text}”` : fallback;
  return (
    `No value for "${parameter}": the source table has no row for exactly ${amount}. ` +
    `The row below reads ${quote(gap.below.source_text, `up to ${gap.below.bound}`)} and the ` +
    `row above reads ${quote(gap.above.source_text, `from ${gap.above.bound}`)} — the ` +
    `regulation itself does not say which governs this exact value, so we don't choose one. ` +
    `Re-measure the plot precisely, or confirm the applicable row with the sanctioning authority.`
  );
}

/** How close to a band edge is worth mentioning: 1% of the plot, min 1 m². */
function edgeTolerance(areaSqm: number): number {
  return Math.max(1, areaSqm * 0.01);
}

/** Human label for a parameter in the band-edge message. */
const EDGE_LABELS: Record<string, string> = {
  far: "FAR",
  ground_coverage_pct: "ground coverage",
  dwelling_units: "dwelling units",
  setback_front_m: "front setback",
  setback_rear_m: "rear setback",
  setback_side_m: "side setback",
  max_height_m: "max height",
};

const asScalar = (o: ResolutionOutcome | undefined): number | boolean | null =>
  o?.status === "resolved" && (o.rule.output.type === "scalar" || o.rule.output.type === "boolean")
    ? o.rule.output.value
    : null;

/**
 * What changes across the nearest band edge. Dwelling units and setbacks do
 * step there, and a surveyed boundary is usually the one thing the user can
 * still influence — so say so rather than letting them discover it by
 * re-typing numbers.
 *
 * This used to call every table a cliff: "250 m² gives FAR 300 and 250.5 m²
 * gives FAR 225, a quarter of the buildable area gone for half a square
 * metre". The plan says otherwise — a plot may not get less than the largest
 * plot in the band below (see categoryFloor) — so across an edge the ratio can
 * fall without what it permits falling with it. A parameter held up by that
 * minimum on either side is left out of the comparison rather than reported
 * as a drop that does not happen.
 */
function nearBandEdge(
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  options: ResolverOptions,
  outcomes: Record<string, ResolutionOutcome>,
  heldByMinimum: (parameter: Parameter, area: number) => boolean,
): Flag | null {
  const area = facts.plot_area_sqm;
  const tolerance = edgeTolerance(area);

  // Nearest band boundary across every parameter banded on plot area.
  let nearest: { bound: number; below: boolean } | null = null;
  for (const outcome of Object.values(outcomes)) {
    if (outcome.status !== "resolved") continue;
    const band = ruleBand(outcome.rule);
    if (!band || band.fact !== "plot_area_sqm") continue;
    for (const [bound, below] of [
      [band.lo, false],
      [band.hi, true],
    ] as [number, boolean][]) {
      if (!Number.isFinite(bound) || Math.abs(area - bound) > tolerance) continue;
      if (nearest === null || Math.abs(area - bound) < Math.abs(area - nearest.bound)) {
        nearest = { bound, below };
      }
    }
  }
  if (nearest === null) return null;

  // What the other side of that edge would give. Step just past the bound —
  // the bands are (lo, hi], so the neighbour sits an epsilon beyond it.
  const step = Math.max(1e-6, nearest.bound * 1e-9);
  const otherArea = nearest.below ? nearest.bound + step : nearest.bound - step;
  if (otherArea <= 0) return null;
  const otherOutcomes = resolveAll(
    { ...facts, plot_area_sqm: otherArea },
    ruleSet,
    evaluationDate,
    options,
  );

  const changes: string[] = [];
  for (const [parameter, label] of Object.entries(EDGE_LABELS)) {
    if (
      heldByMinimum(parameter as Parameter, area) ||
      heldByMinimum(parameter as Parameter, otherArea)
    ) {
      continue;
    }
    const here = asScalar(outcomes[parameter]);
    const there = asScalar(otherOutcomes[parameter as keyof typeof otherOutcomes]);
    if (here === null || there === null || here === there) continue;
    const fmt = (v: number | boolean): string =>
      parameter === "far" && typeof v === "number" ? `${v / 100}` : String(v);
    changes.push(`${label} ${fmt(here)} → ${fmt(there)}`);
  }
  if (changes.length === 0) return null;

  const distance = Math.abs(area - nearest.bound);
  const where =
    distance < 0.005
      ? `sits exactly on the ${nearest.bound} m² band edge`
      : `is ${distance.toFixed(2).replace(/\.?0+$/, "")} m² ${nearest.below ? "under" : "over"} ` +
        `the ${nearest.bound} m² band edge`;
  return {
    code: "near_band_edge",
    message:
      `This plot ${where}. Just across it: ${changes.join(", ")}. Confirm the surveyed area ` +
      `before designing to these numbers.`,
    citations: [],
  };
}

/** A band row undercut by the minimum the band below guarantees. */
interface FloorBite {
  provision: CategoryFloor;
  /** The row that resolved for this plot, and its ratio. */
  rule: Rule;
  value: number;
  /** The row below, whose largest plot sets the minimum. */
  lower: Rule;
  /** That largest plot: the shared edge, which (lo, hi] gives to the row below. */
  bound: number;
  /** m² the largest plot below is entitled to, following the minimum down. */
  minimum: number;
  /** m² this row's own ratio gives this plot. */
  own: number;
}

/** One parameter's scalar outcome at a given plot area, or null. */
function scalarAt(
  parameter: Parameter,
  area: number,
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  options: ResolverOptions,
): { rule: Rule; value: number } | null {
  const o = resolveParameter(parameter, { ...facts, plot_area_sqm: area }, ruleSet, evaluationDate, options);
  if (o.status !== "resolved") return null;
  const out = o.rule.output;
  return out.type === "scalar" && typeof out.value === "number" ? { rule: o.rule, value: out.value } : null;
}

/**
 * MPD-2021 p.64 (ii), and the same words in MPD-2047 and UBBL: coverage and
 * FAR "permissible in any plot in a category, shall not be less than that
 * permissible and available to the largest plot in the next lower category".
 *
 * The resolver reads each band row on its own, so just past an edge it served
 * the row's ratio even where that gives less than the largest plot below
 * already has: 225% of 300 m² is 675 m², when 250 m² at 300% is 750. This
 * finds those cases. It deliberately does not compute the higher figure —
 * whether the minimum is an area, and how it meets setbacks and height, is a
 * reading a person has to confirm (docs/tasks.md) — so the caller declines,
 * the conservative behaviour CLAUDE.md asks for.
 *
 * Which parameters, which documents and the clause itself come from
 * rules/category-floor.json. Every number here is a band row from the corpus.
 */
function categoryFloor(
  parameter: Parameter,
  area: number,
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  options: ResolverOptions,
  provisions: readonly CategoryFloor[],
): FloorBite | null {
  if (!provisions.some((p) => p.parameters.includes(parameter))) return null;
  const here = scalarAt(parameter, area, facts, ruleSet, evaluationDate, options);
  if (!here) return null;
  const covers = (rule: Rule): CategoryFloor | undefined =>
    provisions.find(
      (p) =>
        p.parameters.includes(parameter) &&
        rule.citations.some((c) => p.applies_to_docs.includes(c.doc_id)),
    );
  const provision = covers(here.rule);
  const band = ruleBand(here.rule);
  if (!provision || !band || band.fact !== provision.fact || !Number.isFinite(band.lo)) return null;

  // Bands are (lo, hi], so the edge itself is the largest plot of the row below…
  const lower = scalarAt(parameter, band.lo, facts, ruleSet, evaluationDate, options);
  if (!lower || covers(lower.rule) !== provision) return null;
  // …and that plot is itself owed whatever the row below *it* guarantees.
  const lowerBite = categoryFloor(parameter, band.lo, facts, ruleSet, evaluationDate, options, provisions);
  const minimum = Math.max((band.lo * lower.value) / 100, lowerBite?.minimum ?? 0);
  const own = (area * here.value) / 100;
  return minimum > own
    ? { provision, rule: here.rule, value: here.value, lower: lower.rule, bound: band.lo, minimum, own }
    : null;
}

const round2 = (n: number): string => String(Math.round(n * 100) / 100);

/** Both figures, so the reader can see why the row's own ratio is not the answer. */
function floorMessage(parameter: Parameter, bite: FloorBite): string {
  const far = parameter === "far";
  const what = far ? "floor area" : "ground coverage";
  const ratio = far ? `FAR ${bite.value / 100}` : `${bite.value}% coverage`;
  return (
    `Not shown. The band below gives its largest plot (${round2(bite.bound)} m²) ` +
    `${round2(bite.minimum)} m² of ${what}; ${ratio} gives this plot ${round2(bite.own)} m². ` +
    `The regulation says a plot may not get less than the largest plot in the band below. How ` +
    `that minimum is applied isn't confirmed yet, so we show no figure rather than one that is too low.`
  );
}

/** Resolver options plus the corpus's own declared omissions. */
export type EvaluateOptions = ResolverOptions & {
  /** From rules/not-modelled.json; see loadNotModelled. */
  notModelled?: Map<string, { reason: string }>;
  /** From rules/corpus-currency.json; see loadCorpusCurrency. */
  currency?: CorpusCurrency;
  /** From rules/category-floor.json; see loadCategoryFloors and categoryFloor. */
  categoryFloors?: readonly CategoryFloor[];
};

export function evaluatePlot(
  facts: ParcelFacts,
  ruleSet: readonly Rule[],
  evaluationDate: string,
  corpusVersion: string,
  options: EvaluateOptions = {},
): PlotEvaluation {
  const meta = {
    evaluation_date: evaluationDate,
    rule_corpus_version: corpusVersion,
    disclaimer: DISCLAIMER,
    /* Only when there is something to warn about. The field exists to say
       "something newer has been published and we have not read it"; an empty
       declaration attached to every result is noise, and it leaked the real
       corpus's state into tests running a synthetic one. */
    ...(options.currency && options.currency.unread_successors.length > 0
      ? { currency: options.currency }
      : {}),
  };

  // Out-of-scope gate (spec §8): special areas and non-residential uses get
  // flags naming the constraint and no computed parameters — never weakened
  // without a PRD change.
  const scopeFlags: Flag[] = [];
  for (const constraint of facts.special_area_flags) {
    scopeFlags.push({
      code: "special_area",
      message: `These norms don't apply here — ${constraint}. Consult the specific regulations.`,
      citations: [],
    });
  }
  if (facts.land_use !== "residential_plotted") {
    scopeFlags.push({
      code: "out_of_scope_land_use",
      message:
        `These norms don't apply here — land use "${facts.land_use}" is outside ` +
        `the plotted-residential MVP scope. Consult the specific regulations.`,
      citations: [],
    });
  }

  if (scopeFlags.length > 0) {
    return { parameters: {}, flags: scopeFlags, meta };
  }

  const outcomes = resolveAll(facts, ruleSet, evaluationDate, options);
  const parameters: Record<string, ParameterResult> = {};
  const flags: Flag[] = [];
  const floors = options.categoryFloors ?? [];
  const minimumOf = (parameter: Parameter, area: number): FloorBite | null =>
    floors.length === 0
      ? null
      : categoryFloor(parameter, area, facts, ruleSet, evaluationDate, options, floors);
  // Withheld because the band below guarantees more than this row gives.
  const declined = new Set<Parameter>();

  for (const parameter of PARAMETERS) {
    const outcome = outcomes[parameter];
    if (outcome.status === "no_applicable_rule") {
      // A missing rule and a gap the source table itself leaves between two
      // rows look identical here but mean opposite things to the user, so
      // distinguish them before telling anyone to "report this plot".
      /* Third cause, and the commonest: the parameter simply does not apply
         to this plot. Every verified rule for stilt_far_exemption is gated on
         stilt_parking == true, so an ordinary plot with no stilt intended was
         told twice to report a non-problem. A flag that cries wolf teaches
         people to ignore the flags that matter, which is fatal for a product
         whose whole claim is that its refusals mean something. */
      const na = findInapplicable(parameter, facts, ruleSet, evaluationDate, options);
      if (na) {
        flags.push({
          code: "not_applicable",
          parameter,
          // The parameter is already named by `parameter`; repeating it, and
          // spelling the fact out as `stilt_parking being true, and you gave
          // false`, made a four-line paragraph out of one short sentence.
          message: `Conditional on ${factLabel(na.fact)} being ${factValue(na.required)} — you set it to ${factValue(na.actual)}.`,
          citations: [],
        });
        continue;
      }
      const declared = options.notModelled?.get(parameter);
      const gap = findBandGap(parameter, facts, ruleSet, evaluationDate, options);
      flags.push(
        gap
          ? {
              code: "source_band_gap",
              parameter,
              message: bandGapMessage(parameter, gap),
              citations: [...gap.below.citations, ...gap.above.citations],
            }
          : declared
            ? {
                /* A fourth cause: we chose not to model this. The reason used
                   to live only in a commit message, where nothing at runtime
                   could read it, so a deliberate omission reached the user as
                   a defect they were asked to report. */
                code: "not_modelled",
                parameter,
                message: declared.reason,
                citations: [],
              }
            : {
                code: "no_applicable_rule",
                parameter,
                message: `No applicable verified rule for "${parameter}" — not covered; report this plot.`,
                citations: [],
              },
      );
      continue;
    }
    if (outcome.status === "rule_conflict") {
      flags.push({
        code: "rule_conflict",
        parameter,
        message:
          `Conflicting rules for "${parameter}" (${outcome.ruleIds.join(", ")}) — ` +
          `corpus error, computation declined.`,
        citations: [],
      });
      continue;
    }
    const bite = minimumOf(parameter, facts.plot_area_sqm);
    if (bite) {
      flags.push({
        code: "category_floor",
        parameter,
        message: floorMessage(parameter, bite),
        citations: [bite.provision.citation, ...bite.lower.citations, ...bite.rule.citations],
      });
      declined.add(parameter);
      continue;
    }
    const rule = outcome.rule;
    switch (rule.output.type) {
      case "scalar":
        parameters[parameter] = {
          value: rule.output.value,
          unit: rule.output.unit,
          citations: rule.citations,
          rule_id: rule.rule_id,
          ...(rule.user_caveat ? { note: rule.user_caveat } : {}),
        };
        break;
      case "boolean":
        parameters[parameter] = {
          value: rule.output.value,
          unit: null,
          citations: rule.citations,
          rule_id: rule.rule_id,
          ...(rule.user_caveat ? { note: rule.user_caveat } : {}),
        };
        break;
      case "formula":
        // Computed below via computeDerived; uncomputable formulas flag there.
        break;
      case "flag":
        flags.push({
          code: rule.output.code,
          parameter,
          message: rule.output.message,
          citations: rule.citations,
        });
        break;
    }
  }

  // Nothing resolved and every rule we hold post-dates the query: the corpus
  // isn't deficient, the date is before the regulations existed. Eleven
  // identical "not covered; report this plot" lines said neither.
  if (Object.keys(parameters).length === 0) {
    const earliest = ruleSet
      .map((r) => r.effective_from)
      .filter((d): d is string => d !== null)
      .sort()[0];
    if (earliest !== undefined && earliest > evaluationDate) {
      return {
        parameters: {},
        flags: [
          {
            code: "no_rules_in_force",
            message:
              `No rules were in force on ${evaluationDate}. The regulations we hold — ` +
              `MPD-2021 and UBBL 2016 — begin on ${earliest}. Pick a later date to evaluate.`,
            citations: [],
          },
        ],
        meta,
      };
    }
  }

  const edge = nearBandEdge(
    facts,
    ruleSet,
    evaluationDate,
    options,
    outcomes,
    (p, area) => minimumOf(p, area) !== null,
  );
  if (edge) flags.push(edge);

  // Nothing may be derived from a value we declined to show: a buildable area
  // or a parking count computed from the withheld FAR is the same too-low
  // number in a different unit.
  const computed = computeDerived(
    Object.fromEntries(
      Object.entries(outcomes).filter(([p]) => !declined.has(p as Parameter)),
    ) as Partial<Record<Parameter, ResolutionOutcome>>,
    facts,
  );
  for (const [name, value] of Object.entries(computed.derived)) {
    parameters[name] = {
      value: value.value,
      unit: value.unit,
      citations: value.citations,
      derived_via: value.derived_via,
      input_rule_ids: value.input_rule_ids,
      // Carries the arithmetic for values the cited clauses don't literally
      // state (e.g. an ECS count derived from a per-100 m² rate).
      ...(value.note ? { note: value.note } : {}),
    };
  }
  flags.push(...computed.flags);

  return { parameters, flags, meta };
}
