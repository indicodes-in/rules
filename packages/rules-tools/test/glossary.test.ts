import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { definitionsInForce, loadDefinitions } from "../src/glossary.js";
import type { DefinitionFile } from "../src/types.js";

/** Synthetic definitions — text fake by design (CLAUDE.md principle 3). */
function def(over: Partial<DefinitionFile> & { definition_id: string }): DefinitionFile {
  return {
    term: "widget",
    applies_to: { land_use: "residential_plotted", authority: "DDA" },
    text: { original: "Widget: SYNTHETIC.", original_lang: "en", translated: null },
    effective_from: "2016-01-01",
    effective_to: null,
    supersedes: null,
    citations: [
      {
        doc_id: "test_doc",
        clause: "1.1",
        page: 3,
        bbox: null,
        original_text: "Widget: SYNTHETIC.",
        original_lang: "en",
        translated_text: null,
      },
    ],
    verification: { status: "verified" },
    notes: "",
    ...over,
  };
}

describe("definitionsInForce", () => {
  it("serves verified definitions and hides drafts unless drafts are allowed", () => {
    const defs = [def({ definition_id: "a.widget" }), def({ definition_id: "a.gadget", term: "gadget", verification: { status: "draft" } })];
    expect(definitionsInForce(defs, "2026-01-01").map((d) => d.term)).toEqual(["widget"]);
    expect(definitionsInForce(defs, "2026-01-01", { allowDraft: true }).map((d) => d.term)).toEqual([
      "gadget",
      "widget",
    ]);
  });

  it("never serves a placeholder with no text", () => {
    const placeholder = def({
      definition_id: "draft.widget",
      text: { original: null, original_lang: null, translated: null },
      citations: [],
      effective_from: null,
      verification: { status: "draft" },
    });
    expect(definitionsInForce([placeholder], "2026-01-01", { allowDraft: true })).toEqual([]);
  });

  it("hands over to a dated successor on its date, not before", () => {
    const old = def({ definition_id: "a.widget" });
    const amended = def({
      definition_id: "b.widget",
      supersedes: "a.widget",
      effective_from: "2018-06-01",
      text: { original: "Widget: SYNTHETIC, AMENDED.", original_lang: "en", translated: null },
    });
    const before = definitionsInForce([old, amended], "2018-05-31");
    expect(before.map((d) => d.definition_id)).toEqual(["a.widget"]);
    expect(before[0]!.reworded).toMatchObject({ definition_id: "b.widget", effective_from: "2018-06-01" });
    expect(definitionsInForce([old, amended], "2018-06-01").map((d) => d.definition_id)).toEqual(["b.widget"]);
  });

  it("keeps the old wording in force beside an undated rewording, and says so", () => {
    const old = def({ definition_id: "a.widget" });
    const undated = def({
      definition_id: "b.widget",
      supersedes: "a.widget",
      effective_from: null,
      verification: { status: "draft" },
    });
    const served = definitionsInForce([old, undated], "2026-01-01", { allowDraft: true });
    expect(served.map((d) => d.definition_id)).toEqual(["a.widget"]);
    expect(served[0]!.reworded).toMatchObject({ definition_id: "b.widget", effective_from: null });
  });

  it("keeps a confirmed definition beside an unconfirmed rewording, warning without its text", () => {
    const old = def({ definition_id: "a.widget" });
    const draft = def({
      definition_id: "b.widget",
      supersedes: "a.widget",
      effective_from: "2018-06-01",
      verification: { status: "draft" },
    });
    const [served] = definitionsInForce([old, draft], "2026-01-01");
    expect(served!.definition_id).toBe("a.widget");
    expect(served!.reworded).toEqual({ definition_id: "b.widget", effective_from: "2018-06-01", citation: null });
  });

  it("does not serve a definition before its own date", () => {
    expect(definitionsInForce([def({ definition_id: "a.widget" })], "2015-12-31")).toEqual([]);
  });

  it("lists the term among its aliases and keeps a second printing as also_in", () => {
    const twice = def({
      definition_id: "a.widget",
      aliases: ["Widgets", "WG"],
      citations: [def({ definition_id: "x" }).citations[0]!, { ...def({ definition_id: "y" }).citations[0]!, doc_id: "later_doc", page: 9 }],
    });
    const [served] = definitionsInForce([twice], "2026-01-01");
    expect(served!.aliases).toEqual(["widget", "Widgets", "WG"]);
    expect(served!.also_in.map((c) => c.doc_id)).toEqual(["later_doc"]);
    expect(served!.link_in_text).toBe(true);
  });
});

describe("the real glossary", () => {
  const rulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../rules");

  it("joins the MPD table's DUs to UBBL clause 1.4.32 (drafts allowed)", () => {
    const served = definitionsInForce(loadDefinitions(rulesDir), "2026-10-11", { allowDraft: true });
    const du = served.find((d) => d.aliases.includes("DUs"));
    expect(du?.term).toBe("dwelling unit");
    expect(du?.citation).toMatchObject({ doc_id: "ubbl2016", clause: "1.4.32", page: 297 });
  });

  it("serves no draft in production", () => {
    const served = definitionsInForce(loadDefinitions(rulesDir), "2026-10-11");
    expect(served.every((d) => d.status === "verified")).toBe(true);
  });
});
