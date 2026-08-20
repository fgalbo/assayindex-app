#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canAcquireSource,
  canRedistributeSource,
} from "../features/assayindex/acquisition/source-policy.ts";
import { acquireAssayIndexSource } from "./acquire-assayindex.mjs";
import { requireAcquisitionAdapter } from "./assayindex/acquisition/adapters.mjs";
import { loadSourceRegistry } from "./assayindex/acquisition/source-registry.mjs";
import { withPublicUpdateTransaction as runPublicUpdateTransaction } from "./assayindex/public-update-transaction.mjs";
import {
  buildSourcePromotion,
  requireSourcePromotionAdapter,
} from "./promote-assayindex-source.mjs";
import { syncAssayIndexCatalog } from "./sync-assayindex-catalog.mjs";

function usage() {
  return [
    "Usage: node scripts/update-assayindex-sources.mjs (--all | --source <id>) --allow-network [--write]",
    "",
    "Acquires every selected source into private staging, preflights every explicitly configured",
    "and release-approved promotion, and only writes public artifacts when --write is present.",
  ].join("\n");
}

export function parseUpdateArguments(argv) {
  const options = {
    all: false,
    sourceId: null,
    allowNetwork: false,
    write: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") {
      if (options.all) throw new Error("--all may only be provided once.");
      options.all = true;
    } else if (argument === "--source") {
      if (options.sourceId !== null) throw new Error("--source may only be provided once.");
      const sourceId = argv[++index];
      if (!sourceId || sourceId.startsWith("--")) {
        throw new Error("--source requires a registered source id.");
      }
      options.sourceId = sourceId;
    } else if (argument === "--allow-network") {
      options.allowNetwork = true;
    } else if (argument === "--write") {
      options.write = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.help) return options;
  if (options.all === Boolean(options.sourceId)) {
    throw new Error("Select exactly one of --all or --source <id>.");
  }
  if (!options.allowNetwork) {
    throw new Error("Network acquisition is disabled. Re-run with the explicit --allow-network gate.");
  }
  return options;
}

function sourceOrder(left, right) {
  return left.priority - right.priority || left.id.localeCompare(right.id);
}

function requireValidTarget(source) {
  const acquisition = canAcquireSource(source);
  if (acquisition.allowed) {
    if (!source.adapterId) {
      throw new Error(`Enabled acquisition source has no adapter: ${source.id}`);
    }
    return source;
  }
  if (acquisition.reason === "source_disabled") {
    throw new Error(`Acquisition source is disabled: ${source.id}`);
  }
  if (acquisition.reason === "permission_not_approved") {
    throw new Error(`Acquisition source permission is not approved: ${source.id}`);
  }
  throw new Error(`Acquisition source ${source.id} is blocked: ${acquisition.reason}`);
}

export function planSourceUpdates({ registry, all = false, sourceId = null }) {
  if (!registry || !Array.isArray(registry.sources)) {
    throw new Error("AssayIndex source registry must contain a sources array.");
  }
  if (all === Boolean(sourceId)) {
    throw new Error("Select exactly one source update mode.");
  }

  if (sourceId) {
    const source = registry.sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error(`Unknown acquisition source: ${sourceId}`);
    return { targets: [requireValidTarget(source)], skipped: [] };
  }

  const targets = [];
  const skipped = [];
  for (const source of registry.sources.toSorted(sourceOrder)) {
    const acquisition = canAcquireSource(source);
    if (!acquisition.allowed) {
      skipped.push({
        sourceId: source.id,
        status: "skipped",
        reason: acquisition.reason,
      });
    } else {
      targets.push(requireValidTarget(source));
    }
  }
  return { targets, skipped };
}

function promotionPlanForSource(source) {
  const redistribution = canRedistributeSource(source);
  if (!redistribution.allowed) {
    return { promote: false, reason: redistribution.reason };
  }
  if (!source.promotionAdapterId) {
    throw new Error(
      `Release-approved source ${source.id} has no promotion adapter configured.`,
    );
  }
  requireSourcePromotionAdapter(source);
  return { promote: true, reason: null };
}

function contextualError(phase, sourceId, error) {
  return new Error(
    `AssayIndex ${phase} failed for ${sourceId}: ${error?.message ?? String(error)}`,
    { cause: error },
  );
}

async function runSourcePhase(phase, sourceId, operation) {
  try {
    return await operation();
  } catch (error) {
    throw contextualError(phase, sourceId, error);
  }
}

export async function updateAssayIndexSources({
  all = false,
  sourceId = null,
  allowNetwork = false,
  write = false,
  registry: providedRegistry = null,
  dependencies = {},
} = {}) {
  if (!allowNetwork) {
    throw new Error("Network acquisition is disabled. Re-run with the explicit --allow-network gate.");
  }
  const registry = providedRegistry ?? await loadSourceRegistry();
  const plan = planSourceUpdates({ registry, all, sourceId });
  const acquireSource = dependencies.acquireSource ?? (({ source }) =>
    acquireAssayIndexSource({ sourceId: source.id, allowNetwork: true, registry }));
  const promoteSource = dependencies.promoteSource ?? ((options) =>
    buildSourcePromotion({ ...options, registry }));
  const syncCatalog = dependencies.syncCatalog ?? syncAssayIndexCatalog;
  const withPublicUpdateTransaction =
    dependencies.withPublicUpdateTransaction ?? runPublicUpdateTransaction;
  const acquisitionResults = new Map();
  const promotionPlans = new Map();
  const promotionPreflights = new Map();
  const publishedPromotions = new Map();

  for (const source of plan.targets) {
    try {
      requireAcquisitionAdapter(source);
      promotionPlans.set(source.id, promotionPlanForSource(source));
    } catch (error) {
      throw contextualError("configuration prevalidation", source.id, error);
    }
  }

  for (const source of plan.targets) {
    acquisitionResults.set(
      source.id,
      await runSourcePhase("acquisition", source.id, () => acquireSource({ source })),
    );
  }

  const promotionTargets = plan.targets.filter(
    (source) => promotionPlans.get(source.id).promote,
  );
  for (const source of promotionTargets) {
    promotionPreflights.set(
      source.id,
      await runSourcePhase("promotion preflight", source.id, () =>
        promoteSource({ sourceId: source.id, write: false })),
    );
  }

  if (write) {
    await withPublicUpdateTransaction(async () => {
      for (const source of promotionTargets) {
        publishedPromotions.set(
          source.id,
          await runSourcePhase("promotion write", source.id, () =>
            promoteSource({ sourceId: source.id, write: true })),
        );
      }
      try {
        await syncCatalog();
      } catch (error) {
        throw new Error(`AssayIndex public catalog sync failed: ${error.message}`, { cause: error });
      }
    });
  }
  const synced = write;

  const skippedById = new Map(plan.skipped.map((entry) => [entry.sourceId, entry]));
  const targetsById = new Map(plan.targets.map((source) => [source.id, source]));
  const orderedSources = (all
    ? registry.sources.toSorted(sourceOrder)
    : registry.sources.filter((source) => source.id === sourceId));
  const results = orderedSources.map((source) => {
    const skipped = skippedById.get(source.id);
    if (skipped) return skipped;
    const target = targetsById.get(source.id);
    if (!target) throw new Error(`Source update plan lost accounting for ${source.id}.`);
    const promotionPlan = promotionPlans.get(source.id);
    const acquisition = acquisitionResults.get(source.id);
    if (!promotionPlan.promote) {
      return {
        sourceId: source.id,
        status: "staged-only",
        reason: promotionPlan.reason,
        acquisition,
      };
    }
    return {
      sourceId: source.id,
      status: write ? "published" : "promotion-preflighted",
      reason: null,
      acquisition,
      promotion: write
        ? publishedPromotions.get(source.id)
        : promotionPreflights.get(source.id),
      promotionPreflight: promotionPreflights.get(source.id),
    };
  });

  return {
    mode: all ? "all" : "source",
    write,
    results,
    synced,
  };
}

async function main() {
  const options = parseUpdateArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  console.log(JSON.stringify(await updateAssayIndexSources(options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`AssayIndex source update failed: ${error.message}`);
    process.exitCode = 1;
  });
}
