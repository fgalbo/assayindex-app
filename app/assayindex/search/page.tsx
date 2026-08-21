import { Suspense } from "react";
import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { getFederatedSearchConfig } from "@/features/assayindex/federated/config.server";
import { SearchPage } from "@/features/assayindex/pages/search-page";

export const metadata: Metadata = {
  title: "Search | AssayIndex",
  description:
    "Search normalized assays and source-listed tests by names, source IDs, laboratories, specimens, methods, contacts, and status.",
};

export default function AssaySearchRoute() {
  const { autoFallbackEnabled } = getFederatedSearchConfig();

  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#526978]">Loading search...</div>}>
      <SearchPage autoFallbackEnabled={autoFallbackEnabled} catalog={publishedCatalog} />
    </Suspense>
  );
}
