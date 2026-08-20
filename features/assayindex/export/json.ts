import type { AssayIndexCatalog, AssayReport } from "@/features/assayindex/domain/types";
import { downloadTextFile } from "@/features/assayindex/utils/formatting";

export function downloadJsonFile(fileName: string, value: unknown) {
  downloadTextFile(fileName, JSON.stringify(value, null, 2), "application/json");
}

export function downloadCatalogJson(catalog: AssayIndexCatalog, fileName = "AssayIndex_catalog.json") {
  downloadJsonFile(fileName, catalog);
}

export function downloadAssayReportJson(report: AssayReport) {
  downloadJsonFile(`AssayIndex_${report.assay.slug}_report.json`, report);
}
