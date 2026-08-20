import { cp, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { PROJECT_ROOT, RUNTIME_ROOT } from "./acquisition/runtime.mjs";

const DEFAULT_TARGETS = Object.freeze([
  resolve(PROJECT_ROOT, "features/assayindex/data/published/source-offering-slices"),
  resolve(PROJECT_ROOT, "features/assayindex/data/published/source-offering-slices.generated.ts"),
  resolve(PROJECT_ROOT, "features/assayindex/data/published/release.json"),
  resolve(PROJECT_ROOT, "public/assayindex"),
  resolve(RUNTIME_ROOT, "generated-source-offering-slices"),
]);
const DEFAULT_TRANSACTION_ROOT = resolve(RUNTIME_ROOT, "public-update-transactions");

function isWithin(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function normalizeTransactionInputs(targets, transactionRoot) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("A public update transaction requires at least one target.");
  }
  const normalizedTargets = targets.map((target) => {
    if (typeof target !== "string" || !target.trim()) {
      throw new Error("Public update transaction targets must be non-empty paths.");
    }
    const normalized = resolve(PROJECT_ROOT, target);
    if (normalized === PROJECT_ROOT || !isWithin(PROJECT_ROOT, normalized)) {
      throw new Error(`Refusing public update transaction target outside the project: ${normalized}`);
    }
    return normalized;
  });
  if (new Set(normalizedTargets).size !== normalizedTargets.length) {
    throw new Error("Public update transaction targets must be unique.");
  }
  for (const target of normalizedTargets) {
    if (normalizedTargets.some(
      (candidate) => candidate !== target && isWithin(candidate, target),
    )) {
      throw new Error("Public update transaction targets must not overlap.");
    }
  }

  const normalizedTransactionRoot = resolve(PROJECT_ROOT, transactionRoot);
  if (!isWithin(RUNTIME_ROOT, normalizedTransactionRoot)) {
    throw new Error(
      `Public update transaction storage must remain under ${RUNTIME_ROOT}.`,
    );
  }
  if (normalizedTargets.some((target) =>
    isWithin(target, normalizedTransactionRoot) || isWithin(normalizedTransactionRoot, target))) {
    throw new Error("Public update transaction storage must not overlap a transaction target.");
  }
  return { targets: normalizedTargets, transactionRoot: normalizedTransactionRoot };
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function restoreTargets(entries) {
  const failures = [];
  for (const entry of entries.toReversed()) {
    try {
      await rm(entry.target, { recursive: true, force: true });
      if (entry.existed) {
        await mkdir(dirname(entry.target), { recursive: true });
        await cp(entry.backup, entry.target, {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      }
    } catch (error) {
      failures.push(new Error(`Failed to restore ${entry.target}: ${error.message}`, { cause: error }));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "AssayIndex public update rollback was incomplete.");
  }
}

export async function withPublicUpdateTransaction(
  operation,
  { targets = DEFAULT_TARGETS, transactionRoot = DEFAULT_TRANSACTION_ROOT } = {},
) {
  if (typeof operation !== "function") {
    throw new Error("A public update transaction requires an operation function.");
  }
  const normalized = normalizeTransactionInputs(targets, transactionRoot);
  await mkdir(normalized.transactionRoot, { recursive: true });
  const transactionDirectory = await mkdtemp(join(normalized.transactionRoot, "transaction-"));
  const entries = [];

  try {
    for (const [index, target] of normalized.targets.entries()) {
      const existed = await pathExists(target);
      const backup = join(transactionDirectory, `target-${index}`);
      if (existed) {
        await cp(target, backup, {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      }
      entries.push({ backup, existed, target });
    }
  } catch (error) {
    await rm(transactionDirectory, { recursive: true, force: true });
    throw new Error(`Failed to snapshot AssayIndex public update targets: ${error.message}`, {
      cause: error,
    });
  }

  let result;
  try {
    result = await operation();
  } catch (operationError) {
    try {
      await restoreTargets(entries);
      await rm(transactionDirectory, { recursive: true, force: true });
    } catch (rollbackError) {
      throw new AggregateError(
        [operationError, rollbackError],
        `AssayIndex public update failed and rollback requires manual recovery from ${transactionDirectory}.`,
      );
    }
    throw operationError;
  }
  await rm(transactionDirectory, { recursive: true, force: true });
  return result;
}
