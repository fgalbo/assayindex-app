import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { describe, expect, it, vi } from "vitest";

import sourceRegistryJson from "@/features/assayindex/acquisition/source-registry.json";
import {
  RUNTIME_ROOT,
  resolveWithinRuntime,
} from "@/scripts/assayindex/acquisition/runtime.mjs";
import { withPublicUpdateTransaction } from "@/scripts/assayindex/public-update-transaction.mjs";
import * as updaterModule from "@/scripts/update-assayindex-sources.mjs";

type Registry = typeof sourceRegistryJson;
type RegistrySource = Registry["sources"][number];
type UpdateArguments = {
  all: boolean;
  sourceId: string | null;
  allowNetwork: boolean;
  write: boolean;
  help: boolean;
};
type UpdatePlan = {
  targets: Array<RegistrySource | { source: RegistrySource }>;
  skipped: Array<{
    sourceId: string;
    status: "skipped";
    reason: "source_disabled" | "permission_not_approved";
  }>;
};
type UpdateResultEntry = {
  sourceId: string;
  status: "skipped" | "staged-only" | "promotion-preflighted" | "published";
  reason: string | null;
  acquisition?: unknown;
  promotion?: unknown;
  promotionPreflight?: unknown;
};
type RunnerDependencies = {
  acquireSource: (input: { source: RegistrySource }) => Promise<unknown>;
  promoteSource: (input: { sourceId: string; write: boolean }) => Promise<unknown>;
  syncCatalog: () => Promise<unknown>;
  withPublicUpdateTransaction: (operation: () => Promise<void>) => Promise<void>;
};
type UpdateOptions = {
  all?: boolean;
  sourceId?: string | null;
  allowNetwork?: boolean;
  write?: boolean;
  registry?: Registry;
  dependencies?: RunnerDependencies;
};

const { parseUpdateArguments, planSourceUpdates, updateAssayIndexSources } = updaterModule as unknown as {
  parseUpdateArguments: (argv: string[]) => UpdateArguments;
  planSourceUpdates: (options: {
    registry: Registry;
    all?: boolean;
    sourceId?: string | null;
  }) => UpdatePlan;
  updateAssayIndexSources: (options?: UpdateOptions) => Promise<{
    mode: "all" | "source";
    write: boolean;
    results: UpdateResultEntry[];
    synced: boolean;
  }>;
};

const GTR_TEST_VERSION = "nih-gtr-test-version";
const GTR_CONDITION_GENE = "nih-gtr-test-condition-gene";
const CDC_TEST_DIRECTORY = "cdc-infectious-diseases-test-directory";
const UNAPPROVED_SOURCE = "unit-unapproved-source";

function registryFixture(): Registry {
  const registry = structuredClone(sourceRegistryJson);
  const template = registry.sources.find((source) => source.id === GTR_TEST_VERSION)!;
  registry.sources.push({
    ...template,
    id: UNAPPROVED_SOURCE,
    enabled: true,
    priority: 12,
    permissionStatus: "not-approved",
  });
  return registry;
}

function targetSource(target: RegistrySource | { source: RegistrySource }): RegistrySource {
  return "source" in target ? target.source : target;
}

function runnerFixture(options: {
  acquisitionFailureSourceId?: string;
  preflightFailureSourceId?: string;
  syncFailure?: boolean;
} = {}) {
  const events: string[] = [];
  const acquireSource = vi.fn(async ({ source }: { source: RegistrySource }) => {
    events.push(`acquire:${source.id}`);
    if (source.id === options.acquisitionFailureSourceId) {
      throw new Error(`acquisition failed for ${source.id}`);
    }
    return {
      publicationStatus: "staged-only",
      sourceId: source.id,
    };
  });
  const promoteSource = vi.fn(async ({ sourceId, write }: { sourceId: string; write: boolean }) => {
    events.push(`promote:${sourceId}:${write ? "write" : "preflight"}`);
    if (!write && sourceId === options.preflightFailureSourceId) {
      throw new Error(`promotion preflight failed for ${sourceId}`);
    }
    return { sourceId, wrote: write };
  });
  const syncCatalog = vi.fn(async () => {
    events.push("sync");
    if (options.syncFailure) throw new Error("catalog sync failed");
    return { synced: true };
  });
  const withPublicUpdateTransaction = vi.fn(async (operation: () => Promise<void>) => {
    events.push("transaction:start");
    try {
      await operation();
      events.push("transaction:commit");
    } catch (error) {
      events.push("transaction:rollback");
      throw error;
    }
  });

  return {
    dependencies: {
      acquireSource,
      promoteSource,
      syncCatalog,
      withPublicUpdateTransaction,
    },
    events,
  };
}

describe("AssayIndex source updater", () => {
  it("parses exactly one selector, an explicit network gate, and optional writes", () => {
    expect(parseUpdateArguments(["--all", "--allow-network"])).toEqual({
      all: true,
      sourceId: null,
      allowNetwork: true,
      write: false,
      help: false,
    });
    expect(
      parseUpdateArguments([
        "--source",
        CDC_TEST_DIRECTORY,
        "--allow-network",
        "--write",
      ]),
    ).toEqual({
      all: false,
      sourceId: CDC_TEST_DIRECTORY,
      allowNetwork: true,
      write: true,
      help: false,
    });

    expect(() => parseUpdateArguments(["--allow-network"])).toThrow(/--all|--source/i);
    expect(() =>
      parseUpdateArguments(["--all", "--source", CDC_TEST_DIRECTORY, "--allow-network"]),
    ).toThrow(/exactly one|--all|--source/i);
    expect(() => parseUpdateArguments(["--all"])).toThrow(/network|allow-network/i);
  });

  it("refuses orchestration without the explicit network gate before invoking a runner", async () => {
    const runners = runnerFixture();

    await expect(
      updateAssayIndexSources({
        registry: registryFixture(),
        all: true,
        allowNetwork: false,
        dependencies: runners.dependencies,
      }),
    ).rejects.toThrow(/network|allow-network/i);
    expect(runners.events).toEqual([]);
  });

  it("plans --all deterministically and explicitly accounts for disabled and unapproved sources", () => {
    const registry = registryFixture();
    const first = planSourceUpdates({ registry, all: true });
    const second = planSourceUpdates({ registry, all: true });

    expect(second).toEqual(first);
    expect(first.targets.map((target) => targetSource(target).id)).toEqual([
      GTR_TEST_VERSION,
      GTR_CONDITION_GENE,
      CDC_TEST_DIRECTORY,
    ]);
    expect(first.skipped).toEqual([
      {
        sourceId: UNAPPROVED_SOURCE,
        status: "skipped",
        reason: "permission_not_approved",
      },
      {
        sourceId: "nih-gtr-data-api",
        status: "skipped",
        reason: "source_disabled",
      },
      {
        sourceId: "arup-curated-catalog",
        status: "skipped",
        reason: "source_disabled",
      },
      {
        sourceId: "labcorp-curated-catalog",
        status: "skipped",
        reason: "source_disabled",
      },
      {
        sourceId: "mayo-clinic-labs-curated-catalog",
        status: "skipped",
        reason: "source_disabled",
      },
      {
        sourceId: "quest-curated-catalog",
        status: "skipped",
        reason: "source_disabled",
      },
    ]);
    expect(first.targets.length + first.skipped.length).toBe(registry.sources.length);
  });

  it("configures only the exact CDC source for promotion", () => {
    const cdcSource = sourceRegistryJson.sources.find(
      (source) => source.id === CDC_TEST_DIRECTORY,
    );
    const gtrSources = sourceRegistryJson.sources.filter(
      (source) => source.publisherId === "nih-gtr",
    );

    expect(cdcSource?.promotionAdapterId).toBe(CDC_TEST_DIRECTORY);
    expect(gtrSources).not.toHaveLength(0);
    expect(gtrSources.every((source) => source.promotionAdapterId === null)).toBe(true);
  });

  it("selects one exact source and rejects unknown, disabled, or unapproved selections", () => {
    const registry = registryFixture();
    const plan = planSourceUpdates({ registry, sourceId: CDC_TEST_DIRECTORY });

    expect(plan.targets.map((target) => targetSource(target).id)).toEqual([CDC_TEST_DIRECTORY]);
    expect(plan.skipped).toEqual([]);
    expect(() => planSourceUpdates({ registry, sourceId: "unknown-source" })).toThrow(
      /unknown.*source/i,
    );
    expect(() => planSourceUpdates({ registry, sourceId: "nih-gtr-data-api" })).toThrow(
      /disabled/i,
    );
    expect(() => planSourceUpdates({ registry, sourceId: UNAPPROVED_SOURCE })).toThrow(
      /permission|approved/i,
    );
  });

  it.each([
    {
      label: "unknown acquisition adapter",
      mutate(source: RegistrySource) {
        source.adapterId = "unit-unknown-acquisition-adapter";
      },
      expected: /unknown.*acquisition adapter/i,
    },
    {
      label: "missing promotion adapter",
      mutate(source: RegistrySource) {
        source.promotionAdapterId = null;
      },
      expected: /promotion adapter/i,
    },
    {
      label: "unknown promotion adapter",
      mutate(source: RegistrySource) {
        source.promotionAdapterId = "unit-unknown-promotion-adapter";
      },
      expected: /unknown.*promotion adapter/i,
    },
  ])("rejects a release-approved source with $label before acquisition", async ({ mutate, expected }) => {
    const registry = registryFixture();
    const cdcSource = registry.sources.find((source) => source.id === CDC_TEST_DIRECTORY)!;
    mutate(cdcSource);
    const runners = runnerFixture();

    await expect(
      updateAssayIndexSources({
        registry,
        sourceId: CDC_TEST_DIRECTORY,
        allowNetwork: true,
        write: false,
        dependencies: runners.dependencies,
      }),
    ).rejects.toThrow(expected);
    expect(runners.events).toEqual([]);
  });

  it("rejects an unknown permission status before invoking any runner", async () => {
    const registry = registryFixture();
    const source = registry.sources.find((candidate) => candidate.id === CDC_TEST_DIRECTORY)!;
    (source as unknown as { permissionStatus: string }).permissionStatus =
      "future-permission-status";
    const runners = runnerFixture();

    await expect(
      updateAssayIndexSources({
        registry,
        sourceId: CDC_TEST_DIRECTORY,
        allowNetwork: true,
        write: true,
        dependencies: runners.dependencies,
      }),
    ).rejects.toThrow(/permission.*not approved/i);

    expect(runners.events).toEqual([]);
    expect(runners.dependencies.acquireSource).not.toHaveBeenCalled();
    expect(runners.dependencies.promoteSource).not.toHaveBeenCalled();
    expect(runners.dependencies.withPublicUpdateTransaction).not.toHaveBeenCalled();
    expect(runners.dependencies.syncCatalog).not.toHaveBeenCalled();
  });

  it("keeps release-disabled GTR sources staged-only and never promotes them", async () => {
    const registry = registryFixture();
    const runners = runnerFixture();

    const result = await updateAssayIndexSources({
      registry,
      sourceId: GTR_TEST_VERSION,
      allowNetwork: true,
      write: true,
      dependencies: runners.dependencies,
    });

    expect(result).toMatchObject({ mode: "source", write: true, synced: true });
    expect(result.results).toEqual([
      expect.objectContaining({
        sourceId: GTR_TEST_VERSION,
        status: "staged-only",
        reason: "release_disabled",
      }),
    ]);
    expect(runners.dependencies.acquireSource).toHaveBeenCalledOnce();
    expect(runners.dependencies.promoteSource).not.toHaveBeenCalled();
    expect(runners.dependencies.syncCatalog).toHaveBeenCalledOnce();
    expect(runners.events).toEqual([
      `acquire:${GTR_TEST_VERSION}`,
      "transaction:start",
      "sync",
      "transaction:commit",
    ]);
  });

  it("dry-runs CDC promotion after acquisition without a public write or sync", async () => {
    const registry = registryFixture();
    const runners = runnerFixture();

    const result = await updateAssayIndexSources({
      registry,
      sourceId: CDC_TEST_DIRECTORY,
      allowNetwork: true,
      write: false,
      dependencies: runners.dependencies,
    });

    expect(result).toMatchObject({ mode: "source", write: false, synced: false });
    expect(result.results).toEqual([
      expect.objectContaining({
        sourceId: CDC_TEST_DIRECTORY,
        status: "promotion-preflighted",
        reason: null,
      }),
    ]);
    expect(runners.events).toEqual([
      `acquire:${CDC_TEST_DIRECTORY}`,
      `promote:${CDC_TEST_DIRECTORY}:preflight`,
    ]);
    expect(runners.dependencies.syncCatalog).not.toHaveBeenCalled();
  });

  it("preflights all enabled sources before one write commit and one catalog sync", async () => {
    const registry = registryFixture();
    const runners = runnerFixture();

    const result = await updateAssayIndexSources({
      registry,
      all: true,
      allowNetwork: true,
      write: true,
      dependencies: runners.dependencies,
    });

    expect(result).toMatchObject({ mode: "all", write: true, synced: true });
    expect(runners.events).toEqual([
      `acquire:${GTR_TEST_VERSION}`,
      `acquire:${GTR_CONDITION_GENE}`,
      `acquire:${CDC_TEST_DIRECTORY}`,
      `promote:${CDC_TEST_DIRECTORY}:preflight`,
      "transaction:start",
      `promote:${CDC_TEST_DIRECTORY}:write`,
      "sync",
      "transaction:commit",
    ]);
    expect(result.results.find((entry) => entry.sourceId === CDC_TEST_DIRECTORY)).toMatchObject({
      status: "published",
      reason: null,
    });
    expect(runners.dependencies.syncCatalog).toHaveBeenCalledOnce();
    expect(runners.dependencies.withPublicUpdateTransaction).toHaveBeenCalledOnce();
  });

  it("syncs exactly once inside one write transaction when no source has a promoter", async () => {
    const registry = registryFixture();
    const cdcSource = registry.sources.find((source) => source.id === CDC_TEST_DIRECTORY)!;
    cdcSource.releaseEnabled = false;
    cdcSource.redistributionApproved = false;
    const runners = runnerFixture();

    const result = await updateAssayIndexSources({
      registry,
      all: true,
      allowNetwork: true,
      write: true,
      dependencies: runners.dependencies,
    });

    expect(result).toMatchObject({ mode: "all", write: true, synced: true });
    expect(runners.dependencies.promoteSource).not.toHaveBeenCalled();
    expect(runners.dependencies.withPublicUpdateTransaction).toHaveBeenCalledOnce();
    expect(runners.dependencies.syncCatalog).toHaveBeenCalledOnce();
    expect(runners.events).toEqual([
      `acquire:${GTR_TEST_VERSION}`,
      `acquire:${GTR_CONDITION_GENE}`,
      `acquire:${CDC_TEST_DIRECTORY}`,
      "transaction:start",
      "sync",
      "transaction:commit",
    ]);
  });

  it("keeps a sync failure inside the single public-write transaction", async () => {
    const runners = runnerFixture({ syncFailure: true });

    await expect(
      updateAssayIndexSources({
        registry: registryFixture(),
        all: true,
        allowNetwork: true,
        write: true,
        dependencies: runners.dependencies,
      }),
    ).rejects.toThrow(/catalog sync failed/i);

    expect(runners.dependencies.withPublicUpdateTransaction).toHaveBeenCalledOnce();
    expect(runners.events).toEqual([
      `acquire:${GTR_TEST_VERSION}`,
      `acquire:${GTR_CONDITION_GENE}`,
      `acquire:${CDC_TEST_DIRECTORY}`,
      `promote:${CDC_TEST_DIRECTORY}:preflight`,
      "transaction:start",
      `promote:${CDC_TEST_DIRECTORY}:write`,
      "sync",
      "transaction:rollback",
    ]);
  });

  it("accounts for every --all registry entry exactly once without silent skips", async () => {
    const registry = registryFixture();
    const runners = runnerFixture();

    const result = await updateAssayIndexSources({
      registry,
      all: true,
      allowNetwork: true,
      write: false,
      dependencies: runners.dependencies,
    });
    const sourceIds = result.results.map((entry) => entry.sourceId);

    expect(result.results).toHaveLength(registry.sources.length);
    expect(new Set(sourceIds).size).toBe(registry.sources.length);
    expect(sourceIds.toSorted()).toEqual(registry.sources.map((source) => source.id).toSorted());
    expect(
      result.results
        .filter((entry) => entry.status === "skipped" || entry.status === "staged-only")
        .every((entry) => typeof entry.reason === "string" && entry.reason.length > 0),
    ).toBe(true);
  });

  it.each([
    {
      label: "acquisition",
      options: { acquisitionFailureSourceId: GTR_CONDITION_GENE },
      expected: /acquisition failed.*nih-gtr-test-condition-gene/i,
    },
    {
      label: "promotion preflight",
      options: { preflightFailureSourceId: CDC_TEST_DIRECTORY },
      expected: /promotion preflight failed.*cdc-infectious-diseases-test-directory/i,
    },
  ])("performs no public write or sync after a $label failure", async ({ options, expected }) => {
    const registry = registryFixture();
    const runners = runnerFixture(options);

    await expect(
      updateAssayIndexSources({
        registry,
        all: true,
        allowNetwork: true,
        write: true,
        dependencies: runners.dependencies,
      }),
    ).rejects.toThrow(expected);

    expect(
      runners.dependencies.promoteSource.mock.calls.some(
        ([input]) => (input as { write: boolean }).write,
      ),
    ).toBe(false);
    expect(runners.dependencies.syncCatalog).not.toHaveBeenCalled();
    expect(runners.dependencies.withPublicUpdateTransaction).not.toHaveBeenCalled();
  });

  it("rolls back an existing file, removes a new directory target, and cleans transaction state", async () => {
    const unitRoot = resolveWithinRuntime(`unit-public-update-${randomUUID()}`);
    const existingTarget = resolve(unitRoot, "published", "existing.json");
    const newTarget = resolve(unitRoot, "generated-slice");
    const transactionRoot = resolve(unitRoot, "transactions");

    expect(unitRoot.startsWith(`${RUNTIME_ROOT}${sep}unit-`)).toBe(true);
    await mkdir(dirname(existingTarget), { recursive: true });
    await writeFile(existingTarget, "before\n", "utf8");

    try {
      await expect(
        withPublicUpdateTransaction(
          async () => {
            await writeFile(existingTarget, "after\n", "utf8");
            await mkdir(newTarget, { recursive: true });
            await writeFile(resolve(newTarget, "offering.json"), "new\n", "utf8");
            throw new Error("second promoter write failed");
          },
          { targets: [existingTarget, newTarget], transactionRoot },
        ),
      ).rejects.toThrow(/second promoter write failed/i);

      expect(await readFile(existingTarget, "utf8")).toBe("before\n");
      await expect(lstat(newTarget)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(transactionRoot)).toEqual([]);
    } finally {
      if (!unitRoot.startsWith(`${RUNTIME_ROOT}${sep}unit-`)) {
        throw new Error(`Refusing unsafe unit fixture cleanup: ${unitRoot}`);
      }
      await rm(unitRoot, { recursive: true, force: true });
    }
  });

  it("keeps public CI offline while preserving the shared updater command", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const workflow = await readFile(
      resolve(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8",
    );

    expect(packageJson.scripts["update:assayindex-sources"]).toBe(
      "node ./scripts/update-assayindex-sources.mjs",
    );
    expect(workflow).not.toContain("update:assayindex-sources");
    expect(workflow).not.toContain("--allow-network");
    expect(workflow).not.toContain("npm run acquire:assayindex");
    expect(workflow).not.toContain("npm run promote:assayindex-source");

    const requiredVerificationCommands = [
      "npm run verify:public-export",
      "npm run test:assayindex-acquisition",
      "npm test -- tests/assayindex",
      "npm run typecheck",
      "npm run lint",
      "npm run build",
    ];
    let previousCommandIndex = -1;
    for (const command of requiredVerificationCommands) {
      const commandIndex = workflow.indexOf(command);
      expect(commandIndex, `${command} must run in public CI order`).toBeGreaterThan(
        previousCommandIndex,
      );
      previousCommandIndex = commandIndex;
    }
  });
});
