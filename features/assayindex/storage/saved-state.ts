import {
  ASSAYINDEX_DRAFT_STORAGE_KEY,
  ASSAYINDEX_IMPORT_NAME_KEY,
  ASSAYINDEX_STORAGE_KEY,
} from "@/features/assayindex/constants";
import type { SavedComparePreset, SavedState } from "@/features/assayindex/domain/types";
import { clearCuratorDraft } from "@/features/assayindex/storage/curator-draft";
import {
  canUseLocalStorage,
  readStorageJson,
  removeStorageValue,
  writeStorageJson,
} from "@/features/assayindex/storage/browser";

const MAX_RECENT_SEARCHES = 8;
const MAX_RECENT_VIEWS = 10;
const MAX_COMPARE_PRESETS = 8;

export function createDefaultSavedState(): SavedState {
  return {
    bookmarks: [],
    recentSearches: [],
    recentViews: [],
    comparePresets: [],
    preferences: {
      tableDensity: "comfortable",
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSavedComparePreset(value: unknown): value is SavedComparePreset {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const preset = value as Partial<SavedComparePreset>;
  return (
    typeof preset.assaySlug === "string" &&
    isStringArray(preset.recordIds) &&
    typeof preset.savedAt === "string"
  );
}

function isSavedState(value: unknown): value is SavedState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const state = value as Partial<SavedState>;
  return (
    isStringArray(state.bookmarks) &&
    isStringArray(state.recentSearches) &&
    isStringArray(state.recentViews) &&
    Array.isArray(state.comparePresets) &&
    state.comparePresets.every(isSavedComparePreset) &&
    typeof state.preferences === "object" &&
    state.preferences !== null &&
    (state.preferences.tableDensity === "comfortable" ||
      state.preferences.tableDensity === "compact")
  );
}

export function loadSavedState() {
  const storedState = readStorageJson<unknown>(ASSAYINDEX_STORAGE_KEY, null);
  return isSavedState(storedState) ? storedState : createDefaultSavedState();
}

export function persistSavedState(state: SavedState) {
  writeStorageJson(ASSAYINDEX_STORAGE_KEY, state);
}

export function toggleBookmark(slug: string) {
  const state = loadSavedState();
  const bookmarks = state.bookmarks.includes(slug)
    ? state.bookmarks.filter((value) => value !== slug)
    : [...state.bookmarks, slug].toSorted();

  const nextState = { ...state, bookmarks };
  persistSavedState(nextState);
  return nextState;
}

export function pushRecentSearch(query: string) {
  const normalized = query.trim();

  if (!normalized) {
    return loadSavedState();
  }

  const state = loadSavedState();
  const recentSearches = [normalized, ...state.recentSearches.filter((item) => item !== normalized)].slice(
    0,
    MAX_RECENT_SEARCHES,
  );
  const nextState = { ...state, recentSearches };
  persistSavedState(nextState);
  return nextState;
}

export function pushRecentView(slug: string) {
  const state = loadSavedState();
  const recentViews = [slug, ...state.recentViews.filter((item) => item !== slug)].slice(
    0,
    MAX_RECENT_VIEWS,
  );
  const nextState = { ...state, recentViews };
  persistSavedState(nextState);
  return nextState;
}

export function saveComparePreset(preset: SavedComparePreset) {
  const state = loadSavedState();
  const key = `${preset.assaySlug}:${preset.recordIds.toSorted().join(",")}`;
  const comparePresets = [
    preset,
    ...state.comparePresets.filter(
      (item) => `${item.assaySlug}:${item.recordIds.toSorted().join(",")}` !== key,
    ),
  ].slice(0, MAX_COMPARE_PRESETS);
  const nextState = { ...state, comparePresets };
  persistSavedState(nextState);
  return nextState;
}

export function setTableDensity(density: SavedState["preferences"]["tableDensity"]) {
  const state = loadSavedState();
  const nextState = {
    ...state,
    preferences: {
      ...state.preferences,
      tableDensity: density,
    },
  };

  persistSavedState(nextState);
  return nextState;
}

export async function resetAssayIndexLocalData() {
  removeStorageValue(ASSAYINDEX_STORAGE_KEY);
  removeStorageValue(ASSAYINDEX_DRAFT_STORAGE_KEY);
  removeStorageValue(ASSAYINDEX_IMPORT_NAME_KEY);
  await clearCuratorDraft();
}

export function getStorageModeLabel() {
  return canUseLocalStorage() ? "Browser storage available" : "Browser storage unavailable";
}
