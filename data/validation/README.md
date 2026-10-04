# Validation benchmark (spec §10)

The benchmark tests the rules against **the regulations as competent people
read them** — not against what a sanctioning office approved. Approvals can
depart from the code (relaxations, older rules, discretion), and a sanctioned
plan that disagrees with the engine cannot tell you which. So:

- **Gate — blind double reading.** Two experienced readers each work the same
  plot scenarios out from the documents alone. Where they agree, the engine
  must match exactly. Where they differ, the clause is ambiguous: recorded,
  not tested, and sent to the interpretations list.
- **Supporting evidence — sanctioned plans.** Run and reported as agree/differ;
  never decide the gate.

`pnpm test:benchmark` runs every `case_*.json` here. These files are the only
place real regulatory values may appear outside `rules/`: they are evidence to
test the corpus against, never read by the engine.

## Running a double read

1. `pnpm benchmark:worksheet` writes `worksheet.csv` — 33 plot scenarios,
   common plots first, then each band edge and the metre above it, then stilt,
   road-width and corner variations. It holds no answers.
2. Give each reader their own copy, with the instructions below. They must not
   see the tool's results, each other's sheet, or talk it through until both
   are done.
3. Import the two filled sheets (paths are from where you run it):

   ```
   pnpm benchmark:import --as-of 2026-08-19 --blind \
     --sheet reader_a:2026-10-01:path/to/reader-a.csv \
     --sheet reader_b:2026-10-03:path/to/reader-b.csv
   ```

   `--blind` is your statement that step 2 held; without it the cases are
   written but never count. `--as-of` is the date the documents were read as
   in force — 2026-08-19, the day before MPD-2047 was notified, keeps the
   question of which master plan governs out of the reading.
4. `pnpm test:benchmark`. Each value is a pass, a fail (engine differs from the
   agreed reading), a gap (readers agree, engine declines), or an ambiguity
   (readers differ).

Readers are pseudonymous in the repo (`reader_a`, `reader_b`, …). Keep the
register of who is who, and their experience, outside the repo.

## Instructions for readers

You are working out, from the documents only, what a plotted-residential plot
in Delhi is permitted under DDA norms. One row per plot.

- **Documents:** MPD-2021 (compilation with modifications to 31 August 2022)
  and the Unified Building Bye-Laws 2016 (compendium, 2020). Read them as in
  force on **19 August 2026**. If you rely on anything else — a notification,
  a circular, a practice you know of — say so in `notes`.
- **Don't** use this tool, ask anyone how it answers, or compare with the
  other reader before you are both done.
- **Fill what you can, per cell:**
  - a number, in the column's unit — FAR ×100 (FAR 2.25 → `225`), coverage in
    %, heights and setbacks in metres, dwelling units as a count;
  - `yes` / `no` for basement allowed;
  - `unsettled` where the documents genuinely do not decide it (say why in
    `notes`);
  - blank where you did not work it out.
- **notes:** the clause and page you relied on, and anything you had to
  interpret. This is what we learn most from when two readings differ.

Unless a row says otherwise: one road abutting, not a corner plot, no stilt,
no basement intended, no special area.

## Case file formats

Double read (written by `benchmark:import`):

```json
{
  "case_id": "case_dr_s03",
  "kind": "double_read",
  "description": "Double read, scenario s03: 400 m², 9 m road",
  "as_of": "2026-08-19",
  "facts": { "plot_area_sqm": 400, "road_width_m": 9, "roads_abutting": 1, "is_corner_plot": false,
             "land_use": "residential_plotted", "authority": "DDA", "stilt_parking": false,
             "basement_intended": false, "special_area_flags": [] },
  "readings": [
    { "reader": "reader_a", "read_on": "2026-10-01", "blind": true,
      "values": { "far": { "value": 0, "unit": "far_x100" }, "max_height_m": { "value": null, "unit": null } } },
    { "reader": "reader_b", "read_on": "2026-10-03", "blind": true, "values": { "…": "…" } }
  ],
  "annotations": "reader_a: p.63 table | reader_b: …"
}
```

`value: null` means "the documents do not settle this" — a real answer the
engine must match by declining. A case counts only with two different readers,
both `blind: true`.

Sanctioned plan (encode by hand):

```json
{
  "case_id": "case_sp_001",
  "kind": "sanctioned_plan",
  "description": "Anonymized: plotted residential, <plot band>, sanctioned <year>",
  "sanction_date": "2019-05-14",
  "facts": { "…": "as above" },
  "expected": { "far": { "value": 0, "unit": "far_x100" } },
  "annotations": "Optional: relaxation, old rule, anything unusual."
}
```

- `expected` holds the **permissible** column of the approved drawing's area
  statement, not the proposed or achieved figures (usually below the limit).
- Anonymize: no addresses, owner names or file numbers — plot band, road
  width and year are all the engine needs. Scans stay out of the repo.

`"synthetic": true` marks harness smoke fixtures; they never count.

## Triage

1. Our rule is wrong → fix it through the verification process (a new
   superseding rule file; never edit a verified rule).
2. A reader misread → both re-read against the cited page.
3. Genuinely unsettled → spec §9 edge-case ledger, the engine declines, and
   the question goes to the interpretations list.
