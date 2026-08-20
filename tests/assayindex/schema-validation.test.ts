import { describe, expect, it } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import {
  mapValidationIssues,
  parseCatalog,
  validateCatalog,
} from "@/features/assayindex/schema/catalog";
import {
  createCoOrderRelationship,
  createCuratedRelationship,
} from "@/tests/assayindex/fixtures/relationships";

type ContractCatalog = typeof publishedCatalog & {
  curatedAssayRelationships: Array<ReturnType<typeof createCuratedRelationship>>;
  coOrderRelationships: Array<ReturnType<typeof createCoOrderRelationship>>;
};

type CoOrderFixture = ReturnType<typeof createCoOrderRelationship>;
type MutableCoOrderFixture = CoOrderFixture &
  Record<string, unknown> & {
    counts: CoOrderFixture["counts"] & Record<string, unknown>;
    observationWindow: CoOrderFixture["observationWindow"] & Record<string, unknown>;
    source: CoOrderFixture["source"] & Record<string, unknown>;
    mapping: CoOrderFixture["mapping"] & Record<string, unknown>;
    disclosureReview: CoOrderFixture["disclosureReview"] & Record<string, unknown>;
  };

function createContractCatalog() {
  const catalog = structuredClone(publishedCatalog) as ContractCatalog;
  catalog.curatedAssayRelationships ??= [];
  catalog.coOrderRelationships ??= [];
  return catalog;
}

function createPriceObservation(
  sourceUrl: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    priceType: "cash",
    sourceText: "$125.50 cash price",
    amount: "125.50",
    minimumAmount: null,
    maximumAmount: null,
    currency: "USD",
    effectiveDate: "2026-08-12",
    sourceUrl,
    note: null,
    ...overrides,
  };
}

function createCatalogWithPrice(overrides: Record<string, unknown> = {}) {
  const catalog = createContractCatalog();
  const record = catalog.assayLabRecords[0];
  (record as unknown as { priceObservations: unknown }).priceObservations = [
    createPriceObservation(record.sourceLinks[0].url, overrides),
  ];
  return catalog;
}

function getValidationIssues(input: unknown) {
  const result = validateCatalog(input);

  if (result.success) {
    throw new Error("Expected catalog validation to fail.");
  }

  return mapValidationIssues(result.error);
}

describe("assay catalog schema validation", () => {
  it("accepts the published catalog", () => {
    const result = validateCatalog(publishedCatalog);

    expect(result.success).toBe(true);
  });

  it("rejects invalid assay payloads with structured issues", () => {
    const invalidCatalog = {
      ...publishedCatalog,
      assays: [
        {
          ...publishedCatalog.assays[0],
          displayName: "",
          createdAt: "not-a-date",
        },
      ],
    };

    const result = validateCatalog(invalidCatalog);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "assays.0.displayName")).toBe(
        true,
      );
      expect(result.error.issues.some((issue) => issue.path.join(".") === "assays.0.createdAt")).toBe(
        true,
      );
    }
  });

  it("rejects duplicate record identifiers", () => {
    const invalidCatalog = structuredClone(publishedCatalog);
    invalidCatalog.assayLabRecords.push(structuredClone(invalidCatalog.assayLabRecords[0]));

    expect(getValidationIssues(invalidCatalog)).toContainEqual(
      expect.objectContaining({
        path: `assayLabRecords.${invalidCatalog.assayLabRecords.length - 1}.id`,
        code: "duplicate_id",
      }),
    );
  });

  it("rejects a record that references an unknown laboratory", () => {
    const invalidCatalog = structuredClone(publishedCatalog);
    invalidCatalog.assayLabRecords[0].labId = "missing-reference-laboratory";

    expect(getValidationIssues(invalidCatalog)).toContainEqual(
      expect.objectContaining({
        path: "assayLabRecords.0.labId",
        code: "invalid_reference",
      }),
    );
  });

  it("rejects a published record without source provenance", () => {
    const invalidCatalog = structuredClone(publishedCatalog);
    invalidCatalog.assayLabRecords[0].sourceLinks = [];

    expect(getValidationIssues(invalidCatalog)).toContainEqual(
      expect.objectContaining({
        path: "assayLabRecords.0.sourceLinks",
        code: "missing_provenance",
      }),
    );
  });

  it("rejects non-HTTP external catalog URLs", () => {
    const invalidLabWebsite = structuredClone(publishedCatalog);
    invalidLabWebsite.labs[0].website = "ftp://reference-lab.example/catalog";

    const invalidRecordSource = structuredClone(publishedCatalog);
    invalidRecordSource.assayLabRecords[0].sourceLinks[0].url =
      "javascript:alert('unsafe')";

    const invalidSourceDocument = structuredClone(publishedCatalog);
    invalidSourceDocument.sourceDocuments[0].url = "mailto:catalog@example.org";

    expect(getValidationIssues(invalidLabWebsite)).toContainEqual(
      expect.objectContaining({ path: "labs.0.website" }),
    );
    expect(getValidationIssues(invalidRecordSource)).toContainEqual(
      expect.objectContaining({ path: "assayLabRecords.0.sourceLinks.0.url" }),
    );
    expect(getValidationIssues(invalidSourceDocument)).toContainEqual(
      expect.objectContaining({ path: "sourceDocuments.0.url" }),
    );
  });

  it("defaults omitted price observations and relationship collections without inventing data", () => {
    const legacyCatalog = structuredClone(publishedCatalog) as Record<string, unknown> & {
      assayLabRecords: Array<Record<string, unknown>>;
    };

    delete legacyCatalog.curatedAssayRelationships;
    delete legacyCatalog.coOrderRelationships;
    legacyCatalog.assayLabRecords.forEach((record) => delete record.priceObservations);

    const parsed = parseCatalog(legacyCatalog) as unknown as ContractCatalog;

    expect(parsed.curatedAssayRelationships).toEqual([]);
    expect(parsed.coOrderRelationships).toEqual([]);
    expect(parsed.assayLabRecords.every((record) => record.priceObservations === null)).toBe(true);
  });

  it("preserves exact and ranged source-backed price observations", () => {
    const catalog = createContractCatalog();
    const record = catalog.assayLabRecords[0];
    const sourceUrl = record.sourceLinks[0].url;
    const observations = [
      createPriceObservation(sourceUrl),
      createPriceObservation(sourceUrl, {
        priceType: "medicare-clfs",
        sourceText: "$100.00-$250.00 published range",
        amount: null,
        minimumAmount: "100.00",
        maximumAmount: "250.00",
        effectiveDate: null,
        note: "Aggregate payment range.",
      }),
    ];
    (record as unknown as { priceObservations: unknown }).priceObservations = observations;

    const parsed = parseCatalog(catalog) as unknown as ContractCatalog;

    expect(parsed.assayLabRecords[0].priceObservations).toEqual(observations);
  });

  it.each([
    ["an empty source label", { sourceText: "" }, "sourceText"],
    ["a numeric amount", { amount: 125.5 }, "amount"],
    ["a non-decimal amount", { amount: "1e3" }, "amount"],
    ["a lowercase currency", { currency: "usd" }, "currency"],
    ["a non-ISO effective date", { effectiveDate: "08/12/2026" }, "effectiveDate"],
    ["an unsupported price type", { priceType: "estimated" }, "priceType"],
    [
      "an exact amount plus a range",
      { minimumAmount: "100.00", maximumAmount: "150.00" },
      "priceObservations.0",
    ],
    [
      "an incomplete range",
      { amount: null, minimumAmount: "100.00", maximumAmount: null },
      "priceObservations.0",
    ],
    [
      "a descending range",
      { amount: null, minimumAmount: "250.00", maximumAmount: "100.00" },
      "priceObservations.0",
    ],
    [
      "an unlinked source URL",
      { sourceUrl: "https://example.test/not-a-record-source" },
      "sourceUrl",
    ],
  ])("rejects price observations with %s", (_label, overrides, expectedPath) => {
    const issues = getValidationIssues(createCatalogWithPrice(overrides));

    expect(issues.some((issue) => issue.path.includes(expectedPath))).toBe(true);
  });

  it("preserves valid curated and aggregate co-order relationships", () => {
    const catalog = createContractCatalog();
    const curatedRelationship = createCuratedRelationship();
    const coOrderRelationship = createCoOrderRelationship();
    catalog.curatedAssayRelationships = [curatedRelationship];
    catalog.coOrderRelationships = [coOrderRelationship];

    const parsed = parseCatalog(catalog) as unknown as ContractCatalog;

    expect(parsed.curatedAssayRelationships).toEqual([curatedRelationship]);
    expect(parsed.coOrderRelationships).toEqual([coOrderRelationship]);
  });

  it.each([
    [
      "self relationships",
      (relationship: Record<string, unknown>) => {
        relationship.targetAssaySlug = relationship.sourceAssaySlug;
      },
      "targetAssaySlug",
    ],
    [
      "dangling assay endpoints",
      (relationship: Record<string, unknown>) => {
        relationship.targetAssaySlug = "missing-assay";
      },
      "targetAssaySlug",
    ],
    [
      "missing source links",
      (relationship: Record<string, unknown>) => {
        relationship.sourceLinks = [];
      },
      "sourceLinks",
    ],
    [
      "missing source publisher provenance",
      (relationship: Record<string, unknown>) => {
        relationship.sourcePublisherId = "";
      },
      "sourcePublisherId",
    ],
  ])("rejects curated %s", (_label, mutate, expectedPath) => {
    const catalog = createContractCatalog();
    const relationship = createCuratedRelationship() as Record<string, unknown>;
    mutate(relationship);
    catalog.curatedAssayRelationships = [relationship as ReturnType<typeof createCuratedRelationship>];

    expect(
      getValidationIssues(catalog).some((issue) => issue.path.includes(expectedPath)),
    ).toBe(true);
  });

  it.each([
    [
      "a noncanonical endpoint order",
      (relationship: MutableCoOrderFixture) => {
        [relationship.leftAssaySlug, relationship.rightAssaySlug] = [
          relationship.rightAssaySlug,
          relationship.leftAssaySlug,
        ];
      },
      "leftAssaySlug",
    ],
    [
      "the same assay on both endpoints",
      (relationship: MutableCoOrderFixture) => {
        relationship.rightAssaySlug = relationship.leftAssaySlug;
      },
      "rightAssaySlug",
    ],
    [
      "a zero aggregate count",
      (relationship: MutableCoOrderFixture) => {
        relationship.counts.pairSetCount = 0;
      },
      "counts.pairSetCount",
    ],
    [
      "a pair count larger than a focal count",
      (relationship: MutableCoOrderFixture) => {
        relationship.counts.pairSetCount = relationship.counts.leftSetCount + 1;
      },
      "counts.pairSetCount",
    ],
    [
      "a union larger than the eligible set",
      (relationship: MutableCoOrderFixture) => {
        relationship.counts.eligibleSetCount = 50;
        relationship.counts.leftSetCount = 40;
        relationship.counts.rightSetCount = 30;
        relationship.counts.pairSetCount = 10;
      },
      "counts",
    ],
    [
      "a reversed observation window",
      (relationship: MutableCoOrderFixture) => {
        relationship.observationWindow.startDate = "2026-01-01";
        relationship.observationWindow.endDate = "2025-01-01";
      },
      "observationWindow",
    ],
    [
      "an impossible calendar date",
      (relationship: MutableCoOrderFixture) => {
        relationship.observationWindow.startDate = "2025-02-30";
      },
      "observationWindow.startDate",
    ],
    [
      "an empty endpoint-code mapping",
      (relationship: MutableCoOrderFixture) => {
        relationship.mapping.leftCodes = [];
      },
      "mapping.leftCodes",
    ],
    [
      "a disclosure status other than passed",
      (relationship: MutableCoOrderFixture) => {
        (relationship.disclosureReview as { status: string }).status = "pending";
      },
      "disclosureReview.status",
    ],
    [
      "an invalid source snapshot hash",
      (relationship: MutableCoOrderFixture) => {
        relationship.source.snapshotSha256 = "not-a-sha256";
      },
      "source.snapshotSha256",
    ],
    [
      "a stored percentage",
      (relationship: MutableCoOrderFixture) => {
        relationship.percentage = 25;
      },
      "coOrderRelationships.0",
    ],
    [
      "a raw patient identifier",
      (relationship: MutableCoOrderFixture) => {
        relationship.patientId = "patient-123";
      },
      "coOrderRelationships.0",
    ],
    [
      "a nested raw order identifier",
      (relationship: MutableCoOrderFixture) => {
        relationship.counts.orderId = "order-123";
      },
      "counts",
    ],
  ])("rejects co-order relationships with %s", (_label, mutate, expectedPath) => {
    const catalog = createContractCatalog();
    const relationship = createCoOrderRelationship() as MutableCoOrderFixture;
    mutate(relationship);
    catalog.coOrderRelationships = [relationship as ReturnType<typeof createCoOrderRelationship>];

    expect(
      getValidationIssues(catalog).some((issue) => issue.path.includes(expectedPath)),
    ).toBe(true);
  });

  it("rejects the same aggregate relationship published twice under different IDs", () => {
    const catalog = createContractCatalog();
    catalog.coOrderRelationships = [
      createCoOrderRelationship(),
      createCoOrderRelationship({ id: "fixture-co-order-duplicate-id" }),
    ];

    expect(getValidationIssues(catalog)).toContainEqual(
      expect.objectContaining({
        path: "coOrderRelationships.1.id",
        code: "duplicate_id",
      }),
    );
  });
});
