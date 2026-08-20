import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/assayindex/testing-search/route";

describe("GTR testing search API input boundary", () => {
  it("rejects malformed JSON without opening the index", async () => {
    const response = await POST(new Request("http://localhost/api/assayindex/testing-search", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("rejects an out-of-bounds query with a private no-store response", async () => {
    const response = await POST(new Request("http://localhost/api/assayindex/testing-search", {
      method: "POST",
      body: JSON.stringify({ query: "x" }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ error: "invalid_search" });
  });
});
