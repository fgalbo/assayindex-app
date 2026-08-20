"use client";

import Link from "next/link";
import { useState } from "react";

import type {
  CoOrderRelationshipSummary,
  CuratedAssayRelationshipSummary,
} from "@/features/assayindex/domain/types";

const DEFAULT_CO_ORDER_PERCENTAGE = 10;

function formatPercentage(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function observationUnitLabel(
  basis: CoOrderRelationshipSummary["relationship"]["basis"],
  count: number,
) {
  const labels = {
    "same-order": ["order", "orders"],
    "same-claim": ["claim", "claims"],
    "same-visit-ordered-or-provided": ["visit", "visits"],
    "same-visit-measurement": ["visit", "visits"],
    synthetic: ["synthetic record", "synthetic records"],
  } as const;

  return labels[basis][count === 1 ? 0 : 1];
}

export function CuratedAssayRelationships({
  summaries,
}: {
  summaries: CuratedAssayRelationshipSummary[];
}) {
  if (summaries.length === 0) {
    return null;
  }

  return (
    <section className="assayindex-panel p-5 md:p-6">
      <p className="assayindex-kicker">Curated assay relationships</p>
      <p className="mt-2 text-sm leading-6 text-[#536979]">
        Source-backed clinical or ordering relationships reviewed by an AssayIndex curator.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {summaries.map(({ direction, otherAssay, relationship }) => (
          <article key={relationship.id} className="rounded-2xl border border-[#d9e3e8] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="assayindex-badge">{relationship.relationshipType.replaceAll("-", " ")}</span>
              <span className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">{direction}</span>
            </div>
            <h3 className="mt-3 text-lg font-semibold text-[#102435]">
              <Link className="underline-offset-4 hover:underline" href={`/assayindex/assays/${otherAssay.slug}`}>
                {otherAssay.displayName}
              </Link>
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#526a79]">{relationship.rationale}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {relationship.sourceLinks.map((source) => (
                <li key={source.url}>
                  <a
                    className="text-[#0f5f79] underline-offset-4 hover:underline"
                    href={source.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CoOrderAssociations({ summaries }: { summaries: CoOrderRelationshipSummary[] }) {
  const [showLessCommon, setShowLessCommon] = useState(false);

  if (summaries.length === 0) {
    return null;
  }

  const lessCommonCount = summaries.filter(
    (summary) => summary.percentage < DEFAULT_CO_ORDER_PERCENTAGE,
  ).length;
  const visibleSummaries = showLessCommon
    ? summaries
    : summaries.filter((summary) => summary.percentage >= DEFAULT_CO_ORDER_PERCENTAGE);

  return (
    <section className="assayindex-panel p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="assayindex-kicker">Typically ordered in conjunction</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#536979]">
            Aggregate historical co-occurrence. These observations are not clinical recommendations
            and do not establish appropriateness, coverage, or current orderability.
          </p>
        </div>
        {lessCommonCount > 0 ? (
          <button
            aria-expanded={showLessCommon}
            className="assayindex-nav-link assayindex-focus-ring"
            type="button"
            onClick={() => setShowLessCommon((current) => !current)}
          >
            {showLessCommon
              ? "Hide less-common co-orders (under 10%)"
              : "Show less-common co-orders (under 10%)"}
          </button>
        ) : null}
      </div>

      {visibleSummaries.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {visibleSummaries.map(({ focalSetCount, otherAssay, pairSetCount, percentage, relationship }) => {
            const unit = observationUnitLabel(relationship.basis, focalSetCount);

            return (
              <article key={relationship.id} className="rounded-2xl border border-[#d9e3e8] p-4">
                <p className="text-2xl font-semibold text-[#102435]">{formatPercentage(percentage)}%</p>
                <p className="mt-2 text-sm leading-6 text-[#425968]">
                  Among {focalSetCount.toLocaleString("en-US")} {unit} containing this assay, {formatPercentage(percentage)}% also included{" "}
                  <Link className="font-semibold text-[#0f5f79] underline-offset-4 hover:underline" href={`/assayindex/assays/${otherAssay.slug}`}>
                    {otherAssay.displayName}
                  </Link>
                  .
                </p>
                <p className="mt-2 text-xs leading-5 text-[#617886]">
                  {pairSetCount.toLocaleString("en-US")} co-occurrences · {relationship.cohort.label} ·{" "}
                  {relationship.observationWindow.startDate} through {relationship.observationWindow.endDate}
                </p>
                <a
                  className="mt-3 inline-block text-sm text-[#0f5f79] underline-offset-4 hover:underline"
                  href={relationship.source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {relationship.source.datasetId} ({relationship.source.datasetVersion})
                </a>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6 text-[#536979]">
          All published associations are below 10%. Use the control above to reveal them.
        </p>
      )}

      {lessCommonCount > 0 ? (
        <p className="mt-4 text-xs leading-5 text-[#617886]">
          The 10% threshold changes presentation only. Every published association remains available
          here and in the downloadable catalog.
        </p>
      ) : null}
    </section>
  );
}
