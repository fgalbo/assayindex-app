"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useLiveCatalog } from "@/features/assayindex/data/live-catalog";
import type { AssayIndexCatalog, AssayLabRecord } from "@/features/assayindex/domain/types";
import {
  downloadAssayReportJson,
  downloadJsonFile,
} from "@/features/assayindex/export/json";
import {
  buildLabMap,
  getAssayBySlug,
  getAssayReport,
  getRecordsByAssaySlug,
} from "@/features/assayindex/selectors/catalog";
import {
  loadSavedState,
  saveComparePreset,
  setTableDensity,
} from "@/features/assayindex/storage/saved-state";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";
import { CompareTable } from "@/features/assayindex/components/compare-table";

type ComparePageProps = {
  catalog: AssayIndexCatalog;
};

function buildNextUrl(pathname: string, searchParams: URLSearchParams) {
  const queryString = searchParams.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function getInitialSelection(records: AssayLabRecord[]) {
  return records.map((record) => record.id);
}

export function ComparePage({ catalog }: ComparePageProps) {
  const { catalog: liveCatalog } = useLiveCatalog(catalog);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const labsById = useMemo(() => buildLabMap(liveCatalog), [liveCatalog]);
  const [tableDensity, setLocalTableDensity] = useState<"comfortable" | "compact">("comfortable");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocalTableDensity(loadSavedState().preferences.tableDensity);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const selectedAssaySlug = searchParams.get("assay") ?? liveCatalog.assays[0]?.slug ?? "";
  const selectedAssay = getAssayBySlug(liveCatalog, selectedAssaySlug);
  const availableRecords = useMemo(
    () => getRecordsByAssaySlug(liveCatalog, selectedAssaySlug),
    [liveCatalog, selectedAssaySlug],
  );
  const selectedRecordIds = (searchParams.get("records") ?? "")
    .split(",")
    .filter(Boolean)
    .filter((recordId) => availableRecords.some((record) => record.id === recordId));
  const selectedRecords =
    selectedRecordIds.length > 0
      ? availableRecords.filter((record) => selectedRecordIds.includes(record.id))
      : availableRecords;
  const selectedReport = getAssayReport(liveCatalog, selectedAssaySlug);

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

  const exportCompareJson = () => {
    const payload = {
      assaySlug: selectedAssaySlug,
      recordIds: selectedRecords.map((record) => record.id),
      records: selectedRecords,
      generatedAt: new Date().toISOString(),
    };

    downloadJsonFile(`AssayIndex_${selectedAssaySlug || "compare"}_Compare.json`, payload);
  };

  return (
    <AssayIndexShell
      title="Comparison workspace"
      description="Select one assay, choose the lab records you want side by side, then print or export a source-transparent comparison."
    >
      <section className="assayindex-panel p-5 md:p-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
          <label className="space-y-2 text-sm text-[#153042]">
            <span className="font-semibold">Assay</span>
            <select
              className="assayindex-focus-ring w-full rounded-2xl border border-[#cad7de] px-4 py-3"
              value={selectedAssaySlug}
              onChange={(event) => {
                const nextRecords = getInitialSelection(
                  getRecordsByAssaySlug(liveCatalog, event.target.value),
                );
                updateSearchParams({
                  assay: event.target.value,
                  records: nextRecords.join(","),
                });
              }}
            >
              {liveCatalog.assays.map((assay) => (
                <option key={assay.slug} value={assay.slug}>
                  {assay.displayName}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2 text-sm text-[#153042]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Selected records</span>
              <button
                className="assayindex-nav-link assayindex-focus-ring text-xs"
                type="button"
                onClick={() =>
                  updateSearchParams({
                    records: getInitialSelection(availableRecords).join(","),
                  })
                }
              >
                Select all
              </button>
            </div>
            <div className="grid gap-2 rounded-2xl border border-[#d8e3e8] bg-[#f8fbfc] p-3">
              {availableRecords.map((record) => {
                const isChecked =
                  selectedRecordIds.length === 0 || selectedRecordIds.includes(record.id);

                return (
                  <label key={record.id} className="flex items-start gap-3 rounded-xl bg-white/80 p-3">
                    <input
                      checked={isChecked}
                      className="mt-1 h-4 w-4"
                      type="checkbox"
                      onChange={(event) => {
                        const currentIds =
                          selectedRecordIds.length > 0
                            ? [...selectedRecordIds]
                            : getInitialSelection(availableRecords);
                        const nextIds = event.target.checked
                          ? [...new Set([...currentIds, record.id])]
                          : currentIds.filter((item) => item !== record.id);

                        updateSearchParams({ records: nextIds.join(",") });
                      }}
                    />
                    <span className="space-y-1">
                      <span className="block font-semibold text-[#102435]">
                        {labsById.get(record.labId)?.displayName ?? record.labId}
                      </span>
                      <span className="block text-xs leading-5 text-[#57707f]">
                        {record.recordTitle}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 text-sm text-[#153042]">
            <span className="font-semibold">Workspace actions</span>
            <div className="grid gap-2">
              <button
                className="assayindex-nav-link assayindex-focus-ring text-left"
                type="button"
                onClick={() => {
                  const nextDensity =
                    tableDensity === "comfortable" ? "compact" : "comfortable";
                  setLocalTableDensity(nextDensity);
                  setTableDensity(nextDensity);
                }}
              >
                Density: {tableDensity}
              </button>
              <button
                className="assayindex-nav-link assayindex-focus-ring text-left"
                type="button"
                onClick={() => {
                  saveComparePreset({
                    assaySlug: selectedAssaySlug,
                    recordIds: selectedRecords.map((record) => record.id),
                    savedAt: new Date().toISOString(),
                  });
                }}
              >
                Save compare set
              </button>
              <button
                className="assayindex-nav-link assayindex-focus-ring text-left"
                type="button"
                onClick={() => window.print()}
              >
                Print
              </button>
              <button
                className="assayindex-nav-link assayindex-focus-ring text-left"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(window.location.href)}
              >
                Copy share link
              </button>
              <button
                className="assayindex-nav-link assayindex-focus-ring text-left"
                type="button"
                onClick={exportCompareJson}
              >
                Export compare JSON
              </button>
              {selectedReport ? (
                <button
                  className="assayindex-nav-link assayindex-focus-ring text-left"
                  type="button"
                  onClick={() => downloadAssayReportJson(selectedReport)}
                >
                  Export assay report JSON
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="assayindex-kicker">Selected assay</p>
            <h2 className="mt-2 text-3xl font-semibold text-[#102435]">
              {selectedAssay?.displayName ?? "Select an assay"}
            </h2>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-[#506776]">
              {selectedAssay?.summary ??
                "Choose an assay to compare record-level ordering, specimen, handling, methodology, and reflex logic details."}
            </p>
          </div>
          {selectedAssay ? (
            <Link
              className="assayindex-nav-link assayindex-focus-ring assayindex-print-hide"
              href={`/assayindex/assays/${selectedAssay.slug}`}
            >
              Open assay detail
            </Link>
          ) : null}
        </div>

        <div className="mt-6">
          {selectedRecords.length > 0 ? (
            <CompareTable
              density={tableDensity}
              labsById={labsById}
              records={selectedRecords}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-[#c3d4dc] p-8 text-center">
              <h3 className="text-xl font-semibold text-[#102435]">No records selected</h3>
              <p className="mt-2 text-sm leading-7 text-[#5b7281]">
                Pick one or more lab records above to build a side-by-side comparison. Missing values
                remain labeled as Not listed by source.
              </p>
            </div>
          )}
        </div>
      </section>
    </AssayIndexShell>
  );
}
