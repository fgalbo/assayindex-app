import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/assayindex/terminology-search/route";

describe("common laboratory order terminology API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns bounded source-attributed common-order matches", async () => {
    const response = await POST(new Request("http://localhost/api/assayindex/terminology-search", {
      method: "POST",
      body: JSON.stringify({ query: "CMP", limit: 5 }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: "1",
      status: "published-common-order-terminology",
      query: "CMP",
      interpretation: {
        interpretationType: "assayindex-search-heuristic",
        label: "Comprehensive metabolic panel (CMP)",
        evidenceUrl: "https://loinc.org/24323-8/",
      },
      resultCount: expect.any(Number),
      source: {
        sourceId: "nlm-loinc-universal-lab-orders-v2",
        valueSetVersion: "2.0",
      },
    });
    expect(body.resultCount).toBeLessThanOrEqual(5);
    expect(JSON.stringify(body)).not.toMatch(/patient|credential|password/i);
  });

  it("serves the bundled snapshot without making an outbound request", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Runtime terminology search must not use fetch.");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(new Request("http://localhost/api/assayindex/terminology-search", {
      method: "POST",
      body: JSON.stringify({ query: "CBC", limit: 1 }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns explicit provenance for an audited supplemental mnemonic", async () => {
    const response = await POST(new Request("http://localhost/api/assayindex/terminology-search", {
      method: "POST",
      body: JSON.stringify({ query: "MCV", limit: 5 }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source.mnemonicSupplement).toMatchObject({
      sourceId: "assayindex-curated-loinc-mnemonic-supplement-v1",
      entryCount: 28,
    });
    expect(body.results).toContainEqual(expect.objectContaining({
      loincCode: "787-2",
      sourceScope: "assayindex-mnemonic-supplement",
      orderObservation: null,
    }));
  });

  it("rejects malformed, extra, and out-of-bounds input", async () => {
    const invalidBodies = [
      "{",
      "null",
      "[]",
      JSON.stringify({ query: "x" }),
      JSON.stringify({ query: 123 }),
      JSON.stringify({ query: "a".repeat(121) }),
      JSON.stringify({ query: "a b c d e f g h i j k" }),
      JSON.stringify({ query: "CBC", limit: 0 }),
      JSON.stringify({ query: "CBC", limit: 51 }),
      JSON.stringify({ query: "CBC", limit: 1.5 }),
      JSON.stringify({ query: "CBC", limit: "5" }),
      JSON.stringify({ query: "CBC", limit: true }),
      JSON.stringify({ query: "CBC", extra: true }),
      JSON.stringify({ query: "CBC", padding: "x".repeat(2_048) }),
    ];
    for (const body of invalidBodies) {
      const response = await POST(new Request("http://localhost/api/assayindex/terminology-search", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }));
      expect(response.status).toBe(400);
    }
  });

  it("accepts the exact query, token, and result boundaries", async () => {
    for (const body of [
      { query: "a".repeat(120), limit: 1 },
      { query: "a b c d e f g h i j", limit: 50 },
    ]) {
      const response = await POST(new Request("http://localhost/api/assayindex/terminology-search", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }));
      expect(response.status).toBe(200);
    }
  });
});
