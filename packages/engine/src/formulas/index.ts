/**
 * Formula registry (spec §3.3): formula LOGIC lives in the engine
 * (src/compute.ts); formula CONSTANTS live in rule files only.
 *
 * `pnpm rules:validate` checks every rule's `output.formula_id` against
 * this set, so a rule may not reference a formula the engine cannot compute.
 */
/**
 *   ecs_per_bua  {ecs_per_100sqm}  ECS per 100 m² of floor area (plot × FAR)
 *   ecs_fixed    {ecs}             a fixed number of ECS for the plot, whatever
 *                                  its floor area (MPD-2047 Table 11.7: "1.0 ECS
 *                                  in plots of size upto 250 sqm")
 */
export const formulaIds: ReadonlySet<string> = new Set<string>(["ecs_per_bua", "ecs_fixed"]);
