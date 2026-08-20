import { describe, expect, it, vi } from "vitest";

import { canUseLocalStorage } from "@/features/assayindex/storage/browser";
import {
  createDefaultSavedState,
  loadSavedState,
  pushRecentSearch,
  saveComparePreset,
  setTableDensity,
  toggleBookmark,
} from "@/features/assayindex/storage/saved-state";

describe("browser persistence", () => {
  it("stores bookmarks and compare presets in local storage", () => {
    expect(loadSavedState()).toEqual(createDefaultSavedState());

    toggleBookmark("hla-b27");
    pushRecentSearch("BCR-ABL1");
    saveComparePreset({
      assaySlug: "hla-b27",
      recordIds: ["mayo-hla-b27"],
      savedAt: "2026-04-15T00:00:00.000Z",
    });
    setTableDensity("compact");

    const savedState = loadSavedState();

    expect(savedState.bookmarks).toContain("hla-b27");
    expect(savedState.recentSearches[0]).toBe("BCR-ABL1");
    expect(savedState.comparePresets).toHaveLength(1);
    expect(savedState.preferences.tableDensity).toBe("compact");
  });

  it("detects unavailable browser storage gracefully", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(canUseLocalStorage()).toBe(false);

    setItemSpy.mockRestore();
  });
});
