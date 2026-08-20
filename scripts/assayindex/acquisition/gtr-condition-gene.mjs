import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

import {
  GTR_CONDITION_GENE_FIELDS,
  createGtrConditionGeneAccumulator,
  normalizeGtrConditionGeneHeader,
} from "../../../features/assayindex/acquisition/gtr.ts";
import { resolveWithinRuntime, writeJsonArrayEnvelopeAtomic } from "./runtime.mjs";

const ADAPTER_VERSION = "1.0.0";
const MAX_ROW_BYTES = 4 * 1_048_576;

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

export async function stageGtrConditionGene(
  snapshotPath,
  manifest,
  source,
  { previousRecordCount = null } = {},
) {
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error("GTR condition/gene snapshot manifest has an invalid SHA-256 digest.");
  }
  if (
    previousRecordCount !== null &&
    (!Number.isInteger(previousRecordCount) || previousRecordCount <= 0)
  ) {
    throw new Error("Previous validated GTR condition/gene record count is invalid.");
  }

  const sourceStats = await stat(snapshotPath);
  if (sourceStats.size > source.maxExpandedBytes) {
    throw new Error(`GTR condition/gene text exceeded ${source.maxExpandedBytes} byte limit.`);
  }

  const policy = stagingPolicy(source);
  const input = createReadStream(snapshotPath);
  let streamedBytes = 0;
  input.on("data", (chunk) => {
    streamedBytes += chunk.length;
    if (streamedBytes > source.maxExpandedBytes) {
      input.destroy(new Error(`GTR condition/gene text exceeded ${source.maxExpandedBytes} byte limit.`));
    }
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let accumulator = null;
  let rowNumber = 0;

  try {
    for await (const line of lines) {
      rowNumber += 1;
      if (Buffer.byteLength(line, "utf8") > MAX_ROW_BYTES) {
        throw new Error(`GTR condition/gene row ${rowNumber} exceeded the safe row size limit.`);
      }
      if (!accumulator) {
        const header = line.split("\t");
        const normalizedHeader = header.map(normalizeGtrConditionGeneHeader);
        const missing = GTR_CONDITION_GENE_FIELDS.filter((field) => !normalizedHeader.includes(field));
        if (missing.length > 0) {
          throw new Error(`GTR condition/gene schema drift: missing ${missing.join(", ")}`);
        }
        accumulator = createGtrConditionGeneAccumulator(header);
        continue;
      }
      if (!line.trim()) continue;
      accumulator.addRow(line.split("\t"), rowNumber);
      if (accumulator.issues.length > policy.maxStagingIssueCount) {
        const firstIssue = accumulator.issues[0];
        throw new Error(
          `GTR condition/gene staging issue gate failed: ${accumulator.issues.length} issue(s) exceeded the allowed ${policy.maxStagingIssueCount}; first issue ${firstIssue.code} at row ${firstIssue.row ?? "unknown"}.`,
        );
      }
    }

    if (!accumulator) throw new Error("GTR condition/gene snapshot was empty.");
    const parsed = accumulator.finish();
    const recordCount = parsed.records.length;
    if (recordCount < policy.minimumCandidateCount) {
      throw new Error(
        `GTR condition/gene record count gate failed: ${recordCount} was below the minimum ${policy.minimumCandidateCount}.`,
      );
    }
    if (
      previousRecordCount !== null &&
      recordCount / previousRecordCount < policy.minimumCandidateRetentionRatio
    ) {
      throw new Error(
        `GTR condition/gene record count regression gate failed: ${recordCount} retained less than ${policy.minimumCandidateRetentionRatio * 100}% of the previous validated ${previousRecordCount}.`,
      );
    }

    const records = parsed.records.map((record) => {
      const candidate = {
        ...record,
        sourceId: source.id,
        publisherId: source.publisherId,
        snapshotSha256: manifest.sha256,
        candidateState: "discovered",
        publicationStatus: "staged-only",
      };
      return { ...candidate, normalizedSha256: stableHash(candidate) };
    });
    const path = resolveWithinRuntime("sources", source.id, "staged", `${manifest.sha256}.records.json`);
    const metadata = {
      schemaVersion: "1",
      adapterVersion: ADAPTER_VERSION,
      sourceId: source.id,
      publisherId: source.publisherId,
      snapshotSha256: manifest.sha256,
      retrievedAt: manifest.retrievedAt,
      sourceUpdatedAt: manifest.sourceUpdatedAt,
      publicationStatus: "staged-only",
      ordering: "gtr-accession-version",
    };
    const footer = {
      recordCount,
      issueCount: parsed.issues.length,
      issues: parsed.issues,
    };
    const written = await writeJsonArrayEnvelopeAtomic(path, {
      metadata,
      arrayName: "records",
      entries: records,
      footer,
    });
    if (written.entryCount !== recordCount) {
      throw new Error(`GTR condition/gene staged writer emitted ${written.entryCount} of ${recordCount} records.`);
    }

    return { path, recordCount, issueCount: parsed.issues.length };
  } finally {
    lines.close();
    input.destroy();
  }
}
