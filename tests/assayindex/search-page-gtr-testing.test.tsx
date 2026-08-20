import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { SearchPage } from "@/features/assayindex/pages/search-page";

const navigationMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/assayindex/search",
  useRouter: () => navigationMocks,
  useSearchParams: () => new URLSearchParams("q=TP53"),
}));

vi.mock("@/features/assayindex/data/live-catalog", () => ({
  useLiveCatalog: (catalog: unknown) => ({ catalog }),
}));

const response = {
  schemaVersion: "1",
  status: "validated-staged-testing",
  query: "TP53",
  matchedCount: 639,
  resultCount: 1,
  truncated: true,
  source: {
    sourceId: "nih-gtr-test-version",
    snapshotSha256: "a".repeat(64),
    enrichmentSourceId: "nih-gtr-test-condition-gene",
    enrichmentSnapshotSha256: "b".repeat(64),
    retrievedAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    candidateCount: 64065,
    reviewRequiredCandidateCount: 5,
    attribution: "NIH Genetic Testing Registry (GTR)",
    attributionUrl: "https://www.ncbi.nlm.nih.gov/gtr/",
    disclaimer: "GTR data are submitted by laboratories and are not independently verified by NIH.",
  },
  results: [{
    id: "nih-gtr-test-version:GTR000210160.6",
    kind: "validated-staged-gtr",
    sourceId: "nih-gtr-test-version",
    publisherId: "nih-gtr",
    externalRecordId: "GTR000210160.6",
    providerId: "provider-1",
    testName: "Li-Fraumeni Syndrome",
    labName: "London Health Sciences Centre",
    institutionName: null,
    location: "Ontario, Canada",
    orderCode: null,
    sourceTestId: null,
    genes: ["TP53"],
    geneIds: ["7157"],
    geneMedgenIds: ["C0043194"],
    conditions: ["Li-Fraumeni syndrome"],
    conditionIds: ["C0085390"],
    methods: ["Sequence analysis"],
    reviewFlags: [],
    candidateState: "discovered",
    sourceLastTouchedAt: "2026-08-09",
    officialUrl: "https://www.ncbi.nlm.nih.gov/gtr/tests/210160/",
  }],
} as const;

describe("SearchPage validated GTR testing results", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads a clearly separated staged result and links only to the official GTR record", async () => {
    render(<SearchPage catalog={publishedCatalog} />);
    expect(screen.getByRole("heading", { name: "Verified AssayIndex records" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Search results" })).toBeEmptyDOMElement();
    expect(screen.getByText(/No verified catalog record matched this query/i)).toBeInTheDocument();
    expect(screen.getByText("Searching the validated GTR index…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/assayindex/testing-search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "TP53", limit: 25 }),
      }),
    );
    const section = screen.getByRole("heading", { name: "NIH Genetic Testing Registry" }).closest("section");
    expect(section).not.toBeNull();
    expect(within(section!).getByText("Validated staged GTR")).toBeInTheDocument();
    expect(within(section!).getByText(/Showing 1 of 639 validated GTR submissions/)).toBeInTheDocument();
    expect(within(section!).getByRole("link", { name: /Li-Fraumeni Syndrome/ })).toHaveAttribute(
      "href",
      "https://www.ncbi.nlm.nih.gov/gtr/tests/210160/",
    );
    expect(within(section!).queryByText(/curated AssayIndex publication/i)).not.toBeInTheDocument();
    expect(within(section!).getByText(/kept separate from curated AssayIndex records/i)).toBeInTheDocument();
  });
});
