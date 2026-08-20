import { Suspense } from "react";
import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { LabsPage } from "@/features/assayindex/pages/labs-page";

export const metadata: Metadata = {
  title: "Labs | AssayIndex",
  description:
    "Directory of laboratories represented by normalized assays or source-listed test offerings in AssayIndex.",
};

export default function AssayLabsRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#526978]">Loading lab directory...</div>}>
      <LabsPage catalog={publishedCatalog} />
    </Suspense>
  );
}
