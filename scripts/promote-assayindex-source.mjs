#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCdcSourceOfferingSlice,
  CDC_SOURCE_ID,
} from "../features/assayindex/acquisition/cdc-source-offerings.ts";
import { isCdcSourceGeneratedAtValue } from "../features/assayindex/acquisition/cdc-source-generated-at.shared.mjs";
import { canRedistributeSource } from "../features/assayindex/acquisition/source-policy.ts";
import { mergeSourceOfferingSlices } from "../features/assayindex/data/source-offering-slices.shared.mjs";
import { parseCatalog } from "../features/assayindex/schema/catalog.ts";
import { loadSourceRegistry } from "./assayindex/acquisition/source-registry.mjs";
import { readJsonIfPresent, resolveWithinRuntime } from "./assayindex/acquisition/runtime.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const catalogPath = resolve(projectRoot, "features/assayindex/data/published/catalog.json");
const outputPath = resolve(
  projectRoot,
  "features/assayindex/data/published/source-offering-slices/cdc-infectious-diseases-test-directory.json",
);
const previousSliceCachePath = resolveWithinRuntime(
  "generated-source-offering-slices",
  "cdc-infectious-diseases-test-directory.json",
);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function usage() {
  return [
    "Usage: node scripts/promote-assayindex-source.mjs --source cdc-infectious-diseases-test-directory [--write]",
    "",
    "Validates the complete latest staged source batch and produces a deterministic public source-offering slice.",
    "Without --write it performs a dry run. The command never deploys, commits, or pushes.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = { sourceId: null, write: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") options.sourceId = argv[++index] ?? null;
    else if (argument === "--write") options.write = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedCandidateHash(candidate) {
  return sha256(JSON.stringify(Object.fromEntries(
    Object.entries(candidate).filter(([key]) => key !== "normalizedSha256"),
  )));
}

function assertIsoDateTime(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (
    typeof value !== "string" ||
    !ISO_DATE_TIME_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be a valid ISO date-time string.`);
  }
}

function validateMarker(marker, source) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    throw new Error(`No validated snapshot exists for ${source.id}. Run acquisition first.`);
  }
  if (
    marker.schemaVersion !== "1" ||
    marker.sourceId !== source.id ||
    marker.adapterId !== source.adapterId ||
    marker.publicationStatus !== "staged-only" ||
    !SHA256_PATTERN.test(marker.snapshotSha256 ?? "")
  ) {
    throw new Error("CDC latest-validated marker has invalid identity, status, or digest metadata.");
  }
  const expectedPath = `staged/${marker.snapshotSha256}.candidates.json`;
  if (marker.stagedPath !== expectedPath) {
    throw new Error("CDC latest-validated marker stagedPath does not match its snapshot digest.");
  }
  if (
    !Number.isInteger(marker.recordCount) ||
    !Number.isInteger(marker.candidateCount) ||
    marker.recordCount <= 0 ||
    marker.candidateCount !== marker.recordCount ||
    !Number.isInteger(marker.issueCount) ||
    marker.issueCount !== 0 ||
    !Number.isInteger(marker.reviewRequiredCandidateCount) ||
    marker.reviewRequiredCandidateCount < 0 ||
    marker.reviewRequiredCandidateCount > marker.candidateCount
  ) {
    throw new Error("CDC latest-validated marker has inconsistent counts or staging issues.");
  }
  assertIsoDateTime(marker.validatedAt, "CDC marker validatedAt");
  return marker;
}

function validateArtifact(artifact, marker, source) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("CDC staged candidate artifact must be an object.");
  }
  if (
    artifact.schemaVersion !== "1" ||
    artifact.adapterVersion !== "1.1.0" ||
    artifact.sourceId !== source.id ||
    artifact.publisherId !== source.publisherId ||
    artifact.snapshotSha256 !== marker.snapshotSha256 ||
    artifact.publicationStatus !== "staged-only" ||
    artifact.ordering !== "cdc-test-code"
  ) {
    throw new Error("CDC staged candidate artifact has invalid metadata or adapter version.");
  }
  assertIsoDateTime(artifact.retrievedAt, "CDC staged retrievedAt");
  assertIsoDateTime(artifact.sourceUpdatedAt, "CDC staged sourceUpdatedAt", { nullable: true });
  if (!isCdcSourceGeneratedAtValue(artifact.sourceGeneratedAt)) {
    throw new Error("CDC staged sourceGeneratedAt must match the validated CDC source timestamp.");
  }
  if (!Array.isArray(artifact.candidates) || !Array.isArray(artifact.issues)) {
    throw new Error("CDC staged candidate artifact has invalid candidate or issue collections.");
  }
  if (
    artifact.candidateCount !== marker.candidateCount ||
    artifact.candidateCount !== artifact.candidates.length ||
    artifact.issueCount !== marker.issueCount ||
    artifact.issueCount !== artifact.issues.length ||
    artifact.reviewRequiredCandidateCount !== marker.reviewRequiredCandidateCount
  ) {
    throw new Error("CDC staged artifact counts do not match the validated marker or payload.");
  }
  const identities = new Set();
  let attentionCount = 0;
  for (const candidate of artifact.candidates) {
    if (identities.has(candidate.externalRecordId)) {
      throw new Error(`CDC staged artifact repeats ${candidate.externalRecordId}.`);
    }
    identities.add(candidate.externalRecordId);
    if (candidate.normalizedSha256 !== normalizedCandidateHash(candidate)) {
      throw new Error(`CDC candidate ${candidate.externalRecordId} normalized hash does not match.`);
    }
    if (candidate.reviewFlags?.length > 0) attentionCount += 1;
  }
  if (attentionCount !== marker.reviewRequiredCandidateCount) {
    throw new Error("CDC staged attention count does not match the validated marker.");
  }
  return artifact;
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function buildCdcSourcePromotion({ source, write }) {
  const markerPath = resolveWithinRuntime("sources", source.id, "latest-validated.json");
  const marker = validateMarker(await readJsonIfPresent(markerPath), source);
  const stagedPath = resolveWithinRuntime("sources", source.id, ...marker.stagedPath.split("/"));
  const artifact = validateArtifact(JSON.parse(await readFile(stagedPath, "utf8")), marker, source);
  const previousSlice =
    (await readJsonIfPresent(previousSliceCachePath)) ?? (await readJsonIfPresent(outputPath));
  const slice = buildCdcSourceOfferingSlice({
    candidates: artifact.candidates,
    metadata: {
      sourceId: artifact.sourceId,
      publisherId: artifact.publisherId,
      snapshotSha256: artifact.snapshotSha256,
      retrievedAt: artifact.retrievedAt,
      sourceUpdatedAt: artifact.sourceUpdatedAt,
      sourceGeneratedAt: artifact.sourceGeneratedAt,
    },
    previousSlice,
  });
  if (
    slice.batch.inputCandidateCount + slice.batch.retainedSourceMissingCount !==
      slice.batch.publishedOfferingCount ||
    slice.batch.blockingExceptionCount !== 0
  ) {
    throw new Error("CDC source-offering reconciliation did not account for every record.");
  }
  const baseCatalog = parseCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
  parseCatalog(mergeSourceOfferingSlices(baseCatalog, [slice]));
  const serialized = `${JSON.stringify(slice, null, 2)}\n`;
  if (write) {
    await writeJsonAtomic(previousSliceCachePath, slice);
    await writeJsonAtomic(outputPath, slice);
  }
  return {
    ...slice.batch,
    sourceId: source.id,
    snapshotSha256: artifact.snapshotSha256,
    mapperVersion: slice.mapperVersion,
    outputSha256: sha256(serialized),
    outputPath,
    wrote: write,
  };
}

export const SOURCE_PROMOTION_ADAPTERS = Object.freeze({
  [CDC_SOURCE_ID]: Object.freeze({
    id: CDC_SOURCE_ID,
    sourceId: CDC_SOURCE_ID,
    publishedSliceRelativePath:
      "features/assayindex/data/published/source-offering-slices/cdc-infectious-diseases-test-directory.json",
    build: buildCdcSourcePromotion,
  }),
});

export function requireSourcePromotionAdapter(source) {
  if (!source?.promotionAdapterId) {
    throw new Error(`Acquisition source has no promotion adapter: ${source?.id ?? "<missing>"}`);
  }
  const adapter = SOURCE_PROMOTION_ADAPTERS[source.promotionAdapterId];
  if (!adapter) {
    throw new Error(`Unknown AssayIndex source promotion adapter: ${source.promotionAdapterId}`);
  }
  if (adapter.sourceId !== source.id) {
    throw new Error(
      `Source ${source.id} does not match promotion adapter ${source.promotionAdapterId}.`,
    );
  }
  return adapter;
}

export async function buildSourcePromotion({
  sourceId,
  write = false,
  registry: providedRegistry = null,
}) {
  const registry = providedRegistry ?? await loadSourceRegistry();
  const source = registry.sources.find((entry) => entry.id === sourceId);
  if (!source) throw new Error(`Unknown acquisition source: ${sourceId}`);
  const redistribution = canRedistributeSource(source);
  if (!redistribution.allowed) {
    throw new Error(`Source-level publication is blocked for ${sourceId}: ${redistribution.reason}`);
  }
  const adapter = requireSourcePromotionAdapter(source);
  return adapter.build({ source, write });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.sourceId) throw new Error("A registered --source id is required.");
  console.log(JSON.stringify(await buildSourcePromotion(options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`AssayIndex source promotion failed: ${error.message}`);
    process.exitCode = 1;
  });
}
