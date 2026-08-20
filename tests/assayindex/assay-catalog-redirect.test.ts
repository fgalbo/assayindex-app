import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import AssayCatalogRoute from "@/app/assayindex/assays/page";

describe("disabled catalog browse route", () => {
  beforeEach(() => redirectMock.mockReset());

  it("redirects to Search and preserves all query parameters", async () => {
    await AssayCatalogRoute({
      searchParams: Promise.resolve({ q: "HLA B27", lab: ["arup", "mayo"] }),
    });
    expect(redirectMock).toHaveBeenCalledWith(
      "/assayindex/search?q=HLA+B27&lab=arup&lab=mayo",
    );
  });
});
