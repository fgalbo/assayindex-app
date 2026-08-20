"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { Assay, AssayIndexCatalog, SavedState } from "@/features/assayindex/domain/types";
import {
  createDefaultSavedState,
  getStorageModeLabel,
  loadSavedState,
  resetAssayIndexLocalData,
} from "@/features/assayindex/storage/saved-state";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

type SavedPageProps = {
  catalog: AssayIndexCatalog;
};

export function SavedPage({ catalog }: SavedPageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const [savedState, setSavedState] = useState<SavedState>(() => createDefaultSavedState());
  const [storageLabel, setStorageLabel] = useState("Checking browser storage...");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedState(loadSavedState());
      setStorageLabel(getStorageModeLabel());
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const bookmarkedAssays = useMemo(
    () => liveCatalog.assays.filter((assay) => savedState.bookmarks.includes(assay.slug)),
    [liveCatalog.assays, savedState.bookmarks],
  );
  const recentViews = useMemo(
    () =>
      savedState.recentViews
        .map((slug) => liveCatalog.assays.find((assay) => assay.slug === slug))
        .filter((assay): assay is Assay => Boolean(assay)),
    [liveCatalog.assays, savedState.recentViews],
  );

  return (
    <AssayIndexShell
      title="Saved and recent"
      description="Your bookmarks, recent searches, recently viewed assays, and stored compare presets stay in the browser with no login required."
    >
      <section className="assayindex-panel p-5 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="assayindex-kicker">Local persistence</p>
            <p className="mt-2 text-sm leading-7 text-[#526978]">{storageLabel}</p>
          </div>
          <button
            className="assayindex-nav-link assayindex-focus-ring"
            type="button"
            onClick={() => {
              void resetAssayIndexLocalData().then(() => {
                setSavedState(loadSavedState());
                setStorageLabel(getStorageModeLabel());
              });
            }}
          >
            Reset AssayIndex local data
          </button>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Bookmarked assays</p>
          <div className="mt-4 space-y-3">
            {bookmarkedAssays.length > 0 ? (
              bookmarkedAssays.map((assay) => (
                <Link
                  key={assay.slug}
                  className="block rounded-2xl border border-[#d9e3e8] p-4 transition hover:border-[#95b5c5] hover:bg-[#f8fbfc]"
                  href={`/assayindex/assays/${assay.slug}`}
                >
                  <h2 className="text-lg font-semibold text-[#102435]">{assay.displayName}</h2>
                  <p className="mt-2 text-sm leading-7 text-[#546a79]">{assay.summary}</p>
                </Link>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                No assays bookmarked yet. Use the Save assay action from any assay detail page.
              </p>
            )}
          </div>
        </article>

        <article className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Recently viewed</p>
          <div className="mt-4 space-y-3">
            {recentViews.length > 0 ? (
              recentViews.map((assay) => (
                <Link
                  key={assay.slug}
                  className="block rounded-2xl border border-[#d9e3e8] p-4 transition hover:border-[#95b5c5] hover:bg-[#f8fbfc]"
                  href={`/assayindex/assays/${assay.slug}`}
                >
                  <h2 className="text-lg font-semibold text-[#102435]">{assay.displayName}</h2>
                  <p className="mt-2 text-sm leading-7 text-[#546a79]">{assay.summary}</p>
                </Link>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                Recent views will appear after you open assay detail pages.
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Recent searches</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {savedState.recentSearches.length > 0 ? (
              savedState.recentSearches.map((query) => (
                <Link
                  key={query}
                  className="assayindex-badge"
                  href={`/assayindex/search?q=${encodeURIComponent(query)}`}
                >
                  {query}
                </Link>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                Search history is empty. Search terms are stored locally when you use the search page.
              </p>
            )}
          </div>
        </article>

        <article className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Saved compare sets</p>
          <div className="mt-4 space-y-3">
            {savedState.comparePresets.length > 0 ? (
              savedState.comparePresets.map((preset) => (
                <Link
                  key={`${preset.assaySlug}:${preset.recordIds.join(",")}`}
                  className="block rounded-2xl border border-[#d9e3e8] p-4 transition hover:border-[#95b5c5] hover:bg-[#f8fbfc]"
                  href={`/assayindex/compare?assay=${preset.assaySlug}&records=${preset.recordIds.join(",")}`}
                >
                  <h2 className="text-lg font-semibold text-[#102435]">
                    {liveCatalog.assays.find((assay) => assay.slug === preset.assaySlug)?.displayName ??
                      preset.assaySlug}
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[#546a79]">
                    {preset.recordIds.length} record{preset.recordIds.length === 1 ? "" : "s"} saved
                    for quick re-open.
                  </p>
                </Link>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                Save a comparison from the compare workspace to reopen it here later.
              </p>
            )}
          </div>
        </article>
      </section>
    </AssayIndexShell>
  );
}
