import { Suspense } from "react";
import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { ComparePage } from "@/features/assayindex/pages/compare-page";

export const metadata: Metadata = {
  title: "Compare | AssayIndex",
  description: "Compare source-backed assay records side by side across participating laboratories.",
};

export default function AssayCompareRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#526978]">Loading compare workspace...</div>}>
      <ComparePage catalog={publishedCatalog} />
    </Suspense>
  );
}
