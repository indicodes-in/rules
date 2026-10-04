/**
 * `pnpm rules:validate` — validates the canonical rule corpus:
 * every rules/<doc>/<rule_id>.json against rules/schema/rule.schema.json,
 * then the cross-file invariants (see validate.ts). Exits non-zero on any
 * error so CI can gate on it. rules/schema/ itself (fixtures) is not scanned.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bandGaps, formulaIds, PARAMETERS, type Rule } from "@indicodes/engine";
import { compileRuleSchema, schemaErrors } from "./schema.js";
import { crossFileChecks } from "./validate.js";
import { definitionChecks, undefinedTerms } from "./definitions.js";
import { missingExtracts, type ExtractManifest, type PageCitation } from "./pages.js";
import type { CorpusDefinition, CorpusRule } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rulesDir = path.join(repoRoot, "rules");

function rel(p: string): string {
  return path.relative(repoRoot, p).replaceAll("\\", "/");
}

const errors: string[] = [];

const schema = JSON.parse(
  readFileSync(path.join(rulesDir, "schema", "rule.schema.json"), "utf8"),
) as object;
const validateSchema = compileRuleSchema(schema);

const sources = JSON.parse(
  readFileSync(path.join(repoRoot, "sources", "sources.json"), "utf8"),
) as { documents: Array<{ doc_id: string }> };
const registeredDocIds = new Set(sources.documents.map((d) => d.doc_id));

// `definitions` holds a different node type with its own schema, and `schema`
// holds the schemas themselves — neither is a source-document rule directory.
const NON_RULE_DIRS = new Set(["schema", "definitions"]);
const docDirs = readdirSync(rulesDir)
  .filter((name) => !NON_RULE_DIRS.has(name))
  .map((name) => path.join(rulesDir, name))
  .filter((p) => statSync(p).isDirectory());

const corpus: CorpusRule[] = [];
for (const dir of docDirs) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const filePath = path.join(dir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (e) {
      errors.push(`${rel(filePath)}: invalid JSON — ${(e as Error).message}`);
      continue;
    }
    if (!validateSchema(parsed)) {
      for (const msg of schemaErrors(validateSchema)) {
        errors.push(`${rel(filePath)}: ${msg}`);
      }
      continue;
    }
    corpus.push({
      filePath: rel(filePath),
      fileStem: path.basename(file, ".json"),
      rule: parsed as CorpusRule["rule"],
    });
  }
}

errors.push(...crossFileChecks(corpus, { registeredDocIds, formulaIds }));

// Definitions: what the words in a value mean. Loaded and checked separately
// because they are a different node type — see definitions.ts for why the
// corpus needs them at all.
const definitionsDir = path.join(rulesDir, "definitions");
const definitions: CorpusDefinition[] = [];
if (existsSync(definitionsDir)) {
  const validateDefinition = compileRuleSchema(
    JSON.parse(
      readFileSync(path.join(rulesDir, "schema", "definition.schema.json"), "utf8"),
    ) as object,
  );
  for (const file of readdirSync(definitionsDir).filter((f) => f.endsWith(".json"))) {
    const filePath = path.join(definitionsDir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (e) {
      errors.push(`${rel(filePath)}: invalid JSON — ${(e as Error).message}`);
      continue;
    }
    if (!validateDefinition(parsed)) {
      for (const msg of schemaErrors(validateDefinition)) {
        errors.push(`${rel(filePath)}: ${msg}`);
      }
      continue;
    }
    definitions.push({
      filePath: rel(filePath),
      fileStem: path.basename(file, ".json"),
      definition: parsed as CorpusDefinition["definition"],
    });
  }
  errors.push(...definitionChecks(definitions, corpus, { registeredDocIds }));
}

// Band-coverage sweep. Overlap checks catch two rules claiming one plot; this
// catches the opposite — a value no row reaches, which resolves to nothing and
// used to reach the user as "not covered; report this plot". Gaps that are
// genuinely in the printed regulation are declared in rules/known-gaps.json;
// anything else is an encoding hole and fails the build.
interface KnownGap {
  parameter: string;
  fact: string;
  from: number;
  to: number;
}
const knownGaps = (
  JSON.parse(readFileSync(path.join(rulesDir, "known-gaps.json"), "utf8")) as { gaps: KnownGap[] }
).gaps;
const isKnown = (parameter: string, fact: string, from: number, to: number): boolean =>
  knownGaps.some(
    (g) => g.parameter === parameter && g.fact === fact && g.from === from && g.to === to,
  );

const ruleSet = corpus.map((c) => c.rule as unknown as Rule);
const declaredGaps: string[] = [];
for (const parameter of PARAMETERS) {
  for (const gap of bandGaps(ruleSet, parameter)) {
    const span = gap.from === gap.to ? `exactly ${gap.from}` : `${gap.from} to ${gap.to}`;
    const where = `${parameter} has no rule for ${gap.fact} ${span} (between ${gap.below} and ${gap.above})`;
    if (isKnown(parameter, gap.fact, gap.from, gap.to)) declaredGaps.push(where);
    else errors.push(`band gap: ${where} — encode the missing band, or declare it in rules/known-gaps.json with the source rows quoted`);
  }
}

// Cited-page extracts: "open the page" must not depend on object storage.
const floorPath = path.join(rulesDir, "category-floor.json");
const provisionCitations = existsSync(floorPath)
  ? (JSON.parse(readFileSync(floorPath, "utf8")) as { provisions: { citation: PageCitation }[] }).provisions.map(
      (p) => p.citation,
    )
  : [];
const pagesManifestPath = path.join(repoRoot, "sources", "pages", "manifest.json");
const pagesManifest = existsSync(pagesManifestPath)
  ? (JSON.parse(readFileSync(pagesManifestPath, "utf8")) as ExtractManifest)
  : null;
errors.push(
  ...missingExtracts(corpus, provisionCitations, pagesManifest, (f) => existsSync(path.join(repoRoot, f))),
);

if (errors.length > 0) {
  console.error(`rules:validate — ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const scanned = docDirs.map((d) => rel(d)).join(", ");
console.log(
  `rules:validate — OK. ${corpus.length} rule file(s) across ${scanned}` +
    (corpus.length === 0 ? " (corpus empty until extraction lands, M1)" : ""),
);
if (declaredGaps.length > 0) {
  console.log(`\n${declaredGaps.length} declared source gap(s) — the regulation itself omits these:`);
  for (const g of declaredGaps) console.log(`  · ${g}`);
}

// The definitions queue. Reported, not failed: no rule declares consumes_terms
// yet, so nothing is broken — but every term below is a word the corpus leans
// on without having read its definition, and that is worth seeing every build.
const pending = undefinedTerms(definitions, corpus);
const verifiedDefs = definitions.filter((d) => d.definition.verification.status === "verified");
console.log(
  `\ndefinitions — ${verifiedDefs.length} verified, ${definitions.length - verifiedDefs.length} draft`,
);
if (pending.length > 0) {
  console.log(`${pending.length} term(s) not yet defined:`);
  for (const p of pending) {
    const used = p.consumedBy > 0 ? `consumed by ${p.consumedBy} rule(s)` : "not yet declared by any rule";
    console.log(`  · ${p.term} — ${p.status}, ${used}`);
  }
}
