import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  materializeEffectiveTo,
  type CategoryFloor,
  type PlotMinimum,
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
export function loadRuleCorpus(rulesDir: string, options: { allowDraft?: boolean } = {}): Rule[] {
  const rules: Rule[] = [];
  for (const entry of readdirSync(rulesDir)) {
    if (NON_RULE_DIRS.has(entry)) continue;
    const dir = path.join(rulesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      rules.push(JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Rule);
    }
  }
  // Only successors the resolver may use end a predecessor's window.
  return materializeEffectiveTo(rules, options);
}

/**
 * Reads rules/not-modelled.json — parameters left out of the model on
 * purpose. Without it the runtime cannot tell a deliberate omission from a
 * missing rule, and tells the user to "report this plot" for something we
 * decided not to encode. Absent or malformed, callers simply get the older,
 * blunter message; this must never be the reason an evaluation fails.
 */
/** Options for the declaration loaders. */
export interface DeclarationOptions {
  /** A missing file is an error rather than "nothing declared" — for a
   *  production server, where a declaration that quietly vanished would
   *  weaken every answer without anyone noticing (audit 2026-10-10 §05). */
  required?: boolean;
}

/**
 * Reads one declaration file. Absent: undefined, or an error when required.
 * Present but unreadable or malformed: always an error — a broken file is
 * never the same as an empty one.
 */
function readDeclaration<T>(rulesDir: string, file: string, options: DeclarationOptions): T | undefined {
  const full = path.join(rulesDir, file);
  if (!existsSync(full)) {
    if (options.required) throw new Error(`rules/${file} is required but missing`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8")) as T;
  } catch (e) {
    throw new Error(`rules/${file} could not be read: ${(e as Error).message}`);
  }
}

export function loadNotModelled(rulesDir: string, options: DeclarationOptions = {}): Map<string, NotModelled> {
  const out = new Map<string, NotModelled>();
  const raw = readDeclaration<{ parameters?: NotModelled[] }>(rulesDir, "not-modelled.json", options);
  for (const entry of raw?.parameters ?? []) out.set(entry.parameter, entry);
  return out;
}

/**
 * Reads rules/category-floor.json. Absent or malformed means nothing is
 * declared, which silently returns the engine to serving undercut rows — so a
 * real-corpus test (corpus.test.ts) pins that the file loads and bites.
 */
export function loadCategoryFloors(rulesDir: string, options: DeclarationOptions = {}): CategoryFloor[] {
  const raw = readDeclaration<{ provisions?: CategoryFloor[] }>(rulesDir, "category-floor.json", options);
  return raw?.provisions ?? [];
}

/** Reads rules/plot-minimum.json: the smallest plot each document allows to be developed. */
export function loadPlotMinimums(rulesDir: string, options: DeclarationOptions = {}): PlotMinimum[] {
  const raw = readDeclaration<{ provisions?: PlotMinimum[] }>(rulesDir, "plot-minimum.json", options);
  return raw?.provisions ?? [];
}

/**
 * The corpus's own declarations that shape an answer beyond the rules — what
 * is not modelled, and where the category minimum makes a figure unsafe to
 * show. Anything that evaluates for real (the benchmark, the invariant sweep)
 * loads these exactly as /evaluate does, or it tests answers nobody is served.
 */
export function loadDeclarations(
  rulesDir: string,
  options: DeclarationOptions = {},
): {
  notModelled: Map<string, NotModelled>;
  categoryFloors: CategoryFloor[];
  plotMinimums: PlotMinimum[];
} {
  return {
    notModelled: loadNotModelled(rulesDir, options),
    categoryFloors: loadCategoryFloors(rulesDir, options),
    plotMinimums: loadPlotMinimums(rulesDir, options),
  };
}

export function loadCorpusCurrency(rulesDir: string, options: DeclarationOptions = {}): CorpusCurrency | null {
  const raw = readDeclaration<Partial<CorpusCurrency>>(rulesDir, "corpus-currency.json", options);
  // Absent and not required: nothing declared, as an older deploy had no file.
  if (!raw) return null;
  return {
    read_against: raw.read_against ?? [],
    unread_successors: raw.unread_successors ?? [],
  };
}
