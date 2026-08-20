"use client";

import Link from "next/link";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import { getCatalogStats } from "@/features/assayindex/selectors/catalog";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

type LandingPageProps = {
  catalog: AssayIndexCatalog;
};

export function LandingPage({ catalog }: LandingPageProps) {
  const { catalog: liveCatalog, catalogError } = useLiveCatalog(catalog);
  const stats = getCatalogStats(liveCatalog);

  return (
    <AssayIndexShell
      title="Find rare tests across reference laboratories"
      description="AssayIndex is a versioned, provenance-backed index of orderable laboratory tests from national, university, hospital, public-health, and specialty reference laboratories. Search it online or download an integrity-checked release."
      actions={
        <form action="/assayindex/search" className="assayindex-hero-search md:min-w-[390px]">
          <label htmlFor="assayindex-landing-search">
            Search assays, codes, or labs
          </label>
          <div className="flex gap-2">
            <input
              id="assayindex-landing-search"
              className="assayindex-control assayindex-focus-ring flex-1"
              name="q"
              placeholder="EGFR, HLA-B27, 81241, Labcorp..."
              type="search"
            />
            <button className="assayindex-action assayindex-action--primary assayindex-focus-ring" type="submit">
              Search
            </button>
          </div>
        </form>
      }
    >
      {catalogError ? (
        <section className="assayindex-panel border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="status">
          The hosted catalog snapshot could not be refreshed. AssayIndex is showing the embedded release-validated catalog instead.
        </section>
      ) : null}

      <section aria-label="Current AssayIndex coverage" className="assayindex-metrics grid gap-4 md:grid-cols-4">
        {[
          ["Assays", stats.assayCount.toString()],
          ["Labs", stats.labCount.toString()],
          ["Records", stats.recordCount.toString()],
          ["Sources", stats.sourceCount.toString()],
        ].map(([label, value]) => (
          <article key={label} className="assayindex-metric assayindex-panel p-5">
            <p className="assayindex-kicker">{label}</p>
            <p className="assayindex-metric-value">{value}</p>
          </article>
        ))}
      </section>

      <section className="assayindex-feature-panel assayindex-panel assayindex-section-band assayindex-section-band--testing flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-7">
        <div>
          <p className="assayindex-kicker">Testing phase</p>
          <h2 className="mt-3 text-2xl font-semibold text-[#102435]">Search is the primary way into the data</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[#516776]">
            Search keeps verified AssayIndex records, validated staged NIH GTR results, and live source candidates visibly separate. Live laboratory lookups run only when you explicitly request them.
          </p>
        </div>
        <Link className="assayindex-action assayindex-action--primary assayindex-focus-ring shrink-0" href="/assayindex/search">
          Search all tests
        </Link>
      </section>

      <section className="assayindex-feature-panel assayindex-panel assayindex-section-band flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-7">
        <div>
          <p className="assayindex-kicker">Open data access</p>
          <h2 className="mt-3 text-2xl font-semibold text-[#102435]">Use the integrity-checked catalog outside this website</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[#516776]">
            Download curated records and validated source-native offerings with provenance and SHA-256 checksums. Raw acquisition snapshots are never published here.
          </p>
        </div>
        <Link className="assayindex-action assayindex-focus-ring shrink-0" href="/assayindex/downloads">
          View downloads
        </Link>
      </section>

    </AssayIndexShell>
  );
}
