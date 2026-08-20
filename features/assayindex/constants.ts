export const ASSAYINDEX_BASE_PATH = "/assayindex";
export const ASSAYINDEX_PUBLIC_CATALOG_PATH = `${ASSAYINDEX_BASE_PATH}/catalog.json`;
export const ASSAYINDEX_DOWNLOADS_PATH = `${ASSAYINDEX_BASE_PATH}/downloads`;
export const ASSAYINDEX_CATALOG_BROWSE_ENABLED = false;

export const ASSAYINDEX_STORAGE_KEY = "assayindex.saved-state.v1";
export const ASSAYINDEX_DRAFT_STORAGE_KEY = "assayindex.curator-draft.v1";
export const ASSAYINDEX_IMPORT_NAME_KEY = "assayindex.curator-import-name.v1";

export const ASSAYINDEX_DISCLAIMER =
  "AssayIndex is an informational reference workspace. Verify current requirements, ordering details, and billing guidance with the source laboratory before ordering or submitting claims.";

export const NOT_LISTED_BY_SOURCE = "Not listed by source";

const ASSAYINDEX_NAV_ITEMS_WITH_CATALOG = [
  { href: ASSAYINDEX_BASE_PATH, label: "Overview" },
  { href: `${ASSAYINDEX_BASE_PATH}/assays`, label: "Catalog" },
  { href: `${ASSAYINDEX_BASE_PATH}/search`, label: "Search" },
  { href: `${ASSAYINDEX_BASE_PATH}/compare`, label: "Compare" },
  { href: `${ASSAYINDEX_BASE_PATH}/codes`, label: "Codes" },
  { href: `${ASSAYINDEX_BASE_PATH}/labs`, label: "Labs" },
  { href: ASSAYINDEX_DOWNLOADS_PATH, label: "Downloads" },
  { href: `${ASSAYINDEX_BASE_PATH}/saved`, label: "Saved" },
  { href: `${ASSAYINDEX_BASE_PATH}/curator`, label: "Curator" },
] as const;

export const ASSAYINDEX_NAV_ITEMS = ASSAYINDEX_NAV_ITEMS_WITH_CATALOG.filter(
  (item) => ASSAYINDEX_CATALOG_BROWSE_ENABLED || item.href !== `${ASSAYINDEX_BASE_PATH}/assays`,
);

export const ASSAY_DETAIL_FIELDS = [
  ["testCode", "Test code"],
  ["orderCode", "Order code"],
  ["testId", "Test ID"],
  ["specimenType", "Specimen type"],
  ["specimenVolume", "Preferred volume"],
  ["minimumVolume", "Minimum volume"],
  ["container", "Container"],
  ["handling", "Handling"],
  ["storage", "Storage"],
  ["transportTemperature", "Transport temperature"],
  ["stability", "Stability"],
  ["turnaroundTime", "Turnaround time"],
  ["methodology", "Methodology"],
  ["useOrClinicalSignificance", "Use / clinical significance"],
  ["patientPreparation", "Patient preparation"],
  ["collectionInstructions", "Collection instructions"],
  ["rejectionCriteria", "Rejection criteria"],
  ["includes", "Includes"],
  ["reflexLogic", "Reflex logic"],
  ["limitations", "Limitations"],
  ["interferences", "Interferences"],
  ["performingSchedule", "Performing schedule"],
  ["notes", "Notes"],
] as const;

export const COMPARE_FIELDS = [
  { key: "category", label: "Category" },
  { key: "testName", label: "Test name" },
  { key: "codes", label: "Codes" },
  { key: "specimenType", label: "Specimen" },
  { key: "container", label: "Container" },
  { key: "handling", label: "Handling" },
  { key: "storage", label: "Storage" },
  { key: "turnaroundTime", label: "Turnaround time" },
  { key: "methodology", label: "Methodology" },
  { key: "price", label: "Source-listed price" },
  { key: "reflexLogic", label: "Reflex logic" },
  { key: "limitations", label: "Limitations" },
  { key: "sourceCoverage", label: "Source coverage" },
] as const;
