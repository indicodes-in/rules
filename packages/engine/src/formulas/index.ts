/**
 * Formula registry (spec §3.3): formula LOGIC lives in the engine
 * (src/compute.ts); formula CONSTANTS live in rule files only.
 *
 * `pnpm rules:validate` checks every rule's `output.formula_id` against
 * this set, so a rule may not reference a formula the engine cannot compute.
 */
export const formulaIds: ReadonlySet<string> = new Set<string>(["ecs_per_bua"]);
