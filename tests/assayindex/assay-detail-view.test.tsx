import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssayDetailView } from "@/features/assayindex/components/assay-detail-view";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { getAssayReport } from "@/features/assayindex/selectors/catalog";

describe("AssayDetailView", () => {
  it("renders core assay sections and provenance", () => {
    const report = getAssayReport(publishedCatalog, "hla-b27");

    expect(report).not.toBeNull();

    render(<AssayDetailView labs={publishedCatalog.labs} report={report!} />);

    expect(screen.getByText("HLA-B27 Association Testing")).toBeInTheDocument();
    expect(screen.getByText("Clinical purpose")).toBeInTheDocument();
    expect(screen.getByText("Associated codes")).toBeInTheDocument();
    expect(screen.getByText("Cross-lab comparison")).toBeInTheDocument();
    expect(screen.getByText("Supporting references")).toBeInTheDocument();
    expect(screen.getByText(/informational reference workspace/i)).toBeInTheDocument();
  });
});
