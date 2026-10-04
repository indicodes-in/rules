import { describe, expect, it } from "vitest";
import { missingExtracts } from "../src/pages.js";

const rule = (status: string, page: number | null) => ({
  rule: { verification: { status }, citations: [{ doc_id: "test_doc", page }] },
});
const manifest = (...pages: number[]) => ({
  extracts: pages.map((page) => ({ doc_id: "test_doc", page, file: `sources/pages/test_doc/p${page}.pdf` })),
});
const onDisk = () => true;

describe("cited-page extracts", () => {
  it("passes when every verified citation has an extract on disk", () => {
    expect(missingExtracts([rule("verified", 2)], [], manifest(2), onDisk)).toEqual([]);
  });

  it("fails for a verified citation with no extract", () => {
    const errors = missingExtracts([rule("verified", 2)], [], manifest(), onDisk);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("test_doc p.2");
    expect(errors[0]).toContain("python -m pipeline.cite_pages");
  });

  it("ignores drafts and citations not yet anchored to a page", () => {
    expect(missingExtracts([rule("draft", 5), rule("verified", null)], [], null, onDisk)).toEqual([]);
  });

  it("counts provision citations (category-floor.json) too", () => {
    const errors = missingExtracts([], [{ doc_id: "test_doc", page: 7 }], manifest(), onDisk);
    expect(errors[0]).toContain("test_doc p.7");
  });

  it("fails when the manifest names a file that is not there", () => {
    const errors = missingExtracts([rule("verified", 2)], [], manifest(2), () => false);
    expect(errors[0]).toContain("sources/pages/test_doc/p2.pdf");
  });
});
