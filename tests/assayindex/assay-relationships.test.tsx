import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CoOrderAssociations } from "@/features/assayindex/components/assay-relationships";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { getCoOrderRelationshipSummaries } from "@/features/assayindex/selectors/catalog";
import { createCoOrderRelationship } from "@/tests/assayindex/fixtures/relationships";

describe("CoOrderAssociations", () => {
  it("collapses associations under 10% by default and reveals every published aggregate row", async () => {
    const user = userEvent.setup();
    const catalog = structuredClone(publishedCatalog);
    catalog.coOrderRelationships = [
      createCoOrderRelationship({
        id: "co-order-high",
        counts: {
          eligibleSetCount: 100,
          leftSetCount: 40,
          rightSetCount: 50,
          pairSetCount: 10,
        },
      }),
      createCoOrderRelationship({
        id: "co-order-low",
        rightAssaySlug: "factor-v-leiden-r506q",
        counts: {
          eligibleSetCount: 100,
          leftSetCount: 20,
          rightSetCount: 25,
          pairSetCount: 1,
        },
      }),
    ];
    const summaries = getCoOrderRelationshipSummaries(
      catalog,
      "bcr-abl1-p210-quantitative",
    );

    render(<CoOrderAssociations summaries={summaries} />);

    expect(screen.getByRole("link", { name: "HLA-B27 Association Testing" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Factor V Leiden (R506Q) Mutation Analysis" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/10 co-occurrences/i)).toBeInTheDocument();
    expect(screen.getByText(/synthetic claims fixture/i)).toBeInTheDocument();
    expect(screen.getByText(/2025-01-01 through 2025-12-31/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fixture-co-orders \(2026\.1\)/i })).toHaveAttribute(
      "href",
      "https://example.test/aggregate-co-orders",
    );
    expect(screen.getByText(/aggregate historical co-occurrence/i)).toBeInTheDocument();
    expect(screen.getByText(/not clinical recommendations/i)).toBeInTheDocument();

    const revealButton = screen.getByRole("button", {
      name: "Show less-common co-orders (under 10%)",
    });
    expect(revealButton).toHaveAttribute("aria-expanded", "false");
    await user.click(revealButton);

    expect(
      screen.getByRole("link", { name: "Factor V Leiden (R506Q) Mutation Analysis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("5%")).toBeInTheDocument();
    expect(
      screen.getByText((_text, element) =>
        Boolean(
          element?.tagName === "P" &&
            element.textContent?.includes("1 co-occurrences · Synthetic claims fixture"),
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/threshold changes presentation only/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hide less-common co-orders/i }));

    expect(
      screen.queryByRole("link", { name: "Factor V Leiden (R506Q) Mutation Analysis" }),
    ).not.toBeInTheDocument();
  });
});
