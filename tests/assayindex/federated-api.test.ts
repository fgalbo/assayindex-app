import { beforeEach, describe, expect, it, vi } from "vitest";

const orchestratorMocks = vi.hoisted(() => ({
  searchLaboratorySources: vi.fn(),
  fetchLaboratorySourceDetails: vi.fn(),
  FederatedInvalidSourceReferenceError: class FederatedInvalidSourceReferenceError extends Error {},
}));

vi.mock("@/features/assayindex/federated/orchestrator", () => ({
  FederatedInvalidSourceReferenceError: orchestratorMocks.FederatedInvalidSourceReferenceError,
  FederatedRefreshNotAuthorizedError: class FederatedRefreshNotAuthorizedError extends Error {},
  searchLaboratorySources: orchestratorMocks.searchLaboratorySources,
  fetchLaboratorySourceDetails: orchestratorMocks.fetchLaboratorySourceDetails,
}));

import { POST as sourceDetailsPost } from "@/app/api/assayindex/source-details/route";
import { POST as sourceSearchPost } from "@/app/api/assayindex/source-search/route";

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  orchestratorMocks.searchLaboratorySources.mockReset();
  orchestratorMocks.fetchLaboratorySourceDetails.mockReset();
});

describe("federated source search API", () => {
  it("rejects malformed JSON and never opens an adapter", async () => {
    const response = await sourceSearchPost(new Request(
      "http://localhost/api/assayindex/source-search",
      { method: "POST", body: "{", headers: { "content-type": "application/json" } },
    ));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
    expect(orchestratorMocks.searchLaboratorySources).not.toHaveBeenCalled();
  });

  it("rejects arbitrary URLs and unknown source IDs", async () => {
    for (const body of [
      {
        query: "HLA-B27",
        sources: ["arup"],
        sourceUrl: "https://attacker.example/private",
      },
      { query: "HLA-B27", sources: ["unknown-lab"] },
    ]) {
      const response = await sourceSearchPost(request("/api/assayindex/source-search", body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    }
    expect(orchestratorMocks.searchLaboratorySources).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated forced refresh before source access", async () => {
    const response = await sourceSearchPost(request("/api/assayindex/source-search", {
      query: "HLA-B27",
      sources: ["arup"],
      refresh: true,
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "refresh_not_authorized" });
    expect(orchestratorMocks.searchLaboratorySources).not.toHaveBeenCalled();
  });

  it("returns independent partial source states with private no-store semantics", async () => {
    orchestratorMocks.searchLaboratorySources.mockResolvedValue({
      requestId: "request-1",
      query: "HLA-B27",
      searchedAt: "2026-08-19T00:00:00.000Z",
      sources: {
        arup: {
          status: "success",
          cached: false,
          results: [],
          message: null,
          officialDirectoryUrl: "https://ltd.aruplab.com",
        },
        mayo: {
          status: "official-directory-only",
          cached: false,
          results: [],
          message: "Mayo automation requires permission.",
          officialDirectoryUrl: "https://www.mayocliniclabs.com/test-catalog",
        },
        quest: {
          status: "timeout",
          cached: false,
          results: [],
          message: "Timed out.",
          officialDirectoryUrl: "https://testdirectory.questdiagnostics.com/test/home",
        },
        labcorp: {
          status: "official-directory-only",
          cached: false,
          results: [],
          message: "Labcorp automation requires permission.",
          officialDirectoryUrl: "https://www.labcorp.com/test-menu/search",
        },
      },
    });

    const response = await sourceSearchPost(request("/api/assayindex/source-search", {
      query: " HLA-B27 ",
      sources: ["arup", "mayo", "quest", "labcorp"],
      refresh: false,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      query: "HLA-B27",
      sources: {
        arup: { status: "success" },
        mayo: { status: "official-directory-only" },
        quest: { status: "timeout" },
        labcorp: { status: "official-directory-only" },
      },
    });
    expect(orchestratorMocks.searchLaboratorySources).toHaveBeenCalledWith(expect.objectContaining({
      query: "HLA-B27",
      sources: ["arup", "mayo", "quest", "labcorp"],
      refresh: false,
      requestId: expect.any(String),
    }));
  });
});

describe("federated source detail API", () => {
  it("accepts only a source ID and opaque reference", async () => {
    orchestratorMocks.fetchLaboratorySourceDetails.mockResolvedValue({
      requestId: "request-1",
      sourceLab: "arup",
      status: "success",
      parsed: {
        sourceTitle: "HLA-B27",
        cptCodes: ["86812"],
        fieldProvenance: {
          cptCodes: {
            rawValue: "86812",
            normalizedValue: ["86812"],
          },
        },
      },
      curator: { status: "not-configured" },
    });

    const response = await sourceDetailsPost(request("/api/assayindex/source-details", {
      sourceLab: "arup",
      sourceRef: "arup:test:0095840",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      sourceLab: "arup",
      status: "success",
      curator: { status: "not-configured" },
    });
    expect(body.parsed.cptCodes).toEqual([]);
    expect(body.parsed.fieldProvenance).not.toHaveProperty("cptCodes");
    expect(orchestratorMocks.fetchLaboratorySourceDetails).toHaveBeenCalledWith({
      sourceLab: "arup",
      sourceRef: "arup:test:0095840",
      requestId: expect.any(String),
    });
  });

  it("rejects client-supplied source URLs and unauthenticated refresh", async () => {
    const arbitraryUrl = await sourceDetailsPost(request("/api/assayindex/source-details", {
      sourceLab: "arup",
      sourceRef: "arup:test:0095840",
      sourceUrl: "https://attacker.example/private",
    }));
    expect(arbitraryUrl.status).toBe(400);
    await expect(arbitraryUrl.json()).resolves.toEqual({ error: "invalid_request" });

    const refresh = await sourceDetailsPost(request("/api/assayindex/source-details", {
      sourceLab: "arup",
      sourceRef: "arup:test:0095840",
      refresh: true,
    }));
    expect(refresh.status).toBe(403);
    await expect(refresh.json()).resolves.toEqual({ error: "refresh_not_authorized" });
    expect(orchestratorMocks.fetchLaboratorySourceDetails).not.toHaveBeenCalled();
  });

  it("maps an upstream network TypeError to service unavailable", async () => {
    orchestratorMocks.fetchLaboratorySourceDetails.mockRejectedValue(
      new TypeError("fetch failed: DNS lookup unavailable"),
    );

    const response = await sourceDetailsPost(request("/api/assayindex/source-details", {
      sourceLab: "arup",
      sourceRef: "arup:test:0095840",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "source_detail_unavailable" });
  });

  it("maps an invalid opaque source reference to a client error", async () => {
    orchestratorMocks.fetchLaboratorySourceDetails.mockRejectedValue(
      new orchestratorMocks.FederatedInvalidSourceReferenceError("ARUP source reference is invalid."),
    );

    const response = await sourceDetailsPost(request("/api/assayindex/source-details", {
      sourceLab: "arup",
      sourceRef: "not-an-arup-reference",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
  });
});
