import catalogJson from "@/features/assayindex/data/published/catalog.json";
import { publishedSourceOfferingSlices } from "@/features/assayindex/data/published/source-offering-slices.generated";
import { projectPublicCatalog } from "@/features/assayindex/data/public-catalog";
import { mergeSourceOfferingSlices } from "@/features/assayindex/data/source-offering-slices.shared.mjs";
import { parseCatalog } from "@/features/assayindex/schema/catalog";

const catalogWithSourceOfferings = parseCatalog(
  mergeSourceOfferingSlices(parseCatalog(catalogJson), publishedSourceOfferingSlices),
);

export const publishedCatalog = projectPublicCatalog(catalogWithSourceOfferings);
