import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileRuleSchema, schemaErrors } from "../src/schema.js";
import { readJson, repoRoot } from "./helpers.js";

const schema = readJson("rules/schema/rule.schema.json") as object;
const validate = compileRuleSchema(schema);

const fixtureDir = (kind: string) => path.join("rules", "schema", "fixtures", kind);
const fixtures = (kind: string) =>
  readdirSync(path.join(repoRoot, fixtureDir(kind))).filter((f) => f.endsWith(".json"));

describe("rule.schema.json fixtures", () => {
  it("has the full fixture set from rules/schema/README.md", () => {
    expect(fixtures("valid")).toHaveLength(4);
    expect(fixtures("invalid")).toHaveLength(6);
  });

  for (const file of fixtures("valid")) {
    it(`accepts valid/${file}`, () => {
      const ok = validate(readJson(path.join(fixtureDir("valid"), file)));
      expect(schemaErrors(validate)).toEqual([]);
      expect(ok).toBe(true);
    });
  }

  for (const file of fixtures("invalid")) {
    it(`rejects invalid/${file}`, () => {
      expect(validate(readJson(path.join(fixtureDir("invalid"), file)))).toBe(false);
    });
  }
});
