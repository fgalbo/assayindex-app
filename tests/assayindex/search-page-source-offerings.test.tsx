import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { SearchPage } from "@/features/assayindex/pages/search-page";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/assayindex/search",
  useRouter: () => navigationMocks,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/features/assayindex/data/live-catalog", () => ({
  useLiveCatalog: (catalog: unknown) => ({ catalog }),
}));

describe("source-offering search disclosure", () => {
  beforeEach(() => {
    navigationMocks.push.mockReset();
    navigationMocks.replace.mockReset();
  });

  it("shows 50 of 258 records initially and exposes every record on request", () => {
    render(<SearchPage catalog={publishedCatalog} />);

    const searchInput = screen.getByRole("combobox", { name: "Search AssayIndex" });
    const results = screen.getByRole("listbox", { name: "Search results" });
    const initialOptions = within(results).getAllByRole("option");

    expect(searchInput).toHaveAttribute("aria-autocomplete", "list");
    expect(searchInput).toHaveAttribute("aria-controls", "assayindex-search-results");
    expect(searchInput).toHaveAttribute("aria-expanded", "true");
    expect(searchInput).toHaveAttribute("aria-activedescendant", "assayindex-result-0");
    expect(initialOptions).toHaveLength(50);
    expect(initialOptions[0]).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Showing 50 of 258 results. No records are removed from the catalog."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 50 more" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));

    expect(within(results).getAllByRole("option")).toHaveLength(258);
    expect(screen.queryByRole("button", { name: "Show 50 more" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
  });

  it("labels exact filters and exposes toggle state accessibly", () => {
    render(<SearchPage catalog={publishedCatalog} />);

    for (const label of [
      "Filter by laboratory",
      "Filter by specialty",
      "Sort results",
      "Filter by category",
      "Filter by source type",
      "Filter by specimen type",
      "Filter by methodology",
    ]) {
      expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
    }

    for (const label of ["Any reflex status", "Any CPT status", "Any LOINC status"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });
});
