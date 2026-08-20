import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { LandingPage } from "@/features/assayindex/pages/landing-page";

vi.mock("@/features/assayindex/data/live-catalog", () => ({
  useLiveCatalog: (catalog: unknown) => ({ catalog, catalogError: null }),
}));

describe("temporary AssayIndex navigation surface", () => {
  it("hides the narrow catalog browse link without removing the working product routes", () => {
    render(<AssayIndexShell description="Test shell" title="Test">Body</AssayIndexShell>);
    expect(screen.queryByRole("link", { name: "Catalog" })).not.toBeInTheDocument();
    for (const name of ["Search", "Labs", "Downloads", "Saved", "Curator"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("removes How it works and sends the primary browse action to Search", () => {
    render(<LandingPage catalog={publishedCatalog} />);
    expect(screen.queryByText(/How it works/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent additions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Featured assays/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search all tests" })).toHaveAttribute(
      "href",
      "/assayindex/search",
    );
    expect(
      screen.queryByRole("link", { name: /HLA-B27 Association Testing/i }),
    ).not.toBeInTheDocument();
  });
});
