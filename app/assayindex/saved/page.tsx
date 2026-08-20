import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { SavedPage } from "@/features/assayindex/pages/saved-page";

export const metadata: Metadata = {
  title: "Saved | AssayIndex",
  description: "Locally stored bookmarks, recent searches, recent views, and compare presets.",
};

export default function AssaySavedRoute() {
  return <SavedPage catalog={publishedCatalog} />;
}
