import { describe, expect, it } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { buildAssayReportDocxBlob } from "@/features/assayindex/export/docx";
import { getAssayReport } from "@/features/assayindex/selectors/catalog";

describe("DOCX export", () => {
  it("builds a report blob in the browser-compatible export path", async () => {
    const report = getAssayReport(publishedCatalog, "hla-b27");

    expect(report).not.toBeNull();

    const blob = await buildAssayReportDocxBlob(report!);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
