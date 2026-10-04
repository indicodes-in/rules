import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CorpusDefinition,
  CorpusRule,
  DefinitionFile,
  RuleCondition,
  RuleFile,
} from "../src/types.js";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, relPath), "utf8"));
}

/** Synthetic verified rule for cross-file tests — all values fake by design. */
export function makeRule(overrides: {
  rule_id: string;
  parameter?: string;
  conditions?: RuleCondition[];
  effective_from?: string | null;
  effective_to?: string | null;
  supersedes?: string | null;
  status?: string;
  doc_id?: string;
  output?: RuleFile["output"];
  fileStem?: string;
}): CorpusRule {
  const rule: RuleFile = {
    rule_id: overrides.rule_id,
    title: `SYNTHETIC — ${overrides.rule_id}`,
    parameter: overrides.parameter ?? "far",
    applicability: {
      land_use: "residential_plotted",
      authority: "DDA",
      conditions: overrides.conditions ?? [],
    },
    output: overrides.output ?? { type: "scalar", value: 123, unit: "far_x100" },
    effective_from: overrides.effective_from !== undefined ? overrides.effective_from : "2020-01-01",
    effective_to: overrides.effective_to !== undefined ? overrides.effective_to : null,
    supersedes: overrides.supersedes ?? null,
    citations: [
      {
        doc_id: overrides.doc_id ?? "test_doc",
        clause: "§0.0 (synthetic)",
        page: 1,
        bbox: null,
        original_text: null,
        original_lang: "en",
        translated_text: null,
      },
    ],
    verification: {
      status: overrides.status ?? "verified",
      verified_by: "test_verifier",
      verified_on: "2020-01-02",
      method: "manual_entry",
      confidence: null,
    },
    notes: "Synthetic test rule — never regulatory truth.",
  };
  const stem = overrides.fileStem ?? overrides.rule_id;
  return { filePath: `rules/test_doc/${stem}.json`, fileStem: stem, rule };
}

export const defaultOpts = {
  registeredDocIds: new Set(["test_doc"]),
  formulaIds: new Set(["ecs_per_bua"]),
};

/** Synthetic definition — the text is nonsense on purpose, never regulatory truth. */
export function makeDefinition(overrides: {
  definition_id: string;
  term?: string;
  text?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  supersedes?: string | null;
  status?: string;
  doc_id?: string;
  land_use?: string;
  authority?: string;
  fileStem?: string;
}): CorpusDefinition {
  const status = overrides.status ?? "verified";
  const definition: DefinitionFile = {
    definition_id: overrides.definition_id,
    term: overrides.term ?? "plot area",
    applies_to: {
      land_use: overrides.land_use ?? "residential_plotted",
      authority: overrides.authority ?? "DDA",
    },
    text: {
      original:
        overrides.text !== undefined
          ? overrides.text
          : `SYNTHETIC definition of ${overrides.term ?? "plot area"}`,
      original_lang: "en",
      translated: null,
    },
    effective_from:
      overrides.effective_from !== undefined ? overrides.effective_from : "2020-01-01",
    effective_to: overrides.effective_to !== undefined ? overrides.effective_to : null,
    supersedes: overrides.supersedes ?? null,
    citations:
      status === "draft"
        ? []
        : [
            {
              doc_id: overrides.doc_id ?? "test_doc",
              clause: "§0.0 (synthetic)",
              page: 1,
              bbox: null,
              original_text: null,
              original_lang: "en",
              translated_text: null,
            },
          ],
    verification: {
      status,
      verified_by: status === "verified" ? "test_verifier" : null,
      verified_on: status === "verified" ? "2020-01-02" : null,
      method: "manual_entry",
      confidence: null,
    },
    notes: "Synthetic test definition — never regulatory truth.",
  };
  const stem = overrides.fileStem ?? overrides.definition_id;
  return { filePath: `rules/definitions/${stem}.json`, fileStem: stem, definition };
}
