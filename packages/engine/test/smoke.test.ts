import { describe, expect, it } from "vitest";
import { ENGINE_PACKAGE } from "../src/index.js";

describe("engine package skeleton", () => {
  it("is importable", () => {
    expect(ENGINE_PACKAGE).toBe("@indicodes/engine");
  });
});
