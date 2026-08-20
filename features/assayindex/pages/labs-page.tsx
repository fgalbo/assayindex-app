"use client";

import Link from "next/link";
import { startTransition, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import { getLabSummaries } from "@/features/assayindex/selectors/catalog";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

type LabsPageProps = {
  catalog: AssayIndexCatalog;
};

function buildNextUrl(pathname: string, searchParams: URLSearchParams) {
  const queryString = searchParams.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function LabsPage({ catalog }: LabsPageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = searchParams.get("q") ?? "";

  const summaries = useMemo(() => getLabSummaries(liveCatalog), [liveCatalog]);
  const filteredSummaries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return summaries;
    }

    return summaries.filter((summary) => {
      return (
        summary.lab.displayName.toLowerCase().includes(normalizedQuery) ||
        summary.lab.shortName.toLowerCase().includes(normalizedQuery) ||
        summary.lab.notes?.toLowerCase().includes(normalizedQuery) ||
        summary.assays.some((assay) =>
          assay.displayName.toLowerCase().includes(normalizedQuery),
        ) ||
        summary.sourceOfferings.some((offering) =>
          [
            offering.testName,
            offering.externalRecordId,
            offering.methodology,
            ...offering.aliases,
          ].some((value) => value?.toLowerCase().includes(normalizedQuery)),
        )
      );
    });
  }, [query, summaries]);

  const updateQuery = (value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (value) {
      nextParams.set("q", value);
    } else {
      nextParams.delete("q");
    }

    startTransition(() => {
      router.replace(buildNextUrl(pathname, nextParams), { scroll: false });
    });
  };

  return (
    <AssayIndexShell
      title="Lab directory"
      description="Browse laboratories represented by normalized assay records or source-listed test offerings, including public-health catalogs that are not forced into assay-concept mappings."
    >
      <section className="assayindex-panel assayindex-search-deck p-5 md:p-6">
        <input
          aria-label="Search laboratory directory"
          className="assayindex-control assayindex-focus-ring"
          placeholder="Search lab name, notes, or represented assays"
          type="search"
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {filteredSummaries.map((summary) => (
          <article key={summary.lab.id} className="assayindex-panel p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="assayindex-kicker">{summary.lab.shortName}</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#102435]">
                  {summary.lab.displayName}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[#526877]">
                  {summary.lab.notes ?? "No additional lab note is stored in the published catalog."}
                </p>
              </div>
              {summary.lab.website ? (
                <a
                  className="assayindex-nav-link assayindex-focus-ring assayindex-print-hide"
                  href={summary.lab.website}
                  rel="noreferrer"
                  target="_blank"
                >
                  Visit source site
                </a>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="assayindex-mini-stat p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Assays</p>
                <p className="mt-2 text-2xl font-semibold text-[#102435]">{summary.assayCount}</p>
              </div>
              <div className="assayindex-mini-stat p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Records</p>
                <p className="mt-2 text-2xl font-semibold text-[#102435]">{summary.recordCount}</p>
              </div>
              <div className="assayindex-mini-stat p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Source offerings</p>
                <p className="mt-2 text-2xl font-semibold text-[#102435]">
                  {summary.sourceOfferingCount}
                </p>
              </div>
              <div className="assayindex-mini-stat p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Sources</p>
                <p className="mt-2 text-2xl font-semibold text-[#102435]">{summary.sourceCount}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {summary.assays.map((assay) => (
                <Link
                  key={assay.slug}
                  className="assayindex-badge"
                  href={`/assayindex/assays/${assay.slug}`}
                >
                  {assay.displayName}
                </Link>
              ))}
              {summary.assays.length === 0 && summary.sourceOfferingCount > 0 ? (
                <span className="text-sm leading-6 text-[#526877]">
                  Source-native offerings available without normalized assay mappings.
                </span>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                className="assayindex-action assayindex-action--primary assayindex-focus-ring"
                href={`/assayindex/labs/${summary.lab.id}`}
              >
                Open lab profile
              </Link>
              <Link
                className="assayindex-action assayindex-focus-ring"
                href={`/assayindex/search?lab=${summary.lab.id}`}
              >
                Search this lab
              </Link>
            </div>
          </article>
        ))}
      </section>

      {filteredSummaries.length === 0 ? (
        <section className="assayindex-panel p-8 text-center">
          <h2 className="text-2xl font-semibold text-[#102435]">No labs matched that search</h2>
          <p className="mt-3 text-sm leading-7 text-[#5c7382]">
            Try a broader query or browse the full published directory without a filter.
          </p>
        </section>
      ) : null}
    </AssayIndexShell>
  );
}
