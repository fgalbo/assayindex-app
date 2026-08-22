import { beforeEach, describe, expect, it } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { getAllCatalogFilterOptions, getFilterOptions } from "@/features/assayindex/selectors/catalog";
import { resetSearchCache, searchAllCatalog, searchCatalog } from "@/features/assayindex/search";

beforeEach(() => {
  resetSearchCache();
});

describe("assay search", () => {
  it("finds assays by source-backed code", () => {
    const results = searchCatalog(publishedCatalog, "21668-9", {}, "relevance");

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.document.assaySlug === "factor-v-leiden-r506q")).toBe(
      true,
    );
  });

  it("finds assays by a laboratory-record synonym", () => {
    const nextCatalog = structuredClone(publishedCatalog);
    const record = nextCatalog.assayLabRecords[0];
    record.synonyms.push("Unique laboratory order mnemonic");

    const results = searchAllCatalog(
      nextCatalog,
      "Unique laboratory order mnemonic",
      {},
      "relevance",
    );

    expect(results.map((result) => result.document.assaySlug)).toContain(record.assaySlug);
  });

  it("does not present weak fuzzy CDC matches as relevant gene results", () => {
    const results = searchAllCatalog(publishedCatalog, "TP53", {}, "relevance");

    expect(
      results.map((result) => ({
        id: result.document.id,
        name: result.document.displayName,
        score: result.score,
      })),
    ).toEqual([]);
  });

  it.each(["CBC", "PT", "UA"])(
    "does not present substring or fuzzy collisions for the short mnemonic %s",
    (query) => {
      expect(searchAllCatalog(publishedCatalog, query, {}, "relevance")).toEqual([]);
    },
  );

  it("matches short clinical mnemonics only at normalized token boundaries", () => {
    const nextCatalog = structuredClone(publishedCatalog);
    const cases = [
      { query: "CBC", synonym: "CBC with differential", assaySlug: nextCatalog.assays[0].slug },
      { query: "PT", synonym: "PT/INR", assaySlug: nextCatalog.assays[1].slug },
      { query: "UA", synonym: "UA with microscopy", assaySlug: nextCatalog.assays[2].slug },
      { query: "A1C", synonym: "Hemoglobin A1C", assaySlug: nextCatalog.assays[3].slug },
      { query: "CTNG", synonym: "CT/NG confirmation", assaySlug: nextCatalog.assays[4].slug },
      { query: "GCCT", synonym: "GC/CT confirmation", assaySlug: nextCatalog.assays[5].slug },
      { query: "PTINR", synonym: "PT/INR", assaySlug: nextCatalog.assays[1].slug },
    ];

    for (const testCase of cases) {
      const record = nextCatalog.assayLabRecords.find(
        (candidate) => candidate.assaySlug === testCase.assaySlug,
      );
      expect(record).toBeDefined();
      record!.synonyms.push(testCase.synonym);
    }

    for (const testCase of cases) {
      const results = searchAllCatalog(nextCatalog, testCase.query, {}, "relevance");
      expect(
        results.map((result) => ({ assaySlug: result.document.assaySlug, score: result.score })),
        testCase.query,
      ).toEqual([{ assaySlug: testCase.assaySlug, score: 0 }]);
    }
  });

  it("preserves fuzzy matching for longer natural-language queries", () => {
    const results = searchAllCatalog(publishedCatalog, "Hemochromatoses", {}, "relevance");

    expect(results.map((result) => result.document.assaySlug)).toContain(
      "hereditary-hemochromatosis-hfe",
    );
  });

  it("does not return the same catalog for an unrelated query", () => {
    expect(searchAllCatalog(publishedCatalog, "zzzxqv-no-such-test", {}, "relevance")).toEqual([]);
  });

  it("keeps strong exact gene matches while dropping unrelated fuzzy results", () => {
    const results = searchAllCatalog(publishedCatalog, "EGFR", {}, "relevance");

    expect(results.map((result) => result.document.displayName)).toEqual([
      "EGFR Mutation Analysis for NSCLC",
    ]);
  });

  it("applies intersecting lab and specialty filters", () => {
    const results = searchCatalog(
      publishedCatalog,
      "",
      {
        labId: "arup",
        specialty: "Molecular Oncology",
      },
      "alphabetical",
    );

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (result) =>
          result.document.labIds.includes("arup") &&
          result.document.specialty.includes("Molecular Oncology"),
      ),
    ).toBe(true);
  });

  it("sorts by lab count when requested", () => {
    const results = searchCatalog(publishedCatalog, "", {}, "lab-count");

    expect(results.length).toBeGreaterThan(1);
    expect(results[0].document.labCount).toBeGreaterThanOrEqual(
      results[results.length - 1].document.labCount,
    );
  });

  it("rebuilds cached search documents when the catalog changes", () => {
    searchCatalog(publishedCatalog, "81241", {}, "relevance");

    const nextCatalog = structuredClone(publishedCatalog);
    nextCatalog.assays[0].displayName = "Unique acquired catalog marker";

    const results = searchCatalog(nextCatalog, "Unique acquired catalog marker", {}, "relevance");

    expect(results.map((result) => result.document.assaySlug)).toContain(
      nextCatalog.assays[0].slug,
    );
  });

  it("keeps source-native narratives searchable without creating giant exact facets", () => {
    const assayOnlyOptions = getFilterOptions(publishedCatalog);
    const allCatalogOptions = getAllCatalogFilterOptions(publishedCatalog);
    const narrativeOffering = publishedCatalog.sourceOfferings!.find(
      (offering) =>
        (offering.acceptableSampleForTesting?.length ?? 0) > 100 &&
        (offering.methodology?.length ?? 0) > 40,
    );

    expect(narrativeOffering).toBeDefined();
    expect(allCatalogOptions.specimenTypes).toEqual(assayOnlyOptions.specimenTypes);
    expect(allCatalogOptions.methodologies).toEqual(assayOnlyOptions.methodologies);
    expect(allCatalogOptions.specimenTypes).not.toContain(
      narrativeOffering!.acceptableSampleForTesting,
    );
    expect(allCatalogOptions.methodologies).not.toContain(narrativeOffering!.methodology);

    for (const query of [
      narrativeOffering!.acceptableSampleForTesting!,
      narrativeOffering!.methodology!,
    ]) {
      expect(searchAllCatalog(publishedCatalog, query, {}, "relevance")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            document: expect.objectContaining({ id: narrativeOffering!.id }),
          }),
        ]),
      );
    }
  });
});
