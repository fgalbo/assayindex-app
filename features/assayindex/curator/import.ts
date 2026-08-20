import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import { mapValidationIssues, validateCatalog } from "@/features/assayindex/schema/catalog";

export function parseImportedCatalogText(rawText: string) {
  try {
    const parsedJson = JSON.parse(rawText) as unknown;
    const result = validateCatalog(parsedJson);

    if (!result.success) {
      return {
        catalog: null,
        issues: mapValidationIssues(result.error),
      };
    }

    return {
      catalog: result.data,
      issues: [],
    };
  } catch (error) {
    return {
      catalog: null,
      issues: [
        {
          path: "catalog",
          message: error instanceof Error ? error.message : "Unable to parse JSON catalog.",
          code: "invalid_json",
        },
      ],
    };
  }
}

export function serializeCatalog(catalog: AssayIndexCatalog) {
  return JSON.stringify(catalog, null, 2);
}
