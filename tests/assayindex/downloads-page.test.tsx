import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DownloadsPage,
  type DownloadRelease,
} from "@/features/assayindex/pages/downloads-page";

import publishedReleaseFixture from "./fixtures/acquisition/published-release.json";

describe("AssayIndex downloads", () => {
  it("shows verified release downloads, checksums, and every source attribution", () => {
    render(<DownloadsPage release={publishedReleaseFixture as DownloadRelease} />);

    expect(
      screen.getByRole("heading", { name: "AssayIndex downloads" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2026.04-seed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download Catalog JSON" })).toHaveAttribute(
      "href",
      "/assayindex/downloads/catalog.json",
    );
    expect(screen.getByRole("link", { name: "Download Provenance bundle" })).toHaveAttribute(
      "href",
      "/assayindex/downloads/release-bundle.json",
    );
    expect(screen.getByRole("link", { name: "Download SHA-256 checksums" })).toHaveAttribute(
      "href",
      "/assayindex/downloads/SHA256SUMS.txt",
    );
    expect(
      screen.getByRole("link", { name: "Mayo Clinic Laboratories" }),
    ).toHaveAttribute("href", "https://www.mayocliniclabs.com/");
    expect(screen.queryByRole("link", { name: "NIH Genetic Testing Registry" })).not.toBeInTheDocument();
  });

  it("does not expose candidate downloads when no verified release exists", () => {
    render(<DownloadsPage release={null} />);

    expect(screen.getByText("No release-validated catalog is available.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Download / })).not.toBeInTheDocument();
  });
});
