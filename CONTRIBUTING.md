# Contributing

One rule holds everything up: **anyone can propose, nothing becomes verified
until a second person has checked it against the cited page.**

## Ways to help

1. **Report an error.** Open an issue with the *Report an error* form: which
   rule, what is wrong, and the page that shows it. The most useful thing an
   architect can do.
2. **Propose a rule or a fix.** Open a pull request adding a rule file with
   `"status": "draft"`. It must carry a citation — document, page, box and the
   verbatim words. Don't edit a verified rule: write a new one that supersedes
   it (`supersedes` pointer, new `effective_from`).
3. **Review.** Check a draft against its page and sign it off (below). A
   reviewer can never verify their own draft.
4. **Register a source.** A new amendment, circular or notification goes in
   `sources/sources.json` with its file hash. The weekly watcher opens
   *source-watch* issues for new DDA and MCD notices — pick one up.
5. **Read benchmark plots blind.** Fill in `data/validation/worksheet.csv` from
   the documents alone, without looking at this data or anyone else's sheet.
   Instructions: `data/validation/README.md`.
6. **Bring a new city.** A new authority gets its own folder under `rules/` and
   its own maintainers. Open an issue first.

## What every rule must respect

- **No values from memory.** A value enters only from a cited page. If you
  know a rule but cannot cite it, open an issue instead.
- **Quote, don't paraphrase.** `original_text` is the source's own words. Where
  the source is in Hindi, keep the Hindi; a translation goes in
  `translated_text` and never replaces it.
- **Effective dates.** Every rule carries `effective_from`. Amendments are new
  rules, never edits.
- **Decline, don't guess.** If the source does not settle a case, don't encode
  a guess — declare it (`rules/known-gaps.json`, `rules/not-modelled.json`)
  and say why.
- **The National Building Code** is a paid BIS publication: cite it by clause
  number only, never quote it.
- **One rule per file, one file per commit** when adding or verifying, so
  review maps one-to-one to clauses.

## What the checks run

Every pull request runs:

- `pnpm rules:validate` — schema, cross-file checks, band overlaps and gaps,
  a page extract for every cited page;
- `pnpm test` — including the logic sweep: thousands of plots through the
  engine, checking that floor area never falls as a plot grows, that every
  parameter is answered or explicitly declined, and more;
- `python -m pytest pipeline/tests`.

Reviewers also run the second read locally, which re-reads each rule from its
cited box in the source PDF (`python -m pipeline.crosscheck`; the PDFs are not
in this repository — see `sources/README.md`).

## Signing off

Sign every commit (`git commit -s`), certifying the
[Developer Certificate of Origin](https://developercertificate.org): you have
the right to submit it under this repository's licences.

Reviewers verify with:

```
python -m pipeline.verify --by "<your reviewer role>" --rule <rule_id>
```

Reviewers appear under a role (for example `Indicodes review`), not a personal
name. Who holds each role is recorded privately by the maintainers. To become
a reviewer, open an issue saying which documents you know well.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
