import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { SearchPage } from "@/features/assayindex/pages/search-page";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/assayindex/search",
  useRouter: () => navigationMocks,
  useSearchParams: () => new URLSearchParams(navigationMocks.search),
}));

vi.mock("@/features/assayindex/data/live-catalog", () => ({
  useLiveCatalog: (catalog: unknown) => ({ catalog }),
}));

const federatedResponse = {
  requestId: "request-1",
  query: "HLA-B27",
  searchedAt: "2026-08-19T00:00:00.000Z",
  sources: {
    arup: {
      status: "success",
      cached: false,
      message: null,
      officialDirectoryUrl: "https://ltd.aruplab.com",
      results: [{
        sourceLab: "arup",
        sourceRef: "arup:test:0095840",
        sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
        sourceTestCode: "0095840",
        title: "HLA-B27",
        summary: "The presence of the HLA-B27 antigen is strongly associated with related disorders.",
        orderingRecommendation: "Not a diagnostic test when interpreted in isolation.",
        sourceStatus: "A",
      }],
    },
    mayo: {
      status: "official-directory-only",
      cached: false,
      results: [],
      message: "Connected to Mayo's official directory for manual testing. Automated catalog search is not used because the official robots policy excludes those paths.",
      officialDirectoryUrl: "https://www.mayocliniclabs.com/test-catalog",
    },
    quest: {
      status: "official-directory-only",
      cached: false,
      results: [],
      message: "Connected to Quest's official directory for manual testing. No documented public test-directory API or universal service-area contract is available.",
      officialDirectoryUrl: "https://testdirectory.questdiagnostics.com/test/home",
    },
    labcorp: {
      status: "official-directory-only",
      cached: false,
      results: [],
      message: "Connected to Labcorp's official Test Finder for manual testing. Automated collection is not used because the current agreement requires prior written permission.",
      officialDirectoryUrl: "https://www.labcorp.com/test-menu/search",
    },
  },
};

const federatedDetailResponse = {
  requestId: "request-detail-1",
  sourceLab: "arup",
  status: "success",
  message: null,
  snapshot: {
    sourceLab: "arup",
    sourceRef: "arup:test:0095840",
    sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
    fetchedAt: "2026-08-19T00:00:00.000Z",
    mediaType: "text/html",
    contentHash: "a".repeat(64),
  },
  parsed: {
    sourceLab: "arup",
    sourceRef: "arup:test:0095840",
    sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
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
    specimenOptions: [{
      specimenType: "Whole blood",
      preferred: null,
      container: null,
      preferredVolume: null,
      minimumVolume: "0.5 mL",
      patientPreparation: null,
      collectionInstructions: null,
      transportTemperature: null,
      ambientStability: null,
      refrigeratedStability: null,
      frozenStability: null,
      rejectionCriteria: [],
    }],
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
    contentHash: "a".repeat(64),
    fetchedAt: "2026-08-19T00:00:00.000Z",
  },
  curator: {
    status: "not-configured",
    message: "Curator import is not configured.",
  },
};

describe("SearchPage federated laboratory discovery", () => {
  beforeEach(() => {
    navigationMocks.push.mockReset();
    navigationMocks.replace.mockReset();
    navigationMocks.search = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never contacts the federated endpoint while the user types", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SearchPage catalog={publishedCatalog} />);

    const input = screen.getByRole("combobox", { name: "Search AssayIndex" });
    fireEvent.change(input, { target: { value: "H" } });
    fireEvent.change(input, { target: { value: "HLA" } });
    fireEvent.change(input, { target: { value: "HLA-B27" } });

    await Promise.resolve();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/source-search"))).toHaveLength(0);
  });

  it("shows an independent accessible loading card for every requested laboratory", () => {
    navigationMocks.search = "q=HLA-B27";
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      if (String(url) === "/api/assayindex/source-search") {
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: "testing_source_unavailable" }),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SearchPage catalog={publishedCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: "Search current laboratory directories" }));

    for (const laboratory of [
      "ARUP Laboratories",
      "Mayo Clinic Laboratories",
      "Quest Diagnostics",
      "Labcorp",
    ]) {
      const sourceCard = screen.getByRole("region", { name: laboratory });
      expect(sourceCard).toHaveAttribute("aria-busy", "true");
      expect(within(sourceCard).getByText("loading")).toBeInTheDocument();
      expect(within(sourceCard).getByText("Checking this source…")).toBeInTheDocument();
    }
  });

  it("searches only on an explicit action and separates live candidates from verified records", async () => {
    navigationMocks.search = "q=HLA-B27";
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/assayindex/source-search") {
        return { ok: true, json: async () => federatedResponse } as Response;
      }
      if (String(url) === "/api/assayindex/source-details") {
        return {
          ok: true,
          json: async () => federatedDetailResponse,
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ error: "testing_source_unavailable" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SearchPage catalog={publishedCatalog} />);

    const localResults = screen.getByRole("listbox", { name: "Search results" });
    expect(within(localResults).getAllByText("Verified AssayIndex Record").length).toBeGreaterThan(0);
    expect(within(localResults).getByText("HLA-B27 Association Testing")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/source-search"))).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Search current laboratory directories" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/source-search"))).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assayindex/source-search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "HLA-B27",
          sources: ["arup", "mayo", "quest", "labcorp"],
          refresh: false,
        }),
      }),
    );

    const liveSection = await screen.findByRole("region", { name: "Live Source Candidates" });
    expect(within(liveSection).getByText("Live Source Candidate")).toBeInTheDocument();
    expect(within(liveSection).getByRole("heading", { name: "HLA-B27" })).toBeInTheDocument();
    expect(within(liveSection).getByText(/0095840/)).toBeInTheDocument();
    expect(within(liveSection).getByRole("link", { name: /official source/i })).toHaveAttribute(
      "href",
      "https://ltd.aruplab.com/Tests/Pub/0095840",
    );
    expect(within(liveSection).getByText(
      "This result was retrieved from the laboratory’s current test directory and has not yet been reviewed or verified by AssayIndex.",
    )).toBeInTheDocument();
    expect(within(liveSection).getByText(/Connected to Mayo's official directory/i)).toBeInTheDocument();
    expect(within(liveSection).getByText(/No documented public test-directory API/i)).toBeInTheDocument();
    expect(within(liveSection).getByText(/Connected to Labcorp's official Test Finder/i)).toBeInTheDocument();
    const directoryLinks = within(liveSection).getAllByRole("link", { name: "Open official test directory" });
    expect(directoryLinks.map((link) => link.getAttribute("href"))).toEqual([
      "https://ltd.aruplab.com",
      "https://www.mayocliniclabs.com/test-catalog",
      "https://testdirectory.questdiagnostics.com/test/home",
      "https://www.labcorp.com/test-menu/search",
    ]);
    expect(within(liveSection).queryByRole("button", { name: /Import to curator/i })).not.toBeInTheDocument();

    fireEvent.click(within(liveSection).getByRole("button", { name: "Load current details" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/source-details"))).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assayindex/source-details",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sourceLab: "arup", sourceRef: "arup:test:0095840" }),
      }),
    );
    expect(await within(liveSection).findByText(/Qualitative Flow Cytometry/)).toBeInTheDocument();
    expect(within(liveSection).getByText(/1-2 days/)).toBeInTheDocument();
    expect(within(liveSection).getByText(/Whole blood/)).toBeInTheDocument();
    expect(within(liveSection).getByText(/0.5 mL/)).toBeInTheDocument();
    expect(within(liveSection).getByRole("link", { name: "26028-1" })).toHaveAttribute(
      "href",
      "https://loinc.org/26028-1/",
    );
  });

  it("hides stale live-source results when the query changes and submits the new query", async () => {
    navigationMocks.search = "q=HLA-B27";
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/assayindex/source-search") {
        const request = JSON.parse(String(init?.body)) as { query: string };
        return {
          ok: true,
          json: async () => ({ ...federatedResponse, query: request.query }),
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ error: "testing_source_unavailable" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<SearchPage catalog={publishedCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: "Search current laboratory directories" }));
    expect(await screen.findByRole("heading", { name: "HLA-B27" })).toBeInTheDocument();

    navigationMocks.search = "q=TP53";
    view.rerender(<SearchPage catalog={publishedCatalog} />);

    expect(screen.queryByRole("heading", { name: "HLA-B27" })).not.toBeInTheDocument();
    const searchButton = screen.getByRole("button", { name: "Search current laboratory directories" });
    expect(searchButton).toBeEnabled();
    fireEvent.click(searchButton);

    await waitFor(() => {
      const sourceCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/source-search"));
      expect(sourceCalls).toHaveLength(2);
      expect(sourceCalls[1]?.[1]).toEqual(expect.objectContaining({
        body: JSON.stringify({
          query: "TP53",
          sources: ["arup", "mayo", "quest", "labcorp"],
          refresh: false,
        }),
      }));
    });
  });
});
