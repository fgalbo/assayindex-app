import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { CuratorPage } from "@/features/assayindex/pages/curator-page";

export const metadata: Metadata = {
  title: "Curator | AssayIndex",
  description:
    "Local browser authoring workflow for importing, validating, editing, previewing, and exporting AssayIndex catalog data.",
};

export default function AssayCuratorRoute() {
  return <CuratorPage catalog={publishedCatalog} />;
}
