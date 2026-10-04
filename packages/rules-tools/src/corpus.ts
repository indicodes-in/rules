import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  materializeEffectiveTo,
  type CategoryFloor,
  type CorpusCurrency,
  type NotModelled,
  type Rule,
} from "@indicodes/engine";

/**
 * Directories under rules/ that are not source-document rule folders.
 * `schema` holds the JSON Schemas; `definitions` holds a different node type
 * entirely (spec §3.7) which the resolver never sees — a definition has no
 * `parameter` and no `output`, so loading one as a rule yields an object that
 * matches nothing and resolves to nothing, failing silently rather than
 * loudly. Keep this in step with cli.ts.
 */
const NON_RULE_DIRS = new Set(["schema", "definitions"]);

/**
 * Loads the canonical rule corpus from rules/<doc>/*.json (spec §1: rules are
 * canonical in git, loaded at deploy). Applies the loader's implicit
 * supersession dating. Files are trusted here because `pnpm rules:validate`
 * gates every merge; the engine still refuses non-verified rules at
 * resolution time unless drafts are explicitly allowed.
 */
export function loadRuleCorpus(rulesDir: string): Rule[] {
  const rules: Rule[] = [];
  for (const entry of readdirSync(rulesDir)) {
    if (NON_RULE_DIRS.has(entry)) continue;
    const dir = path.join(rulesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      rules.push(JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Rule);
    }
  }
  return materializeEffectiveTo(rules);
}

/**
 * Reads rules/not-modelled.json — parameters left out of the model on
 * purpose. Without it the runtime cannot tell a deliberate omission from a
 * missing rule, and tells the user to "report this plot" for something we
 * decided not to encode. Absent or malformed, callers simply get the older,
 * blunter message; this must never be the reason an evaluation fails.
 */
export function loadNotModelled(rulesDir: string): Map<string, NotModelled> {
  const out = new Map<string, NotModelled>();
  try {
    const raw = JSON.parse(readFileSync(path.join(rulesDir, "not-modelled.json"), "utf8")) as {
      parameters?: NotModelled[];
    };
    for (const entry of raw.parameters ?? []) out.set(entry.parameter, entry);
  } catch {
    /* declaring nothing is a valid state */
  }
  return out;
}

/**
 * Reads rules/category-floor.json. Absent or malformed means nothing is
 * declared, which silently returns the engine to serving undercut rows — so a
 * real-corpus test (corpus.test.ts) pins that the file loads and bites.
 */
export function loadCategoryFloors(rulesDir: string): CategoryFloor[] {
  try {
    const raw = JSON.parse(readFileSync(path.join(rulesDir, "category-floor.json"), "utf8")) as {
      provisions?: CategoryFloor[];
    };
    return raw.provisions ?? [];
  } catch {
    return [];
  }
}

/**
 * The corpus's own declarations that shape an answer beyond the rules — what
 * is not modelled, and where the category minimum makes a figure unsafe to
 * show. Anything that evaluates for real (the benchmark, the invariant sweep)
 * loads these exactly as /evaluate does, or it tests answers nobody is served.
 */
export function loadDeclarations(rulesDir: string): {
  notModelled: Map<string, NotModelled>;
  categoryFloors: CategoryFloor[];
} {
  return { notModelled: loadNotModelled(rulesDir), categoryFloors: loadCategoryFloors(rulesDir) };
}

export function loadCorpusCurrency(rulesDir: string): CorpusCurrency | null {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(rulesDir, "corpus-currency.json"), "utf8"),
    ) as Partial<CorpusCurrency>;
    return {
      read_against: raw.read_against ?? [],
      unread_successors: raw.unread_successors ?? [],
    };
  } catch {
    // Declaring nothing is a valid state — an older deploy has no file.
    return null;
  }
}
