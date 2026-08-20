import { createHash } from "node:crypto";

import type {
  AssayIndexCatalog,
  SourceDocument,
} from "@/features/assayindex/domain/types";

export type RecordProvenance =
  | {
      recordId: string;
      sourceOfferingId?: never;
      sourceId: string;
      locator: string | null;
    }
  | {
      recordId?: never;
      sourceOfferingId: string;
      sourceId: string;
      locator: string | null;
    };

export type PublicationCandidate = {
  catalog: AssayIndexCatalog;
  provenance: RecordProvenance[];
  reviewed: boolean;
  sourceComplete: boolean;
  validationIssues: string[];
  contributingSourcePublisherIds: string[];
  sourceReleaseDecisions: Array<{
    sourcePublisherId: string;
    approved: boolean;
  }>;
  acquisitionSourceReleaseDecisions?: Array<{
    sourceId: string;
    approved: boolean;
  }>;
};

export type PublicationBlocker =
  | "review_required"
  | "source_incomplete"
  | "validation_failed"
  | "missing_provenance"
  | "source_policy_blocked";

export type ReleaseManifestFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type ReleaseManifest = {
  schemaVersion: "1";
  catalogVersion: string;
  generatedAt: string;
  counts: {
    assays: number;
    laboratories: number;
    records: number;
    sourceOfferings: number;
    sourceDocuments: number;
    curatedRelationships: number;
    coOrderRelationships: number;
  };
  files: ReleaseManifestFile[];
};

export type ReleaseBundle = {
  files: Record<string, string>;
  manifest: ReleaseManifest;
};

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function deriveContributingSourcePublisherIds(catalog: AssayIndexCatalog): string[] {
  return [
    ...new Set([
      ...catalog.assayLabRecords.map((record) => record.labId),
      ...catalog.sourceDocuments.map((source) => source.labId),
      ...(catalog.sourceOfferings ?? []).map((offering) => offering.sourcePublisherId),
      ...catalog.curatedAssayRelationships.map((relationship) => relationship.sourcePublisherId),
      ...catalog.coOrderRelationships.map((relationship) => relationship.source.publisherId),
    ]),
  ].toSorted();
}

function fileEntry(path: string, content: string): ReleaseManifestFile {
  return {
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  };
}

export function evaluatePublicationCandidate(candidate: PublicationCandidate): {
  publishable: boolean;
  blockers: PublicationBlocker[];
} {
  const blockers: PublicationBlocker[] = [];

  if (!candidate.reviewed) blockers.push("review_required");
  if (!candidate.sourceComplete) blockers.push("source_incomplete");
  if (candidate.validationIssues.length > 0) blockers.push("validation_failed");
  const provenanceRecordIds = new Set(
    candidate.provenance.flatMap((entry) => entry.recordId ? [entry.recordId] : []),
  );
  const hasMissingRecordProvenance = candidate.catalog.assayLabRecords.some(
    (record) => !provenanceRecordIds.has(record.id),
  );
  const hasMissingSourceOfferingProvenance = (candidate.catalog.sourceOfferings ?? [])
    .filter((offering) => offering.publicationStatus === "published")
    .some(
      (offering) =>
        offering.sourceLinks.length === 0 ||
        !offering.provenance.snapshotSha256 ||
        !offering.provenance.candidateSha256 ||
        !offering.provenance.detailUrl,
    );
  if (hasMissingRecordProvenance || hasMissingSourceOfferingProvenance) {
    blockers.push("missing_provenance");
  }
  const approvedSourcePublisherIds = new Set(
    candidate.sourceReleaseDecisions
      .filter((decision) => decision.approved)
      .map((decision) => decision.sourcePublisherId),
  );
  const contributingSourcePublisherIds = new Set([
    ...deriveContributingSourcePublisherIds(candidate.catalog),
    ...candidate.contributingSourcePublisherIds,
  ]);
  if (
    [...contributingSourcePublisherIds].some(
      (sourcePublisherId) => !approvedSourcePublisherIds.has(sourcePublisherId),
    )
  ) {
    blockers.push("source_policy_blocked");
  }
  const approvedAcquisitionSourceIds = new Set(
    (candidate.acquisitionSourceReleaseDecisions ?? [])
      .filter((decision) => decision.approved)
      .map((decision) => decision.sourceId),
  );
  const acquisitionSourceBlocked = (candidate.catalog.sourceOfferings ?? [])
    .filter((offering) => offering.publicationStatus === "published")
    .some((offering) => !approvedAcquisitionSourceIds.has(offering.sourceId));
  if (acquisitionSourceBlocked && !blockers.includes("source_policy_blocked")) {
    blockers.push("source_policy_blocked");
  }

  return { blockers, publishable: blockers.length === 0 };
}

export function buildReleaseBundle(input: {
  candidate: PublicationCandidate;
  sources: SourceDocument[];
  generatedAt: string;
  additionalFiles?: Record<string, string>;
  manifestExtensions?: Record<string, unknown>;
}): ReleaseBundle {
  const evaluation = evaluatePublicationCandidate(input.candidate);
  if (!evaluation.publishable) {
    throw new Error(`AssayIndex release blocked: ${evaluation.blockers.join(", ")}`);
  }

  const catalogJson = stableJson(input.candidate.catalog);
  const providedSourceOfferingIds = new Set(
    input.candidate.provenance.flatMap((entry) =>
      entry.sourceOfferingId ? [entry.sourceOfferingId] : [],
    ),
  );
  const sourceOfferingProvenance: RecordProvenance[] = (input.candidate.catalog.sourceOfferings ?? [])
    .filter(
      (offering) =>
        offering.publicationStatus === "published" &&
        !providedSourceOfferingIds.has(offering.id),
    )
    .map((offering) => ({
      sourceOfferingId: offering.id,
      sourceId: offering.sourceId,
      locator: offering.provenance.detailUrl,
    }));
  const provenanceJson = stableJson([
    ...input.candidate.provenance,
    ...sourceOfferingProvenance,
  ]);
  const sourcesJson = stableJson(input.sources);
  const reservedPaths = new Set(["catalog.json", "provenance.json", "sources.json", "manifest.json", "SHA256SUMS.txt"]);
  const additionalFiles = input.additionalFiles ?? {};
  const conflictingPath = Object.keys(additionalFiles).find((path) => reservedPaths.has(path));
  if (conflictingPath) {
    throw new Error(`AssayIndex release file path is reserved: ${conflictingPath}`);
  }
  const reservedManifestKeys = new Set(["schemaVersion", "catalogVersion", "generatedAt", "counts", "files"]);
  const conflictingManifestKey = Object.keys(input.manifestExtensions ?? {}).find((key) => reservedManifestKeys.has(key));
  if (conflictingManifestKey) {
    throw new Error(`AssayIndex release manifest key is reserved: ${conflictingManifestKey}`);
  }
  const payloads: Record<string, string> = {
    "catalog.json": catalogJson,
    "provenance.json": provenanceJson,
    "sources.json": sourcesJson,
    ...additionalFiles,
  };
  const manifest: ReleaseManifest = {
    schemaVersion: "1",
    catalogVersion: input.candidate.catalog.meta.version,
    generatedAt: input.generatedAt,
    ...input.manifestExtensions,
    counts: {
      assays: input.candidate.catalog.assays.length,
      laboratories: input.candidate.catalog.labs.length,
      records: input.candidate.catalog.assayLabRecords.length,
      sourceOfferings: input.candidate.catalog.sourceOfferings?.length ?? 0,
      sourceDocuments: input.candidate.catalog.sourceDocuments.length,
      curatedRelationships: input.candidate.catalog.curatedAssayRelationships.length,
      coOrderRelationships: input.candidate.catalog.coOrderRelationships.length,
    },
    files: Object.entries(payloads)
      .map(([path, content]) => fileEntry(path, content))
      .toSorted((left, right) => left.path.localeCompare(right.path)),
  };
  const manifestJson = stableJson(manifest);
  const checksumEntries = [
    ...manifest.files,
    fileEntry("manifest.json", manifestJson),
  ].toSorted((left, right) => left.path.localeCompare(right.path));
  const checksums = `${checksumEntries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`;

  return {
    manifest,
    files: {
      ...payloads,
      "manifest.json": manifestJson,
      "SHA256SUMS.txt": checksums,
    },
  };
}

export function verifyReleaseBundle(bundle: ReleaseBundle): {
  valid: boolean;
  issues: Array<{ code: "missing_file" | "hash_mismatch"; path: string }>;
} {
  const issues: Array<{ code: "missing_file" | "hash_mismatch"; path: string }> = [];

  for (const expected of bundle.manifest.files) {
    const content = bundle.files[expected.path];
    if (typeof content !== "string") {
      issues.push({ code: "missing_file", path: expected.path });
    } else if (sha256(content) !== expected.sha256) {
      issues.push({ code: "hash_mismatch", path: expected.path });
    }
  }

  return { issues, valid: issues.length === 0 };
}
