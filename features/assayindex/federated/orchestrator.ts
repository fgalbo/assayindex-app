import { createHash } from "node:crypto";

import { getFederatedSearchConfig } from "@/features/assayindex/federated/config.server";
import { SourceTimeoutError } from "@/features/assayindex/federated/http.server";
import {
  assertCompleteAdapterRegistry,
  createLaboratorySourceAdapterRegistry,
  type LaboratorySourceAdapterRegistry,
} from "@/features/assayindex/federated/registry";
import {
  parsedSourceOfferingSchema,
  rawSourceSnapshotSchema,
  sourceSearchReferenceSchema,
} from "@/features/assayindex/federated/schema";
import {
  LABORATORY_SOURCE_IDS,
  type FederatedSearchResponse,
  type LaboratorySourceId,
  type SourceSearchReference,
  type SourceSearchResult,
} from "@/features/assayindex/federated/types";

type CacheEntry = {
  expiresAt: number;
  results: SourceSearchReference[];
};

export interface FederatedSearchCache {
  get(key: string, now: number): SourceSearchReference[] | null;
  set(key: string, results: SourceSearchReference[], expiresAt: number): void;
}

export class MemoryFederatedSearchCache implements FederatedSearchCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly maximumEntries = 200) {}

  get(key: string, now: number) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.results);
  }

  set(key: string, results: SourceSearchReference[], expiresAt: number) {
    this.entries.delete(key);
    this.entries.set(key, { expiresAt, results: structuredClone(results) });
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}

class SourceRateLimitError extends Error {
  constructor() {
    super("The source request rate limit was reached.");
    this.name = "SourceRateLimitError";
  }
}

class SourceExecutionGate {
  private active = 0;
  private windowStartedAt = 0;
  private windowCount = 0;

  constructor(
    private readonly maximumConcurrency = 2,
    private readonly maximumPerMinute = 30,
  ) {}

  async run<T>(operation: () => Promise<T>, now = Date.now()) {
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= this.maximumPerMinute) throw new SourceRateLimitError();
    if (this.active >= this.maximumConcurrency) throw new SourceRateLimitError();
    this.windowCount += 1;
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
}

export class FederatedRefreshNotAuthorizedError extends Error {
  constructor() {
    super("Forced source refresh requires an authenticated curator backend.");
    this.name = "FederatedRefreshNotAuthorizedError";
  }
}

export class FederatedInvalidSourceReferenceError extends Error {
  constructor() {
    super("The source reference is invalid.");
    this.name = "FederatedInvalidSourceReferenceError";
  }
}

export class FederatedSourceResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FederatedSourceResponseError";
  }
}

const defaultCache = new MemoryFederatedSearchCache();
const defaultGates = Object.fromEntries(
  LABORATORY_SOURCE_IDS.map((sourceId) => [sourceId, new SourceExecutionGate()]),
) as Record<LaboratorySourceId, SourceExecutionGate>;

function normalizedQuery(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 120) {
    throw new Error("Federated search query must be between 2 and 120 characters.");
  }
  return normalized;
}

function logEvent(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...fields }));
}

function statusResult(
  status: Exclude<SourceSearchResult["status"], "success">,
  message: string | null,
  officialDirectoryUrl: string,
): SourceSearchResult {
  return { status, cached: false, results: [], message, officialDirectoryUrl };
}

function errorStatus(error: unknown, officialDirectoryUrl: string): SourceSearchResult {
  if (error instanceof SourceTimeoutError) {
    return statusResult("timeout", "The source request timed out.", officialDirectoryUrl);
  }
  if (error instanceof SourceRateLimitError) {
    return statusResult("rate-limited", error.message, officialDirectoryUrl);
  }
  return statusResult(
    "source-unavailable",
    "The source could not be reached or returned an invalid response.",
    officialDirectoryUrl,
  );
}

export async function searchLaboratorySources(
  input: {
    query: string;
    sources: LaboratorySourceId[];
    requestId: string;
    refresh?: boolean;
  },
  dependencies: {
    registry?: LaboratorySourceAdapterRegistry;
    cache?: FederatedSearchCache;
    now?: () => number;
    cacheTtlSeconds?: number;
    gates?: Partial<Record<LaboratorySourceId, SourceExecutionGate>>;
  } = {},
): Promise<FederatedSearchResponse> {
  if (input.refresh) throw new FederatedRefreshNotAuthorizedError();
  const query = normalizedQuery(input.query);
  const requested = new Set(input.sources);
  const orderedSources = LABORATORY_SOURCE_IDS.filter((sourceId) => requested.has(sourceId));
  if (orderedSources.length === 0) throw new Error("At least one laboratory source is required.");
  const registry = assertCompleteAdapterRegistry(
    dependencies.registry ?? createLaboratorySourceAdapterRegistry(),
  );
  const cache = dependencies.cache ?? defaultCache;
  const now = dependencies.now?.() ?? Date.now();
  const ttlSeconds = dependencies.cacheTtlSeconds ?? getFederatedSearchConfig().cacheTtlSeconds;
  const sourceResults: FederatedSearchResponse["sources"] = {};

  logEvent("federated_search_started", {
    requestId: input.requestId,
    sourceCount: orderedSources.length,
  });

  const entries = await Promise.all(orderedSources.map(async (sourceId) => {
    const adapter = registry[sourceId];
    if (adapter.status !== "enabled") {
      return [
        sourceId,
        statusResult(adapter.status, adapter.statusMessage, adapter.officialDirectoryUrl),
      ] as const;
    }

    const cacheKey = `${sourceId}:${adapter.adapterVersion}:${query.toLocaleLowerCase("en-US")}`;
    const cached = cache.get(cacheKey, now);
    if (cached) {
      logEvent("source_search_cache_hit", { requestId: input.requestId, sourceId, resultCount: cached.length });
      return [sourceId, {
        status: "success",
        cached: true,
        results: cached,
        message: null,
        officialDirectoryUrl: adapter.officialDirectoryUrl,
      }] as const;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    try {
      const gate = dependencies.gates?.[sourceId] ?? defaultGates[sourceId];
      const results = await gate.run(() => adapter.search(query, {
        requestId: input.requestId,
        signal: controller.signal,
        cacheMode: "default",
      }), now);
      const validated = results.map((result) => {
        const parsed = sourceSearchReferenceSchema.parse(result);
        if (parsed.sourceLab !== sourceId) {
          throw new FederatedSourceResponseError(
            `The ${sourceId} adapter returned a result for ${parsed.sourceLab}.`,
          );
        }
        return parsed;
      });
      cache.set(cacheKey, validated, now + ttlSeconds * 1_000);
      logEvent("source_search_succeeded", {
        requestId: input.requestId,
        sourceId,
        resultCount: validated.length,
        durationMs: Date.now() - startedAt,
      });
      return [sourceId, {
        status: "success",
        cached: false,
        results: validated,
        message: null,
        officialDirectoryUrl: adapter.officialDirectoryUrl,
      }] as const;
    } catch (error) {
      const failure = errorStatus(error, adapter.officialDirectoryUrl);
      logEvent(
        failure.status === "timeout" ? "source_search_timed_out" : "source_search_failed",
        {
          requestId: input.requestId,
          sourceId,
          status: failure.status,
          durationMs: Date.now() - startedAt,
        },
      );
      return [sourceId, failure] as const;
    } finally {
      controller.abort();
    }
  }));
  for (const [sourceId, result] of entries) sourceResults[sourceId] = result;

  logEvent("federated_search_completed", {
    requestId: input.requestId,
    sourceCount: orderedSources.length,
    successCount: Object.values(sourceResults).filter((result) => result?.status === "success").length,
  });

  return {
    requestId: input.requestId,
    query,
    searchedAt: new Date(now).toISOString(),
    sources: sourceResults,
  };
}

export async function fetchLaboratorySourceDetails(
  input: {
    sourceLab: LaboratorySourceId;
    sourceRef: string;
    requestId: string;
    refresh?: boolean;
  },
  dependencies: {
    registry?: LaboratorySourceAdapterRegistry;
  } = {},
) {
  if (input.refresh) throw new FederatedRefreshNotAuthorizedError();
  const registry = assertCompleteAdapterRegistry(
    dependencies.registry ?? createLaboratorySourceAdapterRegistry(),
  );
  const adapter = registry[input.sourceLab];
  if (adapter.status !== "enabled") {
    return {
      requestId: input.requestId,
      sourceLab: input.sourceLab,
      status: adapter.status,
      message: adapter.statusMessage,
      parsed: null,
    } as const;
  }

  let reference: SourceSearchReference;
  try {
    reference = sourceSearchReferenceSchema.parse(adapter.resolveReference(input.sourceRef));
  } catch {
    throw new FederatedInvalidSourceReferenceError();
  }
  const controller = new AbortController();
  try {
    const rawSnapshot = await defaultGates[input.sourceLab].run(() => adapter.fetchDetails(reference, {
      requestId: input.requestId,
      signal: controller.signal,
      cacheMode: "default",
    }));
    let snapshot;
    let parsed;
    try {
      snapshot = rawSourceSnapshotSchema.parse(rawSnapshot);
      if (
        snapshot.sourceLab !== input.sourceLab ||
        snapshot.sourceRef !== reference.sourceRef ||
        createHash("sha256").update(snapshot.body).digest("hex") !== snapshot.contentHash
      ) {
        throw new Error("Source snapshot identity or content hash does not match the request.");
      }
      parsed = parsedSourceOfferingSchema.parse(await adapter.parse(snapshot));
      if (
        parsed.sourceLab !== input.sourceLab ||
        parsed.sourceRef !== snapshot.sourceRef ||
        parsed.sourceUrl !== snapshot.sourceUrl ||
        parsed.contentHash !== snapshot.contentHash ||
        parsed.fetchedAt !== snapshot.fetchedAt ||
        parsed.adapterVersion !== adapter.adapterVersion ||
        parsed.parserVersion !== adapter.parserVersion
      ) {
        throw new Error("Parsed source details do not match the validated snapshot.");
      }
    } catch (error) {
      throw new FederatedSourceResponseError(
        error instanceof Error ? error.message : "The source returned an invalid response.",
      );
    }
    return {
      requestId: input.requestId,
      sourceLab: input.sourceLab,
      status: "success" as const,
      message: null,
      snapshot: {
        sourceLab: snapshot.sourceLab,
        sourceRef: snapshot.sourceRef,
        sourceUrl: snapshot.sourceUrl,
        fetchedAt: snapshot.fetchedAt,
        mediaType: snapshot.mediaType,
        contentHash: snapshot.contentHash,
      },
      parsed,
      curator: {
        status: "not-configured" as const,
        message: "Secure shared candidate persistence and curator authentication are staged for a later round.",
      },
    };
  } finally {
    controller.abort();
  }
}
