import { describe, expect, it } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { getCodeExplorerEntries } from "@/features/assayindex/selectors/catalog";

describe("code explorer data", () => {
  it("indexes factor V Leiden LOINC coverage", () => {
    const entries = getCodeExplorerEntries(publishedCatalog);
    const factorVCode = entries.find((entry) => entry.code === "21668-9");

    expect(factorVCode).toBeDefined();
    expect(factorVCode?.assaySlugs).toContain("factor-v-leiden-r506q");
  });

  it("does not publish populated CPT entries without a separate license", () => {
    const entries = getCodeExplorerEntries(publishedCatalog);

    expect(entries.some((entry) => entry.category === "CPT")).toBe(false);
    expect(publishedCatalog.assayLabRecords.every((record) => record.cptCodes.length === 0)).toBe(
      true,
    );
  });

  it("preserves informational ICD-10 notes separately from billing guarantees", () => {
    const entries = getCodeExplorerEntries(publishedCatalog);
    const icd10Entry = entries.find((entry) => entry.code === "E83.110");

    expect(icd10Entry).toBeDefined();
    expect(icd10Entry?.note).toMatch(/informational/i);
    expect(icd10Entry?.scope).toBe("lab-specific");
  });
});
