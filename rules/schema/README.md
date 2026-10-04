# rules/schema — Rule file schema (spec §3, normative)

Drop this folder into the repo as `rules/schema/` (schema + fixtures). It satisfies task M0.2; the fixtures seed the M0.2 test suite for `pnpm rules:validate` (M0.3).

## What the JSON Schema enforces (validated, all fixtures passing)

- Structure: every field explicit (nulls written out), `additionalProperties: false` everywhere — typos and sneaky extra fields fail.
- Closed sets: the 11-parameter vocabulary (spec §3.1), 8 condition ops, 6 condition facts, output unit enum, citation language enum. Extending any of these is a deliberate spec change.
- Condition shape per op: `between` takes exactly `[lo, hi]`; `in` takes a non-empty array; comparison ops take a scalar; boolean facts only allow `eq`/`neq` with boolean values.
- Output variants: `scalar`, `boolean`, `formula` (constants only — logic lives in `packages/engine/src/formulas/`), `flag`.
- **Verified-rule completeness (spec §3.4):** when `verification.status == "verified"`, the schema requires non-null `effective_from`, non-null output value / fully numeric formula params, `verified_by` + `verified_on`, and a first citation with `clause` and `page`. A verified rule with a null anywhere that matters cannot pass CI.

## What `pnpm rules:validate` code must enforce on top (cross-file — JSON Schema cannot)

1. `rule_id` matches the filename `<rule_id>.json` and is unique across `rules/**`.
2. Every `citations[].doc_id` is registered in `sources/sources.json`.
3. Every `supersedes` target exists; supersession chains are acyclic; effective-date windows of a superseded/superseding pair don't overlap.
4. Every `formula_id` exists in the engine formula registry.
5. Two-person rule: git author of the verifying commit ≠ `verified_by` (or however the team encodes extractor ≠ verifier).
6. No two `verified` rules for the same parameter have overlapping applicability for any reachable fact combination (the "exactly one rule" resolution invariant, spec §5.2) — implement as a fact-matrix sweep; this is the most valuable check in the file.

## Semantics encoded as comments in the schema (engine must implement + test)

- `between` is inclusive-exclusive `[lo, hi)` so band boundaries belong to exactly one band — test plot_area exactly at each boundary.
- `effective_to` is normally set implicitly by the loader from supersession (spec §3.5); explicit authoring is allowed only when the source states an end date.
- `confidence` is extraction-stage only; nulled on verification.

## Fixtures

`fixtures/valid/` — draft scalar, draft boolean, verified scalar, verified formula.
`fixtures/invalid/` — verified-with-null-value, verified-missing-citation-page, bad op, malformed between, unknown parameter, extra field.

All fixture values are **synthetic by design** (CLAUDE.md principle 3: no regulatory values from memory anywhere, including tests). Real values enter only via the extraction + human-verification pipeline.

Validation run (jsonschema 4.26, Draft 2020-12): schema self-valid; 4/4 valid fixtures accepted; 6/6 invalid fixtures rejected.
