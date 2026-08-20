import { createHash } from "node:crypto";

import type {
  Lab,
  SourceLink,
  SourceOffering,
} from "../domain/types";
import { isCdcSourceGeneratedAtValue } from "./cdc-source-generated-at.shared.mjs";
import type { CdcTestDirectoryCandidate } from "./cdc-test-directory";

export const CDC_SOURCE_OFFERING_MAPPER_VERSION = "1.0.0";
export const CDC_SOURCE_ID = "cdc-infectious-diseases-test-directory";
export const CDC_SOURCE_PUBLISHER_ID = "cdc";
export const CDC_LAB_ID = "cdc-infectious-diseases-laboratories";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CDC_EXTERNAL_ID_PATTERN = /^CDC-\d{5}$/;
const CANDIDATE_KEYS = new Set([
  "externalRecordId",
  "providerId",
  "providerName",
  "sourceTestId",
  "sourceLabId",
  "sourceUnitNumber",
  "testName",
  "aliases",
  "method",
  "turnaroundTimeText",
  "turnaroundTime",
  "acceptableSampleForTestingText",
  "minimumVolume",
  "storageAndPreservation",
  "transport",
  "shippingInstructions",
  "interferencesAndLimitations",
  "additionalInformation",
  "supplementalInformationRequired",
  "specimenLabeling",
  "sourceLinkText",
  "legacyLinkText",
  "sourceLinks",
  "orderStatus",
  "offline",
  "clia",
  "priorApprovalRequired",
  "performedOn",
  "contacts",
  "sourceVersion",
  "detailUrl",
  "reviewFlags",
  "candidateState",
  "sourceId",
  "publisherId",
  "snapshotSha256",
  "publicationStatus",
  "normalizedSha256",
]);

export type StagedCdcSourceCandidate = CdcTestDirectoryCandidate & {
  sourceId: string;
  publisherId: string;
  snapshotSha256: string;
  publicationStatus: "staged-only";
  normalizedSha256: string;
};

export type CdcSourceOfferingSlice = {
  schemaVersion: "1";
  mapperVersion: string;
  source: {
    sourceId: string;
    publisherId: string;
    snapshotSha256: string;
    retrievedAt: string;
    sourceUpdatedAt: string | null;
    sourceGeneratedAt: string;
  };
  batch: {
    inputCandidateCount: number;
    publishedOfferingCount: number;
    attentionOfferingCount: number;
    offlineOfferingCount: number;
    retainedSourceMissingCount: number;
    blockingExceptionCount: number;
  };
  labs: Lab[];
  sourceOfferings: SourceOffering[];
};

type CdcSourceOfferingMetadata = {
  sourceId: string;
  publisherId: string;
  snapshotSha256: string;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  sourceGeneratedAt: string;
};

function assertIsoDateTime(value: unknown, field: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`CDC source-offering metadata has invalid ${field}.`);
  }
}

function normalizedCandidateHash(candidate: StagedCdcSourceCandidate) {
  return createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(
      Object.entries(candidate).filter(([key]) => key !== "normalizedSha256"),
    )), "utf8")
    .digest("hex");
}

function assertCandidate(candidate: StagedCdcSourceCandidate) {
  const unknownKey = Object.keys(candidate).find((key) => !CANDIDATE_KEYS.has(key));
  if (unknownKey) {
    throw new Error(`CDC candidate contains an unmapped field: ${unknownKey}`);
  }
  if (candidate.sourceId !== CDC_SOURCE_ID) {
    throw new Error(`CDC candidate ${candidate.externalRecordId} has an invalid sourceId.`);
  }
  if (candidate.publisherId !== CDC_SOURCE_PUBLISHER_ID) {
    throw new Error(`CDC candidate ${candidate.externalRecordId} has an invalid publisherId.`);
  }
  if (candidate.providerId !== CDC_LAB_ID) {
    throw new Error(`CDC candidate ${candidate.externalRecordId} has an invalid providerId.`);
  }
  if (candidate.publicationStatus !== "staged-only") {
    throw new Error(`CDC candidate ${candidate.externalRecordId} must remain staged-only before mapping.`);
  }
  if (!CDC_EXTERNAL_ID_PATTERN.test(candidate.externalRecordId)) {
    throw new Error(`CDC candidate has invalid externalRecordId: ${candidate.externalRecordId}`);
  }
  if (
    !SHA256_PATTERN.test(candidate.snapshotSha256) ||
    !SHA256_PATTERN.test(candidate.normalizedSha256)
  ) {
    throw new Error(`CDC candidate ${candidate.externalRecordId} has an invalid SHA-256 digest.`);
  }
  if (candidate.normalizedSha256 !== normalizedCandidateHash(candidate)) {
    throw new Error(`CDC candidate ${candidate.externalRecordId} normalized hash does not match its content.`);
  }
  const expectedFlags = [
    ...(candidate.offline ? ["source_offline"] : []),
    ...(candidate.offline ? ["source_status_unavailable"] : []),
    ...(!candidate.clia ? ["non_clia"] : []),
    ...(candidate.priorApprovalRequired ? ["prior_approval_required"] : []),
  ];
  if (JSON.stringify(candidate.reviewFlags) !== JSON.stringify(expectedFlags)) {
    throw new Error(`CDC candidate ${candidate.externalRecordId} has inconsistent attention flags.`);
  }
}

function mappedSourceLinks(candidate: StagedCdcSourceCandidate): SourceLink[] {
  const links = new Map<string, SourceLink>();
  links.set(candidate.detailUrl, {
    label: `CDC test directory: ${candidate.externalRecordId}`,
    url: candidate.detailUrl,
    sourceType: "test-page",
    note: `Source version ${candidate.sourceVersion}`,
  });
  for (const sourceLink of candidate.sourceLinks) {
    if (!links.has(sourceLink.url)) {
      links.set(sourceLink.url, {
        label: sourceLink.label ?? sourceLink.url,
        url: sourceLink.url,
        sourceType: "reference",
        note: null,
      });
    }
  }
  const [detail, ...supporting] = [...links.values()];
  return [detail, ...supporting.toSorted((left, right) => left.url.localeCompare(right.url))];
}

function mapCandidate(
  candidate: StagedCdcSourceCandidate,
  metadata: CdcSourceOfferingMetadata,
  previous: SourceOffering | undefined,
): SourceOffering {
  const candidateChanged = previous?.provenance.candidateSha256 !== candidate.normalizedSha256;
  const firstSeenAt = previous?.provenance.firstSeenAt ?? metadata.retrievedAt;
  const updatedAt = previous && !candidateChanged ? previous.updatedAt : metadata.retrievedAt;

  return {
    id: `${CDC_SOURCE_ID}:${candidate.externalRecordId}`,
    assaySlug: previous?.assaySlug ?? null,
    labId: CDC_LAB_ID,
    sourceId: CDC_SOURCE_ID,
    sourcePublisherId: CDC_SOURCE_PUBLISHER_ID,
    externalRecordId: candidate.externalRecordId,
    testName: candidate.testName,
    aliases: candidate.aliases,
    sourceTestId: candidate.sourceTestId,
    sourceLabId: candidate.sourceLabId,
    sourceUnitNumber: candidate.sourceUnitNumber,
    methodology: candidate.method,
    turnaroundTime: candidate.turnaroundTimeText,
    structuredTurnaroundTime: candidate.turnaroundTime,
    acceptableSampleForTesting: candidate.acceptableSampleForTestingText,
    minimumVolume: candidate.minimumVolume,
    storageAndPreservation: candidate.storageAndPreservation,
    transport: candidate.transport,
    shippingInstructions: candidate.shippingInstructions,
    interferencesAndLimitations: candidate.interferencesAndLimitations,
    additionalInformation: candidate.additionalInformation,
    supplementalInformationRequired: candidate.supplementalInformationRequired,
    specimenLabeling: candidate.specimenLabeling,
    sourceLinkText: candidate.sourceLinkText,
    legacyLinkText: candidate.legacyLinkText,
    availability: {
      orderStatus: candidate.orderStatus,
      offline: candidate.offline,
      clia: candidate.clia,
      priorApprovalRequired: candidate.priorApprovalRequired,
      performedOn: candidate.performedOn,
      sourcePresence: "listed",
    },
    contacts: candidate.contacts,
    sourceVersion: candidate.sourceVersion,
    sourceLinks: mappedSourceLinks(candidate),
    attentionFlags: candidate.reviewFlags as SourceOffering["attentionFlags"],
    provenance: {
      snapshotSha256: candidate.snapshotSha256,
      candidateSha256: candidate.normalizedSha256,
      retrievedAt: metadata.retrievedAt,
      sourceUpdatedAt: metadata.sourceUpdatedAt,
      firstSeenAt,
      lastSeenAt: metadata.retrievedAt,
      missingSince: null,
      detailUrl: candidate.detailUrl,
    },
    publicationStatus: "published",
    updatedAt,
  };
}

function retainMissingOffering(previous: SourceOffering, metadata: CdcSourceOfferingMetadata) {
  const attentionFlags = [
    ...previous.attentionFlags.filter((flag) => flag !== "source_missing"),
    "source_missing" as const,
  ];
  return {
    ...previous,
    availability: { ...previous.availability, sourcePresence: "source-missing" as const },
    attentionFlags,
    provenance: {
      ...previous.provenance,
      missingSince: previous.provenance.missingSince ?? metadata.retrievedAt,
    },
  };
}

export function buildCdcSourceOfferingSlice(input: {
  candidates: StagedCdcSourceCandidate[];
  metadata: CdcSourceOfferingMetadata;
  previousSlice?: CdcSourceOfferingSlice | null;
}): CdcSourceOfferingSlice {
  const { candidates, metadata, previousSlice = null } = input;
  if (
    metadata.sourceId !== CDC_SOURCE_ID ||
    metadata.publisherId !== CDC_SOURCE_PUBLISHER_ID ||
    !SHA256_PATTERN.test(metadata.snapshotSha256)
  ) {
    throw new Error("CDC source-offering metadata has invalid source identity or snapshot digest.");
  }
  assertIsoDateTime(metadata.retrievedAt, "retrievedAt");
  if (metadata.sourceUpdatedAt !== null) assertIsoDateTime(metadata.sourceUpdatedAt, "sourceUpdatedAt");
  if (!isCdcSourceGeneratedAtValue(metadata.sourceGeneratedAt)) {
    throw new Error("CDC source-offering metadata has invalid sourceGeneratedAt.");
  }

  const previousByExternalId = new Map(
    (previousSlice?.sourceOfferings ?? []).map((offering) => [offering.externalRecordId, offering]),
  );
  const seen = new Set<string>();
  const mapped = candidates.map((candidate) => {
    assertCandidate(candidate);
    if (candidate.snapshotSha256 !== metadata.snapshotSha256) {
      throw new Error(`CDC candidate ${candidate.externalRecordId} snapshot does not match the batch.`);
    }
    if (seen.has(candidate.externalRecordId)) {
      throw new Error(`CDC source-offering batch has a duplicate externalRecordId: ${candidate.externalRecordId}.`);
    }
    seen.add(candidate.externalRecordId);
    return mapCandidate(candidate, metadata, previousByExternalId.get(candidate.externalRecordId));
  });
  const retainedMissing = [...previousByExternalId.values()]
    .filter((offering) => !seen.has(offering.externalRecordId))
    .map((offering) => retainMissingOffering(offering, metadata));
  const sourceOfferings = [...mapped, ...retainedMissing].toSorted((left, right) =>
    left.externalRecordId.localeCompare(right.externalRecordId),
  );
  const labs: Lab[] = [{
    id: CDC_LAB_ID,
    displayName: "CDC Infectious Diseases Laboratories",
    shortName: "CDC ID Labs",
    website: "https://www.cdc.gov/infectious-diseases-labs/php/test-directory/index.html",
    notes: "Public-health reference testing listed in the CDC Infectious Diseases Laboratory Test Directory.",
  }];

  return {
    schemaVersion: "1",
    mapperVersion: CDC_SOURCE_OFFERING_MAPPER_VERSION,
    source: {
      sourceId: metadata.sourceId,
      publisherId: metadata.publisherId,
      snapshotSha256: metadata.snapshotSha256,
      retrievedAt: metadata.retrievedAt,
      sourceUpdatedAt: metadata.sourceUpdatedAt,
      sourceGeneratedAt: metadata.sourceGeneratedAt,
    },
    batch: {
      inputCandidateCount: candidates.length,
      publishedOfferingCount: sourceOfferings.length,
      attentionOfferingCount: sourceOfferings.filter((offering) => offering.attentionFlags.length > 0).length,
      offlineOfferingCount: sourceOfferings.filter((offering) => offering.availability.offline).length,
      retainedSourceMissingCount: retainedMissing.length,
      blockingExceptionCount: 0,
    },
    labs,
    sourceOfferings,
  };
}
