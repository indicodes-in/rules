/**
 * Serving definitions (spec §3.7.8): which definition of each term is in
 * force on a date, in the shape the source viewer needs to link a word on a
 * page to the clause that defines it.
 *
 * The same gate as rules (CLAUDE.md principle 4): only verified definitions
 * are served unless drafts are allowed (local dev). A placeholder with no
 * text is never served — it records that we know a term matters, not what
 * it means.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DefinitionFile } from "./types.js";

export interface GlossaryCitation {
  doc_id: string;
  clause: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  original_text: string | null;
  original_lang: "hi" | "en" | null;
  translated_text: string | null;
}

export interface ServedDefinition {
  definition_id: string;
  term: string;
  /** Forms to find on a page; always includes the term itself. */
  aliases: string[];
  link_in_text: boolean;
  text: DefinitionFile["text"];
  effective_from: string;
  status: "verified" | "draft";
  /** Where the definition is printed — the clause a link opens. */
  citation: GlossaryCitation;
  /** The same wording printed elsewhere (a later compilation). */
  also_in: GlossaryCitation[];
  /**
   * A later wording of the same clause that is not in force on this date,
   * or whose date we have not confirmed. Shown beside the definition so a
   * reader is never handed old wording as if nothing had changed. Its
   * citation is null while the later wording is itself unconfirmed: the
   * warning is served, the unconfirmed text is not.
   */
  reworded: { definition_id: string; effective_from: string | null; citation: GlossaryCitation | null } | null;
}

export function loadDefinitions(rulesDir: string): DefinitionFile[] {
  const dir = path.join(rulesDir, "definitions");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as DefinitionFile);
}

function usable(d: DefinitionFile, allowDraft: boolean): boolean {
  if (d.text.original === null || d.citations.length === 0) return false;
  const s = d.verification.status;
  return s === "verified" || (allowDraft && s === "draft");
}

/**
 * The definitions in force on `date`, one per supersession chain.
 *
 * In force: dated on or before `date`, not closed by its own `effective_to`,
 * and not replaced by a usable successor dated on or before `date`. An
 * undated successor (a draft whose amending notification is still unknown)
 * never takes over — we cannot say when it began — but it is attached as
 * `reworded`, so the old wording is never shown as the last word.
 */
export function definitionsInForce(
  defs: readonly DefinitionFile[],
  date: string,
  options: { allowDraft?: boolean } = {},
): ServedDefinition[] {
  const allowDraft = options.allowDraft ?? false;
  const pool = defs.filter((d) => usable(d, allowDraft));
  // Successors are looked for among every worded definition, served or not:
  // as with rules (spec §3.5) an unconfirmed successor never ends a
  // confirmed definition, but its existence is still worth a warning.
  const successor = new Map<string, DefinitionFile>();
  for (const d of defs) if (d.supersedes !== null && d.text.original !== null) successor.set(d.supersedes, d);

  const out: ServedDefinition[] = [];
  for (const d of pool) {
    if (d.effective_from === null || d.effective_from > date) continue;
    if (d.effective_to !== null && d.effective_to <= date) continue;
    const next = successor.get(d.definition_id);
    const nextServed = next !== undefined && usable(next, allowDraft);
    if (nextServed && next.effective_from !== null && next.effective_from <= date) continue;

    const [first, ...rest] = d.citations as unknown as GlossaryCitation[];
    const aliases = [...new Set([d.term, ...(d.aliases ?? [])])];
    out.push({
      definition_id: d.definition_id,
      term: d.term,
      aliases,
      link_in_text: d.link_in_text ?? true,
      text: d.text,
      effective_from: d.effective_from,
      status: d.verification.status === "verified" ? "verified" : "draft",
      citation: first!,
      also_in: rest,
      reworded: next
        ? {
            definition_id: next.definition_id,
            effective_from: next.effective_from,
            citation: nextServed ? (next.citations[0] as unknown as GlossaryCitation) : null,
          }
        : null,
    });
  }
  return out.sort((a, b) => a.term.localeCompare(b.term));
}
