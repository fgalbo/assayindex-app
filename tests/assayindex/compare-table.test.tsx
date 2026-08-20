import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompareTable } from "@/features/assayindex/components/compare-table";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { buildLabMap, getRecordsByAssaySlug } from "@/features/assayindex/selectors/catalog";

describe("CompareTable", () => {
  it("renders key comparison rows for selected lab records", () => {
    const records = getRecordsByAssaySlug(publishedCatalog, "hiv-1-rna-quantitative").slice(0, 2);
    const labsById = buildLabMap(publishedCatalog);

    render(<CompareTable labsById={labsById} records={records} />);

    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getAllByText("Methodology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reflex logic").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/HIV-1 RNA, Quantitative, Real-Time PCR/i).length).toBeGreaterThan(0);
  });
});
