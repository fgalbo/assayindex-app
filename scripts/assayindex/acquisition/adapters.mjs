import { isCdcSourceGeneratedAt } from "../../../features/assayindex/acquisition/cdc-test-directory.ts";
import { GTR_CONDITION_GENE_FIELDS } from "../../../features/assayindex/acquisition/gtr.ts";
import { stageCdcTestDirectory } from "./cdc-test-directory.mjs";
import { stageGtrConditionGene } from "./gtr-condition-gene.mjs";
import { stageGtrTestVersion } from "./gtr-test-version.mjs";
import {
  validateGzipSnapshot,
  validateTextSnapshot,
  validateXmlSnapshot,
} from "./payload-validation.mjs";

const GTR_HOST = "ftp.ncbi.nlm.nih.gov";
const CDC_HOST = "www.cdc.gov";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoDateTime(value) {
  return (
    typeof value === "string" &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isNonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateTestVersionMarkerFields(marker) {
  if (!isPositiveInteger(marker.candidateCount) || marker.candidateCount !== marker.recordCount) {
    throw new Error("Previous GTR test-version marker has an invalid candidateCount.");
  }
  if (!isNonnegativeInteger(marker.historicalRowCount)) {
    throw new Error("Previous GTR test-version marker has an invalid historicalRowCount.");
  }
  if (
    !isNonnegativeInteger(marker.reviewRequiredCandidateCount) ||
    marker.reviewRequiredCandidateCount > marker.candidateCount
  ) {
    throw new Error("Previous GTR test-version marker has an invalid reviewRequiredCandidateCount.");
  }
}

function validateCdcMarkerFields(marker) {
  if (!isPositiveInteger(marker.candidateCount) || marker.candidateCount !== marker.recordCount) {
    throw new Error("Previous CDC test directory marker has an invalid candidateCount.");
  }
  if (
    !isNonnegativeInteger(marker.reviewRequiredCandidateCount) ||
    marker.reviewRequiredCandidateCount > marker.candidateCount
  ) {
    throw new Error(
      "Previous CDC test directory marker has an invalid reviewRequiredCandidateCount.",
    );
  }
  if (!isCdcSourceGeneratedAt(marker.sourceGeneratedAt)) {
    throw new Error("Previous CDC test directory marker has an invalid sourceGeneratedAt.");
  }
}

export const ACQUISITION_ADAPTERS = Object.freeze({
  "nih-gtr-test-version": Object.freeze({
    id: "nih-gtr-test-version",
    sourceUrl: "https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_version.gz",
    allowedHosts: [GTR_HOST],
    snapshotFileName: "test_version.gz",
    validateSnapshot: validateGzipSnapshot,
    validatePreviousMarkerFields: validateTestVersionMarkerFields,
    async stage(snapshotPath, manifest, source, { previousRecordCount }) {
      const result = await stageGtrTestVersion(snapshotPath, manifest, source, {
        previousCandidateCount: previousRecordCount,
      });
      return {
        ...result,
        recordCount: result.candidateCount,
        markerFields: {
          candidateCount: result.candidateCount,
          historicalRowCount: result.historicalRowCount,
          reviewRequiredCandidateCount: result.reviewRequiredCandidateCount,
        },
        summaryFields: {
          stagedCandidateCount: result.candidateCount,
          skippedHistoricalRowCount: result.historicalRowCount,
          reviewRequiredCandidateCount: result.reviewRequiredCandidateCount,
        },
      };
    },
    stagedRelativePath(manifest) {
      return `staged/${manifest.sha256}.candidates.json`;
    },
  }),
  "nih-gtr-test-condition-gene": Object.freeze({
    id: "nih-gtr-test-condition-gene",
    sourceUrl: "https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_condition_gene.txt",
    allowedHosts: [GTR_HOST],
    snapshotFileName: "test_condition_gene.txt",
    validateSnapshot(path) {
      return validateTextSnapshot(path, { requiredHeaderFields: GTR_CONDITION_GENE_FIELDS });
    },
    validatePreviousMarkerFields() {},
    async stage(snapshotPath, manifest, source, { previousRecordCount }) {
      const result = await stageGtrConditionGene(snapshotPath, manifest, source, {
        previousRecordCount,
      });
      return {
        ...result,
        markerFields: {},
        summaryFields: { stagedRecordCount: result.recordCount },
      };
    },
    stagedRelativePath(manifest) {
      return `staged/${manifest.sha256}.records.json`;
    },
  }),
  "cdc-infectious-diseases-test-directory": Object.freeze({
    id: "cdc-infectious-diseases-test-directory",
    sourceUrl: "https://www.cdc.gov/laboratory/specimen-submission/js-app/data.xml",
    allowedHosts: [CDC_HOST],
    snapshotFileName: "data.xml",
    validateSnapshot(path, source) {
      return validateXmlSnapshot(path, {
        rootElement: "dataroot",
        recordElement: "QryTableMerge",
        maxBytes: source?.maxExpandedBytes,
      });
    },
    validatePreviousMarkerFields: validateCdcMarkerFields,
    async stage(snapshotPath, manifest, source, { previousRecordCount }) {
      const result = await stageCdcTestDirectory(snapshotPath, manifest, source, {
        previousRecordCount,
      });
      return {
        ...result,
        recordCount: result.candidateCount,
        markerFields: {
          candidateCount: result.candidateCount,
          reviewRequiredCandidateCount: result.reviewRequiredCandidateCount,
          sourceGeneratedAt: result.sourceGeneratedAt,
        },
        summaryFields: {
          stagedCandidateCount: result.candidateCount,
          reviewRequiredCandidateCount: result.reviewRequiredCandidateCount,
          sourceGeneratedAt: result.sourceGeneratedAt,
        },
      };
    },
    stagedRelativePath(manifest) {
      return `staged/${manifest.sha256}.candidates.json`;
    },
  }),
});

export function requireAcquisitionAdapter(source) {
  if (!source.adapterId) throw new Error(`Acquisition source has no implemented adapter: ${source.id}`);
  const adapter = ACQUISITION_ADAPTERS[source.adapterId];
  if (!adapter) throw new Error(`Unknown AssayIndex acquisition adapter: ${source.adapterId}`);
  if (source.url !== adapter.sourceUrl) {
    throw new Error(`Source ${source.id} URL does not match its hardcoded adapter allowlist.`);
  }
  if (
    source.allowedHosts.length !== adapter.allowedHosts.length ||
    source.allowedHosts.some((host, index) => host !== adapter.allowedHosts[index])
  ) {
    throw new Error(`Source ${source.id} hosts do not match its hardcoded adapter allowlist.`);
  }
  return adapter;
}

export function validatePreviousAcquisitionMarker(marker, { source, adapter }) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    throw new Error(`The previous validated ${source.id} acquisition marker must be an object.`);
  }
  if (marker.schemaVersion !== "1") {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid schemaVersion.`);
  }
  if (marker.sourceId !== source.id) {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid sourceId.`);
  }
  if (marker.adapterId !== adapter.id || marker.adapterId !== source.adapterId) {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid adapterId.`);
  }
  if (!SHA256_PATTERN.test(marker.snapshotSha256 ?? "")) {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid snapshotSha256.`);
  }
  if (marker.stagedPath !== adapter.stagedRelativePath({ sha256: marker.snapshotSha256 })) {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid stagedPath.`);
  }
  if (marker.publicationStatus !== "staged-only") {
    throw new Error(`The previous validated ${source.id} acquisition marker is not staged-only.`);
  }
  if (!isIsoDateTime(marker.validatedAt)) {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid validatedAt.`);
  }
  if (!isNonnegativeInteger(marker.issueCount)) {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid issueCount.`);
  }
  if (
    Number.isInteger(source.maxStagingIssueCount) &&
    marker.issueCount > source.maxStagingIssueCount
  ) {
    throw new Error(`The previous validated ${source.id} acquisition marker exceeds its issue-count policy.`);
  }
  if (!isPositiveInteger(marker.recordCount)) {
    throw new Error(`The previous validated ${source.id} acquisition marker has an invalid recordCount.`);
  }
  if (
    Number.isInteger(source.minimumCandidateCount) &&
    marker.recordCount < source.minimumCandidateCount
  ) {
    throw new Error(`The previous validated ${source.id} acquisition marker is below its minimum record-count policy.`);
  }
  adapter.validatePreviousMarkerFields(marker);
  return marker;
}
