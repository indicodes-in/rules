/**
 * Writes the blank reader worksheet: `pnpm benchmark:worksheet` (root).
 * Each reader gets their own copy of data/validation/worksheet.csv.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scenarios, worksheetCsv } from "./benchmark-worksheet.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = path.join(repoRoot, "data", "validation", "worksheet.csv");
writeFileSync(out, worksheetCsv(scenarios()));
console.log(`Wrote ${scenarios().length} scenarios to ${path.relative(repoRoot, out)}`);
