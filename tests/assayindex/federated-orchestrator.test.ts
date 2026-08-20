import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SourceTimeoutError } from "@/features/assayindex/federated/http.server";
import {
  FederatedRefreshNotAuthorizedError,
  FederatedSourceResponseError,
  MemoryFederatedSearchCache,
  fetchLaboratorySourceDetails,
  searchLaboratorySources,
} from "@/features/assayindex/federated/orchestrator";
import {
  LABORATORY_SOURCE_IDS,
  assertCompleteAdapterRegistry,
  createLaboratorySourceAdapterRegistry,
} from "@/features/assayindex/federated/registry";
import { federatedDetailResponseSchema } from "@/features/assayindex/federated/schema";
import type {
  LaboratorySourceAdapter,
  LaboratorySourceId,
  ParsedSourceOffering,
  SourceAdapterStatus,
  SourceSearchReference,
} from "@/features/assayindex/federated/types";

const ARUP_REFERENCE: SourceSearchReference = {
  sourceLab: "arup",
  sourceRef: "arup:test:0095840",
  sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
  sourceTestCode: "0095840",
  title: "HLA-B27",
  summary: null,
  orderingRecommendation: null,
  sourceStatus: "A",
};
const OFFICIAL_SOURCE_BODY = "<p>official source body</p>";
const OFFICIAL_SOURCE_HASH = createHash("sha256").update(OFFICIAL_SOURCE_BODY).digest("hex");

function validParsedOffering(): ParsedSourceOffering {
  return {
    sourceLab: "arup",
    sourceRef: ARUP_REFERENCE.sourceRef,
    sourceUrl: ARUP_REFERENCE.sourceUrl,
    sourceTestCode: "0095840",
    sourceTitle: "HLA-B27",
    testName: "HLA-B27",
    aliases: [],
    analytes: [],
    genes: [],
    orderingRecommendation: null,
    methodology: "Qualitative Flow Cytometry",
    methodClass: null,
    measurementType: "Qualitative",
    specimenOptions: [],
    turnaroundTime: "1-2 days",
    performingSchedule: "Sun-Sat",
    performingLocation: null,
    cptCodes: ["86812"],
    loincCodes: ["26028-1"],
    resultComponents: [],
    reflexRules: [],
    clinicalUse: null,
    limitations: null,
    availability: null,
    serviceAreas: [],
    parseWarnings: [],
    fieldProvenance: {},
    parserVersion: "test-1",
    adapterVersion: "test-1",
    contentHash: OFFICIAL_SOURCE_HASH,
    fetchedAt: "2026-08-19T00:00:00.000Z",
  };
}

function adapter(
  id: LaboratorySourceId,
  status: SourceAdapterStatus,
  overrides: Partial<LaboratorySourceAdapter> = {},
): LaboratorySourceAdapter {
  const statusMessage = status === "enabled" ? null : `${id} is ${status}.`;
  return {
    id,
    displayName: id,
    sourcePolicyId: `${id}-policy`,
    officialDirectoryUrl: `https://${id}.example.test/directory`,
    status,
    adapterVersion: "test-1",
    parserVersion: "test-1",
    statusMessage,
    resolveReference: vi.fn(() => ({ ...ARUP_REFERENCE, sourceLab: id })),
    search: vi.fn(async () => []),
    fetchDetails: vi.fn(async () => {
      throw new Error("not used");
    }),
    parse: vi.fn(async () => {
      throw new Error("not used");
    }),
    ...overrides,
  };
}

function completeRegistry(
  overrides: Partial<Record<LaboratorySourceId, LaboratorySourceAdapter>> = {},
) {
  return {
    arup: adapter("arup", "enabled"),
    mayo: adapter("mayo", "permission-required"),
    quest: adapter("quest", "permission-required"),
    labcorp: adapter("labcorp", "permission-required"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("laboratory adapter registry", () => {
  it("provides one typed adapter for every supported source", () => {
    const registry = createLaboratorySourceAdapterRegistry({}, { env: {} });

    expect(LABORATORY_SOURCE_IDS).toEqual(["arup", "mayo", "quest", "labcorp"]);
    expect(Object.keys(registry)).toEqual(LABORATORY_SOURCE_IDS);
    expect(registry.arup.status).toBe("permission-required");
    expect(registry.mayo.status).toBe("official-directory-only");
    expect(registry.quest.status).toBe("official-directory-only");
    expect(registry.labcorp.status).toBe("official-directory-only");
    expect(() => assertCompleteAdapterRegistry(registry)).not.toThrow();
  });

  it("enables only ARUP when explicitly flagged and keeps directory handoffs actionable", () => {
    const registry = createLaboratorySourceAdapterRegistry({}, {
      env: {
        ASSAYINDEX_FEDERATED_SEARCH_ENABLED: "true",
        ASSAYINDEX_ARUP_SEARCH_ENABLED: "true",
        ASSAYINDEX_MAYO_SEARCH_ENABLED: "true",
        ASSAYINDEX_QUEST_SEARCH_ENABLED: "true",
        ASSAYINDEX_LABCORP_SEARCH_ENABLED: "true",
      },
    });

    expect(registry.arup.status).toBe("enabled");
    expect(registry.mayo.status).toBe("official-directory-only");
    expect(registry.quest.status).toBe("official-directory-only");
    expect(registry.labcorp.status).toBe("official-directory-only");
    expect(registry.mayo.officialDirectoryUrl).toBe("https://www.mayocliniclabs.com/test-catalog");
    expect(registry.quest.officialDirectoryUrl).toBe("https://testdirectory.questdiagnostics.com/test/home");
    expect(registry.labcorp.officialDirectoryUrl).toBe("https://www.labcorp.com/test-menu/search");
  });
});

describe("federated source orchestration", () => {
  it("isolates timeout and disabled states without failing a successful source", async () => {
    const arupSearch = vi.fn(async () => [ARUP_REFERENCE]);
    const questSearch = vi.fn(async () => {
      throw new SourceTimeoutError();
    });
    const mayoSearch = vi.fn(async () => []);
    const registry = completeRegistry({
      arup: adapter("arup", "enabled", { search: arupSearch }),
      mayo: adapter("mayo", "permission-required", { search: mayoSearch }),
      quest: adapter("quest", "enabled", { search: questSearch }),
    });

    const response = await searchLaboratorySources(
      {
        query: "  HLA-B27  ",
        sources: ["arup", "mayo", "quest", "labcorp"],
        requestId: "request-1",
      },
      {
        registry,
        cache: new MemoryFederatedSearchCache(),
        now: () => Date.parse("2026-08-19T00:00:00.000Z"),
      },
    );

    expect(response).toMatchObject({
      requestId: "request-1",
      query: "HLA-B27",
      searchedAt: "2026-08-19T00:00:00.000Z",
      sources: {
        arup: { status: "success", cached: false, results: [ARUP_REFERENCE] },
        mayo: { status: "permission-required", cached: false, results: [] },
        quest: { status: "timeout", cached: false, results: [] },
        labcorp: { status: "permission-required", cached: false, results: [] },
      },
    });
    expect(arupSearch).toHaveBeenCalledOnce();
    expect(questSearch).toHaveBeenCalledOnce();
    expect(mayoSearch).not.toHaveBeenCalled();
  });

  it("reuses a normalized-query cache and does not call the adapter twice", async () => {
    const search = vi.fn(async () => [ARUP_REFERENCE]);
    const registry = completeRegistry({ arup: adapter("arup", "enabled", { search }) });
    const cache = new MemoryFederatedSearchCache();
    const dependencies = {
      registry,
      cache,
      cacheTtlSeconds: 60,
      now: () => Date.parse("2026-08-19T00:00:00.000Z"),
    };

    const first = await searchLaboratorySources(
      { query: "HLA-B27", sources: ["arup"], requestId: "request-1" },
      dependencies,
    );
    const second = await searchLaboratorySources(
      { query: "  hla-b27 ", sources: ["arup"], requestId: "request-2" },
      dependencies,
    );

    expect(first.sources.arup?.cached).toBe(false);
    expect(second.sources.arup).toMatchObject({ cached: true, results: [ARUP_REFERENCE] });
    expect(search).toHaveBeenCalledOnce();
  });

  it("rejects a result attributed to a different laboratory source", async () => {
    const search = vi.fn(async () => [{ ...ARUP_REFERENCE, sourceLab: "quest" as const }]);
    const registry = completeRegistry({ arup: adapter("arup", "enabled", { search }) });

    const response = await searchLaboratorySources(
      { query: "HLA-B27", sources: ["arup"], requestId: "request-cross-source" },
      { registry, cache: new MemoryFederatedSearchCache() },
    );

    expect(response.sources.arup).toMatchObject({
      status: "source-unavailable",
      results: [],
      officialDirectoryUrl: "https://arup.example.test/directory",
    });
  });

  it("rejects forced refresh before any adapter request", async () => {
    const search = vi.fn(async () => [ARUP_REFERENCE]);
    const registry = completeRegistry({ arup: adapter("arup", "enabled", { search }) });

    await expect(
      searchLaboratorySources(
        { query: "HLA-B27", sources: ["arup"], requestId: "request-1", refresh: true },
        { registry },
      ),
    ).rejects.toBeInstanceOf(FederatedRefreshNotAuthorizedError);
    expect(search).not.toHaveBeenCalled();
  });

  it("returns parsed detail metadata but no raw body and keeps curator import unavailable", async () => {
    const parsed = validParsedOffering();
    const resolveReference = vi.fn(() => ARUP_REFERENCE);
    const fetchDetails = vi.fn(async () => ({
      sourceLab: "arup" as const,
      sourceRef: ARUP_REFERENCE.sourceRef,
      sourceUrl: ARUP_REFERENCE.sourceUrl,
      fetchedAt: "2026-08-19T00:00:00.000Z",
      mediaType: "text/html",
      body: OFFICIAL_SOURCE_BODY,
      contentHash: OFFICIAL_SOURCE_HASH,
      responseMetadata: {},
    }));
    const parse = vi.fn(async () => parsed);
    const registry = completeRegistry({
      arup: adapter("arup", "enabled", { resolveReference, fetchDetails, parse }),
    });

    const response = await fetchLaboratorySourceDetails(
      { sourceLab: "arup", sourceRef: ARUP_REFERENCE.sourceRef, requestId: "request-1" },
      { registry },
    );

    expect(response).toMatchObject({
      status: "success",
      snapshot: {
        sourceLab: "arup",
        sourceRef: ARUP_REFERENCE.sourceRef,
        sourceUrl: ARUP_REFERENCE.sourceUrl,
        contentHash: OFFICIAL_SOURCE_HASH,
      },
      parsed,
      curator: { status: "not-configured" },
    });
    expect(federatedDetailResponseSchema.safeParse(response).success).toBe(true);
    expect(JSON.stringify(response)).not.toContain("official source body");
    expect(resolveReference).toHaveBeenCalledWith(ARUP_REFERENCE.sourceRef);
    expect(fetchDetails).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledOnce();
  });

  it("rejects malformed parsed detail output before it reaches an API response", async () => {
    const fetchDetails = vi.fn(async () => ({
      sourceLab: "arup" as const,
      sourceRef: ARUP_REFERENCE.sourceRef,
      sourceUrl: ARUP_REFERENCE.sourceUrl,
      fetchedAt: "2026-08-19T00:00:00.000Z",
      mediaType: "text/html",
      body: OFFICIAL_SOURCE_BODY,
      contentHash: OFFICIAL_SOURCE_HASH,
      responseMetadata: {},
    }));
    const parse = vi.fn(async () => ({
      sourceLab: "arup",
      sourceRef: ARUP_REFERENCE.sourceRef,
      sourceUrl: ARUP_REFERENCE.sourceUrl,
      sourceTitle: "HLA-B27",
    } as ParsedSourceOffering));
    const registry = completeRegistry({
      arup: adapter("arup", "enabled", { fetchDetails, parse }),
    });

    await expect(fetchLaboratorySourceDetails(
      { sourceLab: "arup", sourceRef: ARUP_REFERENCE.sourceRef, requestId: "request-invalid" },
      { registry },
    )).rejects.toBeInstanceOf(FederatedSourceResponseError);
    expect(fetchDetails).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledOnce();
  });
});
