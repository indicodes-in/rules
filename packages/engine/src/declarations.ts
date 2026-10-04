/**
 * Declarations a corpus makes about itself, beyond its rules: what it
 * deliberately leaves out, which minimums its band rows may not undercut, and
 * how current it is. Data, loaded from rules/*.json by the caller — the
 * engine stays free of I/O.
 */

import type { Citation } from "./types.js";

/** A parameter we deliberately do not encode, and the reason. */
export interface NotModelled {
  parameter: string;
  reason: string;
  see?: string[];
}

/**
 * A provision that sets a minimum a band row cannot undercut — MPD-2021's
 * "not less than … the largest plot in the next lower category". Declared as
 * data so the clause, its scope and its words live in the corpus, not in code.
 */
export interface CategoryFloor {
  id: string;
  /** Parameters whose rows the minimum governs. */
  parameters: string[];
  /** The fact the rows band on; the only one a "largest plot" is measured in. */
  fact: "plot_area_sqm";
  /** Documents whose rows it governs, matched against the rule's citations. */
  applies_to_docs: string[];
  /** The clause itself, verbatim — shown first on every decline it causes. */
  citation: Citation;
}

/**
 * How current this corpus is (rules/corpus-currency.json).
 *
 * Every rule carries `effective_from` and none carries `effective_to`, so the
 * resolver treats them all as in force indefinitely and an evaluation dated
 * today comes back cited and uncaveated. That is only safe while nothing has
 * superseded them. MPD-2047 was notified on 2026-08-20 and this corpus holds
 * no rule from it, so the tool has to be able to say so.
 *
 * It states what was read and what has not been — never that anything ceased.
 * No transition provision has been located, and inventing one would be the
 * confidently-wrong answer this product exists to avoid.
 */
export interface UnreadSuccessor {
  doc_id: string;
  label: string;
  instrument: string | null;
  notified: string | null;
  rules_extracted: number;
  note: string | null;
}

export interface CorpusCurrency {
  read_against: { doc_id: string; label: string; note: string | null }[];
  unread_successors: UnreadSuccessor[];
}
