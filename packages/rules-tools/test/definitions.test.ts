import { describe, expect, it } from "vitest";
import { definitionChecks, undefinedTerms } from "../src/definitions.js";
import { compileRuleSchema } from "../src/schema.js";
import { makeDefinition, makeRule, readJson } from "./helpers.js";

const opts = { registeredDocIds: new Set(["test_doc"]) };
const check = (defs: ReturnType<typeof makeDefinition>[], rules: ReturnType<typeof makeRule>[] = []) =>
  definitionChecks(defs, rules, opts);

describe("definition file integrity", () => {
  it("accepts a well-formed corpus", () => {
    expect(check([makeDefinition({ definition_id: "test_doc.plot_area" })])).toEqual([]);
  });

  it("rejects a definition_id that does not match its filename", () => {
    const d = makeDefinition({ definition_id: "test_doc.plot_area", fileStem: "something_else" });
    expect(check([d])[0]).toMatch(/does not match filename/);
  });

  it("rejects a duplicate definition_id", () => {
    const a = makeDefinition({ definition_id: "test_doc.plot_area" });
    const b = makeDefinition({ definition_id: "test_doc.plot_area" });
    expect(check([a, b])[0]).toMatch(/duplicate definition_id/);
  });

  it("rejects a citation to an unregistered document", () => {
    const d = makeDefinition({ definition_id: "test_doc.plot_area", doc_id: "not_registered" });
    expect(check([d])[0]).toMatch(/not registered in sources\/sources\.json/);
  });

  it("rejects supersession of a definition that does not exist", () => {
    const d = makeDefinition({ definition_id: "test_doc.plot_area", supersedes: "test_doc.ghost" });
    expect(check([d])[0]).toMatch(/does not exist in rules\/definitions\//);
  });

  it("detects a supersession cycle", () => {
    const a = makeDefinition({ definition_id: "test_doc.a", supersedes: "test_doc.b" });
    const b = makeDefinition({ definition_id: "test_doc.b", supersedes: "test_doc.a" });
    expect(check([a, b]).some((e) => /cycle/.test(e))).toBe(true);
  });
});

describe("term coverage (a checked number must not rest on an unchecked word)", () => {
  it("fails a verified rule consuming a term nothing defines", () => {
    const rule = makeRule({ rule_id: "test_doc.far.a" });
    rule.rule.consumes_terms = ["built-up area"];
    const errors = check([], [rule]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/which no definition file defines/);
  });

  it("fails a verified rule consuming a term that is only a draft", () => {
    const rule = makeRule({ rule_id: "test_doc.far.a" });
    rule.rule.consumes_terms = ["plot area"];
    const draft = makeDefinition({ definition_id: "draft.plot_area", status: "draft", text: null });
    const errors = check([draft], [rule]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/still a draft/);
  });

  it("passes once the definition is verified", () => {
    const rule = makeRule({ rule_id: "test_doc.far.a" });
    rule.rule.consumes_terms = ["plot area"];
    expect(check([makeDefinition({ definition_id: "test_doc.plot_area" })], [rule])).toEqual([]);
  });

  it("does not hold a draft rule to the standard — only verified rules ship", () => {
    const rule = makeRule({ rule_id: "test_doc.far.a", status: "draft" });
    rule.rule.consumes_terms = ["built-up area"];
    expect(check([], [rule])).toEqual([]);
  });

  it("treats a rule declaring nothing as unrecorded, not as depending on nothing", () => {
    // Every rule in the corpus is in this state today; failing them would make
    // the check unshippable and teach nobody anything.
    expect(check([], [makeRule({ rule_id: "test_doc.far.a" })])).toEqual([]);
  });
});

describe("conflicting definitions (the first conflicts_with detector)", () => {
  const a = { definition_id: "test_doc.height_a", term: "building height", text: "measured from road level" };
  const b = { definition_id: "test_doc.height_b", term: "building height", text: "measured from plinth level" };

  it("flags two verified definitions of one term in force at once", () => {
    const errors = check([makeDefinition(a), makeDefinition(b)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/two verified definitions of "building height"/);
  });

  it("allows them when one supersedes the other", () => {
    const older = makeDefinition({ ...a, effective_to: "2022-01-01" });
    const newer = makeDefinition({ ...b, effective_from: "2022-01-01", supersedes: a.definition_id });
    expect(check([older, newer])).toEqual([]);
  });

  it("allows them when their scopes do not overlap", () => {
    // Not modellable today (both enums are single-valued) but the check must
    // be scope-aware before a second authority lands, not after.
    const errors = check([makeDefinition(a), makeDefinition({ ...b, authority: "OTHER" })]);
    expect(errors).toEqual([]);
  });

  it("does not flag identical text from two documents — that is agreement", () => {
    const errors = check([makeDefinition(a), makeDefinition({ ...b, text: a.text })]);
    expect(errors).toEqual([]);
  });

  it("does not flag a draft against a verified definition", () => {
    // A draft is a research note, not a claim about what the law says.
    const errors = check([makeDefinition(a), makeDefinition({ ...b, status: "draft", text: null })]);
    expect(errors).toEqual([]);
  });
});

describe("undefinedTerms — the definitions work queue", () => {
  it("ranks by how many rules lean on the term", () => {
    const r1 = makeRule({ rule_id: "test_doc.far.a" });
    const r2 = makeRule({ rule_id: "test_doc.far.b" });
    const r3 = makeRule({ rule_id: "test_doc.cov.a" });
    r1.rule.consumes_terms = ["plot area", "built-up area"];
    r2.rule.consumes_terms = ["plot area"];
    r3.rule.consumes_terms = ["plot area"];
    const queue = undefinedTerms([], [r1, r2, r3]);
    expect(queue[0]).toEqual({ term: "plot area", status: "missing", consumedBy: 3 });
    expect(queue[1]).toEqual({ term: "built-up area", status: "missing", consumedBy: 1 });
  });

  it("keeps a draft term nobody consumes yet — that is why the draft exists", () => {
    const queue = undefinedTerms([makeDefinition({ definition_id: "draft.storey", term: "storey", status: "draft", text: null })], []);
    expect(queue).toEqual([{ term: "storey", status: "draft", consumedBy: 0 }]);
  });

  it("drops a term once its definition is verified", () => {
    const rule = makeRule({ rule_id: "test_doc.far.a" });
    rule.rule.consumes_terms = ["plot area"];
    expect(undefinedTerms([makeDefinition({ definition_id: "test_doc.plot_area" })], [rule])).toEqual([]);
  });
});

describe("definition.schema.json — the verified-completeness gate", () => {
  const validate = compileRuleSchema(readJson("rules/schema/definition.schema.json") as object);
  const draft = readJson("rules/definitions/draft.plot_area.json") as Record<string, unknown>;
  const citation = {
    doc_id: "test_doc",
    clause: "§0.0",
    page: 1,
    bbox: null,
    original_text: null,
    original_lang: "en",
    translated_text: null,
  };
  const verified = (over: Record<string, unknown> = {}) => ({
    ...draft,
    text: { original: "real text", original_lang: "en", translated: null },
    effective_from: "2020-01-01",
    citations: [citation],
    verification: {
      status: "verified",
      verified_by: "someone",
      verified_on: "2020-01-01",
      method: "manual_entry",
      confidence: null,
    },
    ...over,
  });

  it("accepts a draft with no text and no citations", () => {
    expect(validate(draft)).toBe(true);
  });

  it("accepts a complete verified definition", () => {
    expect(validate(verified())).toBe(true);
  });

  it("rejects a verified definition with no text — the whole point of the node", () => {
    expect(validate(verified({ text: { original: null, original_lang: null, translated: null } }))).toBe(false);
  });

  it("rejects a verified definition with no citation", () => {
    expect(validate(verified({ citations: [] }))).toBe(false);
  });

  it("rejects a verified definition with no effective date", () => {
    expect(validate(verified({ effective_from: null }))).toBe(false);
  });

  it("rejects unknown fields, so a typo can never silently do nothing", () => {
    expect(validate({ ...draft, definitionn: "typo" })).toBe(false);
  });
});

describe("the shipped definition corpus", () => {
  const TERMS = [
    "basement",
    "building_height",
    "built_up_area",
    "dwelling_unit",
    "ecs",
    "ground_coverage",
    "plot_area",
    "road_width",
    "stilt_floor",
    "storey",
  ];

  it("carries no definition text — principle 3 forbids writing one from memory", () => {
    for (const slug of TERMS) {
      const d = readJson(`rules/definitions/draft.${slug}.json`) as {
        text: { original: string | null };
        verification: { status: string };
        citations: unknown[];
      };
      expect(d.text.original, `draft.${slug} must not carry invented text`).toBeNull();
      expect(d.verification.status).toBe("draft");
      expect(d.citations).toEqual([]);
    }
  });

  it("says in each file what the term is load-bearing for", () => {
    for (const slug of TERMS) {
      const d = readJson(`rules/definitions/draft.${slug}.json`) as { notes: string };
      expect(d.notes).toMatch(/TODO\(verify\)/);
      expect(d.notes.length).toBeGreaterThan(120);
    }
  });
});
