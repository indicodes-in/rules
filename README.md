# Indicodes Rules

**India's building rules as open, cited, dated data.**

What may be built on a plot in India is written across master plans, bye-laws,
amendments, circulars and court orders — mostly as PDFs, often scanned, rarely
versioned. This repository turns those rules into structured data anyone can
read, check and build on. Every value carries the clause, page and words it was
read from, and the date it took effect.

It starts with one slice, end to end: **plotted residential development in Delhi
under the DDA** — Master Plan for Delhi 2021 and the Unified Building Bye-Laws
2016.

| | |
|---|---|
| Verified rules | 54 |
| Draft rules (not yet reviewed) | 25 |
| Parameters | 10 |
| Source documents registered | 7 |

## What a rule looks like

```json
{
  "rule_id": "mpd2021_mod_2022.res_plotted.far.250_750",
  "parameter": "far",
  "applicability": { "land_use": "residential_plotted", "authority": "DDA",
    "conditions": [{ "fact": "plot_area_sqm", "op": "between", "value": [250, 750] }] },
  "output": { "type": "scalar", "value": 225, "unit": "far_x100" },
  "effective_from": "2007-02-07",
  "citations": [{ "doc_id": "mpd2021_mod_2022", "page": 63,
    "bbox": [0.2812, 0.1949, 0.8411, 0.2091],
    "original_text": "4 Above 250 to 750 75 225 6" }],
  "verification": { "status": "verified", "verified_by": "Indicodes review" }
}
```

The schema is `rules/schema/rule.schema.json`. Bands are `(lo, hi]`. A rule is
never edited once verified: a change is a new rule that supersedes it, so every
past answer stays reproducible.

## How far to trust it

- **Verified** means a reviewer checked the value against the cited page. It
  does not mean independently tested: the benchmark — two experienced readers
  working the same plots blind from the documents — has no cases yet
  (`data/validation/`).
- **Every number cites its source.** Check it there.
- **MPD-2047** was notified on 20 August 2026. Its rules are drafts here; which
  plan governs a plot today is not settled by this data.
- Decision support, not statutory sanction. Verify with the sanctioning authority.

## Use it

The rules are plain JSON — read them with anything. To get the answer for a
plot exactly as the rules combine (bands, dates, the next-lower-category
minimum, declared gaps), use the engine:

```ts
import { evaluatePlot, validateParcelFacts } from "@indicodes/engine";
import { loadDeclarations, loadRuleCorpus } from "@indicodes/rules-tools";

const facts = validateParcelFacts({
  plot_area_sqm: 400, road_width_m: 9, roads_abutting: 1, is_corner_plot: false,
  land_use: "residential_plotted", authority: "DDA",
  stilt_parking: false, basement_intended: false, special_area_flags: [],
});
if (facts.ok) {
  const result = evaluatePlot(facts.facts, loadRuleCorpus("rules"), "2026-08-19", "local", {
    ...loadDeclarations("rules"),
  });
  console.log(result.parameters.far, result.flags);
}
```

The engine is pure TypeScript with no I/O. Where the rules do not settle a
question, it declines and says why — it never guesses.

```
pnpm install
pnpm test              # engine, tools, and the logic sweep over the real rules
pnpm rules:validate    # schema + cross-file checks
python -m pytest pipeline/tests
```

## Layout

| Path | What |
|---|---|
| `rules/<document>/` | One rule per file, grouped by source document |
| `rules/schema/` | JSON Schemas for rules and definitions |
| `rules/*.json` | What the corpus declares about itself: band gaps in the source, minimums, what is not modelled, what is newer and unread |
| `sources/sources.json` | Registry of source documents, with file hashes |
| `sources/pages/` | Single-page extracts of every cited page |
| `packages/engine/` | The deterministic engine (`evaluatePlot`) |
| `packages/rules-tools/` | Validator, loaders, benchmark, logic sweep |
| `pipeline/` | Second read against the PDFs, the notice watcher, sign-off helper |
| `data/validation/` | The blind double-read benchmark |

## Contributing

Report an error, propose a rule, review one, register a new notice, or read
benchmark plots blind. Nothing becomes verified until a second person has
checked it against the page. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

- Data (`rules/`, `sources/sources.json`, `data/`): **CC BY 4.0** — see
  [LICENSE-DATA.md](LICENSE-DATA.md). Credit "Indicodes Rules".
- Code (`packages/`, `pipeline/`): **Apache-2.0** — see [LICENSE](LICENSE).
- Page extracts and quoted source text are from government publications; see
  LICENSE-DATA.md.

The Indicodes app at [www.indicodes.com](https://www.indicodes.com) reads this
data; the app itself is a separate product.
