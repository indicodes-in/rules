/**
 * Parcel fact validation (spec §5.1). Pure: turns untrusted input (API
 * request bodies, fixtures) into a typed ParcelFacts or a list of errors.
 * The fact vocabulary is closed — unknown fields are rejected, so a typo'd
 * fact can never silently pass through to resolution.
 */

import type { ParcelFacts } from "./types.js";

export type FactsValidation =
  | { ok: true; facts: ParcelFacts }
  | { ok: false; errors: string[] };

const FACT_KEYS = [
  "plot_area_sqm",
  "road_width_m",
  "roads_abutting",
  "is_corner_plot",
  "land_use",
  "authority",
  "stilt_parking",
  "basement_intended",
  "special_area_flags",
] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function validateParcelFacts(input: unknown): FactsValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["facts must be an object"] };
  }
  const obj = input as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(obj)) {
    if (!(FACT_KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown fact "${key}" — the fact vocabulary is closed (spec §5.1)`);
    }
  }
  for (const key of FACT_KEYS) {
    if (!(key in obj)) errors.push(`missing fact "${key}"`);
  }
  if (errors.length > 0) return { ok: false, errors };

  if (!isFiniteNumber(obj.plot_area_sqm) || obj.plot_area_sqm <= 0) {
    errors.push("plot_area_sqm must be a finite number > 0 (m²)");
  }
  if (!isFiniteNumber(obj.road_width_m) || obj.road_width_m < 0) {
    errors.push("road_width_m must be a finite number ≥ 0 (m, max abutting road)");
  }
  if (
    !isFiniteNumber(obj.roads_abutting) ||
    !Number.isInteger(obj.roads_abutting) ||
    obj.roads_abutting < 0
  ) {
    errors.push("roads_abutting must be an integer ≥ 0");
  }
  for (const key of ["is_corner_plot", "stilt_parking", "basement_intended"] as const) {
    if (typeof obj[key] !== "boolean") errors.push(`${key} must be a boolean`);
  }
  for (const key of ["land_use", "authority"] as const) {
    if (typeof obj[key] !== "string" || obj[key] === "") {
      errors.push(`${key} must be a non-empty string`);
    }
  }
  if (
    !Array.isArray(obj.special_area_flags) ||
    !obj.special_area_flags.every((f) => typeof f === "string")
  ) {
    errors.push("special_area_flags must be an array of strings");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    facts: {
      plot_area_sqm: obj.plot_area_sqm as number,
      road_width_m: obj.road_width_m as number,
      roads_abutting: obj.roads_abutting as number,
      is_corner_plot: obj.is_corner_plot as boolean,
      land_use: obj.land_use as string,
      authority: obj.authority as string,
      stilt_parking: obj.stilt_parking as boolean,
      basement_intended: obj.basement_intended as boolean,
      special_area_flags: obj.special_area_flags as string[],
    },
  };
}
