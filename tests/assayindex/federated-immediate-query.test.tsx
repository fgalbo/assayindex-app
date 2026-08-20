import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useDeferredValue: () => "STALE-DEFERRED-QUERY",
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/assayindex/search",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("q=HLA-B27"),
}));

vi.mock("@/features/assayindex/data/live-catalog", () => ({
  useLiveCatalog: (catalog: unknown) => ({ catalog }),
}));

vi.mock("@/features/assayindex/components/federated-source-search", () => ({
  FederatedSourceSearch: ({ query }: { query: string }) => (
    <output data-testid="federated-query">{query}</output>
  ),
}));

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { SearchPage } from "@/features/assayindex/pages/search-page";

describe("SearchPage explicit federated query", () => {
  it("passes the immediate submitted query instead of a deferred stale value", () => {
    render(<SearchPage catalog={publishedCatalog} />);

    expect(screen.getByTestId("federated-query")).toHaveTextContent("HLA-B27");
    expect(screen.getByTestId("federated-query")).not.toHaveTextContent("STALE-DEFERRED-QUERY");
  });
});
