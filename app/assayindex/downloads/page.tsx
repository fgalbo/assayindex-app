import type { Metadata } from "next";

import releaseJson from "@/features/assayindex/data/published/release.json";
import {
  DownloadsPage,
  type DownloadRelease,
} from "@/features/assayindex/pages/downloads-page";

export const metadata: Metadata = {
  title: "Downloads | AssayIndex",
  description: "Download release-validated AssayIndex catalog data, provenance, manifests, and checksums.",
};

export default function AssayIndexDownloadsRoute() {
  return <DownloadsPage release={releaseJson as DownloadRelease} />;
}
