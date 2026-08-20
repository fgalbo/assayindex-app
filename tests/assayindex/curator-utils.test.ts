import { describe, expect, it } from "vitest";

import { collectDiffPaths } from "@/features/assayindex/curator/diff";
import {
  parseImportedCatalogText,
  serializeCatalog,
} from "@/features/assayindex/curator/import";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";

describe("curator import, validation, and export helpers", () => {
  it("parses and re-serializes a valid catalog", () => {
    const serialized = serializeCatalog(publishedCatalog);
    const parsed = parseImportedCatalogText(serialized);

    expect(parsed.issues).toHaveLength(0);
    expect(parsed.catalog?.meta.title).toBe(publishedCatalog.meta.title);
  });

  it("surfaces validation issues for malformed imports", () => {
    const parsed = parseImportedCatalogText(
      JSON.stringify({
        ...publishedCatalog,
        labs: [{ id: "", displayName: "", shortName: "", website: null, notes: null }],
      }),
    );

    expect(parsed.catalog).toBeNull();
    expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it("tracks draft differences against the published catalog", () => {
    const nextCatalog = {
      ...publishedCatalog,
      assays: publishedCatalog.assays.map((assay) =>
        assay.slug === "hla-b27" ? { ...assay, summary: "Updated summary" } : assay,
      ),
    };

    const diffPaths = collectDiffPaths(publishedCatalog, nextCatalog);

    expect(diffPaths).toContain("root.assays[0].summary");
  });

  it("does not report a difference for equal arrays", () => {
    expect(collectDiffPaths(["HLA-B27", "BCR-ABL1"], ["HLA-B27", "BCR-ABL1"])).toEqual([]);
  });
});
