import { describe, expect, it } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import {
  buildReleaseBundle,
  deriveContributingSourcePublisherIds,
  evaluatePublicationCandidate,
  sha256,
  verifyReleaseBundle,
} from "@/features/assayindex/acquisition/release";

const provenance = publishedCatalog.assayLabRecords.map((record, index) => ({
  recordId: record.id,
  sourceId: `${record.id}:source:1`,
  locator: `fixture row ${index + 2}`,
}));
const contributingSourcePublisherIds = deriveContributingSourcePublisherIds(publishedCatalog);
const contributingAcquisitionSourceIds = [
  ...new Set((publishedCatalog.sourceOfferings ?? []).map((offering) => offering.sourceId)),
].toSorted();

const baseCandidate = {
  catalog: publishedCatalog,
  provenance,
  reviewed: true,
  sourceComplete: true,
  validationIssues: [] as string[],
  contributingSourcePublisherIds,
  sourceReleaseDecisions: contributingSourcePublisherIds.map((sourcePublisherId) => ({
    sourcePublisherId,
    approved: true,
  })),
  acquisitionSourceReleaseDecisions: contributingAcquisitionSourceIds.map((sourceId) => ({
    sourceId,
    approved: true,
  })),
};
const sourceAttributionJson = `${JSON.stringify(
  {
    schemaVersion: "1",
    catalogVersion: publishedCatalog.meta.version,
    generatedAt: "2026-08-12T12:00:00.000Z",
    sources: [
      {
        sourceId: "cdc-infectious-diseases-test-directory",
        requiredAttribution:
          "Centers for Disease Control and Prevention (CDC), Infectious Diseases Laboratory Test Directory",
        requiredAttributionUrl:
          "https://www.cdc.gov/infectious-diseases-labs/php/test-directory/index.html",
        disclaimer:
          "Source: CDC. AssayIndex is not endorsed by CDC, HHS, or the U.S. Government. The original Test Directory is available from CDC at no charge and is continually updated; verify current requirements with CDC.",
      },
    ],
  },
  null,
  2,
)}\n`;

describe("AssayIndex candidate publication", () => {
  it("derives contributing publishers from records, source documents, and source offerings", () => {
    const catalog = structuredClone(publishedCatalog);
    const recordPublisherIds = [
      ...new Set(catalog.assayLabRecords.map((record) => record.labId)),
    ].toSorted();
    const offeringPublisherIds = [
      ...new Set((catalog.sourceOfferings ?? []).map((offering) => offering.sourcePublisherId)),
    ];
    const basePublisherIds = [...new Set([...recordPublisherIds, ...offeringPublisherIds])].toSorted();
    const sourceTemplate = structuredClone(catalog.sourceDocuments[0]);
    const sourceOnlyPublisherId = "source-only-reference-lab";

    catalog.sourceDocuments = [];
    expect(deriveContributingSourcePublisherIds(catalog)).toEqual(basePublisherIds);
    expect(deriveContributingSourcePublisherIds(catalog)).toContain("cdc");
    expect(deriveContributingSourcePublisherIds(catalog)).not.toContain(
      "cdc-infectious-diseases-laboratories",
    );

    catalog.sourceDocuments = [
      { ...sourceTemplate, id: "source-only-a", labId: sourceOnlyPublisherId },
      { ...sourceTemplate, id: "source-only-b", labId: sourceOnlyPublisherId },
      { ...sourceTemplate, id: "record-publisher-source", labId: recordPublisherIds[0] },
    ];

    expect(deriveContributingSourcePublisherIds(catalog)).toEqual(
      [...basePublisherIds, sourceOnlyPublisherId].toSorted(),
    );
  });

  it("requires review, complete acquisition, validation, and provenance", () => {
    expect(evaluatePublicationCandidate(baseCandidate)).toEqual({
      blockers: [],
      publishable: true,
    });

    expect(
      evaluatePublicationCandidate({
        ...baseCandidate,
        provenance: [],
        reviewed: false,
        sourceComplete: false,
        validationIssues: ["schema drift"],
      }),
    ).toEqual({
      blockers: [
        "review_required",
        "source_incomplete",
        "validation_failed",
        "missing_provenance",
      ],
      publishable: false,
    });
  });

  it("requires provenance for every published record, not merely a non-empty provenance list", () => {
    expect(
      evaluatePublicationCandidate({
        ...baseCandidate,
        provenance: provenance.slice(0, -1),
      }),
    ).toEqual({
      blockers: ["missing_provenance"],
      publishable: false,
    });
  });

  it("blocks a contributing source publisher without an approved release decision", () => {
    expect(
      evaluatePublicationCandidate({
        ...baseCandidate,
        sourceReleaseDecisions: [],
      }),
    ).toEqual({
      blockers: ["source_policy_blocked"],
      publishable: false,
    });
  });

  it("requires approval for the exact acquisition source ID, not its provider laboratory ID", () => {
    expect(contributingAcquisitionSourceIds).toEqual([
      "cdc-infectious-diseases-test-directory",
    ]);
    expect(
      evaluatePublicationCandidate({
        ...baseCandidate,
        acquisitionSourceReleaseDecisions: [],
      }),
    ).toEqual({
      blockers: ["source_policy_blocked"],
      publishable: false,
    });
    expect(
      evaluatePublicationCandidate({
        ...baseCandidate,
        acquisitionSourceReleaseDecisions: [
          {
            sourceId: "cdc-infectious-diseases-laboratories",
            approved: true,
          },
        ],
      }),
    ).toEqual({
      blockers: ["source_policy_blocked"],
      publishable: false,
    });
  });
});

describe("AssayIndex release bundle", () => {
  it("emits a deterministic manifest and verifies every exported payload", () => {
    const input = {
      candidate: baseCandidate,
      generatedAt: "2026-08-12T12:00:00.000Z",
      sources: [publishedCatalog.sourceDocuments[0]],
      additionalFiles: {
        "SOURCE-ATTRIBUTION.json": sourceAttributionJson,
      },
    };

    const first = buildReleaseBundle(input);
    const second = buildReleaseBundle(input);

    expect(first).toEqual(second);
    expect(first.manifest.catalogVersion).toBe(publishedCatalog.meta.version);
    expect(first.manifest.counts.sourceOfferings).toBe(250);
    expect(Object.keys(first.files).toSorted()).toEqual([
      "SHA256SUMS.txt",
      "SOURCE-ATTRIBUTION.json",
      "catalog.json",
      "manifest.json",
      "provenance.json",
      "sources.json",
    ]);
    expect(first.files["SOURCE-ATTRIBUTION.json"]).toBe(sourceAttributionJson);
    expect(first.manifest.files).toContainEqual({
      bytes: new TextEncoder().encode(sourceAttributionJson).byteLength,
      path: "SOURCE-ATTRIBUTION.json",
      sha256: sha256(sourceAttributionJson),
    });
    expect(first.files["SHA256SUMS.txt"]).toContain(
      `${sha256(sourceAttributionJson)}  SOURCE-ATTRIBUTION.json\n`,
    );
    const releaseProvenance = JSON.parse(first.files["provenance.json"]);
    const sourceOfferingProvenance = releaseProvenance.filter(
      (entry: { sourceOfferingId?: string }) => entry.sourceOfferingId,
    );
    expect(sourceOfferingProvenance).toHaveLength(250);
    expect(sourceOfferingProvenance).toEqual(
      expect.arrayContaining([
        {
          sourceOfferingId:
            "cdc-infectious-diseases-test-directory:CDC-10106",
          sourceId: "cdc-infectious-diseases-test-directory",
          locator:
            "https://www.cdc.gov/laboratory/specimen-submission/detail.html?CDCTestCode=CDC-10106",
        },
      ]),
    );
    expect(verifyReleaseBundle(first)).toEqual({ issues: [], valid: true });
    expect(JSON.stringify(first)).not.toMatch(
      /(?:^|["'\s])[A-Z]:\\|OneDrive|BLOB_READ_WRITE_TOKEN/i,
    );
  });

  it("detects a payload changed after the checksums were generated", () => {
    const bundle = buildReleaseBundle({
      candidate: baseCandidate,
      generatedAt: "2026-08-12T12:00:00.000Z",
      sources: [publishedCatalog.sourceDocuments[0]],
    });
    const tampered = structuredClone(bundle);
    tampered.files["catalog.json"] += " ";

    expect(verifyReleaseBundle(tampered)).toEqual({
      issues: [
        expect.objectContaining({
          code: "hash_mismatch",
          path: "catalog.json",
        }),
      ],
      valid: false,
    });
  });

  it("detects source attribution changed after the checksums were generated", () => {
    const bundle = buildReleaseBundle({
      candidate: baseCandidate,
      generatedAt: "2026-08-12T12:00:00.000Z",
      sources: [publishedCatalog.sourceDocuments[0]],
      additionalFiles: {
        "SOURCE-ATTRIBUTION.json": sourceAttributionJson,
      },
    });
    const tampered = structuredClone(bundle);
    tampered.files["SOURCE-ATTRIBUTION.json"] += " ";

    expect(verifyReleaseBundle(tampered)).toEqual({
      issues: [
        {
          code: "hash_mismatch",
          path: "SOURCE-ATTRIBUTION.json",
        },
      ],
      valid: false,
    });
  });
});
