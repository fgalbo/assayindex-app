"use client";

import Link from "next/link";
import { useMemo } from "react";

import { AssayDetailView } from "@/features/assayindex/components/assay-detail-view";
import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";
import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import { getAssayReport } from "@/features/assayindex/selectors/catalog";

type AssayDetailPageProps = {
  catalog: AssayIndexCatalog;
  slug: string;
};

export function AssayDetailPage({ catalog, slug }: AssayDetailPageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const report = useMemo(() => getAssayReport(liveCatalog, slug), [liveCatalog, slug]);

  if (!report) {
    return (
      <AssayIndexShell
        title="Assay detail"
        description="This assay is not available in the current AssayIndex snapshot."
        eyebrow="AssayIndex / Assay detail"
      >
        <section className="assayindex-panel p-8 text-center">
          <h2 className="text-2xl font-semibold text-[#102435]">Assay not available in this snapshot</h2>
          <p className="mt-3 text-sm leading-7 text-[#5b7281]">
            The current hosted catalog does not include this assay. Browse the live catalog or search
            for related assays and code mappings.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link className="assayindex-nav-link assayindex-focus-ring" href="/assayindex/search">
              Search tests
            </Link>
          </div>
        </section>
      </AssayIndexShell>
    );
  }

  return (
    <AssayIndexShell
      title="Assay detail"
      description="Normalized assay detail page with summary, codes, cross-lab comparison, record-level details, and source provenance."
      eyebrow="AssayIndex / Assay detail"
    >
      <AssayDetailView labs={liveCatalog.labs} report={report} />
    </AssayIndexShell>
  );
}
