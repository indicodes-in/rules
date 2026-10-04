/**
 * Cited-page extracts (docs/superpowers/specs/2026-09-12-source-pages-design.md).
 *
 * Every page a verified rule or declared provision cites must have a committed
 * single-page extract under sources/pages/, cut by `python -m pipeline.cite_pages`.
 * Without one the citation viewer falls back to object storage, and "open the
 * page" breaks the day storage does — which is how it broke the first time.
 */

export interface PageCitation {
  doc_id: string;
  page: number | null;
}

export interface ExtractManifest {
  extracts: { doc_id: string; page: number; file: string }[];
}

/** Rule files are schema-validated before this runs, but their citation type
 * leaves `page` untyped — so it is read, not assumed. */
interface CitingRule {
  rule: { verification: { status: string }; citations: readonly { doc_id: string; page?: unknown }[] };
}

export function missingExtracts(
  corpus: readonly CitingRule[],
  extraCitations: readonly PageCitation[],
  manifest: ExtractManifest | null,
  fileExists: (repoRelativePath: string) => boolean,
): string[] {
  const cited = new Map<string, PageCitation>();
  const add = (c: { doc_id: string; page?: unknown }): void => {
    if (typeof c.page === "number") cited.set(`${c.doc_id}#${c.page}`, { doc_id: c.doc_id, page: c.page });
  };
  for (const { rule } of corpus) {
    if (rule.verification.status === "verified") rule.citations.forEach(add);
  }
  extraCitations.forEach(add);

  const files = new Map((manifest?.extracts ?? []).map((e) => [`${e.doc_id}#${e.page}`, e.file]));
  const errors: string[] = [];
  for (const [key, c] of [...cited].sort(([a], [b]) => a.localeCompare(b))) {
    const file = files.get(key);
    if (file === undefined) {
      errors.push(`${c.doc_id} p.${c.page} is cited but has no extract — run \`python -m pipeline.cite_pages\``);
    } else if (!fileExists(file)) {
      errors.push(`${file} is listed in sources/pages/manifest.json but missing — re-run \`python -m pipeline.cite_pages\``);
    }
  }
  return errors;
}
