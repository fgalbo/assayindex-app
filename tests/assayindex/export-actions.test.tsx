import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { ComparePage } from "@/features/assayindex/pages/compare-page";
import { CuratorPage } from "@/features/assayindex/pages/curator-page";

const mocks = vi.hoisted(() => ({
  clearCuratorDraft: vi.fn(),
  downloadTextFile: vi.fn(),
  loadCuratorDraft: vi.fn(),
  loadCuratorImportName: vi.fn(),
  replace: vi.fn(),
  saveCuratorDraft: vi.fn(),
  saveCuratorImportName: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/assayindex/compare",
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("assay=hla-b27"),
}));

vi.mock("@/features/assayindex/data/live-catalog", () => ({
  useLiveCatalog: (catalog: typeof publishedCatalog) => ({
    catalog,
    catalogError: null,
    catalogSource: "embedded",
  }),
}));

vi.mock("@/features/assayindex/storage/curator-draft", () => ({
  clearCuratorDraft: mocks.clearCuratorDraft,
  loadCuratorDraft: mocks.loadCuratorDraft,
  loadCuratorImportName: mocks.loadCuratorImportName,
  saveCuratorDraft: mocks.saveCuratorDraft,
  saveCuratorImportName: mocks.saveCuratorImportName,
}));

vi.mock("@/features/assayindex/utils/formatting", async () => {
  const actual = await vi.importActual<typeof import("@/features/assayindex/utils/formatting")>(
    "@/features/assayindex/utils/formatting",
  );

  return {
    ...actual,
    downloadTextFile: mocks.downloadTextFile,
  };
});

describe("AssayIndex JSON export actions", () => {
  beforeEach(() => {
    mocks.downloadTextFile.mockReset();
    mocks.loadCuratorDraft.mockReset().mockResolvedValue(null);
    mocks.loadCuratorImportName.mockReset().mockResolvedValue(null);
  });

  it("passes the comparison filename before its JSON content", () => {
    render(<ComparePage catalog={publishedCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: "Export compare JSON" }));

    expect(mocks.downloadTextFile).toHaveBeenCalledTimes(1);
    const [fileName, content, mimeType] = mocks.downloadTextFile.mock.calls[0];

    expect(fileName).toBe("AssayIndex_hla-b27_Compare.json");
    expect(JSON.parse(content)).toMatchObject({ assaySlug: "hla-b27" });
    expect(mimeType).toBe("application/json");
  });

  it("passes the curator filename before its JSON content", () => {
    render(<CuratorPage catalog={publishedCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(mocks.downloadTextFile).toHaveBeenCalledTimes(1);
    const [fileName, content, mimeType] = mocks.downloadTextFile.mock.calls[0];

    expect(fileName).toBe("published-catalog.json");
    expect(JSON.parse(content)).toMatchObject({
      meta: { title: publishedCatalog.meta.title },
    });
    expect(mimeType).toBe("application/json");
  });
});
