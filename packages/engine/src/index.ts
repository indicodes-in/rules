/**
 * @indicodes/engine — deterministic rule resolver and parameter computation.
 *
 * Pure TypeScript, zero I/O: (parcelFacts, ruleSet, evaluationDate) → ComputedParameters.
 * Resolver semantics: spec §5.2. Formula logic lives in ./formulas/ with constants
 * supplied by rule files only — no regulatory value may appear in this package
 * (CLAUDE.md principle 3).
 *
 * The resolver and fact vocabulary are implemented under their own M0 tasks;
 * this module is the package entry point.
 */

export const ENGINE_PACKAGE = "@indicodes/engine";

export { formulaIds } from "./formulas/index.js";
export { validateParcelFacts, type FactsValidation } from "./facts.js";
export { computeDerived, type ComputeResult, type DerivedValue } from "./compute.js";
export { bandGaps, findBandGap, ruleBand, type BandGap, type BandNeighbour } from "./gaps.js";
export { findInapplicable, type Inapplicable } from "./applicability.js";
export {
  DISCLAIMER,
  evaluatePlot,
  type EvaluateOptions,
  type Flag,
  type ParameterResult,
  type PlotEvaluation,
} from "./evaluate.js";
export type { CategoryFloor, CorpusCurrency, NotModelled, UnreadSuccessor } from "./declarations.js";
export {
  EngineError,
  materializeEffectiveTo,
  resolveAll,
  resolveParameter,
  type ResolutionOutcome,
  type ResolverOptions,
} from "./resolver.js";
export {
  CONDITION_FACTS,
  PARAMETERS,
  type Citation,
  type ConditionFact,
  type ConditionOp,
  type ParcelFacts,
  type Parameter,
  type Rule,
  type RuleCondition,
  type RuleOutput,
  type Verification,
} from "./types.js";
