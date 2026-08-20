import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSourceRegistry } from "../../../features/assayindex/acquisition/source-policy.ts";
import { PROJECT_ROOT } from "./runtime.mjs";

export const SOURCE_REGISTRY_PATH = resolve(
  PROJECT_ROOT,
  "features/assayindex/acquisition/source-registry.json",
);

function assertPositiveInteger(value, field, sourceId) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Source ${sourceId} has invalid ${field}.`);
  }
}

function assertOptionalStagingPolicy(source) {
  if (
    source.maxStagingIssueCount !== undefined &&
    (!Number.isInteger(source.maxStagingIssueCount) || source.maxStagingIssueCount < 0)
  ) {
    throw new Error(`Source ${source.id} has invalid maxStagingIssueCount.`);
  }
  if (source.minimumCandidateCount !== undefined) {
    assertPositiveInteger(source.minimumCandidateCount, "minimumCandidateCount", source.id);
  }
  if (
    source.minimumCandidateRetentionRatio !== undefined &&
    (!Number.isFinite(source.minimumCandidateRetentionRatio) ||
      source.minimumCandidateRetentionRatio < 0 ||
      source.minimumCandidateRetentionRatio > 1)
  ) {
    throw new Error(`Source ${source.id} has invalid minimumCandidateRetentionRatio.`);
  }
}

export async function loadSourceRegistry() {
  const registry = parseSourceRegistry(
    JSON.parse(await readFile(SOURCE_REGISTRY_PATH, "utf8")),
  );

  const ids = new Set();
  for (const source of registry.sources) {
    if (!source?.id || ids.has(source.id)) {
      throw new Error(`Source registry contains a missing or duplicate id: ${source?.id ?? "<missing>"}`);
    }
    ids.add(source.id);
    if (
      source.adapterId !== undefined &&
      source.adapterId !== null &&
      (typeof source.adapterId !== "string" || !source.adapterId.trim())
    ) {
      throw new Error(`Source ${source.id} has an invalid adapterId.`);
    }
    if (
      source.promotionAdapterId !== undefined &&
      source.promotionAdapterId !== null &&
      (typeof source.promotionAdapterId !== "string" || !source.promotionAdapterId.trim())
    ) {
      throw new Error(`Source ${source.id} has an invalid promotionAdapterId.`);
    }
    if (source.enabled && !source.adapterId) {
      throw new Error(`Enabled source ${source.id} has no adapterId.`);
    }
    if (!Array.isArray(source.allowedHosts) || source.allowedHosts.length === 0) {
      throw new Error(`Source ${source.id} has no allowed hosts.`);
    }
    if (!Array.isArray(source.expectedContentTypes) || source.expectedContentTypes.length === 0) {
      throw new Error(`Source ${source.id} has no expected content types.`);
    }
    assertPositiveInteger(source.timeoutMs, "timeoutMs", source.id);
    assertPositiveInteger(source.maxDownloadBytes, "maxDownloadBytes", source.id);
    assertPositiveInteger(source.maxExpandedBytes, "maxExpandedBytes", source.id);
    assertOptionalStagingPolicy(source);
  }
  return registry;
}

export function requireAcquirableSource(registry, sourceId) {
  const source = registry.sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Unknown acquisition source: ${sourceId}`);
  if (!source.enabled) throw new Error(`Acquisition source is disabled: ${sourceId}`);
  if (!new Set(["approved", "evaluation-authorized"]).has(source.permissionStatus)) {
    throw new Error(`Acquisition source permission is not approved: ${sourceId}`);
  }
  return source;
}
