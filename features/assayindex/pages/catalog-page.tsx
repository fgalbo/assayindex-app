"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog, SearchFilters, SearchSort } from "@/features/assayindex/domain/types";
import { getFilterOptions } from "@/features/assayindex/selectors/catalog";
import { searchCatalog } from "@/features/assayindex/search";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

type CatalogPageProps = {
  catalog: AssayIndexCatalog;
};

function buildNextUrl(pathname: string, searchParams: URLSearchParams) {
  const queryString = searchParams.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function CatalogPage({ catalog }: CatalogPageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const query = searchParams.get("q") ?? "";
  const specialty = searchParams.get("specialty") ?? "";
  const labId = searchParams.get("lab") ?? "";
  const category = searchParams.get("category") ?? "";
  const sort = (searchParams.get("sort") as SearchSort | null) ?? "alphabetical";
  const deferredQuery = useDeferredValue(query);

  const filters = useMemo<SearchFilters>(
    () => ({
      specialty: specialty || undefined,
      labId: labId || undefined,
      category: category || undefined,
    }),
    [category, labId, specialty],
  );

  const results = useMemo(
    () => searchCatalog(liveCatalog, deferredQuery, filters, sort),
    [deferredQuery, filters, liveCatalog, sort],
  );

  const filterOptions = useMemo(() => getFilterOptions(liveCatalog), [liveCatalog]);

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
      title="Assay catalog"
      description="Browse the published assay index with coverage-aware filters for specialty, lab, and source-backed records."
    >
      <section className="assayindex-panel p-5 md:p-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,180px))]">
          <input
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            placeholder="Search assays, codes, specimen types, or methods"
            type="search"
            value={query}
            onChange={(event) => updateSearchParams({ q: event.target.value })}
          />
          <select
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={specialty}
            onChange={(event) => updateSearchParams({ specialty: event.target.value })}
          >
            <option value="">All specialties</option>
            {filterOptions.specialties.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={labId}
            onChange={(event) => updateSearchParams({ lab: event.target.value })}
          >
            <option value="">All labs</option>
            {filterOptions.labs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={category}
            onChange={(event) => updateSearchParams({ category: event.target.value })}
          >
            <option value="">All categories</option>
            {filterOptions.categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={sort}
            onChange={(event) => updateSearchParams({ sort: event.target.value })}
          >
            <option value="alphabetical">Alphabetical</option>
            <option value="lab-count">Lab count</option>
            <option value="source-coverage">Source coverage</option>
            <option value="recently-updated">Recently updated</option>
          </select>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {results.map((result) => (
          <Link
            key={result.document.assaySlug}
            className="assayindex-panel block p-5 transition hover:border-[#98b6c6] hover:bg-[#f8fbfc]"
            href={`/assayindex/assays/${result.document.assaySlug}`}
          >
            <div className="flex flex-wrap gap-2">
              {result.document.specialty.map((tag) => (
                <span key={tag} className="assayindex-badge">
                  {tag}
                </span>
              ))}
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-[#0f2435]">{result.document.displayName}</h2>
            <p className="mt-3 text-sm leading-7 text-[#526775]">{result.document.summary}</p>
            <div className="mt-4 grid gap-3 text-sm text-[#405969] md:grid-cols-2">
              <p>
                <span className="font-semibold text-[#153042]">Labs:</span> {result.document.labNames.join(", ")}
              </p>
              <p>
                <span className="font-semibold text-[#153042]">Coverage:</span> {result.document.sourceCount} source docs
              </p>
              <p>
                <span className="font-semibold text-[#153042]">Specimen:</span>{" "}
                {result.document.specimenTypes.join(", ") || "Not listed by source"}
              </p>
              <p>
                <span className="font-semibold text-[#153042]">Methods:</span>{" "}
                {result.document.methodologies.join(", ") || "Not listed by source"}
              </p>
            </div>
          </Link>
        ))}
      </section>

      {results.length === 0 ? (
        <section className="assayindex-panel p-8 text-center">
          <h2 className="text-2xl font-semibold text-[#0f2435]">No assays matched those filters</h2>
          <p className="mt-3 text-sm leading-7 text-[#566c7a]">
            Try a broader specialty, remove the lab filter, or search by a code such as 81241 or 26028-1.
          </p>
        </section>
      ) : null}
    </AssayIndexShell>
  );
}
