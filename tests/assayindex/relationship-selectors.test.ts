import { describe, expect, it } from "vitest";

import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import {
  buildSearchDocuments,
  getAssayCards,
  getCoOrderRelationshipSummaries,
  getCuratedRelationshipSummaries,
  getRecordsByAssaySlug,
} from "@/features/assayindex/selectors/catalog";
import {
  createCoOrderRelationship,
  createCuratedRelationship,
} from "@/tests/assayindex/fixtures/relationships";

function createCatalog(): AssayIndexCatalog {
  return structuredClone(publishedCatalog);
}

describe("assay relationship selectors", () => {
  it("derives directional pair-over-focal percentages and sorts by percentage then assay name", () => {
    const catalog = createCatalog();
    catalog.coOrderRelationships = [
      createCoOrderRelationship({
        id: "co-order-bcr-hla",
        counts: {
          eligibleSetCount: 100,
          leftSetCount: 40,
          rightSetCount: 50,
          pairSetCount: 10,
        },
      }),
      createCoOrderRelationship({
        id: "co-order-bcr-factor",
        rightAssaySlug: "factor-v-leiden-r506q",
        counts: {
          eligibleSetCount: 100,
          leftSetCount: 40,
          rightSetCount: 30,
          pairSetCount: 20,
        },
      }),
      createCoOrderRelationship({
        id: "co-order-bcr-hla-tie",
        counts: {
          eligibleSetCount: 100,
          leftSetCount: 40,
          rightSetCount: 50,
          pairSetCount: 20,
        },
        source: {
          ...createCoOrderRelationship().source,
          datasetVersion: "2026.2",
          snapshotSha256: "b".repeat(64),
        },
      }),
      createCoOrderRelationship({ id: "co-order-draft", publicationStatus: "draft" }),
    ];

    const leftSummaries = getCoOrderRelationshipSummaries(
      catalog,
      "bcr-abl1-p210-quantitative",
    );

    expect(leftSummaries.map((summary) => summary.relationship.id)).toEqual([
      "co-order-bcr-factor",
      "co-order-bcr-hla-tie",
      "co-order-bcr-hla",
    ]);
    expect(leftSummaries.map((summary) => summary.percentage)).toEqual([50, 50, 25]);
    expect(leftSummaries[2]).toMatchObject({ focalSetCount: 40, pairSetCount: 10 });

    const rightSummary = getCoOrderRelationshipSummaries(catalog, "hla-b27").find(
      (summary) => summary.relationship.id === "co-order-bcr-hla",
    );
    expect(rightSummary).toMatchObject({ focalSetCount: 50, pairSetCount: 10, percentage: 20 });
  });

  it("returns only published curated relationships and reports direction deterministically", () => {
    const catalog = createCatalog();
    catalog.curatedAssayRelationships = [
      createCuratedRelationship({ id: "curated-published" }),
      createCuratedRelationship({ id: "curated-draft", publicationStatus: "draft" }),
    ];

    expect(getCuratedRelationshipSummaries(catalog, "bcr-abl1-p210-quantitative")).toMatchObject([
      {
        direction: "outgoing",
        otherAssay: { slug: "hla-b27" },
        relationship: { id: "curated-published" },
      },
    ]);
    expect(getCuratedRelationshipSummaries(catalog, "hla-b27")).toMatchObject([
      {
        direction: "incoming",
        otherAssay: { slug: "bcr-abl1-p210-quantitative" },
        relationship: { id: "curated-published" },
      },
    ]);
  });
});

describe("neutral offering discovery", () => {
  it("orders offerings by lab display name, test name, and record ID only", () => {
    const catalog = createCatalog();
    const template = structuredClone(
      catalog.assayLabRecords.find((record) => record.assaySlug === "hla-b27")!,
    );
    const labcorpId = catalog.labs.find((lab) => lab.displayName === "Labcorp")!.id;
    const mayoId = catalog.labs.find((lab) => lab.displayName === "Mayo Clinic Laboratories")!.id;
    const sourceUrl = template.sourceLinks[0].url;
    catalog.assayLabRecords = [
      {
        ...structuredClone(template),
        id: "record-zeta",
        labId: labcorpId,
        testName: "Zeta assay",
        displayOrder: 0,
        priceObservations: [
          {
            priceType: "cash",
            sourceText: "$1.00",
            amount: "1.00",
            minimumAmount: null,
            maximumAmount: null,
            currency: "USD",
            effectiveDate: null,
            sourceUrl,
            note: null,
          },
        ],
      },
      {
        ...structuredClone(template),
        id: "record-alpha-b",
        labId: labcorpId,
        testName: "Alpha assay",
        displayOrder: 999,
        priceObservations: null,
      },
      {
        ...structuredClone(template),
        id: "record-alpha-a",
        labId: labcorpId,
        testName: "Alpha assay",
        displayOrder: 500,
        priceObservations: null,
      },
      {
        ...structuredClone(template),
        id: "record-mayo-first-by-display-order",
        labId: mayoId,
        testName: "A assay",
        displayOrder: 0,
        priceObservations: null,
      },
    ];
    catalog.coOrderRelationships = [
      createCoOrderRelationship({
        counts: {
          eligibleSetCount: 1_000,
          leftSetCount: 900,
          rightSetCount: 900,
          pairSetCount: 850,
        },
      }),
    ];

    expect(getRecordsByAssaySlug(catalog, "hla-b27").map((record) => record.id)).toEqual([
      "record-alpha-a",
      "record-alpha-b",
      "record-zeta",
      "record-mayo-first-by-display-order",
    ]);
  });

  it("counts distinct laboratories rather than duplicate offerings", () => {
    const catalog = createCatalog();
    const records = catalog.assayLabRecords.filter((record) => record.assaySlug === "hla-b27");
    const duplicate = {
      ...structuredClone(records[0]),
      id: `${records[0].id}-duplicate-offering`,
    };
    catalog.assayLabRecords.push(duplicate);
    const expectedDistinctLabCount = new Set([...records, duplicate].map((record) => record.labId)).size;

    expect(
      buildSearchDocuments(catalog).find((document) => document.assaySlug === "hla-b27")?.labCount,
    ).toBe(expectedDistinctLabCount);
    expect(getAssayCards(catalog).find((card) => card.assay.slug === "hla-b27")?.labCount).toBe(
      expectedDistinctLabCount,
    );
  });
});
