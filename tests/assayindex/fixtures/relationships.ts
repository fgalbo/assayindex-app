import type {
  CoOrderRelationship,
  CuratedAssayRelationship,
} from "@/features/assayindex/domain/types";

const curatedRelationshipFixture = {
  id: "fixture-curated-bcr-abl1-to-hla-b27",
  sourceAssaySlug: "bcr-abl1-p210-quantitative",
  targetAssaySlug: "hla-b27",
  relationshipType: "other",
  rationale: "Synthetic relationship used only to exercise the catalog contract.",
  sourcePublisherId: "fixture-publisher",
  sourceLinks: [
    {
      label: "Synthetic relationship fixture",
      url: "https://example.test/assay-relationship",
      sourceType: "reference",
      note: null,
    },
  ],
  reviewedAt: "2026-08-12T00:00:00.000Z",
  publicationStatus: "published",
  updatedAt: "2026-08-12T00:00:00.000Z",
} satisfies CuratedAssayRelationship;

const coOrderRelationshipFixture = {
  id: "fixture-co-order-bcr-abl1-hla-b27",
  leftAssaySlug: "bcr-abl1-p210-quantitative",
  rightAssaySlug: "hla-b27",
  basis: "same-claim",
  counts: {
    eligibleSetCount: 100,
    leftSetCount: 40,
    rightSetCount: 50,
    pairSetCount: 10,
  },
  cohort: {
    label: "Synthetic claims fixture",
    description: "Aggregate-only test data with no order or patient identifiers.",
  },
  observationWindow: {
    startDate: "2025-01-01",
    endDate: "2025-12-31",
  },
  source: {
    publisherId: "fixture-publisher",
    datasetId: "fixture-co-orders",
    datasetVersion: "2026.1",
    snapshotSha256: "a".repeat(64),
    url: "https://example.test/aggregate-co-orders",
    retrievedAt: "2026-08-12T00:00:00.000Z",
  },
  mapping: {
    codeSystem: "CPT",
    leftCodes: ["FIXTURE-LEFT"],
    rightCodes: ["FIXTURE-RIGHT"],
    mappingVersion: "2026.1",
    method: "Synthetic mapping used only by tests.",
    reviewedAt: "2026-08-12T00:00:00.000Z",
  },
  disclosureReview: {
    status: "passed",
    reviewedAt: "2026-08-12T00:00:00.000Z",
    method: "Aggregate-only fixture review.",
    note: null,
  },
  publicationStatus: "published",
  updatedAt: "2026-08-12T00:00:00.000Z",
} satisfies CoOrderRelationship;

export function createCuratedRelationship(
  overrides: Partial<CuratedAssayRelationship> = {},
): CuratedAssayRelationship {
  return structuredClone({ ...curatedRelationshipFixture, ...overrides }) as CuratedAssayRelationship;
}

export function createCoOrderRelationship(
  overrides: Partial<CoOrderRelationship> = {},
): CoOrderRelationship {
  return structuredClone({ ...coOrderRelationshipFixture, ...overrides }) as CoOrderRelationship;
}
