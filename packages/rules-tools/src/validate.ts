/**
 * Cross-file corpus checks for `pnpm rules:validate` — the invariants JSON
 * Schema cannot express (rules/schema/README.md):
 *
 *   1. rule_id matches the filename and is unique across rules/**
 *   2. every citations[].doc_id is registered in sources/sources.json
 *   3. supersedes targets exist, chains are acyclic, and effective-date
 *      windows of superseded/superseding pairs don't overlap
 *   4. every output.formula_id exists in the engine formula registry
 *   5. (deferred — see docs/tasks.md) two-person rule: extractor ≠ verifier
 *   6. no two verified rules for the same parameter have overlapping
 *      applicability for any reachable fact combination
 */

import { conditionsCanCooccur } from "./overlap.js";
import type { CorpusRule } from "./types.js";

export interface ValidationOptions {
  /** doc_ids registered in sources/sources.json. */
  registeredDocIds: ReadonlySet<string>;
  /** formula_ids implemented in packages/engine/src/formulas/. */
  formulaIds: ReadonlySet<string>;
}

const DATE_MIN = "0000-01-01";
const DATE_MAX = "9999-12-31";

export function crossFileChecks(rules: CorpusRule[], opts: ValidationOptions): string[] {
  const errors: string[] = [];
  const byId = new Map<string, CorpusRule>();

  // 1. rule_id ↔ filename, uniqueness
  for (const r of rules) {
    if (r.rule.rule_id !== r.fileStem) {
      errors.push(
        `${r.filePath}: rule_id "${r.rule.rule_id}" does not match filename "${r.fileStem}.json"`,
      );
    }
    const dup = byId.get(r.rule.rule_id);
    if (dup) {
      errors.push(
        `${r.filePath}: duplicate rule_id "${r.rule.rule_id}" (also in ${dup.filePath})`,
      );
    } else {
      byId.set(r.rule.rule_id, r);
    }
  }

  // 2. citations cite registered documents only
  for (const r of rules) {
    for (const c of r.rule.citations) {
      if (!opts.registeredDocIds.has(c.doc_id)) {
        errors.push(
          `${r.filePath}: citation doc_id "${c.doc_id}" is not registered in sources/sources.json`,
        );
      }
    }
  }

  // 3. supersession: target exists, acyclic, date windows sane
  for (const r of rules) {
    const target = r.rule.supersedes;
    if (target === null) continue;
    const old = byId.get(target);
    if (!old) {
      errors.push(`${r.filePath}: supersedes "${target}" which does not exist in rules/`);
      continue;
    }
    const newFrom = r.rule.effective_from;
    const oldFrom = old.rule.effective_from;
    const oldTo = old.rule.effective_to;
    if (newFrom !== null && oldFrom !== null && newFrom < oldFrom) {
      errors.push(
        `${r.filePath}: effective_from ${newFrom} precedes superseded rule's effective_from ${oldFrom}`,
      );
    }
    if (newFrom !== null && oldTo !== null && oldTo > newFrom) {
      errors.push(
        `${r.filePath}: superseded rule "${target}" has effective_to ${oldTo} overlapping this rule's effective_from ${newFrom}`,
      );
    }
  }
  for (const r of rules) {
    const seen = new Set<string>([r.rule.rule_id]);
    let cur = r.rule.supersedes;
    while (cur !== null) {
      if (seen.has(cur)) {
        errors.push(`${r.filePath}: supersession chain contains a cycle through "${cur}"`);
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.rule.supersedes ?? null;
    }
  }

  // 4. formula_id must be implemented in the engine
  for (const r of rules) {
    const formulaId = r.rule.output.formula_id;
    if (r.rule.output.type === "formula" && formulaId !== undefined) {
      if (!opts.formulaIds.has(formulaId)) {
        errors.push(
          `${r.filePath}: formula_id "${formulaId}" is not in the engine formula registry`,
        );
      }
    }
  }

  // 6. exactly-one-rule sweep over verified rules
  // effective_to falls back to the effective_from of the rule superseding it
  // (the loader's implicit dating, spec §3.5), else open-ended.
  const supersededBy = new Map<string, string>();
  for (const r of rules) {
    if (r.rule.supersedes !== null) {
      supersededBy.set(r.rule.supersedes, r.rule.rule_id);
    }
  }
  const window = (r: CorpusRule): [string, string] => {
    const from = r.rule.effective_from ?? DATE_MIN;
    const successor = supersededBy.get(r.rule.rule_id);
    const to =
      r.rule.effective_to ??
      (successor ? (byId.get(successor)?.rule.effective_from ?? DATE_MAX) : DATE_MAX);
    return [from, to];
  };

  const verified = rules.filter((r) => r.rule.verification.status === "verified");
  for (let i = 0; i < verified.length; i++) {
    for (let j = i + 1; j < verified.length; j++) {
      const a = verified[i]!;
      const b = verified[j]!;
      if (a.rule.parameter !== b.rule.parameter) continue;
      if (a.rule.applicability.land_use !== b.rule.applicability.land_use) continue;
      if (a.rule.applicability.authority !== b.rule.applicability.authority) continue;
      const [fromA, toA] = window(a);
      const [fromB, toB] = window(b);
      // [from, to) windows — touching at a boundary is not an overlap.
      if (!(fromA < toB && fromB < toA)) continue;
      if (conditionsCanCooccur(a.rule.applicability.conditions, b.rule.applicability.conditions)) {
        errors.push(
          `${a.filePath} and ${b.filePath}: verified rules for "${a.rule.parameter}" have ` +
            `overlapping applicability and effective windows (violates spec §5.2 exactly-one-rule)`,
        );
      }
    }
  }

  return errors;
}
