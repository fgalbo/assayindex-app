import { describe, expect, it, vi } from "vitest";

import { assertAllowedArupUrl } from "@/features/assayindex/federated/arup";
import { fetchBoundedSourceText } from "@/features/assayindex/federated/http.server";

function options(fetchImpl: typeof fetch, overrides: Partial<{
  maxBytes: number;
  expectedContentTypes: string[];
}> = {}) {
  return {
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    maxBytes: overrides.maxBytes ?? 1_024,
    expectedContentTypes: overrides.expectedContentTypes ?? ["text/html"],
    accept: "text/html",
    assertUrl: (url: URL) => assertAllowedArupUrl(url, "detail"),
    fetchImpl,
  };
}

describe("bounded federated source fetch", () => {
  it("revalidates redirects and blocks an escape from the official host", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/private" },
    })) as unknown as typeof fetch;

    await expect(fetchBoundedSourceText(
      new URL("https://ltd.aruplab.com/Tests/Pub/0095840"),
      options(fetchImpl),
    )).rejects.toThrow(/blocked unsafe ARUP source URL/i);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects a successful response with the wrong media type", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    await expect(fetchBoundedSourceText(
      new URL("https://ltd.aruplab.com/Tests/Pub/0095840"),
      options(fetchImpl),
    )).rejects.toThrow(/unexpected content type/i);
  });

  it("stops reading when the streamed body exceeds the configured byte limit", async () => {
    const fetchImpl = vi.fn(async () => new Response("01234567890", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })) as unknown as typeof fetch;

    await expect(fetchBoundedSourceText(
      new URL("https://ltd.aruplab.com/Tests/Pub/0095840"),
      options(fetchImpl, { maxBytes: 10 }),
    )).rejects.toThrow(/size limit/i);
  });
});
