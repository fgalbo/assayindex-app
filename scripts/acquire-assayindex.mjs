#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireSnapshot, snapshotPathForManifest } from "./assayindex/acquisition/download.mjs";
import {
  requireAcquisitionAdapter,
  validatePreviousAcquisitionMarker,
} from "./assayindex/acquisition/adapters.mjs";
import { readJsonIfPresent, resolveWithinRuntime, writeJsonAtomic } from "./assayindex/acquisition/runtime.mjs";
import { loadSourceRegistry, requireAcquirableSource } from "./assayindex/acquisition/source-registry.mjs";

function usage() {
  return [
    "Usage: node scripts/acquire-assayindex.mjs --source <registered-source-id> --allow-network",
    "",
    "Downloads a policy-approved source snapshot and writes staged discovery data only.",
    "It never changes or publishes the canonical AssayIndex catalog.",
  ].join("\n");
}

export function parseAcquisitionArguments(argv) {
  const options = { allowNetwork: false, sourceId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-network") options.allowNetwork = true;
    else if (argument === "--source") options.sourceId = argv[++index] ?? null;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export async function acquireAssayIndexSource({
  sourceId,
  allowNetwork = false,
  registry: providedRegistry = null,
} = {}) {
  if (!allowNetwork) {
    throw new Error("Network acquisition is disabled. Re-run with the explicit --allow-network gate.");
  }
  if (!sourceId) throw new Error("A registered --source id is required.");

  const registry = providedRegistry ?? await loadSourceRegistry();
  const source = requireAcquirableSource(registry, sourceId);
  const adapter = requireAcquisitionAdapter(source);
  const validatedManifestPath = resolveWithinRuntime("sources", source.id, "latest-validated.json");
  const previousMarker = await readJsonIfPresent(validatedManifestPath);
  const previousValidation = previousMarker === null
    ? null
    : validatePreviousAcquisitionMarker(previousMarker, { source, adapter });
  const previousRecordCount = previousValidation?.recordCount ?? null;
  const acquisition = await acquireSnapshot(source, {
    snapshotFileName: adapter.snapshotFileName,
    validateSnapshot: adapter.validateSnapshot,
  });
  const snapshotPath = acquisition.snapshotPath ?? snapshotPathForManifest(source.id, acquisition.manifest);
  const staged = await adapter.stage(snapshotPath, acquisition.manifest, source, {
    previousRecordCount,
  });
  const validatedAt = new Date().toISOString();
  await writeJsonAtomic(validatedManifestPath, {
    schemaVersion: "1",
    sourceId: source.id,
    adapterId: adapter.id,
    snapshotSha256: acquisition.manifest.sha256,
    stagedPath: adapter.stagedRelativePath(acquisition.manifest),
    validatedAt,
    recordCount: staged.recordCount,
    issueCount: staged.issueCount,
    publicationStatus: "staged-only",
    ...staged.markerFields,
  });

  return {
    sourceId: source.id,
    adapterId: adapter.id,
    snapshotSha256: acquisition.manifest.sha256,
    unchanged: acquisition.unchanged,
    stagedRecordCount: staged.recordCount,
    ...staged.summaryFields,
    stagedIssueCount: staged.issueCount,
    validatedAt,
    publicationStatus: "staged-only",
    note: "No canonical catalog files were changed or published.",
  };
}

async function main() {
  const options = parseAcquisitionArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  console.log(JSON.stringify(await acquireAssayIndexSource(options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`AssayIndex acquisition failed: ${error.message}`);
    process.exitCode = 1;
  });
}
