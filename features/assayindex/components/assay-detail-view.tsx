import Link from "next/link";

import { ASSAY_DETAIL_FIELDS } from "@/features/assayindex/constants";
import type { AssayLabRecord, AssayReport, Lab } from "@/features/assayindex/domain/types";
import { formatDateOnly, renderListOrFallback, renderValueOrFallback } from "@/features/assayindex/utils/formatting";

import { AssayActions } from "@/features/assayindex/components/assay-actions";
import {
  CoOrderAssociations,
  CuratedAssayRelationships,
} from "@/features/assayindex/components/assay-relationships";
import { CompareTable } from "@/features/assayindex/components/compare-table";

type AssayDetailViewProps = {
  report: AssayReport;
  labs: Lab[];
  previewMode?: boolean;
};

function groupCodes(report: AssayReport) {
  return {
    CPT: report.assayLevelCodes.filter((code) => code.category === "CPT"),
    ICD10: report.assayLevelCodes.filter((code) => code.category === "ICD10"),
    LOINC: report.assayLevelCodes.filter((code) => code.category === "LOINC"),
    OTHER: report.assayLevelCodes.filter((code) => code.category === "OTHER"),
  };
}

function recordCodeSummary(record: AssayLabRecord) {
  return renderListOrFallback([
    record.testCode ? `Test ${record.testCode}` : null,
    record.orderCode ? `Order ${record.orderCode}` : null,
    record.testId ? `ID ${record.testId}` : null,
    record.cptCodes.length > 0 ? `CPT ${record.cptCodes.join(", ")}` : null,
    record.loincCodes.length > 0 ? `LOINC ${record.loincCodes.join(", ")}` : null,
    record.associatedIcd10.length > 0
      ? `ICD-10 ${record.associatedIcd10.map((code) => `${code.code}${code.note ? " *" : ""}`).join(", ")}`
      : null,
  ]);
}

export function AssayDetailView({ report, labs, previewMode = false }: AssayDetailViewProps) {
  const codeGroups = groupCodes(report);
  const labMap = new Map(labs.map((lab) => [lab.id, lab]));
  const distinctLabCount = new Set(report.labRecords.map((record) => record.labId)).size;

  return (
    <div className="space-y-6">
      <section className="assayindex-panel p-5 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {report.assay.specialty.map((tag) => (
                <span key={tag} className="assayindex-badge">
                  {tag}
                </span>
              ))}
              <span className="assayindex-badge">{report.labRecords.length} lab records</span>
              <span className="assayindex-badge">{report.sources.length} source documents</span>
            </div>
            <div>
              <h2 className="text-3xl font-semibold text-[#0f2435] md:text-4xl">{report.assay.displayName}</h2>
              <p className="mt-3 max-w-4xl text-base leading-7 text-[#425967]">{report.assay.summary}</p>
            </div>
            {report.assay.synonyms.length > 0 ? (
              <p className="text-sm leading-6 text-[#536979]">
                <span className="font-semibold text-[#193447]">Synonyms:</span>{" "}
                {report.assay.synonyms.join(", ")}
              </p>
            ) : null}
          </div>
          {!previewMode ? <AssayActions report={report} /> : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_320px]">
        <article className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Clinical purpose</p>
          <p className="mt-4 text-base leading-7 text-[#173446]">{report.assay.purpose}</p>
        </article>

        <aside className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Quick stats</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#526574]">Labs represented</dt>
              <dd className="font-semibold text-[#132332]">{distinctLabCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#526574]">Source documents</dt>
              <dd className="font-semibold text-[#132332]">{report.sources.length}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#526574]">Last updated</dt>
              <dd className="font-semibold text-[#132332]">{formatDateOnly(report.assay.updatedAt)}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <CuratedAssayRelationships summaries={report.curatedRelationships} />

      <CoOrderAssociations summaries={report.coOrderRelationships} />

      <section className="assayindex-panel p-5 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="assayindex-kicker">Associated codes</p>
            <p className="mt-2 text-sm leading-6 text-[#536979]">
              Assay-level codes are separated from lab-specific codes. ICD-10 associations are informational only.
            </p>
          </div>
          {!previewMode ? (
            <Link className="assayindex-nav-link assayindex-focus-ring assayindex-print-hide" href="/assayindex/codes">
              Browse code explorer
            </Link>
          ) : null}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(codeGroups).map(([label, codes]) => (
            <article key={label} className="rounded-2xl border border-[#d9e3e8] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#476173]">{label}</h3>
              {codes.length > 0 ? (
                <ul className="mt-3 space-y-3 text-sm">
                  {codes.map((code) => (
                    <li key={code.id} className="rounded-xl bg-[#f5f9fa] p-3">
                      <p className="font-semibold text-[#112535]">{code.code}</p>
                      <p className="mt-1 text-[#4f6675]">{code.description}</p>
                      {code.note ? <p className="mt-1 text-xs leading-5 text-[#607584]">{code.note}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#647886]">Not listed by source</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="assayindex-kicker">Cross-lab comparison</p>
            <p className="mt-2 text-sm leading-6 text-[#536979]">
              A concise side-by-side view of ordering and handling differences across current source-backed records.
            </p>
          </div>
        </div>
        <div className="mt-5">
          <CompareTable records={report.labRecords} labsById={labMap} />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="assayindex-kicker">Detailed lab records</p>
          <p className="mt-2 text-sm leading-6 text-[#536979]">
            Each card preserves lab-specific terminology, operational notes, and direct source links.
          </p>
        </div>
        <div className="grid gap-4">
          {report.labRecords.map((record) => (
            <article key={record.id} className="assayindex-panel p-5 md:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="assayindex-kicker">{labMap.get(record.labId)?.displayName ?? record.labId}</span>
                    <span className="assayindex-badge">{record.category}</span>
                  </div>
                  <h3 className="mt-3 text-2xl font-semibold text-[#102435]">{record.recordTitle}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#4a6271]">{record.testName}</p>
                  <p className="mt-2 text-sm leading-6 text-[#153042]">{recordCodeSummary(record)}</p>
                </div>
                {record.synonyms.length > 0 ? (
                  <div className="max-w-sm rounded-2xl bg-[#f5f9fa] p-4">
                    <p className="assayindex-kicker">Aliases</p>
                    <p className="mt-2 text-sm leading-6 text-[#4b6473]">{record.synonyms.join(", ")}</p>
                  </div>
                ) : null}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {ASSAY_DETAIL_FIELDS.map(([fieldKey, label]) => (
                  <div key={fieldKey} className="rounded-2xl border border-[#d9e3e8] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#5a707f]">{label}</p>
                    <p className="mt-2 text-sm leading-6 text-[#153042]">
                      {renderValueOrFallback(record[fieldKey as keyof AssayLabRecord] as string | null)}
                    </p>
                  </div>
                ))}
                <div className="rounded-2xl border border-[#d9e3e8] p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#5a707f]">Source-listed price</p>
                  {record.priceObservations && record.priceObservations.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-[#153042]">
                      {record.priceObservations.map((price) => (
                        <li key={`${price.priceType}:${price.sourceUrl}:${price.effectiveDate ?? "current"}`}>
                          <a
                            className="text-[#0f5f79] underline-offset-4 hover:underline"
                            href={price.sourceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {price.sourceText}
                          </a>
                          <span className="ml-2 text-xs text-[#617886]">
                            ({price.priceType.replaceAll("-", " ")}
                            {price.effectiveDate ? `, effective ${price.effectiveDate}` : ""})
                          </span>
                          {price.note ? <p className="text-[#617886]">{price.note}</p> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-[#153042]">Not listed by source</p>
                  )}
                </div>
                <div className="rounded-2xl border border-[#d9e3e8] p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#5a707f]">Informational ICD-10</p>
                  <p className="mt-2 text-sm leading-6 text-[#153042]">
                    {record.associatedIcd10.length > 0
                      ? record.associatedIcd10
                          .map((code) => `${code.code} - ${code.description}${code.note ? ` (${code.note})` : ""}`)
                          .join("; ")
                      : "Not listed by source"}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl bg-[#f7fafb] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5a707f]">Source links</p>
                <ul className="mt-3 space-y-2 text-sm leading-6">
                  {record.sourceLinks.map((link) => (
                    <li key={link.url}>
                      <a className="text-[#0f5f79] underline-offset-4 hover:underline" href={link.url} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                      <span className="ml-2 text-[#617886]">({link.sourceType})</span>
                      {link.note ? <p className="text-[#617886]">{link.note}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <p className="assayindex-kicker">Supporting references</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {report.sources.map((source) => (
            <article key={source.id} className="rounded-2xl border border-[#d9e3e8] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-[0.16em] text-[#5a707f]">{source.sourceType}</span>
                <span className="assayindex-badge">{source.relatedRecordIds.length} linked record(s)</span>
              </div>
              <h3 className="mt-3 text-lg font-semibold text-[#122637]">{source.label}</h3>
              <a className="mt-3 block text-sm text-[#0f5f79] underline-offset-4 hover:underline" href={source.url} target="_blank" rel="noreferrer">
                {source.url}
              </a>
              {source.note ? <p className="mt-2 text-sm leading-6 text-[#5d7484]">{source.note}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <p className="assayindex-kicker">Disclaimer</p>
        <p className="mt-4 text-sm leading-7 text-[#475d6c]">{report.disclaimer}</p>
      </section>
    </div>
  );
}
