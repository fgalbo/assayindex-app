import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parseCdcTestDirectoryXml } from "../../../features/assayindex/acquisition/cdc-test-directory.ts";
import { resolveWithinRuntime, writeJsonArrayEnvelopeAtomic } from "./runtime.mjs";

export const CDC_TEST_DIRECTORY_ADAPTER_VERSION = "1.1.0";

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function stagingPolicy(source) {
  return {
    maxStagingIssueCount: source.maxStagingIssueCount ?? 0,
    minimumCandidateCount: source.minimumCandidateCount ?? 1,
    minimumCandidateRetentionRatio: source.minimumCandidateRetentionRatio ?? 0.9,
  };
}

export async function stageCdcTestDirectory(
  snapshotPath,
  manifest,
  source,
  { previousRecordCount = null } = {},
) {
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error("CDC test directory snapshot manifest has an invalid SHA-256 digest.");
  }
  if (
    previousRecordCount !== null &&
    (!Number.isInteger(previousRecordCount) || previousRecordCount <= 0)
  ) {
    throw new Error("Previous validated CDC test directory candidate count is invalid.");
  }

  const bytes = await readFile(snapshotPath);
  if (bytes.length > source.maxExpandedBytes) {
    throw new Error(`CDC test directory XML exceeded ${source.maxExpandedBytes} byte limit.`);
  }
  let xml;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("CDC test directory XML is not valid UTF-8.");
  }

  const parsed = parseCdcTestDirectoryXml(xml);
  const policy = stagingPolicy(source);
  if (parsed.issues.length > policy.maxStagingIssueCount) {
    const firstIssue = parsed.issues[0];
    throw new Error(
      `CDC test directory staging issue gate failed: ${parsed.issues.length} issue(s) exceeded the allowed ${policy.maxStagingIssueCount}; first issue ${firstIssue.code} in ${firstIssue.field ?? "unknown field"} at record ${firstIssue.record ?? "unknown"}.`,
    );
  }

  const candidateCount = parsed.candidates.length;
  if (candidateCount < policy.minimumCandidateCount) {
    throw new Error(
      `CDC test directory candidate count gate failed: ${candidateCount} was below the minimum ${policy.minimumCandidateCount}.`,
    );
  }
  if (
    previousRecordCount !== null &&
    candidateCount / previousRecordCount < policy.minimumCandidateRetentionRatio
  ) {
    throw new Error(
      `CDC test directory candidate count regression gate failed: ${candidateCount} retained less than ${policy.minimumCandidateRetentionRatio * 100}% of the previous validated ${previousRecordCount}.`,
    );
  }

  const candidates = parsed.candidates.map((candidate) => {
    const stagedCandidate = {
      ...candidate,
      sourceId: source.id,
      publisherId: source.publisherId,
      snapshotSha256: manifest.sha256,
      publicationStatus: "staged-only",
    };
    return { ...stagedCandidate, normalizedSha256: stableHash(stagedCandidate) };
  });
  const reviewRequiredCandidateCount = candidates.filter(
    (candidate) => candidate.candidateState === "discovered-review-required",
  ).length;
  const path = resolveWithinRuntime(
    "sources",
    source.id,
    "staged",
    `${manifest.sha256}.candidates.json`,
  );
  const metadata = {
    schemaVersion: "1",
    adapterVersion: CDC_TEST_DIRECTORY_ADAPTER_VERSION,
    sourceId: source.id,
    publisherId: source.publisherId,
    snapshotSha256: manifest.sha256,
    retrievedAt: manifest.retrievedAt,
    sourceUpdatedAt: manifest.sourceUpdatedAt,
    sourceGeneratedAt: parsed.sourceGeneratedAt,
    publicationStatus: "staged-only",
    ordering: "cdc-test-code",
  };
  const footer = {
    candidateCount,
    reviewRequiredCandidateCount,
    issueCount: parsed.issues.length,
    issues: parsed.issues,
  };
  const written = await writeJsonArrayEnvelopeAtomic(path, {
    metadata,
    arrayName: "candidates",
    entries: candidates,
    footer,
  });
  if (written.entryCount !== candidateCount) {
    throw new Error(
      `CDC test directory staged writer emitted ${written.entryCount} of ${candidateCount} candidates.`,
    );
  }

  return {
    path,
    recordCount: candidateCount,
    candidateCount,
    reviewRequiredCandidateCount,
    issueCount: parsed.issues.length,
    sourceGeneratedAt: parsed.sourceGeneratedAt,
  };
}
