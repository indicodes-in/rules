/** Minimal structural types for rule files (normative shape: rules/schema/rule.schema.json). */

export interface RuleCondition {
  fact: string;
  op: string;
  value: unknown;
}

export interface RuleFile {
  rule_id: string;
  title: string;
  parameter: string;
  applicability: {
    land_use: string;
    authority: string;
    conditions: RuleCondition[];
  };
  output: { type: string; formula_id?: string } & Record<string, unknown>;
  effective_from: string | null;
  effective_to: string | null;
  supersedes: string | null;
  citations: Array<{ doc_id: string } & Record<string, unknown>>;
  verification: { status: string } & Record<string, unknown>;
  notes: string;
  /** Terms this rule's meaning depends on — the `defines_term_for` edge, read
   *  from the definition side. Absent means "not recorded yet", never "none". */
  consumes_terms?: string[];
}

/** A rule file as found on disk, for cross-file checks. */
export interface CorpusRule {
  /** Path relative to the repo root, for error messages. */
  filePath: string;
  /** File basename without .json — must equal rule.rule_id. */
  fileStem: string;
  rule: RuleFile;
}

/** Minimal structural type for definition files (rules/schema/definition.schema.json). */
export interface DefinitionFile {
  definition_id: string;
  term: string;
  applies_to: { land_use: string; authority: string };
  text: { original: string | null; original_lang: string | null; translated: string | null };
  effective_from: string | null;
  effective_to: string | null;
  supersedes: string | null;
  citations: Array<{ doc_id: string } & Record<string, unknown>>;
  verification: { status: string } & Record<string, unknown>;
  notes: string;
}

/** A definition file as found on disk, for cross-file checks. */
export interface CorpusDefinition {
  filePath: string;
  /** File basename without .json — must equal definition.definition_id. */
  fileStem: string;
  definition: DefinitionFile;
}
