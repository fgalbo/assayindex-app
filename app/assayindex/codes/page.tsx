import { Suspense } from "react";
import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { CodesPage } from "@/features/assayindex/pages/codes-page";

export const metadata: Metadata = {
  title: "Codes | AssayIndex",
  description: "Browse CPT, ICD-10, and LOINC associations tied to assays and lab-specific records.",
};

export default function AssayCodesRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#526978]">Loading code explorer...</div>}>
      <CodesPage catalog={publishedCatalog} />
    </Suspense>
  );
}
