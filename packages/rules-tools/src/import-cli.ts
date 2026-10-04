/**
 * Pairs two filled reader worksheets into double-read case files:
 *
 *   pnpm benchmark:import --as-of 2026-08-19 --blind \
 *     --sheet reader_a:2026-10-01:path/to/a.csv \
 *     --sheet reader_b:2026-10-03:path/to/b.csv
 *
 * `--blind` is your statement that neither reader saw the engine's answers or
 * the other's sheet; without it the cases are written but never count.
 * Existing case files are not overwritten unless `--force` is given.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCases, type FilledSheet } from "./benchmark-worksheet.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const asOf = option("--as-of");
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error("--as-of YYYY-MM-DD is required: the date the readers read the documents as in force.");
  process.exit(1);
}

const sheets: FilledSheet[] = [];
args.forEach((a, i) => {
  if (a !== "--sheet") return;
  const [reader, readOn, ...file] = (args[i + 1] ?? "").split(":");
  const filePath = file.join(":");
  if (!reader || !readOn || !filePath) {
    console.error(`--sheet expects reader:YYYY-MM-DD:path, got "${args[i + 1] ?? ""}"`);
    process.exit(1);
  }
  // pnpm runs this from the package folder; resolve paths from where it was invoked.
  const from = process.env.INIT_CWD ?? process.cwd();
  sheets.push({ reader, read_on: readOn, csv: readFileSync(path.resolve(from, filePath), "utf8") });
});
if (sheets.length < 2) {
  console.error("Give at least two --sheet arguments, one per reader.");
  process.exit(1);
}

const cases = buildCases(sheets, { as_of: asOf, blind: flag("--blind") });
let written = 0;
for (const c of cases) {
  const out = path.join(repoRoot, "data", "validation", `${c.case_id}.json`);
  if (existsSync(out) && !flag("--force")) {
    console.log(`skip  ${c.case_id} (exists; --force to replace)`);
    continue;
  }
  writeFileSync(out, JSON.stringify(c, null, 2) + "\n");
  written++;
}
console.log(`Wrote ${written} case file(s). Run pnpm test:benchmark to compare.`);
if (!flag("--blind")) console.log("Not marked --blind: these cases will not count toward the gate.");
