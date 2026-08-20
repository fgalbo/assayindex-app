import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssayDetailView } from "@/features/assayindex/components/assay-detail-view";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { getAssayReport } from "@/features/assayindex/selectors/catalog";
import { renderValueOrFallback } from "@/features/assayindex/utils/formatting";

describe("missing-data handling", () => {
  it("renders the shared fallback helper for unknown values", () => {
    expect(renderValueOrFallback(null)).toBe("Not listed by source");
  });

  it("shows Not listed by source on assay detail pages for partial records", () => {
    const report = getAssayReport(publishedCatalog, "hereditary-hemochromatosis-hfe");

    expect(report).not.toBeNull();

    render(<AssayDetailView labs={publishedCatalog.labs} report={report!} />);

    expect(screen.getAllByText("Not listed by source").length).toBeGreaterThan(0);
  });
});
