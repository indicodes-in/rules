/**
 * Cross-file checks over the definition corpus (rules/definitions/**) and the
 * `defines_term_for` edge between definitions and the rules that consume them.
 *
 * Why definitions are separate nodes: a rule states a value, a definition
 * states what the words in that value mean, and in Indian building regulation
 * the words are where the disagreement lives. "Height" is measured one way by
 * the bye-laws and another way for airport height clearance; "built-up area"
 * decides an ECS count without appearing in the parking clause at all. A
 * corpus that holds only values can be entirely correct clause by clause and
 * still produce a wrong answer, because two of its clauses were reading the
 * same word differently. These checks are what make that representable — and
 * therefore fixable.
 *
 * The invariants:
 *
 *   1. definition_id matches the filename and is unique
 *   2. every citations[].doc_id is registered in sources/sources.json
 *   3. supersedes targets exist and chains are acyclic
 *   4. term coverage — a VERIFIED rule may not consume a term that has no
 *      verified definition in force. A checked number must not rest on an
 *      unchecked word.
 *   5. conflicting definitions — two verified definitions of the same term,
 *      same scope, overlapping effective windows. This is the first
 *      `conflicts_with` detector: it does not resolve the conflict (that is
 *      legal judgment and belongs to a human), it refuses to let the corpus
 *      pretend the conflict isn't there.
 */

import type { CorpusDefinition, CorpusRule } from "./types.js";

const DATE_MIN = "0000-01-01";
const DATE_MAX = "9999-12-31";

export interface DefinitionCheckOptions {
  /** doc_ids registered in sources/sources.json. */
  registeredDocIds: ReadonlySet<string>;
}

/** Effective window, with supersession supplying an implicit end date. */
function windows(defs: CorpusDefinition[]): Map<string, [string, string]> {
  const byId = new Map(defs.map((d) => [d.definition.definition_id, d]));
  const supersededBy = new Map<string, string>();
  for (const d of defs) {
    if (d.definition.supersedes !== null) {
      supersededBy.set(d.definition.supersedes, d.definition.definition_id);
    }
  }
  const out = new Map<string, [string, string]>();
  for (const d of defs) {
    const from = d.definition.effective_from ?? DATE_MIN;
    const successor = supersededBy.get(d.definition.definition_id);
    const to =
      d.definition.effective_to ??
      (successor ? (byId.get(successor)?.definition.effective_from ?? DATE_MAX) : DATE_MAX);
    out.set(d.definition.definition_id, [from, to]);
  }
  return out;
}

export function definitionChecks(
  definitions: CorpusDefinition[],
  rules: CorpusRule[],
  opts: DefinitionCheckOptions,
): string[] {
  const errors: string[] = [];
  const byId = new Map<string, CorpusDefinition>();

  // 1. definition_id ↔ filename, uniqueness
  for (const d of definitions) {
    if (d.definition.definition_id !== d.fileStem) {
      errors.push(
        `${d.filePath}: definition_id "${d.definition.definition_id}" does not match filename "${d.fileStem}.json"`,
      );
    }
    const dup = byId.get(d.definition.definition_id);
    if (dup) {
      errors.push(
        `${d.filePath}: duplicate definition_id "${d.definition.definition_id}" (also in ${dup.filePath})`,
      );
    } else {
      byId.set(d.definition.definition_id, d);
    }
  }

  // 2. citations cite registered documents only
  for (const d of definitions) {
    for (const c of d.definition.citations) {
      if (!opts.registeredDocIds.has(c.doc_id)) {
        errors.push(
          `${d.filePath}: citation doc_id "${c.doc_id}" is not registered in sources/sources.json`,
        );
      }
    }
  }

  // 3. supersession: target exists, acyclic
  for (const d of definitions) {
    const target = d.definition.supersedes;
    if (target !== null && !byId.has(target)) {
      errors.push(`${d.filePath}: supersedes "${target}" which does not exist in rules/definitions/`);
    }
  }
  for (const d of definitions) {
    const seen = new Set<string>([d.definition.definition_id]);
    let cur = d.definition.supersedes;
    while (cur !== null) {
      if (seen.has(cur)) {
        errors.push(`${d.filePath}: supersession chain contains a cycle through "${cur}"`);
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.definition.supersedes ?? null;
    }
  }

  const verified = definitions.filter((d) => d.definition.verification.status === "verified");
  const win = windows(definitions);

  // 4. term coverage — a verified rule must not rest on an undefined word.
  const verifiedTerms = new Set(verified.map((d) => d.definition.term));
  const draftTerms = new Set(
    definitions
      .filter((d) => d.definition.verification.status === "draft")
      .map((d) => d.definition.term),
  );
  for (const r of rules) {
    if (r.rule.verification.status !== "verified") continue;
    for (const term of r.rule.consumes_terms ?? []) {
      if (verifiedTerms.has(term)) continue;
      errors.push(
        draftTerms.has(term)
          ? `${r.filePath}: consumes term "${term}", whose definition is still a draft — ` +
            `verify rules/definitions/ for that term, or drop the declaration until the rule needs it`
          : `${r.filePath}: consumes term "${term}", which no definition file defines — ` +
            `add a draft definition under rules/definitions/ and verify it`,
      );
    }
  }

  // 5. conflicting definitions in force at the same time, for the same scope.
  for (let i = 0; i < verified.length; i++) {
    for (let j = i + 1; j < verified.length; j++) {
      const a = verified[i]!;
      const b = verified[j]!;
      if (a.definition.term !== b.definition.term) continue;
      if (a.definition.applies_to.land_use !== b.definition.applies_to.land_use) continue;
      if (a.definition.applies_to.authority !== b.definition.applies_to.authority) continue;
      const [fromA, toA] = win.get(a.definition.definition_id)!;
      const [fromB, toB] = win.get(b.definition.definition_id)!;
      // [from, to) — touching at a boundary is succession, not conflict.
      if (!(fromA < toB && fromB < toA)) continue;
      // Identical wording from two documents is agreement, not conflict —
      // duplication is untidy but it does not change any answer.
      if (a.definition.text.original === b.definition.text.original) continue;
      errors.push(
        `${a.filePath} and ${b.filePath}: two verified definitions of "${a.definition.term}" ` +
          `are in force at the same time with different text. Decide which governs and supersede ` +
          `the other, or narrow their applies_to — the engine cannot choose between them, and a ` +
          `value computed from an ambiguous term is not a cited value.`,
      );
    }
  }

  return errors;
}

/** Terms consumed by at least one verified rule but not yet verified — the
 *  definitions work queue, reported by rules:validate rather than failed on
 *  (declaring nothing is the current state of every rule file). */
export function undefinedTerms(
  definitions: CorpusDefinition[],
  rules: CorpusRule[],
): { term: string; status: "draft" | "missing"; consumedBy: number }[] {
  const status = new Map<string, string>();
  for (const d of definitions) status.set(d.definition.term, d.definition.verification.status);

  const counts = new Map<string, number>();
  for (const r of rules) {
    for (const term of r.rule.consumes_terms ?? []) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  // Terms nobody consumes yet still matter — they are why the draft exists.
  for (const d of definitions) {
    if (!counts.has(d.definition.term)) counts.set(d.definition.term, 0);
  }

  return [...counts.entries()]
    .filter(([term]) => status.get(term) !== "verified")
    .map(([term, consumedBy]) => ({
      term,
      status: status.has(term) ? ("draft" as const) : ("missing" as const),
      consumedBy,
    }))
    .sort((a, b) => b.consumedBy - a.consumedBy || a.term.localeCompare(b.term));
}
