import { Suspense } from "react";
import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { SearchPage } from "@/features/assayindex/pages/search-page";

export const metadata: Metadata = {
  title: "Search | AssayIndex",
  description:
    "Search normalized assays and source-listed tests by names, source IDs, laboratories, specimens, methods, contacts, and status.",
};

export default function AssaySearchRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#526978]">Loading search...</div>}>
      <SearchPage catalog={publishedCatalog} />
    </Suspense>
  );
}
