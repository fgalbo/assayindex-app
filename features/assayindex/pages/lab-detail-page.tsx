"use client";

import Link from "next/link";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import {
  getAssaysForLab,
  sortOfferingRecords,
} from "@/features/assayindex/selectors/catalog";
import { getSourceOfferingRouteSegment } from "@/features/assayindex/selectors/source-offerings";
import { formatDateOnly, renderValueOrFallback } from "@/features/assayindex/utils/formatting";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

type LabDetailPageProps = {
  catalog: AssayIndexCatalog;
  labId: string;
};

export function LabDetailPage({ catalog, labId }: LabDetailPageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const summary = getAssaysForLab(liveCatalog, labId);

  if (!summary) {
    return (
      <AssayIndexShell
        title="Lab detail"
        description="This lab is not available in the current AssayIndex snapshot."
        eyebrow="AssayIndex / Lab profile"
      >
        <section className="assayindex-panel p-8 text-center">
          <h2 className="text-2xl font-semibold text-[#102435]">Lab not available in this snapshot</h2>
          <p className="mt-3 text-sm leading-7 text-[#5b7281]">
            The current hosted catalog does not include this lab record set. Browse the live lab
            directory or return to the assay catalog.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link className="assayindex-nav-link assayindex-focus-ring" href="/assayindex/labs">
              Browse labs
            </Link>
            <Link className="assayindex-nav-link assayindex-focus-ring" href="/assayindex/search">
              Search tests
            </Link>
          </div>
        </section>
      </AssayIndexShell>
    );
  }

  const records = sortOfferingRecords(
    liveCatalog,
    liveCatalog.assayLabRecords.filter((record) => record.labId === labId),
  );

  const sources = liveCatalog.sourceDocuments
    .filter((source) => source.labId === labId)
    .toSorted((left, right) => left.label.localeCompare(right.label));

  return (
    <AssayIndexShell
      title={summary.lab.displayName}
      description="A laboratory-level view of normalized assays and source-listed test offerings, including current source status, provenance, and direct catalog links."
      eyebrow="AssayIndex / Lab profile"
    >
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_320px]">
        <article className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Overview</p>
          <p className="mt-4 text-sm leading-7 text-[#465d6c]">
            {summary.lab.notes ?? "No additional lab note is stored in the published catalog."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {summary.lab.website ? (
              <a
                className="assayindex-nav-link assayindex-focus-ring"
                href={summary.lab.website}
                rel="noreferrer"
                target="_blank"
              >
                Visit official site
              </a>
            ) : null}
            <Link
              className="assayindex-nav-link assayindex-focus-ring"
              href={`/assayindex/search?lab=${summary.lab.id}`}
            >
              Search this lab
            </Link>
          </div>
        </article>

        <aside className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Coverage snapshot</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#526574]">Assays represented</dt>
              <dd className="font-semibold text-[#132332]">{summary.assayCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#526574]">Lab records</dt>
              <dd className="font-semibold text-[#132332]">{summary.recordCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#526574]">Source offerings</dt>
              <dd className="font-semibold text-[#132332]">{summary.sourceOfferingCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#526574]">Source documents</dt>
              <dd className="font-semibold text-[#132332]">{summary.sourceCount}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="assayindex-kicker">Assays in this catalog</p>
            <p className="mt-2 text-sm leading-7 text-[#536a79]">
              Direct links back to the normalized assay workspace, plus compare shortcuts with this
              lab preselected.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {summary.assays.map((assay) => (
            <article key={assay.slug} className="rounded-2xl border border-[#d9e3e8] p-4">
              <h2 className="text-xl font-semibold text-[#102435]">{assay.displayName}</h2>
              <p className="mt-2 text-sm leading-7 text-[#526a79]">{assay.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {assay.specialty.map((tag) => (
                  <span key={tag} className="assayindex-badge">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  className="assayindex-nav-link assayindex-focus-ring"
                  href={`/assayindex/assays/${assay.slug}`}
                >
                  Open assay detail
                </Link>
                <Link
                  className="assayindex-nav-link assayindex-focus-ring"
                  href={`/assayindex/compare?assay=${assay.slug}&records=${records
                    .filter((record) => record.assaySlug === assay.slug)
                    .map((record) => record.id)
                    .join(",")}`}
                >
                  Compare this lab&apos;s records
                </Link>
              </div>
            </article>
          ))}
          {summary.assays.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cad8df] p-5 text-sm leading-7 text-[#5b7281]">
              No normalized assay concepts are linked to this laboratory yet. Its source-native
              offerings remain available below and through search.
            </div>
          ) : null}
        </div>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <p className="assayindex-kicker">Source-listed offerings</p>
        <p className="mt-2 text-sm leading-7 text-[#536a79]">
          Source status is shown as published. Offline, non-CLIA, prior-approval, and source-missing
          offerings remain accessible rather than being suppressed.
        </p>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {summary.sourceOfferings.map((offering) => (
            <article key={offering.id} className="rounded-2xl border border-[#d9e3e8] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="assayindex-badge">{offering.externalRecordId}</span>
                {offering.attentionFlags.map((flag) => (
                  <span key={flag} className="assayindex-badge">
                    {flag.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
              <h2 className="mt-3 text-lg font-semibold text-[#102435]">{offering.testName}</h2>
              <p className="mt-2 text-sm leading-7 text-[#526a79]">
                {renderValueOrFallback(offering.methodology)}
              </p>
              <p className="mt-2 text-sm leading-7 text-[#425968]">
                {offering.availability.orderStatus}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  className="assayindex-nav-link assayindex-focus-ring"
                  href={`/assayindex/offerings/${getSourceOfferingRouteSegment(offering)}`}
                >
                  View source offering
                </Link>
                {offering.assaySlug ? (
                  <Link
                    className="assayindex-nav-link assayindex-focus-ring"
                    href={`/assayindex/assays/${offering.assaySlug}`}
                  >
                    View mapped assay
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
          {summary.sourceOfferings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cad8df] p-5 text-sm leading-7 text-[#5b7281]">
              No source-native offerings are stored for this laboratory in the current snapshot.
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <article className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Current lab records</p>
          <div className="mt-4 space-y-3">
            {records.map((record) => (
              <article key={record.id} className="rounded-2xl border border-[#d9e3e8] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="assayindex-badge">{record.category}</span>
                  <span className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">
                    Updated {formatDateOnly(record.updatedAt)}
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-semibold text-[#102435]">{record.recordTitle}</h2>
                <p className="mt-2 text-sm leading-7 text-[#526a79]">{record.testName}</p>
                <p className="mt-3 text-sm leading-7 text-[#425968]">
                  <span className="font-semibold text-[#153042]">Assay:</span>{" "}
                  {summary.assays.find((assay) => assay.slug === record.assaySlug)?.displayName ??
                    record.assaySlug}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    className="assayindex-nav-link assayindex-focus-ring"
                    href={`/assayindex/assays/${record.assaySlug}`}
                  >
                    View assay page
                  </Link>
                </div>
              </article>
            ))}
            {records.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                No normalized assay-lab records are linked to this laboratory.
              </p>
            ) : null}
          </div>
        </article>

        <aside className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Source documents</p>
          <div className="mt-4 space-y-3">
            {sources.map((source) => (
              <article key={source.id} className="rounded-2xl border border-[#d9e3e8] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">
                  {source.sourceType}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-[#102435]">{source.label}</h3>
                <a
                  className="mt-3 block text-sm text-[#0f5f79] underline-offset-4 hover:underline"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.url}
                </a>
                {source.note ? (
                  <p className="mt-2 text-sm leading-7 text-[#5c7281]">{source.note}</p>
                ) : null}
              </article>
            ))}
            {sources.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                No separate supporting source documents are stored for this laboratory.
              </p>
            ) : null}
          </div>
        </aside>
      </section>
    </AssayIndexShell>
  );
}
