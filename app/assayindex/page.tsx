import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { LandingPage } from "@/features/assayindex/pages/landing-page";

export const metadata: Metadata = {
  title: "AssayIndex",
  description:
    "Search and download a versioned, provenance-backed index of tests offered by reference laboratories.",
};

export default function AssayIndexHomePage() {
  return <LandingPage catalog={publishedCatalog} />;
}
