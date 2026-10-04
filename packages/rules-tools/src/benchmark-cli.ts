/**
 * CLI for the spec §10 validation benchmark: `pnpm test:benchmark` (root).
 * Exit 0 only when at least one real double-read comparison exists and every
 * real double-read case matches — the launch gate. Sanctioned plans are
 * reported as supporting evidence and never decide it; synthetic smoke cases
 * never count.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases, runBenchmark } from "./benchmark.js";
import { loadDeclarations, loadRuleCorpus } from "./corpus.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cases = loadCases(path.join(repoRoot, "data", "validation"));
const rulesDir = path.join(repoRoot, "rules");
// Same declarations /evaluate applies, or the gate tests answers nobody is served.
const report = runBenchmark(cases, loadRuleCorpus(rulesDir), loadDeclarations(rulesDir));

for (const r of report.results) {
  const tag = r.synthetic ? " [synthetic smoke]" : r.kind === "sanctioned_plan" ? " [sanctioned plan]" : "";
  const verdict = r.kind === "sanctioned_plan" ? (r.passed ? "AGREE" : "DIFFER") : r.passed ? "PASS" : "FAIL";
  console.log(`${verdict}  ${r.case_id}${tag}  (${r.checked.length} checked)`);
  for (const line of r.failures) console.log(`      ✗ ${line}`);
  for (const line of r.declined) console.log(`      – ${line}`);
  for (const line of r.ambiguous) console.log(`      ? ${line}`);
}

const ambiguous = report.results.filter((r) => !r.synthetic).flatMap((r) => r.ambiguous.map((a) => `${r.case_id} ${a}`));
console.log(
  `\n${report.doubleReadPassed}/${report.doubleReadCases} double-read cases match ` +
    `(${report.checkedParameters} parameter comparisons; target 25–30 cases).`,
);
console.log(
  `${report.sanctionedAgreeing}/${report.sanctionedCases} sanctioned plans agree — supporting evidence, not the gate.`,
);
if (ambiguous.length) {
  console.log(`${ambiguous.length} reading(s) where the readers differ → interpretations list (spec §10).`);
}

if (report.checkedParameters === 0) {
  console.error(
    "GATE NOT MET: no agreed double-read values in data/validation/ — two blind readers " +
      "working the worksheet is an open [HUMAN] task (spec §10).",
  );
  process.exit(1);
}
if (!report.gatePassed) {
  console.error(
    "GATE NOT MET: every double-read case must match exactly before launch (spec §10). " +
      "Triage: our rule wrong → fix via verification; readers wrong → re-read with the page; " +
      "genuinely unsettled → edge-case ledger and decline.",
  );
  process.exit(1);
}
console.log("GATE MET: every agreed double-read value matches.");
