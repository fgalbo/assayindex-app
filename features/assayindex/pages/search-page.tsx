"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog, SearchFilters, SearchSort } from "@/features/assayindex/domain/types";
import { getAllCatalogFilterOptions } from "@/features/assayindex/selectors/catalog";
import { searchAllCatalog } from "@/features/assayindex/search";
import { pushRecentSearch } from "@/features/assayindex/storage/saved-state";
import type { GtrTestingSearchResponse } from "@/features/assayindex/testing/types";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";
import { FederatedSourceSearch } from "@/features/assayindex/components/federated-source-search";

type SearchPageProps = {
  catalog: AssayIndexCatalog;
};

const INITIAL_RESULT_COUNT = 50;
const GTR_SEARCH_DELAY_MS = 500;

type GtrSearchState =
  | { status: "idle"; query: string; data: null }
  | { status: "loading"; query: string; data: null }
  | { status: "success"; query: string; data: GtrTestingSearchResponse }
  | { status: "error"; query: string; data: null };

function isGtrTestingSearchResponse(value: unknown): value is GtrTestingSearchResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GtrTestingSearchResponse>;
  return candidate.schemaVersion === "1"
    && candidate.status === "validated-staged-testing"
    && typeof candidate.matchedCount === "number"
    && Array.isArray(candidate.results)
    && Boolean(candidate.source && typeof candidate.source.attribution === "string");
}

function buildNextUrl(pathname: string, searchParams: URLSearchParams) {
  const queryString = searchParams.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function SearchPage({ catalog }: SearchPageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleResultCount, setVisibleResultCount] = useState(INITIAL_RESULT_COUNT);
  const [gtrSearch, setGtrSearch] = useState<GtrSearchState>({ status: "idle", query: "", data: null });

  const query = searchParams.get("q") ?? "";
  const deferredQuery = useDeferredValue(query);
  const sort = (searchParams.get("sort") as SearchSort | null) ?? "relevance";
  const filters = useMemo<SearchFilters>(
    () => ({
      labId: searchParams.get("lab") || undefined,
      specialty: searchParams.get("specialty") || undefined,
      category: searchParams.get("category") || undefined,
      sourceType: searchParams.get("sourceType") || undefined,
      specimenType: searchParams.get("specimenType") || undefined,
      methodology: searchParams.get("methodology") || undefined,
      hasReflexLogic: searchParams.get("hasReflexLogic") === "1" ? true : undefined,
      hasCpt: searchParams.get("hasCpt") === "1" ? true : undefined,
      hasLoinc: searchParams.get("hasLoinc") === "1" ? true : undefined,
    }),
    [searchParams],
  );

  const filterOptions = useMemo(() => getAllCatalogFilterOptions(liveCatalog), [liveCatalog]);
  const results = useMemo(
    () => searchAllCatalog(liveCatalog, deferredQuery, filters, sort),
    [deferredQuery, filters, liveCatalog, sort],
  );
  const visibleResults = results.slice(0, visibleResultCount);
  const boundedActiveIndex = Math.min(activeIndex, Math.max(visibleResults.length - 1, 0));
  const testingQuery = deferredQuery.trim();
  const currentGtrSearch: GtrSearchState = gtrSearch.query === testingQuery
    ? gtrSearch
    : {
        status: testingQuery.length >= 2 ? "loading" : "idle",
        query: testingQuery,
        data: null,
      };

  useEffect(() => {
    const testingQuery = deferredQuery.trim();
    if (testingQuery.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setGtrSearch({ status: "loading", query: testingQuery, data: null });
      try {
        const response = await fetch("/api/assayindex/testing-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: testingQuery, limit: 25 }),
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (!response.ok || !isGtrTestingSearchResponse(body)) {
          throw new Error("The staged testing source is unavailable.");
        }
        setGtrSearch({ status: "success", query: testingQuery, data: body });
      } catch {
        if (!controller.signal.aborted) {
          setGtrSearch({ status: "error", query: testingQuery, data: null });
        }
      }
    }, GTR_SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [deferredQuery]);

  const updateSearchParams = (updates: Record<string, string>) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    }

    setActiveIndex(0);
    setVisibleResultCount(INITIAL_RESULT_COUNT);
    startTransition(() => {
      router.replace(buildNextUrl(pathname, nextParams), { scroll: false });
    });
  };

  return (
    <AssayIndexShell
      title="Search and discovery"
      description="Search normalized assays and source-listed test offerings by names, aliases, source IDs, labs, specimen and submission details, methods, contacts, and current source status."
    >
      <section className="assayindex-panel assayindex-search-deck p-5 md:p-6">
        <div className="assayindex-search-controls grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <input
            aria-activedescendant={visibleResults[boundedActiveIndex] ? `assayindex-result-${boundedActiveIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls="assayindex-search-results"
            aria-expanded={visibleResults.length > 0}
            aria-label="Search AssayIndex"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            placeholder="Search assays, source tests, codes, labs, or methods"
            type="search"
            value={query}
            onChange={(event) => {
              updateSearchParams({ q: event.target.value });
              pushRecentSearch(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(visibleResults.length - 1, 0)));
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) =>
                  Math.max(Math.min(index, Math.max(visibleResults.length - 1, 0)) - 1, 0),
                );
              }

              if (event.key === "Enter" && visibleResults[boundedActiveIndex]) {
                event.preventDefault();
                router.push(visibleResults[boundedActiveIndex].document.href);
              }
            }}
            role="combobox"
          />
          <select
            aria-label="Filter by laboratory"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={filters.labId ?? ""}
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
            aria-label="Filter by specialty"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={filters.specialty ?? ""}
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
            aria-label="Sort results"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={sort}
            onChange={(event) => updateSearchParams({ sort: event.target.value })}
          >
            <option value="relevance">Relevance</option>
            <option value="alphabetical">Alphabetical</option>
            <option value="recently-updated">Recently updated</option>
            <option value="source-coverage">Source coverage</option>
            <option value="lab-count">Lab count</option>
          </select>
        </div>

        <p className="assayindex-filter-label">Refine the result set</p>
        <div className="assayindex-search-controls grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <select
            aria-label="Filter by category"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={filters.category ?? ""}
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
            aria-label="Filter by source type"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={filters.sourceType ?? ""}
            onChange={(event) => updateSearchParams({ sourceType: event.target.value })}
          >
            <option value="">All source types</option>
            {filterOptions.sourceTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by specimen type"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={filters.specimenType ?? ""}
            onChange={(event) => updateSearchParams({ specimenType: event.target.value })}
          >
            <option value="">All specimen types</option>
            {filterOptions.specimenTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by methodology"
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            value={filters.methodology ?? ""}
            onChange={(event) => updateSearchParams({ methodology: event.target.value })}
          >
            <option value="">All methodologies</option>
            {filterOptions.methodologies.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            aria-pressed={Boolean(filters.hasReflexLogic)}
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            type="button"
            onClick={() => updateSearchParams({ hasReflexLogic: filters.hasReflexLogic ? "" : "1" })}
          >
            {filters.hasReflexLogic ? "With reflex only" : "Any reflex status"}
          </button>
          <button
            aria-pressed={Boolean(filters.hasCpt)}
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            type="button"
            onClick={() => updateSearchParams({ hasCpt: filters.hasCpt ? "" : "1" })}
          >
            {filters.hasCpt ? "Has CPT only" : "Any CPT status"}
          </button>
          <button
            aria-pressed={Boolean(filters.hasLoinc)}
            className="assayindex-focus-ring rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042]"
            type="button"
            onClick={() => updateSearchParams({ hasLoinc: filters.hasLoinc ? "" : "1" })}
          >
            {filters.hasLoinc ? "Has LOINC only" : "Any LOINC status"}
          </button>
        </div>
      </section>

      <section aria-labelledby="verified-search-results-heading" className="assayindex-panel assayindex-section-band assayindex-section-band--verified p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="assayindex-kicker">Published catalog</p>
            <h2 className="mt-2 text-2xl font-semibold text-[#102435]" id="verified-search-results-heading">
              Verified AssayIndex records
            </h2>
          </div>
          <span className="assayindex-badge assayindex-badge--verified">
            {results.length.toLocaleString("en-US")} {results.length === 1 ? "match" : "matches"}
          </span>
        </div>
        {deferredQuery.trim() && results.length === 0 ? (
          <p className="mt-4 text-sm leading-7 text-[#526978]" role="status">
            No verified catalog record matched this query. Validated GTR results and optional live-source
            searches remain available below.
          </p>
        ) : null}
      </section>

      <section aria-label="Search results" className="space-y-4" id="assayindex-search-results" role="listbox">
        {visibleResults.map((result, index) => (
          <Link
            aria-label={`Open ${result.document.kind === "assay" ? "assay" : "source offering"}: ${result.document.displayName}`}
            aria-selected={index === boundedActiveIndex}
            key={result.document.id}
            className="assayindex-panel assayindex-result assayindex-result--verified block p-5"
            href={result.document.href}
            id={`assayindex-result-${index}`}
            role="option"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="assayindex-badge assayindex-badge--verified">
                Verified AssayIndex Record
              </span>
              <span className="assayindex-badge">
                {result.document.kind === "assay" ? "Normalized assay" : "Source offering"}
              </span>
              {result.document.specialty.map((tag) => (
                <span key={tag} className="assayindex-badge">
                  {tag}
                </span>
              ))}
              {typeof result.score === "number" ? (
                <span className="assayindex-metadata">
                  score {result.score.toFixed(2)}
                </span>
              ) : null}
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-[#102435]">{result.document.displayName}</h2>
            <p className="mt-3 text-sm leading-7 text-[#526978]">{result.document.summary}</p>
            <div className="assayindex-result-facts mt-4 grid gap-3 text-sm text-[#455b69] md:grid-cols-2">
              <p>
                <span className="font-semibold text-[#153042]">Labs:</span>{" "}
                {result.document.labNames.join(", ") || "Not listed by source"}
              </p>
              <p>
                <span className="font-semibold text-[#153042]">Codes:</span>{" "}
                {result.document.codes.slice(0, 5).join(", ") || "Not listed by source"}
              </p>
              <p>
                <span className="font-semibold text-[#153042]">Methods:</span>{" "}
                {result.document.methodologies.join(", ") || "Not listed by source"}
              </p>
              <p>
                <span className="font-semibold text-[#153042]">Specimen:</span>{" "}
                {result.document.specimenTypes.join(", ") || "Not listed by source"}
              </p>
            </div>
          </Link>
        ))}
      </section>

      {visibleResults.length < results.length ? (
        <section className="assayindex-panel flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="text-sm leading-6 text-[#526978]">
            Showing {visibleResults.length} of {results.length} results. No records are removed from the catalog.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="assayindex-nav-link assayindex-focus-ring"
              type="button"
              onClick={() => setVisibleResultCount((count) => Math.min(count + INITIAL_RESULT_COUNT, results.length))}
            >
              Show 50 more
            </button>
            <button
              className="assayindex-nav-link assayindex-focus-ring"
              type="button"
              onClick={() => setVisibleResultCount(results.length)}
            >
              Show all
            </button>
          </div>
        </section>
      ) : null}

      {deferredQuery.trim().length >= 2 ? (
        <section aria-labelledby="gtr-testing-results-heading" className="assayindex-panel assayindex-section-band assayindex-section-band--testing p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="assayindex-kicker">Validated staged testing source</p>
              <h2 className="mt-2 text-2xl font-semibold text-[#102435]" id="gtr-testing-results-heading">
                NIH Genetic Testing Registry
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-7 text-[#526978]">
                This testing-only path searches validated NIH GTR submissions by test, accession, laboratory,
                institution, method, gene, and condition. Results are kept separate from curated AssayIndex records.
              </p>
            </div>
            <span className="assayindex-badge assayindex-badge--testing">Testing · staged data</span>
          </div>

          {currentGtrSearch.status === "loading" ? (
            <p className="mt-5 text-sm text-[#526978]" role="status">Searching the validated GTR index…</p>
          ) : null}

          {currentGtrSearch.status === "error" ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="status">
              The validated GTR testing index is temporarily unavailable. Published AssayIndex results above are unaffected.
            </div>
          ) : null}

          {currentGtrSearch.status === "success" ? (
            <div className="mt-5 space-y-4">
              <p className="text-sm leading-6 text-[#526978]" role="status">
                {currentGtrSearch.data.matchedCount === 0
                  ? "No validated GTR submissions matched this search."
                  : `Showing ${currentGtrSearch.data.resultCount} of ${currentGtrSearch.data.matchedCount.toLocaleString("en-US")} validated GTR submissions.`}
              </p>
              {currentGtrSearch.data.results.map((result) => (
                <a
                  className="assayindex-result assayindex-result--testing block rounded-2xl border border-[#d8e3e8] p-4"
                  href={result.officialUrl}
                  key={result.id}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="assayindex-badge assayindex-badge--testing">Validated staged GTR</span>
                    {result.reviewFlags.length > 0 ? (
                      <span className="assayindex-badge assayindex-badge--warning">
                        Source status needs attention
                      </span>
                    ) : null}
                    <span className="assayindex-metadata">
                      {result.externalRecordId}
                    </span>
                  </div>
                  <h3 className="mt-3 text-xl font-semibold text-[#102435]">{result.testName}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#455b69]">
                    <span className="font-semibold text-[#153042]">Laboratory:</span> {result.labName}
                    {result.institutionName && result.institutionName !== result.labName
                      ? ` · ${result.institutionName}`
                      : ""}
                    {result.location ? ` · ${result.location}` : ""}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm leading-6 text-[#526978] md:grid-cols-2">
                    <p><span className="font-semibold text-[#153042]">Genes:</span> {result.genes.join(", ") || "Not listed by source"}</p>
                    <p><span className="font-semibold text-[#153042]">Conditions:</span> {result.conditions.join(", ") || "Not listed by source"}</p>
                    <p><span className="font-semibold text-[#153042]">Methods:</span> {result.methods.join(", ") || "Not listed by source"}</p>
                    <p><span className="font-semibold text-[#153042]">Order / test ID:</span> {[result.orderCode, result.sourceTestId].filter(Boolean).join(" · ") || "Not listed by source"}</p>
                  </div>
                </a>
              ))}
              <div className="assayindex-provenance p-4 text-xs leading-6">
                <p>
                  Source: <a className="underline" href={currentGtrSearch.data.source.attributionUrl} rel="noreferrer" target="_blank">{currentGtrSearch.data.source.attribution}</a>.
                  {" "}{currentGtrSearch.data.source.disclaimer}
                </p>
                <p className="mt-1">
                  Snapshot {currentGtrSearch.data.source.snapshotSha256.slice(0, 12)}… · enriched with {currentGtrSearch.data.source.enrichmentSourceId} · {currentGtrSearch.data.source.candidateCount.toLocaleString("en-US")} validated candidates.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <FederatedSourceSearch query={query} />

      {results.length === 0 && currentGtrSearch.status === "success" && currentGtrSearch.data.matchedCount === 0 ? (
        <section className="assayindex-panel p-8 text-center">
          <h2 className="text-2xl font-semibold text-[#102435]">No search results</h2>
          <p className="mt-3 text-sm leading-7 text-[#566c7a]">
            Try removing one or more filters, or search with a direct code such as 81256, 81241, or 55135-8.
          </p>
        </section>
      ) : null}
    </AssayIndexShell>
  );
}
