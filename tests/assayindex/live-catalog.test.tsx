import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import {
  getCatalogSnapshotUrls,
  loadHostedCatalogSnapshot,
  resetHostedCatalogSnapshotCache,
  useLiveCatalog,
} from "@/features/assayindex/data/live-catalog";

function CatalogProbe() {
  const { catalog } = useLiveCatalog(publishedCatalog);

  return (
    <div>
      <span data-testid="catalog-version">{catalog.meta.version}</span>
      <span data-testid="catalog-published-at">{catalog.meta.lastPublishedAt}</span>
    </div>
  );
}

afterEach(() => {
  resetHostedCatalogSnapshotCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useLiveCatalog", () => {
  it("prefers a configured hosted snapshot URL before the local fallback", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_ASSAYINDEX_CATALOG_URL",
      "https://example.public.blob.vercel-storage.com/assayindex/catalog.json",
    );

    expect(getCatalogSnapshotUrls()).toEqual([
      "https://example.public.blob.vercel-storage.com/assayindex/catalog.json",
      "/assayindex/catalog.json",
    ]);
  });

  it("hydrates from the hosted snapshot when the runtime payload is valid", async () => {
    const liveCatalog = structuredClone(publishedCatalog);
    liveCatalog.meta.version = "2026.04-live";
    liveCatalog.meta.lastPublishedAt = "2026-04-15T12:00:00.000Z";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => liveCatalog,
      }),
    );

    render(<CatalogProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("catalog-version")).toHaveTextContent("2026.04-live");
    });

    expect(screen.getByTestId("catalog-published-at")).toHaveTextContent("2026-04-15T12:00:00.000Z");
  });

  it("falls back to the local snapshot when the configured hosted URL fails", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_ASSAYINDEX_CATALOG_URL",
      "https://example.public.blob.vercel-storage.com/assayindex/catalog.json",
    );

    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const requestUrl = input.toString();

      if (requestUrl.includes("example.public.blob.vercel-storage.com")) {
        return {
          ok: false,
          status: 500,
          json: async () => null,
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => publishedCatalog,
      };
    });

    const catalog = await loadHostedCatalogSnapshot(fetchMock as typeof fetch);

    expect(catalog.meta.version).toBe(publishedCatalog.meta.version);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the local snapshot when the configured request rejects", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_ASSAYINDEX_CATALOG_URL",
      "https://example.public.blob.vercel-storage.com/assayindex/catalog.json",
    );

    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      if (input.toString().includes("example.public.blob.vercel-storage.com")) {
        throw new Error("network unavailable");
      }

      return {
        ok: true,
        status: 200,
        json: async () => publishedCatalog,
      };
    });

    const catalog = await loadHostedCatalogSnapshot(fetchMock as typeof fetch);

    expect(catalog.meta.version).toBe(publishedCatalog.meta.version);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the embedded catalog when the hosted snapshot is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ invalid: true }),
      }),
    );

    render(<CatalogProbe />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId("catalog-version")).toHaveTextContent(publishedCatalog.meta.version);
    expect(screen.getByTestId("catalog-published-at")).toHaveTextContent(
      publishedCatalog.meta.lastPublishedAt,
    );
  });
});
