import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import { projectPublicCatalogData } from "@/features/assayindex/data/public-catalog.shared.mjs";

export function projectPublicCatalog(catalog: AssayIndexCatalog): AssayIndexCatalog {
  return projectPublicCatalogData(catalog) as AssayIndexCatalog;
}
