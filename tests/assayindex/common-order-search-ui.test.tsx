import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommonOrderSearch } from "@/features/assayindex/components/common-order-search";

const response = {
  schemaVersion: "1",
  status: "published-common-order-terminology",
  query: "CMP",
  interpretation: null,
  matchedCount: 1,
  resultCount: 1,
  truncated: false,
  source: {
    sourceId: "nlm-loinc-universal-lab-orders-v2",
    valueSetName: "LOINC Universal Lab Orders Value Set",
    valueSetVersion: "2.0",
    sourcePageUrl: "https://lhncbc.nlm.nih.gov/CHRB/Projects/top-LOINC-codes.html",
    sourceDataUrl: "https://lhncbc.nlm.nih.gov/assets/files/LOINCUniversalLabOrdersValueSet.csv",
    searchApiUrl: "https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search",
    searchApiDocsUrl: "https://clinicaltables.nlm.nih.gov/apidoc/loinc/v3/doc.html",
    enrichment: {
      sourceId: "nlm-clinical-tables-loinc-v3",
      retrievedAt: "2026-08-21T00:00:00.000Z",
      responseSha256: "b".repeat(64),
      batchCount: 32,
      excludeCopyrighted: true,
      loincReleaseVersion: null,
      releaseVersionStatus: "not-exposed-by-source",
    },
    mnemonicSupplement: {
      sourceId: "assayindex-curated-loinc-mnemonic-supplement-v1",
      selectionVersion: "1.0.0",
      codeSetSha256: "c".repeat(64),
      entryCount: 28,
    },
    licenseUrl: "https://loinc.org/license",
    licenseNotice: "This material contains content from LOINC (http://loinc.org).",
    sourceUpdatedAt: "2025-01-21T14:39:14.000Z",
    retrievedAt: "2026-08-21T00:00:00.000Z",
    sourceSha256: "a".repeat(64),
    sourceEntryCount: 1_523,
    commonOrderPublishedEntryCount: 1_523,
    supplementalEntryCount: 28,
    publishedEntryCount: 1_551,
    excludedEntryCount: 0,
  },
  results: [{
    loincCode: "24323-8",
    longCommonName: "Comprehensive metabolic 2000 panel - Serum or Plasma",
    orderObservation: "Order",
    sourceScope: "common-order-value-set",
    officialUrl: "https://loinc.org/24323-8/",
    matchedTerm: "CMP",
    matchReason: "related-name",
  }],
} as const;

describe("CommonOrderSearch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows an evidence-linked warning for an interpreted mnemonic", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...response,
        query: "UDS",
        interpretation: {
          interpretationType: "assayindex-search-heuristic",
          label: "Urine drug screen (UDS)",
          evidenceLabel: "NIH/NIDA protocol — Urine Drug Screen (UDS)",
          evidenceUrl: "https://example.test/nida-uds",
          ambiguityNote: "UDS can mean something else outside laboratory ordering.",
        },
      }),
    }));

    render(<CommonOrderSearch query="UDS" onSearchLabs={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText(/interpreted in the laboratory-order context as/i)).toHaveTextContent("Urine drug screen");
    expect(screen.getByText(/AssayIndex search interpretation.*heuristic/i)).toBeInTheDocument();
    expect(screen.getByText(/does not make the entered shorthand an official LOINC synonym/i)).toBeInTheDocument();
    expect(screen.getByText(/can mean something else outside laboratory ordering/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /NIH\/NIDA protocol/i })).toHaveAttribute(
      "href",
      "https://example.test/nida-uds",
    );
  });

  it("labels terminology separately and can reuse the official name for a lab search", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);
    const onSearchLabs = vi.fn();
    render(<CommonOrderSearch query="CMP" onSearchLabs={onSearchLabs} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const section = screen.getByRole("heading", { name: "Common laboratory order terminology" }).closest("section");
    expect(section).not.toBeNull();
    expect(within(section!).getByText("Common-order value set")).toBeInTheDocument();
    expect(within(section!).getByText(/not proof that a laboratory currently performs/i)).toBeInTheDocument();
    expect(within(section!).getByText(/not the complete LOINC release/i)).toBeInTheDocument();
    expect(within(section!).getByText(/query is not sent to NLM/i)).toBeInTheDocument();
    expect(within(section!).getByText(/Source last modified Jan 21, 2025 and retrieved Aug 21, 2026/i)).toBeInTheDocument();
    expect(within(section!).getByRole("link", { name: "Open official LOINC record" })).toHaveAttribute(
      "href",
      "https://loinc.org/24323-8/",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assayindex/terminology-search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "CMP", limit: 20 }),
        cache: "no-store",
      }),
    );

    fireEvent.click(within(section!).getByRole("button", { name: "Search labs using this name" }));
    expect(onSearchLabs).toHaveBeenCalledWith("Comprehensive metabolic 2000 panel - Serum or Plasma");
  });

  it("labels supplemental mnemonic concepts without inventing an order role", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...response,
        query: "MCV",
        results: [{
          ...response.results[0],
          loincCode: "787-2",
          longCommonName: "MCV [Entitic mean volume] in Red Blood Cells by Automated count",
          orderObservation: null,
          sourceScope: "assayindex-mnemonic-supplement",
          officialUrl: "https://loinc.org/787-2/",
          matchedTerm: "MCV",
          matchReason: "assayindex-interpretation",
        }],
      }),
    }));

    render(<CommonOrderSearch query="MCV" onSearchLabs={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText("Audited mnemonic supplement")).toBeInTheDocument();
    expect(screen.getByText("Order role not classified by source")).toBeInTheDocument();
    expect(screen.getByText(/includes 28 audited LOINC concepts/i)).toBeInTheDocument();
  });

  it("rejects an incomplete response without crashing the result panel", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...response,
        source: { ...response.source, mnemonicSupplement: undefined },
      }),
    }));

    render(<CommonOrderSearch query="CMP" onSearchLabs={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText(/snapshot is temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Comprehensive metabolic/)).not.toBeInTheDocument();
  });

  it("does not issue a request for a query below the public minimum", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CommonOrderSearch query="x" onSearchLabs={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Common laboratory order terminology" })).not.toBeInTheDocument();
  });

  it("drops a completed response immediately when the query changes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => response }));
    const view = render(<CommonOrderSearch query="CMP" onSearchLabs={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByText(/Comprehensive metabolic/)).toBeInTheDocument();
    view.rerender(<CommonOrderSearch query="BMP" onSearchLabs={vi.fn()} />);
    expect(screen.queryByText(/Comprehensive metabolic/)).not.toBeInTheDocument();
    expect(screen.getByText("Searching common order terminology…")).toBeInTheDocument();
  });
});
