import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { dirname } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import { ensureRuntimeDirectory, resolveWithinRuntime } from "./runtime.mjs";

const REQUIRED_FIELDS = [
  "test_accession_ver",
  "name_of_laboratory",
  "name_of_institution",
  "lab_id",
  "lab_test_name",
  "now_current",
  "test_currStat",
  "test_pubStat",
];

const MAX_FIELD_BYTES = 1_048_576;
const ADAPTER_VERSION = "1.2.0";
const EXPECTED_TEST_CURRENT_STATUS = "1";
const EXPECTED_TEST_PUBLICATION_STATUS = "3";

function nullable(value) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replaceAll('""', '"')
    : trimmed;
  return unquoted || null;
}

function splitList(value) {
  const normalized = nullable(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(/[|;]/).map((item) => item.trim()).filter(Boolean))].sort();
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stagingPolicy(source) {
  const policy = {
    maxStagingIssueCount: source.maxStagingIssueCount ?? 0,
    minimumCandidateCount: source.minimumCandidateCount ?? 1,
    minimumCandidateRetentionRatio: source.minimumCandidateRetentionRatio ?? 0.9,
  };
  if (!Number.isInteger(policy.maxStagingIssueCount) || policy.maxStagingIssueCount < 0) {
    throw new Error("GTR staging policy has an invalid maxStagingIssueCount.");
  }
  if (!Number.isInteger(policy.minimumCandidateCount) || policy.minimumCandidateCount <= 0) {
    throw new Error("GTR staging policy has an invalid minimumCandidateCount.");
  }
  if (
    !Number.isFinite(policy.minimumCandidateRetentionRatio) ||
    policy.minimumCandidateRetentionRatio < 0 ||
    policy.minimumCandidateRetentionRatio > 1
  ) {
    throw new Error("GTR staging policy has an invalid minimumCandidateRetentionRatio.");
  }
  return policy;
}

export function classifySourceStatus(sourceStatus) {
  const reviewFlags = [];
  if (sourceStatus.deletedAt) reviewFlags.push("source_deleted");
  if (!sourceStatus.testCurrentStatus) reviewFlags.push("missing_test_current_status");
  else if (sourceStatus.testCurrentStatus !== EXPECTED_TEST_CURRENT_STATUS) {
    reviewFlags.push("unrecognized_test_current_status");
  }
  if (!sourceStatus.testPublicationStatus) reviewFlags.push("missing_test_publication_status");
  else if (sourceStatus.testPublicationStatus !== EXPECTED_TEST_PUBLICATION_STATUS) {
    reviewFlags.push("unrecognized_test_publication_status");
  }
  if (
    sourceStatus.labCurrentStatus &&
    sourceStatus.labCurrentStatus !== EXPECTED_TEST_CURRENT_STATUS
  ) {
    reviewFlags.push("unrecognized_lab_current_status");
  }
  if (
    sourceStatus.labPublicationStatus &&
    sourceStatus.labPublicationStatus !== EXPECTED_TEST_PUBLICATION_STATUS
  ) {
    reviewFlags.push("unrecognized_lab_publication_status");
  }
  return reviewFlags;
}

async function writeChunk(stream, value) {
  if (!stream.write(value)) await once(stream, "drain");
}

async function finishStream(stream, completion) {
  stream.end();
  const error = await completion;
  if (error) throw error;
}

export async function stageGtrTestVersion(
  snapshotPath,
  manifest,
  source,
  { previousCandidateCount = null } = {},
) {
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error("GTR snapshot manifest has an invalid SHA-256 digest.");
  }
  if (
    previousCandidateCount !== null &&
    (!Number.isInteger(previousCandidateCount) || previousCandidateCount <= 0)
  ) {
    throw new Error("Previous validated GTR candidate count is invalid.");
  }
  const policy = stagingPolicy(source);
  let expandedBytes = 0;
  let rowNumber = 0;
  let header;
  let indexes;
  const issues = [];
  const seen = new Set();
  let candidateCount = 0;
  let historicalRowCount = 0;
  let reviewRequiredCandidateCount = 0;

  function recordIssue(issue) {
    issues.push(issue);
    if (issues.length > policy.maxStagingIssueCount) {
      throw new Error(
        `GTR staging issue gate failed: ${issues.length} issue(s) exceeded the allowed ${policy.maxStagingIssueCount}; first issue ${issues[0].code} at row ${issues[0].row}.`,
      );
    }
  }

  const path = resolveWithinRuntime("sources", source.id, "staged", `${manifest.sha256}.candidates.json`);
  await ensureRuntimeDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const output = createWriteStream(temporary, { flags: "wx", encoding: "utf8" });
  const outputCompletion = finished(output).then(
    () => null,
    (error) => error,
  );
  const metadata = {
    schemaVersion: "1",
    adapterVersion: ADAPTER_VERSION,
    sourceId: source.id,
    publisherId: source.publisherId,
    snapshotSha256: manifest.sha256,
    retrievedAt: manifest.retrievedAt,
    sourceUpdatedAt: manifest.sourceUpdatedAt,
    publicationStatus: "staged-only",
    ordering: "source-row",
  };

  const gunzip = createGunzip();
  gunzip.on("data", (chunk) => {
    expandedBytes += chunk.length;
    if (expandedBytes > source.maxExpandedBytes) {
      gunzip.destroy(new Error(`Expanded GTR data exceeded ${source.maxExpandedBytes} byte limit.`));
    }
  });
  const compressedInput = createReadStream(snapshotPath);
  const decompressionCompletion = pipeline(compressedInput, gunzip).then(
    () => null,
    (error) => error,
  );
  const lines = createInterface({
    input: gunzip,
    crlfDelay: Infinity,
  });

  try {
    const prefix = JSON.stringify(metadata).slice(0, -1);
    await writeChunk(output, `${prefix},\"candidates\":[\n`);

    for await (const line of lines) {
      rowNumber += 1;
      if (Buffer.byteLength(line, "utf8") > MAX_FIELD_BYTES * 32) {
        throw new Error(`GTR row ${rowNumber} exceeded the safe row size limit.`);
      }
      if (!header) {
        header = line.replace(/^\uFEFF/, "").split("\t").map((field) => field.trim());
        indexes = Object.fromEntries(header.map((field, index) => [field, index]));
        const missing = REQUIRED_FIELDS.filter((field) => indexes[field] === undefined);
        if (missing.length) throw new Error(`GTR schema drift: missing ${missing.join(", ")}`);
        continue;
      }
      if (!line.trim()) continue;
      const cells = line.split("\t");
      if (cells.length !== header.length) {
        recordIssue({ code: "invalid_column_count", row: rowNumber, expected: header.length, actual: cells.length });
        continue;
      }
      if (cells.some((cell) => Buffer.byteLength(cell, "utf8") > MAX_FIELD_BYTES)) {
        recordIssue({ code: "oversized_field", row: rowNumber });
        continue;
      }
      const row = Object.fromEntries(header.map((field, index) => [field, cells[index] ?? ""]));
      const externalRecordId = nullable(row.test_accession_ver);
      const publisherProviderId = nullable(row.lab_id);
      if (!externalRecordId || !publisherProviderId) {
        recordIssue({ code: "missing_identity", row: rowNumber });
        continue;
      }
      if (nullable(row.now_current) !== "1") {
        historicalRowCount += 1;
        continue;
      }
      if (seen.has(externalRecordId)) {
        recordIssue({ code: "duplicate_accession", row: rowNumber, externalRecordId });
        continue;
      }
      seen.add(externalRecordId);
      const sourceStatus = {
        nowCurrent: nullable(row.now_current),
        testCurrentStatus: nullable(row.test_currStat),
        testPublicationStatus: nullable(row.test_pubStat),
        labCurrentStatus: nullable(row.lab_currStat),
        labPublicationStatus: nullable(row.lab_pubStat),
        lastTouchedAt: nullable(row.last_touch_date),
        createdAt: nullable(row.test_create_date),
        deletedAt: nullable(row.test_deletion_date),
      };
      const reviewFlags = classifySourceStatus(sourceStatus);
      if (reviewFlags.length > 0) reviewRequiredCandidateCount += 1;
      const candidate = {
        sourceId: source.id,
        publisherId: source.publisherId,
        externalRecordId,
        publisherProviderId,
        sourceRowNumber: rowNumber,
        provider: {
          laboratoryName: nullable(row.name_of_laboratory),
          institutionName: nullable(row.name_of_institution),
          country: nullable(row.facility_country),
          state: nullable(row.facility_state),
          postcode: nullable(row.facility_postcode),
        },
        offering: {
          labTestName: nullable(row.lab_test_name),
          manufacturerTestName: nullable(row.manufacturer_test_name),
          labTestId: nullable(row.lab_test_id),
          orderCode: nullable(row.test_order_code),
          testDevelopment: nullable(row.test_development),
          methodCategories: splitList(row.method_categories),
          methods: splitList(row.methods),
          platforms: splitList(row.platforms),
          genes: splitList(row.genes),
          conditions: splitList(row.condition_identifiers),
        },
        sourceStatus,
        reviewFlags,
        candidateState: reviewFlags.length > 0 ? "discovered-review-required" : "discovered",
        publicationStatus: "staged-only",
      };
      const stagedCandidate = { ...candidate, normalizedSha256: stableHash(candidate) };
      await writeChunk(output, `${candidateCount > 0 ? ",\n" : ""}${JSON.stringify(stagedCandidate)}`);
      candidateCount += 1;
    }

    const decompressionError = await decompressionCompletion;
    if (decompressionError) throw decompressionError;

    if (!header) throw new Error("GTR snapshot was empty.");
    if (candidateCount < policy.minimumCandidateCount) {
      throw new Error(
        `GTR candidate count gate failed: ${candidateCount} was below the minimum ${policy.minimumCandidateCount}.`,
      );
    }
    if (
      previousCandidateCount !== null &&
      previousCandidateCount > 0 &&
      candidateCount / previousCandidateCount < policy.minimumCandidateRetentionRatio
    ) {
      throw new Error(
        `GTR candidate count regression gate failed: ${candidateCount} retained less than ${policy.minimumCandidateRetentionRatio * 100}% of the previous validated ${previousCandidateCount}.`,
      );
    }
    await writeChunk(
      output,
      `\n],\"candidateCount\":${candidateCount},\"historicalRowCount\":${historicalRowCount},\"reviewRequiredCandidateCount\":${reviewRequiredCandidateCount},\"issueCount\":${issues.length},\"issues\":${JSON.stringify(issues)}}\n`,
    );
    await finishStream(output, outputCompletion);
    await rename(temporary, path);
    return {
      path,
      candidateCount,
      historicalRowCount,
      reviewRequiredCandidateCount,
      issueCount: issues.length,
    };
  } catch (error) {
    lines.close();
    compressedInput.destroy();
    gunzip.destroy();
    await decompressionCompletion;
    if (!output.destroyed && !output.writableEnded) output.end();
    await outputCompletion;
    await rm(temporary, { force: true });
    throw error;
  }
}
