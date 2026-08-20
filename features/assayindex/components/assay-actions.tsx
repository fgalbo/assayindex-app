"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import type { AssayReport } from "@/features/assayindex/domain/types";
import { downloadAssayReportDocx } from "@/features/assayindex/export/docx";
import { downloadAssayReportJson } from "@/features/assayindex/export/json";
import {
  loadSavedState,
  pushRecentView,
  toggleBookmark,
} from "@/features/assayindex/storage/saved-state";

type AssayActionsProps = {
  report: AssayReport;
  trackView?: boolean;
};

export function AssayActions({ report, trackView = true }: AssayActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [bookmarkedSlugs, setBookmarkedSlugs] = useState<string[]>([]);
  const isBookmarked = bookmarkedSlugs.includes(report.assay.slug);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBookmarkedSlugs(loadSavedState().bookmarks);
    }, 0);

    if (trackView) {
      pushRecentView(report.assay.slug);
    }

    return () => {
      window.clearTimeout(timer);
    };
  }, [report.assay.slug, trackView]);

  return (
    <div className="flex flex-wrap gap-2">
      <button
        className="assayindex-nav-link assayindex-focus-ring"
        type="button"
        onClick={() => {
          startTransition(() => {
            const nextState = toggleBookmark(report.assay.slug);
            setBookmarkedSlugs(nextState.bookmarks);
          });
        }}
      >
        {isBookmarked ? "Bookmarked" : "Save assay"}
      </button>
      <button
        className="assayindex-nav-link assayindex-focus-ring"
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(window.location.href);
        }}
      >
        Copy link
      </button>
      <button
        className="assayindex-nav-link assayindex-focus-ring"
        type="button"
        onClick={() => window.print()}
      >
        Print
      </button>
      <button
        className="assayindex-nav-link assayindex-focus-ring"
        type="button"
        onClick={() => void downloadAssayReportDocx(report)}
      >
        {isPending ? "Working..." : "Export DOCX"}
      </button>
      <button
        className="assayindex-nav-link assayindex-focus-ring"
        type="button"
        onClick={() => downloadAssayReportJson(report)}
      >
        Export JSON
      </button>
      <Link
        className="assayindex-nav-link assayindex-focus-ring"
        href={`/assayindex/compare?assay=${report.assay.slug}`}
      >
        Compare
      </Link>
    </div>
  );
}
