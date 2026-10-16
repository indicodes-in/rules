import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCategoryFloors, loadCorpusCurrency, loadDeclarations, loadNotModelled } from "../src/corpus.js";

/* Audit 2026-10-10 §05: a declaration that cannot be read must not quietly
   become "nothing declared" — that weakens every answer without a trace. */
const dir = () => mkdtempSync(path.join(tmpdir(), "decl-"));

describe("declaration loaders", () => {
  it("treat an absent file as nothing declared, by default", () => {
    const d = dir();
    expect(loadCategoryFloors(d)).toEqual([]);
    expect(loadCorpusCurrency(d)).toBeNull();
    expect(loadNotModelled(d).size).toBe(0);
  });

  it("refuse an absent file when it is required", () => {
    const d = dir();
    expect(() => loadCategoryFloors(d, { required: true })).toThrow(/category-floor\.json is required/);
    expect(() => loadCorpusCurrency(d, { required: true })).toThrow(/corpus-currency\.json is required/);
    expect(() => loadDeclarations(d, { required: true })).toThrow(/required/);
  });

  it("always refuse a malformed file", () => {
    const d = dir();
    writeFileSync(path.join(d, "category-floor.json"), "{ not json");
    writeFileSync(path.join(d, "corpus-currency.json"), "{ not json");
    expect(() => loadCategoryFloors(d)).toThrow(/could not be read/);
    expect(() => loadCorpusCurrency(d)).toThrow(/could not be read/);
  });

  it("load the real corpus's declarations when required", () => {
    const rules = path.resolve(__dirname, "../../../rules");
    expect(loadCategoryFloors(rules, { required: true }).length).toBeGreaterThan(0);
    expect(loadCorpusCurrency(rules, { required: true })).not.toBeNull();
  });
});
