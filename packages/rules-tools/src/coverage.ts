/**
 * `pnpm rules:coverage` — reports, per spec §3.1 parameter, how many
 * verified and draft rules exist in the corpus, so the gap to "every
 * parameter covered by verified rules" (M3 exit criterion) is visible.
 * Exits non-zero while any parameter lacks a verified rule — informational
 * during the build, a gate once the corpus is meant to be complete.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARAMETERS } from "@indicodes/engine";
import type { RuleFile } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rulesDir = path.join(repoRoot, "rules");

const counts = new Map<string, { verified: number; draft: number }>(
  PARAMETERS.map((p) => [p, { verified: 0, draft: 0 }]),
);

for (const entry of readdirSync(rulesDir)) {
  if (entry === "schema") continue;
  const dir = path.join(rulesDir, entry);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const rule = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as RuleFile;
    const bucket = counts.get(rule.parameter);
    if (!bucket) continue; // unknown parameters are rules:validate's problem
    if (rule.verification.status === "verified") bucket.verified += 1;
    if (rule.verification.status === "draft") bucket.draft += 1;
  }
}

const width = Math.max(...PARAMETERS.map((p) => p.length));
let uncovered = 0;
console.log(`rules:coverage — verified rules per spec §3.1 parameter\n`);
for (const parameter of PARAMETERS) {
  const { verified, draft } = counts.get(parameter)!;
  const mark = verified > 0 ? "✓" : "✗";
  if (verified === 0) uncovered += 1;
  const draftNote = draft > 0 ? `  (${draft} draft awaiting verification)` : "";
  console.log(`  ${mark} ${parameter.padEnd(width)}  verified: ${verified}${draftNote}`);
}
console.log(
  `\n${PARAMETERS.length - uncovered}/${PARAMETERS.length} parameters covered by verified rules.`,
);
if (uncovered > 0) {
  console.log(`Coverage incomplete — corpus work pending (M1 extraction → M3 verification).`);
  process.exit(1);
}
