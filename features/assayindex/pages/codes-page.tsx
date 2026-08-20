"use client";

import Link from "next/link";
import { startTransition, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import {
  buildLabMap,
  getAssayNameMap,
  getCodeExplorerEntries,
} from "@/features/assayindex/selectors/catalog";
import { LOINC_LICENSE_URL, loincRecordUrl } from "@/features/assayindex/utils/loinc";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

type CodesPageProps = {
  catalog: AssayIndexCatalog;
};

function buildNextUrl(pathname: string, searchParams: URLSearchParams) {
  const queryString = searchParams.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function CodesPage({ catalog }: CodesPageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const codeQuery = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";
  const activeCode = searchParams.get("code") ?? "";
  const activeScope = searchParams.get("scope") ?? "";

  const entries = useMemo(() => getCodeExplorerEntries(liveCatalog), [liveCatalog]);
  const labsById = useMemo(() => buildLabMap(liveCatalog), [liveCatalog]);
  const assaysBySlug = useMemo(() => getAssayNameMap(liveCatalog), [liveCatalog]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = codeQuery.trim().toLowerCase();

    return entries.filter((entry) => {
      if (category && entry.category !== category) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        entry.code.toLowerCase().includes(normalizedQuery) ||
        entry.description?.toLowerCase().includes(normalizedQuery) ||
        entry.note?.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [category, codeQuery, entries]);

  const selectedEntry =
    filteredEntries.find(
      (entry) =>
        entry.code === activeCode && (!activeScope || entry.scope === activeScope),
    ) ?? filteredEntries[0] ?? null;

  const updateSearchParams = (updates: Record<string, string>) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    }

    startTransition(() => {
      router.replace(buildNextUrl(pathname, nextParams), { scroll: false });
    });
  };

  return (
    <AssayIndexShell
      title="Code explorer"
      description="Browse CPT, ICD-10, and LOINC associations with scope-aware links back to assay detail pages and current lab coverage."
    >
      <section className="assayindex-panel p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_240px]">
          <input
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            placeholder="Search code, description, or note"
            type="search"
            value={codeQuery}
            onChange={(event) =>
              updateSearchParams({
                q: event.target.value,
              })
            }
          />
          <select
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={category}
            onChange={(event) =>
              updateSearchParams({
                category: event.target.value,
                code: "",
                scope: "",
              })
            }
          >
            <option value="">All code families</option>
            <option value="CPT">CPT</option>
            <option value="ICD10">ICD-10</option>
            <option value="LOINC">LOINC</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.82fr)]">
        <div className="space-y-3">
          {filteredEntries.map((entry) => {
            const isActive =
              selectedEntry?.code === entry.code && selectedEntry.scope === entry.scope;

            return (
              <button
                key={`${entry.category}:${entry.code}:${entry.scope}`}
                className={`assayindex-panel w-full p-5 text-left transition hover:border-[#92b3c3] hover:bg-[#f8fbfc] ${
                  isActive ? "border-[#73a7bf] shadow-[0_0_0_2px_rgba(58,128,158,0.15)]" : ""
                }`}
                type="button"
                onClick={() =>
                  updateSearchParams({
                    category: entry.category,
                    code: entry.code,
                    scope: entry.scope,
                  })
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="assayindex-badge">{entry.category}</span>
                  <span className="assayindex-badge">
                    {entry.scope === "assay-level" ? "Assay level" : "Lab specific"}
                  </span>
                  <span className="text-xs uppercase tracking-[0.16em] text-[#5e7584]">
                    {entry.assayCount} assay{entry.assayCount === 1 ? "" : "s"}
                  </span>
                </div>
                <h2 className="mt-4 text-2xl font-semibold text-[#102435]">{entry.code}</h2>
                <p className="mt-2 text-sm leading-7 text-[#536a79]">
                  {entry.description ?? "Description not listed by source"}
                </p>
                {entry.note ? (
                  <p className="mt-2 text-xs leading-6 text-[#667b89]">{entry.note}</p>
                ) : null}
              </button>
            );
          })}

          {filteredEntries.length === 0 ? (
            <div className="assayindex-panel p-8 text-center">
              <h2 className="text-2xl font-semibold text-[#102435]">No codes matched</h2>
              <p className="mt-3 text-sm leading-7 text-[#5d7382]">
                Try a broader search or switch code families. AssayIndex only shows codes that are
                currently present in the published catalog.
              </p>
            </div>
          ) : null}
        </div>

        <aside className="assayindex-panel p-5 md:p-6">
          {selectedEntry ? (
            <div className="space-y-5">
              <div>
                <p className="assayindex-kicker">Selected code</p>
                <h2 className="mt-2 text-3xl font-semibold text-[#102435]">
                  {selectedEntry.code}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[#526978]">
                  {selectedEntry.description ?? "Description not listed by source"}
                </p>
                {selectedEntry.category === "LOINC" && loincRecordUrl(selectedEntry.code) ? (
                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    <a
                      className="text-[#0f5f79] underline-offset-4 hover:underline"
                      href={loincRecordUrl(selectedEntry.code) ?? undefined}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open official LOINC record
                    </a>
                    <a
                      className="text-[#0f5f79] underline-offset-4 hover:underline"
                      href={LOINC_LICENSE_URL}
                      rel="noreferrer"
                      target="_blank"
                    >
                      LOINC license and attribution
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[#d9e3e8] p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Category</p>
                  <p className="mt-2 text-sm font-semibold text-[#102435]">
                    {selectedEntry.category}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#d9e3e8] p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Scope</p>
                  <p className="mt-2 text-sm font-semibold text-[#102435]">
                    {selectedEntry.scope === "assay-level" ? "Assay level" : "Lab specific"}
                  </p>
                </div>
              </div>

              {selectedEntry.note ? (
                <div className="rounded-2xl bg-[#f6fafb] p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Note</p>
                  <p className="mt-2 text-sm leading-7 text-[#425967]">{selectedEntry.note}</p>
                </div>
              ) : null}

              <div className="space-y-3">
                <p className="assayindex-kicker">Related assays</p>
                {selectedEntry.assaySlugs.map((slug) => (
                  <Link
                    key={slug}
                    className="block rounded-2xl border border-[#d9e3e8] p-4 transition hover:border-[#95b5c5] hover:bg-[#f8fbfc]"
                    href={`/assayindex/assays/${slug}`}
                  >
                    <p className="font-semibold text-[#102435]">
                      {assaysBySlug.get(slug)?.displayName ?? slug}
                    </p>
                    <p className="mt-1 text-sm text-[#576e7d]">Open assay detail</p>
                  </Link>
                ))}
              </div>

              <div className="space-y-3">
                <p className="assayindex-kicker">Labs represented</p>
                {selectedEntry.labIds.length > 0 ? (
                  selectedEntry.labIds.map((labId) => (
                    <Link
                      key={labId}
                      className="block rounded-2xl border border-[#d9e3e8] p-4 transition hover:border-[#95b5c5] hover:bg-[#f8fbfc]"
                      href={`/assayindex/labs/${labId}`}
                    >
                      <p className="font-semibold text-[#102435]">
                        {labsById.get(labId)?.displayName ?? labId}
                      </p>
                      <p className="mt-1 text-sm text-[#576e7d]">View lab profile</p>
                    </Link>
                  ))
                ) : (
                  <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5a7180]">
                    This code is currently stored at assay level rather than attached to a specific
                    lab record.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold text-[#102435]">Choose a code</h2>
              <p className="text-sm leading-7 text-[#5d7382]">
                Select a code from the list to inspect its scope, notes, related assays, and linked
                lab coverage.
              </p>
            </div>
          )}
        </aside>
      </section>
    </AssayIndexShell>
  );
}
