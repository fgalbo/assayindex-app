import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CDC_SOURCE_OFFERING_MAPPER_VERSION,
  buildCdcSourceOfferingSlice,
  type StagedCdcSourceCandidate,
} from "@/features/assayindex/acquisition/cdc-source-offerings";
import { parseCdcTestDirectoryXml } from "@/features/assayindex/acquisition/cdc-test-directory";
import {
  deriveContributingSourcePublisherIds,
  evaluatePublicationCandidate,
} from "@/features/assayindex/acquisition/release";
import baseCatalogJson from "@/features/assayindex/data/published/catalog.json";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { projectPublicCatalog } from "@/features/assayindex/data/public-catalog";
import { mergeSourceOfferingSlices } from "@/features/assayindex/data/source-offering-slices.shared.mjs";
import { SourceOfferingDetailPage } from "@/features/assayindex/pages/source-offering-detail-page";
import { parseCatalog, validateCatalog } from "@/features/assayindex/schema/catalog";
import { getLabSummaries } from "@/features/assayindex/selectors/catalog";
import {
  getSourceOfferingByRouteSegment,
  getSourceOfferingRouteSegment,
} from "@/features/assayindex/selectors/source-offerings";
import { searchAllCatalog } from "@/features/assayindex/search";

const SOURCE_ID = "cdc-infectious-diseases-test-directory";
const PUBLISHER_ID = "cdc";
const SNAPSHOT_SHA256 = "2".repeat(64);
const RETRIEVED_AT = "2026-08-13T00:27:55.408Z";
const SOURCE_UPDATED_AT = "2026-08-03T15:00:00.000Z";
const baseCatalog = parseCatalog(baseCatalogJson);
const CDC_SOURCE_ATTRIBUTION = {
  label:
    "Centers for Disease Control and Prevention (CDC), Infectious Diseases Laboratory Test Directory",
  url: "https://www.cdc.gov/infectious-diseases-labs/php/test-directory/index.html",
  disclaimer:
    "Source: CDC. AssayIndex is not endorsed by CDC, HHS, or the U.S. Government. The original Test Directory is available from CDC at no charge and is continually updated; verify current requirements with CDC.",
};

function fixturePath(fileName: string) {
  return resolve(
    process.cwd(),
    "tests",
    "assayindex",
    "fixtures",
    "acquisition",
    "cdc",
    fileName,
  );
}

function normalizedCandidateHash(candidate: object) {
  return createHash("sha256").update(JSON.stringify(candidate), "utf8").digest("hex");
}

async function buildFixtureInput(fileName = "test-directory.sample.xml") {
  const parsed = parseCdcTestDirectoryXml(await readFile(fixturePath(fileName), "utf8"));
  expect(parsed.issues).toEqual([]);

  return {
    metadata: {
      schemaVersion: "1" as const,
      adapterVersion: "1.1.0",
      sourceId: SOURCE_ID,
      publisherId: PUBLISHER_ID,
      snapshotSha256: SNAPSHOT_SHA256,
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: SOURCE_UPDATED_AT,
      sourceGeneratedAt: parsed.sourceGeneratedAt,
      publicationStatus: "staged-only" as const,
      ordering: "cdc-test-code",
    },
    candidates: parsed.candidates.map((candidate) => {
      const stagedCandidate = {
        ...candidate,
        sourceId: SOURCE_ID,
        publisherId: PUBLISHER_ID,
        snapshotSha256: SNAPSHOT_SHA256,
        publicationStatus: "staged-only" as const,
      };

      return {
        ...stagedCandidate,
        normalizedSha256: normalizedCandidateHash(stagedCandidate),
      };
    }),
  };
}

function sortedById<T extends { id: string }>(values: T[]) {
  return values.toSorted((left, right) => left.id.localeCompare(right.id));
}

describe("CDC systemic source-offering mapping", () => {
  it("accounts for every valid candidate exactly once without an excluded bucket", async () => {
    const input = await buildFixtureInput();
    const slice = buildCdcSourceOfferingSlice(input);

    expect(slice.schemaVersion).toBe("1");
    expect(slice.mapperVersion).toBe(CDC_SOURCE_OFFERING_MAPPER_VERSION);
    expect(slice.source).toEqual({
      sourceId: SOURCE_ID,
      publisherId: PUBLISHER_ID,
      snapshotSha256: SNAPSHOT_SHA256,
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: SOURCE_UPDATED_AT,
      sourceGeneratedAt: "2026-08-03T10:06:35",
    });
    expect(slice.batch).toEqual({
      inputCandidateCount: 2,
      publishedOfferingCount: 2,
      attentionOfferingCount: 2,
      offlineOfferingCount: 1,
      retainedSourceMissingCount: 0,
      blockingExceptionCount: 0,
    });
    expect(slice.sourceOfferings).toHaveLength(input.candidates.length);
    expect(slice.sourceOfferings.map((offering) => offering.id)).toEqual([
      `${SOURCE_ID}:CDC-10471`,
      `${SOURCE_ID}:CDC-10472`,
    ]);
    expect(new Set(slice.sourceOfferings.map((offering) => offering.externalRecordId))).toEqual(
      new Set(input.candidates.map((candidate) => candidate.externalRecordId)),
    );
    expect(new Set(slice.sourceOfferings.map((offering) => offering.id)).size).toBe(
      input.candidates.length,
    );
    expect(JSON.stringify(slice)).not.toMatch(/excluded|suppressed|rejected/i);
  });

  it("publishes attention-flagged and offline source records instead of suppressing them", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const byExternalId = new Map(
      slice.sourceOfferings.map((offering) => [offering.externalRecordId, offering]),
    );

    expect(byExternalId.get("CDC-10471")).toMatchObject({
      publicationStatus: "published",
      attentionFlags: ["non_clia"],
      availability: { offline: false, clia: false, sourcePresence: "listed" },
    });
    expect(byExternalId.get("CDC-10472")).toMatchObject({
      publicationStatus: "published",
      attentionFlags: [
        "source_offline",
        "source_status_unavailable",
        "prior_approval_required",
      ],
      availability: {
        offline: true,
        clia: true,
        priorApprovalRequired: true,
        sourcePresence: "listed",
      },
    });
  });

  it("is deterministic across source reordering and repeated identical input", async () => {
    const original = await buildFixtureInput("test-directory.sample.xml");
    const reordered = await buildFixtureInput("test-directory.reordered.xml");

    const first = buildCdcSourceOfferingSlice(original);
    const second = buildCdcSourceOfferingSlice({ ...original, previousSlice: first });
    const reorderedSlice = buildCdcSourceOfferingSlice(reordered);

    expect(second).toEqual(first);
    expect(reorderedSlice).toEqual(first);
    expect(sortedById(reorderedSlice.sourceOfferings)).toEqual(
      sortedById(first.sourceOfferings),
    );
  });

  it("uses stable source identities and never fuzzy-merges offerings with similar names", async () => {
    const input = await buildFixtureInput();
    const similarName = structuredClone(input.candidates[0]);
    similarName.externalRecordId = "CDC-99999";
    similarName.sourceTestId = "99999";
    similarName.testName = input.candidates[1].testName;
    similarName.normalizedSha256 = normalizedCandidateHash(
      Object.fromEntries(
        Object.entries(similarName).filter(([key]) => key !== "normalizedSha256"),
      ),
    );

    const originalSlice = buildCdcSourceOfferingSlice(input);
    const expandedSlice = buildCdcSourceOfferingSlice({
      ...input,
      candidates: [...input.candidates, similarName],
    });
    const originalByExternalId = new Map(
      originalSlice.sourceOfferings.map((offering) => [offering.externalRecordId, offering]),
    );
    const expandedByExternalId = new Map(
      expandedSlice.sourceOfferings.map((offering) => [offering.externalRecordId, offering]),
    );

    expect(expandedSlice.sourceOfferings).toHaveLength(3);
    expect(expandedByExternalId.get("CDC-10471")?.id).toBe(
      originalByExternalId.get("CDC-10471")?.id,
    );
    expect(expandedByExternalId.get("CDC-99999")?.id).not.toBe(
      expandedByExternalId.get("CDC-10472")?.id,
    );
    expect(expandedByExternalId.get("CDC-99999")?.id).toBe(`${SOURCE_ID}:CDC-99999`);
  });

  it("maps source fields, explicit nulls, contacts, status, and exact provenance", async () => {
    const input = await buildFixtureInput();
    const slice = buildCdcSourceOfferingSlice(input);
    const ebola = slice.sourceOfferings.find(
      (offering) => offering.externalRecordId === "CDC-10471",
    );
    const sourceCandidate = input.candidates.find(
      (candidate) => candidate.externalRecordId === "CDC-10471",
    );

    expect(ebola).toEqual(
      expect.objectContaining({
        assaySlug: null,
        labId: "cdc-infectious-diseases-laboratories",
        sourceId: SOURCE_ID,
        sourcePublisherId: PUBLISHER_ID,
        externalRecordId: "CDC-10471",
        testName: "Ebola Virus Disease Testing",
        aliases: ["Ebola Virus Disease Test", "EVD testing"],
        sourceTestId: "10471",
        sourceLabId: "11",
        sourceUnitNumber: "1",
        methodology: "RT-PCR",
        turnaroundTime: "Contact CDC before submission. Timing varies.",
        structuredTurnaroundTime: null,
        acceptableSampleForTesting: "Whole blood",
        minimumVolume: null,
        storageAndPreservation: "Freeze.",
        transport: "Contact CDC.",
        shippingInstructions: "Follow special-permit instructions.",
        interferencesAndLimitations: null,
        additionalInformation: "For professional public-health use.",
        supplementalInformationRequired: null,
        specimenLabeling: null,
        sourceLinkText: null,
        legacyLinkText: null,
        sourceVersion: "2.0",
        sourceLinks: [
          {
            label: "CDC test directory: CDC-10471",
            url: "https://www.cdc.gov/laboratory/specimen-submission/detail.html?CDCTestCode=CDC-10471",
            sourceType: "test-page",
            note: "Source version 2.0",
          },
        ],
        provenance: {
          snapshotSha256: SNAPSHOT_SHA256,
          candidateSha256: sourceCandidate?.normalizedSha256,
          retrievedAt: RETRIEVED_AT,
          sourceUpdatedAt: SOURCE_UPDATED_AT,
          firstSeenAt: RETRIEVED_AT,
          lastSeenAt: RETRIEVED_AT,
          missingSince: null,
          detailUrl:
            "https://www.cdc.gov/laboratory/specimen-submission/detail.html?CDCTestCode=CDC-10471",
        },
        publicationStatus: "published",
        updatedAt: RETRIEVED_AT,
      }),
    );
    expect(ebola?.contacts.cdc).toEqual([
      { name: "Katherine Johnson", phone: null, email: "katherine@example.cdc.gov" },
    ]);
    expect(ebola?.availability).toEqual({
      orderStatus: "This Test Order is currently accepting specimens.",
      offline: false,
      clia: false,
      priorApprovalRequired: false,
      performedOn: { human: true, animal: true, other: false },
      sourcePresence: "listed",
    });
  });

  it("keeps the canonical CDC detail page first and de-duplicates supplemental source URLs", async () => {
    const input = await buildFixtureInput();
    const candidate = structuredClone(input.candidates[0]);
    candidate.sourceLinks = [
      { url: "https://example.gov/z-form", label: "Z form" },
      { url: "https://example.gov/a-form", label: null },
      { url: "https://example.gov/z-form", label: "Duplicate label" },
    ];
    candidate.normalizedSha256 = normalizedCandidateHash(
      Object.fromEntries(
        Object.entries(candidate).filter(([key]) => key !== "normalizedSha256"),
      ),
    );

    const offering = buildCdcSourceOfferingSlice({
      ...input,
      candidates: [candidate],
    }).sourceOfferings[0];

    expect(offering.sourceLinks).toEqual([
      {
        label: "CDC test directory: CDC-10471",
        url: candidate.detailUrl,
        sourceType: "test-page",
        note: "Source version 2.0",
      },
      {
        label: "https://example.gov/a-form",
        url: "https://example.gov/a-form",
        sourceType: "reference",
        note: null,
      },
      {
        label: "Z form",
        url: "https://example.gov/z-form",
        sourceType: "reference",
        note: null,
      },
    ]);
  });

  it("retains a previously published source record when it disappears upstream", async () => {
    const input = await buildFixtureInput();
    const first = buildCdcSourceOfferingSlice(input);
    const nextMetadata = {
      ...input.metadata,
      snapshotSha256: "3".repeat(64),
      retrievedAt: "2026-08-20T00:27:55.408Z",
    };
    const refreshedCandidateWithoutHash = {
      ...input.candidates[0],
      snapshotSha256: nextMetadata.snapshotSha256,
    };
    const refreshedCandidate = {
      ...refreshedCandidateWithoutHash,
      normalizedSha256: normalizedCandidateHash(
        Object.fromEntries(
          Object.entries(refreshedCandidateWithoutHash).filter(
            ([key]) => key !== "normalizedSha256",
          ),
        ),
      ),
    };
    const next = buildCdcSourceOfferingSlice({
      candidates: [refreshedCandidate],
      metadata: nextMetadata,
      previousSlice: first,
    });
    const missingExternalId = input.candidates[1].externalRecordId;
    const retained = next.sourceOfferings.find(
      (offering) => offering.externalRecordId === missingExternalId,
    );

    expect(next.batch).toMatchObject({
      inputCandidateCount: 1,
      publishedOfferingCount: 2,
      retainedSourceMissingCount: 1,
      blockingExceptionCount: 0,
    });
    expect(retained).toMatchObject({
      publicationStatus: "published",
      attentionFlags: expect.arrayContaining(["source_missing"]),
      availability: { sourcePresence: "source-missing" },
      provenance: {
        snapshotSha256: SNAPSHOT_SHA256,
        lastSeenAt: RETRIEVED_AT,
        missingSince: nextMetadata.retrievedAt,
      },
    });
  });

  it("fails the batch atomically when source identities conflict", async () => {
    const input = await buildFixtureInput();
    const conflicting = structuredClone(input.candidates[0]);
    conflicting.testName = "Conflicting duplicate";
    conflicting.normalizedSha256 = normalizedCandidateHash(
      Object.fromEntries(
        Object.entries(conflicting).filter(([key]) => key !== "normalizedSha256"),
      ),
    );

    expect(() =>
      buildCdcSourceOfferingSlice({
        ...input,
        candidates: [...input.candidates, conflicting],
      }),
    ).toThrow(/duplicate|conflict|externalRecordId/i);
  });

  it.each([
    {
      label: "an unknown candidate field",
      mutate(candidate: Record<string, unknown>) {
        candidate.unmappedSourceFact = "must not be silently discarded";
      },
      error: /unknown|unrecognized|field|key/i,
    },
    {
      label: "a mismatched candidate hash",
      mutate(candidate: Record<string, unknown>) {
        candidate.normalizedSha256 = "0".repeat(64);
      },
      error: /hash|sha|content/i,
    },
    {
      label: "a mismatched acquisition source",
      mutate(candidate: Record<string, unknown>) {
        candidate.sourceId = "different-source";
      },
      error: /source/i,
    },
    {
      label: "a mismatched source publisher",
      mutate(candidate: Record<string, unknown>) {
        candidate.publisherId = "different-publisher";
      },
      error: /publisher/i,
    },
    {
      label: "a non-staged candidate",
      mutate(candidate: Record<string, unknown>) {
        candidate.publicationStatus = "published";
      },
      error: /staged|publication/i,
    },
  ])("rejects $label instead of partially mapping the batch", async ({ mutate, error }) => {
    const input = await buildFixtureInput();
    const candidate = structuredClone(input.candidates[0]) as unknown as Record<string, unknown>;
    mutate(candidate);

    expect(() =>
      buildCdcSourceOfferingSlice({
        ...input,
        candidates: [candidate as unknown as StagedCdcSourceCandidate, input.candidates[1]],
      }),
    ).toThrow(error);
  });
});

describe("source-offering catalog merge and release gates", () => {
  it("preserves all existing canonical data while adding one deterministic source slice", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const canonicalBefore = structuredClone(baseCatalog);
    const merged = mergeSourceOfferingSlices(canonicalBefore, [slice]);

    expect(canonicalBefore).toEqual(baseCatalog);
    expect(merged.meta).toEqual({
      ...baseCatalog.meta,
      lastPublishedAt: [baseCatalog.meta.lastPublishedAt, slice.source.retrievedAt].toSorted().at(-1),
    });
    expect(merged.assays).toEqual(baseCatalog.assays);
    expect(merged.assayLabRecords).toEqual(baseCatalog.assayLabRecords);
    expect(merged.sourceDocuments).toEqual(baseCatalog.sourceDocuments);
    expect(merged.assayLevelCodes).toEqual(baseCatalog.assayLevelCodes);
    expect(merged.curatedAssayRelationships).toEqual(baseCatalog.curatedAssayRelationships);
    expect(merged.coOrderRelationships).toEqual(baseCatalog.coOrderRelationships);
    expect(merged.labs).toEqual([
      ...baseCatalog.labs,
      expect.objectContaining({
        id: "cdc-infectious-diseases-laboratories",
        displayName: "CDC Infectious Diseases Laboratories",
      }),
    ]);
    expect(merged.sourceOfferings).toEqual(slice.sourceOfferings);
    expect(merged.assays).toHaveLength(8);
    expect(merged.assayLabRecords).toHaveLength(16);
  });

  it("rejects a source slice with an invalid retrieval timestamp", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const invalidSlice = structuredClone(slice);
    invalidSlice.source.retrievedAt = "not-an-iso-timestamp";

    expect(() =>
      mergeSourceOfferingSlices(structuredClone(baseCatalog), [invalidSlice]),
    ).toThrow(/unsupported schema/i);
  });

  it("rejects a provider ID collision instead of overwriting canonical laboratory data", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const collision = structuredClone(baseCatalog);
    collision.labs.push({
      id: "cdc-infectious-diseases-laboratories",
      displayName: "Different laboratory",
      shortName: "Collision",
      website: null,
      notes: null,
    });

    expect(() => mergeSourceOfferingSlices(collision, [slice])).toThrow(
      /laboratory|lab|collision|conflict/i,
    );
    expect(collision.assays).toHaveLength(8);
    expect(collision.assayLabRecords).toHaveLength(16);
  });

  it("validates and publicly projects source offerings without requiring an assay mapping", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const merged = mergeSourceOfferingSlices(structuredClone(baseCatalog), [slice]);
    const validated = parseCatalog(merged);
    const publicCatalog = projectPublicCatalog(validated);

    expect(validateCatalog(merged).success).toBe(true);
    expect(publicCatalog.sourceOfferings).toHaveLength(2);
    expect(publicCatalog.sourceOfferings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalRecordId: "CDC-10472",
          assaySlug: null,
          publicationStatus: "published",
          attentionFlags: expect.arrayContaining(["source_offline"]),
        }),
      ]),
    );

    const mappedToDraftAssayCatalog = structuredClone(validated);
    const mappedOffering = mappedToDraftAssayCatalog.sourceOfferings![0];
    const draftAssay = mappedToDraftAssayCatalog.assays[0];
    mappedOffering.assaySlug = draftAssay.slug;
    draftAssay.status = "draft";
    const draftAssayProjection = projectPublicCatalog(mappedToDraftAssayCatalog);

    expect(validateCatalog(mappedToDraftAssayCatalog).success).toBe(true);
    expect(draftAssayProjection.assays.map((assay) => assay.slug)).not.toContain(draftAssay.slug);
    expect(draftAssayProjection.sourceOfferings).toHaveLength(2);
    expect(
      draftAssayProjection.sourceOfferings?.find((offering) => offering.id === mappedOffering.id),
    ).toMatchObject({
      id: mappedOffering.id,
      assaySlug: null,
      publicationStatus: "published",
    });

    const draftCatalog = structuredClone(validated);
    const draftOffering = draftCatalog.sourceOfferings![0];
    draftOffering.publicationStatus = "draft";
    const draftOfferingProjection = projectPublicCatalog(draftCatalog);
    expect(draftOfferingProjection.sourceOfferings).toHaveLength(1);
    expect(draftOfferingProjection.sourceOfferings?.map((offering) => offering.id)).not.toContain(
      draftOffering.id,
    );
  });

  it("searches every attention-flagged offering and includes its unmapped provider lab", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const catalog = parseCatalog(
      mergeSourceOfferingSlices(structuredClone(baseCatalog), [slice]),
    );
    const results = searchAllCatalog(catalog, "", {}, "alphabetical");
    const offeringResults = results.filter(
      (result) => result.document.kind === "source-offering",
    );
    const zika = offeringResults.find(
      (result) => result.document.id === `${SOURCE_ID}:CDC-10472`,
    );
    const cdcLab = getLabSummaries(catalog).find(
      (summary) => summary.lab.id === "cdc-infectious-diseases-laboratories",
    );

    expect(offeringResults).toHaveLength(2);
    expect(zika?.document).toMatchObject({
      id: `${SOURCE_ID}:CDC-10472`,
      kind: "source-offering",
      href: `/assayindex/offerings/${SOURCE_ID}--CDC-10472`,
      assaySlug: null,
      displayName: "Zika Virus Molecular Detection",
      labIds: ["cdc-infectious-diseases-laboratories"],
      labNames: ["CDC Infectious Diseases Laboratories"],
      codes: expect.arrayContaining(["CDC-10472", "10472", SOURCE_ID]),
      notes: expect.arrayContaining([
        "source_offline",
        "source_status_unavailable",
        "prior_approval_required",
      ]),
    });
    expect(cdcLab).toMatchObject({
      assayCount: 0,
      recordCount: 0,
      sourceOfferingCount: 2,
    });
  });

  it("gates acquisition-derived offerings by exact source ID, separate from provider identity", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const catalog = mergeSourceOfferingSlices(structuredClone(baseCatalog), [slice]);
    const provenance = catalog.assayLabRecords.map(
      (record: (typeof catalog.assayLabRecords)[number], index: number) => ({
      recordId: record.id,
      sourceId: `${record.id}:source:${index + 1}`,
      locator: null,
      }),
    );
    const contributingSourcePublisherIds = deriveContributingSourcePublisherIds(catalog);
    expect(contributingSourcePublisherIds).toContain(PUBLISHER_ID);
    expect(contributingSourcePublisherIds).not.toContain(
      "cdc-infectious-diseases-laboratories",
    );
    const baseCandidate = {
      catalog,
      provenance,
      reviewed: true,
      sourceComplete: true,
      validationIssues: [] as string[],
      contributingSourcePublisherIds,
      sourceReleaseDecisions: contributingSourcePublisherIds.map((sourcePublisherId) => ({
        sourcePublisherId,
        approved: true,
      })),
      acquisitionSourceReleaseDecisions: [{ sourceId: SOURCE_ID, approved: true }],
    };

    expect(evaluatePublicationCandidate(baseCandidate)).toEqual({
      blockers: [],
      publishable: true,
    });
    expect(
      evaluatePublicationCandidate({
        ...baseCandidate,
        acquisitionSourceReleaseDecisions: [],
      }),
    ).toEqual({
      blockers: expect.arrayContaining(["source_policy_blocked"]),
      publishable: false,
    });
    expect(
      evaluatePublicationCandidate({
        ...baseCandidate,
        acquisitionSourceReleaseDecisions: [
          { sourceId: "cdc-infectious-diseases-laboratories", approved: true },
        ],
      }),
    ).toEqual({
      blockers: expect.arrayContaining(["source_policy_blocked"]),
      publishable: false,
    });
  });
});

describe("source-offering static route identity", () => {
  it("round-trips every published offering through a unique Windows-safe segment", () => {
    const offerings = publishedCatalog.sourceOfferings ?? [];
    const routeSegments = offerings.map((offering) => getSourceOfferingRouteSegment(offering));

    expect(offerings).toHaveLength(250);
    expect(new Set(routeSegments).size).toBe(offerings.length);
    expect(routeSegments.every((segment) => /^[A-Za-z0-9._~-]+$/.test(segment))).toBe(true);

    for (const [index, offering] of offerings.entries()) {
      const routeSegment = routeSegments[index];
      expect(routeSegment).toBe(`${offering.sourceId}--${offering.externalRecordId}`);
      expect(offering.id).toBe(`${offering.sourceId}:${offering.externalRecordId}`);
      expect(getSourceOfferingByRouteSegment(publishedCatalog, routeSegment)?.id).toBe(offering.id);
    }
  });
});

describe("source-offering public detail", () => {
  it("renders attention notices, professional contacts, provenance, and honest null fallbacks", async () => {
    const slice = buildCdcSourceOfferingSlice(await buildFixtureInput());
    const catalog = parseCatalog(
      mergeSourceOfferingSlices(structuredClone(baseCatalog), [slice]),
    );
    const offeringId = `${SOURCE_ID}:CDC-10472`;
    const offering = catalog.sourceOfferings?.find((entry) => entry.id === offeringId) ?? null;
    const lab = offering
      ? catalog.labs.find((entry) => entry.id === offering.labId) ?? null
      : null;

    render(
      createElement(SourceOfferingDetailPage, {
        offering,
        lab,
        assay: null,
        sourceAttribution: CDC_SOURCE_ATTRIBUTION,
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Zika Virus Molecular Detection" }),
    ).toBeInTheDocument();
    expect(screen.getByText("CDC marks this test offering offline.")).toBeInTheDocument();
    expect(
      screen.getByText("CDC currently lists this test as not accepting specimens."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("CDC requires prior approval before specimen submission."),
    ).toBeInTheDocument();
    expect(screen.getByText("CDC professional contacts")).toBeInTheDocument();
    expect(screen.getByText("Prior-approval contacts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ada@example.cdc.gov" })).toHaveAttribute(
      "href",
      "mailto:ada%40example.cdc.gov",
    );
    expect(screen.getByRole("link", { name: "grace@example.cdc.gov" })).toHaveAttribute(
      "href",
      "mailto:grace%40example.cdc.gov",
    );
    expect(screen.getByRole("link", { name: "CDC test directory: CDC-10472" })).toHaveAttribute(
      "href",
      expect.stringContaining("CDCTestCode=CDC-10472"),
    );
    expect(screen.getByRole("link", { name: CDC_SOURCE_ATTRIBUTION.label })).toHaveAttribute(
      "href",
      CDC_SOURCE_ATTRIBUTION.url,
    );
    expect(screen.getByText(CDC_SOURCE_ATTRIBUTION.disclaimer)).toBeInTheDocument();
    expect(screen.getAllByText("Not listed by source").length).toBeGreaterThan(0);
  });

  it("renders from selected offering, laboratory, assay, and attribution props", () => {
    const offering = structuredClone(publishedCatalog.sourceOfferings![0]);
    const lab = publishedCatalog.labs.find((entry) => entry.id === offering.labId) ?? null;
    const assay = publishedCatalog.assays[0];
    offering.assaySlug = assay.slug;

    render(
      createElement(SourceOfferingDetailPage, {
        offering,
        lab,
        assay,
        sourceAttribution: CDC_SOURCE_ATTRIBUTION,
      }),
    );

    expect(screen.getByRole("heading", { name: offering.testName })).toBeInTheDocument();
    expect(screen.getByText(lab!.displayName)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to filippogalbo.com lab" }),
    ).toHaveAttribute("href", "https://filippogalbo.com/lab");
    expect(screen.getByRole("link", { name: assay.displayName })).toHaveAttribute(
      "href",
      `/assayindex/assays/${assay.slug}`,
    );
    expect(screen.getByRole("link", { name: CDC_SOURCE_ATTRIBUTION.label })).toHaveAttribute(
      "href",
      CDC_SOURCE_ATTRIBUTION.url,
    );
    expect(screen.getByText(CDC_SOURCE_ATTRIBUTION.disclaimer)).toBeInTheDocument();
  });

  it("keeps a retained source-missing offering browsable with its reason and last source detail", async () => {
    const input = await buildFixtureInput();
    const first = buildCdcSourceOfferingSlice(input);
    const nextSnapshotSha256 = "3".repeat(64);
    const refreshedCandidateWithoutHash = {
      ...input.candidates[0],
      snapshotSha256: nextSnapshotSha256,
    };
    const refreshedCandidate = {
      ...refreshedCandidateWithoutHash,
      normalizedSha256: normalizedCandidateHash(
        Object.fromEntries(
          Object.entries(refreshedCandidateWithoutHash).filter(
            ([key]) => key !== "normalizedSha256",
          ),
        ),
      ),
    };
    const next = buildCdcSourceOfferingSlice({
      candidates: [refreshedCandidate],
      metadata: {
        ...input.metadata,
        snapshotSha256: nextSnapshotSha256,
        retrievedAt: "2026-08-20T00:27:55.408Z",
      },
      previousSlice: first,
    });
    const catalog = parseCatalog(
      mergeSourceOfferingSlices(structuredClone(baseCatalog), [next]),
    );
    const offering =
      catalog.sourceOfferings?.find((entry) => entry.id === `${SOURCE_ID}:CDC-10472`) ?? null;
    const lab = offering
      ? catalog.labs.find((entry) => entry.id === offering.labId) ?? null
      : null;

    render(
      createElement(SourceOfferingDetailPage, {
        offering,
        lab,
        assay: null,
        sourceAttribution: CDC_SOURCE_ATTRIBUTION,
      }),
    );

    expect(
      screen.getByText(
        "This offering was absent from the latest source snapshot. Its last source-listed details remain available for reference.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("source-missing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CDC test directory: CDC-10472" })).toHaveAttribute(
      "href",
      expect.stringContaining("CDCTestCode=CDC-10472"),
    );
  });
});
