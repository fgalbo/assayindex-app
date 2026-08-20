export type SourceLink = {
  label: string;
  url: string;
  sourceType:
    | "test-page"
    | "test-guide"
    | "faq"
    | "overview"
    | "pdf"
    | "brochure"
    | "reference"
    | "other";
  note?: string | null;
};

export type AssociatedCode = {
  code: string;
  description: string;
  category: "CPT" | "ICD10" | "LOINC" | "OTHER";
  scope: "assay-level" | "lab-specific";
  note?: string | null;
};

export type Assay = {
  slug: string;
  displayName: string;
  summary: string;
  purpose: string;
  specialty: string[];
  synonyms: string[];
  keywords: string[];
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
};

export type Lab = {
  id: string;
  displayName: string;
  shortName: string;
  website: string | null;
  notes: string | null;
};

export type PriceObservation = {
  priceType: "cash" | "list" | "medicare-clfs" | "negotiated" | "other";
  sourceText: string;
  amount: string | null;
  minimumAmount: string | null;
  maximumAmount: string | null;
  currency: string;
  effectiveDate: string | null;
  sourceUrl: string;
  note: string | null;
};

export type AssayLabRecord = {
  id: string;
  assaySlug: string;
  labId: string;
  category:
    | "standard"
    | "with-reflex"
    | "resistance"
    | "quantification"
    | "panel"
    | "reference"
    | "faq"
    | "other";
  displayOrder: number;
  recordTitle: string;
  testName: string;
  testCode: string | null;
  testId: string | null;
  orderCode: string | null;
  synonyms: string[];
  cptCodes: string[];
  loincCodes: string[];
  associatedIcd10: AssociatedCode[];
  specimenType: string | null;
  specimenVolume: string | null;
  minimumVolume: string | null;
  container: string | null;
  handling: string | null;
  storage: string | null;
  transportTemperature: string | null;
  stability: string | null;
  turnaroundTime: string | null;
  methodology: string | null;
  priceObservations: PriceObservation[] | null;
  useOrClinicalSignificance: string | null;
  patientPreparation: string | null;
  collectionInstructions: string | null;
  rejectionCriteria: string | null;
  includes: string | null;
  reflexLogic: string | null;
  limitations: string | null;
  interferences: string | null;
  performingSchedule: string | null;
  notes: string | null;
  sourceLinks: SourceLink[];
  publicationStatus: "draft" | "published";
  sourceVerifiedAt: string | null;
  updatedAt: string;
};

export type SourceOfferingAttentionFlag =
  | "source_offline"
  | "source_status_unavailable"
  | "non_clia"
  | "prior_approval_required"
  | "source_missing";

export type SourceOfferingContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

export type SourceOffering = {
  id: string;
  assaySlug: string | null;
  labId: string;
  sourceId: string;
  sourcePublisherId: string;
  externalRecordId: string;
  testName: string;
  aliases: string[];
  sourceTestId: string | null;
  sourceLabId: string | null;
  sourceUnitNumber: string | null;
  methodology: string | null;
  turnaroundTime: string | null;
  structuredTurnaroundTime: {
    value: number;
    unit: "day" | "week";
  } | null;
  acceptableSampleForTesting: string | null;
  minimumVolume: string | null;
  storageAndPreservation: string | null;
  transport: string | null;
  shippingInstructions: string | null;
  interferencesAndLimitations: string | null;
  additionalInformation: string | null;
  supplementalInformationRequired: string | null;
  specimenLabeling: string | null;
  sourceLinkText: string | null;
  legacyLinkText: string | null;
  availability: {
    orderStatus: string;
    offline: boolean;
    clia: boolean;
    priorApprovalRequired: boolean;
    performedOn: {
      human: boolean;
      animal: boolean;
      other: boolean;
    };
    sourcePresence: "listed" | "source-missing";
  };
  contacts: {
    cdc: SourceOfferingContact[];
    priorApproval: SourceOfferingContact[];
  };
  sourceVersion: string;
  sourceLinks: SourceLink[];
  attentionFlags: SourceOfferingAttentionFlag[];
  provenance: {
    snapshotSha256: string;
    candidateSha256: string;
    retrievedAt: string;
    sourceUpdatedAt: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    missingSince: string | null;
    detailUrl: string;
  };
  publicationStatus: "draft" | "published";
  updatedAt: string;
};

export type CuratedAssayRelationship = {
  id: string;
  sourcePublisherId: string;
  sourceAssaySlug: string;
  targetAssaySlug: string;
  relationshipType:
    | "reflex-to"
    | "confirmatory-for"
    | "alternative-to"
    | "component-of"
    | "other";
  rationale: string;
  sourceLinks: SourceLink[];
  reviewedAt: string;
  publicationStatus: "draft" | "published";
  updatedAt: string;
};

export type CoOrderRelationship = {
  id: string;
  leftAssaySlug: string;
  rightAssaySlug: string;
  basis:
    | "same-order"
    | "same-claim"
    | "same-visit-ordered-or-provided"
    | "same-visit-measurement"
    | "synthetic";
  counts: {
    eligibleSetCount: number;
    leftSetCount: number;
    rightSetCount: number;
    pairSetCount: number;
  };
  cohort: {
    label: string;
    description: string;
  };
  observationWindow: {
    startDate: string;
    endDate: string;
  };
  source: {
    publisherId: string;
    datasetId: string;
    datasetVersion: string;
    snapshotSha256: string;
    url: string;
    retrievedAt: string;
  };
  mapping: {
    codeSystem: string;
    leftCodes: string[];
    rightCodes: string[];
    mappingVersion: string;
    method: string;
    reviewedAt: string;
  };
  disclosureReview: {
    status: "passed";
    reviewedAt: string;
    method: string;
    note: string | null;
  };
  publicationStatus: "draft" | "published";
  updatedAt: string;
};

export type SourceDocument = {
  id: string;
  assaySlug: string;
  labId: string;
  label: string;
  url: string;
  sourceType:
    | "test-page"
    | "test-guide"
    | "faq"
    | "overview"
    | "pdf"
    | "brochure"
    | "reference"
    | "other";
  relatedRecordIds: string[];
  note: string | null;
  verifiedAt: string | null;
};

export type AssayIndexCatalogMeta = {
  title: string;
  version: string;
  lastPublishedAt: string;
  disclaimer: string;
};

export type AssayLevelCode = AssociatedCode & {
  id: string;
  assaySlug: string;
};

export type AssayIndexCatalog = {
  meta: AssayIndexCatalogMeta;
  assays: Assay[];
  labs: Lab[];
  assayLabRecords: AssayLabRecord[];
  sourceOfferings?: SourceOffering[];
  sourceDocuments: SourceDocument[];
  assayLevelCodes: AssayLevelCode[];
  curatedAssayRelationships: CuratedAssayRelationship[];
  coOrderRelationships: CoOrderRelationship[];
};

export type CuratedAssayRelationshipSummary = {
  relationship: CuratedAssayRelationship;
  otherAssay: Assay;
  direction: "outgoing" | "incoming";
};

export type CoOrderRelationshipSummary = {
  relationship: CoOrderRelationship;
  otherAssay: Assay;
  focalSetCount: number;
  pairSetCount: number;
  percentage: number;
};

export type AssayReport = {
  assay: Assay;
  labRecords: AssayLabRecord[];
  assayLevelCodes: AssayLevelCode[];
  sources: SourceDocument[];
  curatedRelationships: CuratedAssayRelationshipSummary[];
  coOrderRelationships: CoOrderRelationshipSummary[];
  disclaimer: string;
  generatedAt: string;
};

export type AssaySearchDocument = {
  assaySlug: string;
  displayName: string;
  summary: string;
  purpose: string;
  specialty: string[];
  synonyms: string[];
  keywords: string[];
  labIds: string[];
  labNames: string[];
  categories: string[];
  sourceTypes: string[];
  testNames: string[];
  recordTitles: string[];
  codes: string[];
  specimenTypes: string[];
  methodologies: string[];
  notes: string[];
  hasReflexLogic: boolean;
  hasCpt: boolean;
  hasLoinc: boolean;
  labCount: number;
  sourceCount: number;
  updatedAt: string;
};

export type SearchFilters = {
  labId?: string;
  specialty?: string;
  category?: string;
  sourceType?: string;
  specimenType?: string;
  methodology?: string;
  hasReflexLogic?: boolean;
  hasCpt?: boolean;
  hasLoinc?: boolean;
};

export type SearchSort =
  | "relevance"
  | "alphabetical"
  | "recently-updated"
  | "source-coverage"
  | "lab-count";

export type AssaySearchResult = {
  document: AssaySearchDocument;
  score: number | null;
};

export type CodeExplorerEntry = {
  category: AssociatedCode["category"];
  code: string;
  description: string | null;
  scope: AssociatedCode["scope"];
  note: string | null;
  assaySlugs: string[];
  labIds: string[];
  recordIds: string[];
  assayCount: number;
};

export type LabSummary = {
  lab: Lab;
  assayCount: number;
  recordCount: number;
  sourceCount: number;
  assays: Assay[];
};

export type CompareRow = {
  key: string;
  label: string;
  values: Record<string, string>;
};

export type SavedComparePreset = {
  assaySlug: string;
  recordIds: string[];
  savedAt: string;
};

export type SavedState = {
  bookmarks: string[];
  recentSearches: string[];
  recentViews: string[];
  comparePresets: SavedComparePreset[];
  preferences: {
    tableDensity: "comfortable" | "compact";
  };
};

export type ValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export type CuratorDraft = {
  catalog: AssayIndexCatalog;
  updatedAt: string;
  sourceName: string | null;
  issues: ValidationIssue[];
};

export type CatalogEntityType = "assay" | "record" | "lab" | "source" | "code";

export type CatalogSelection = {
  type: CatalogEntityType;
  id: string;
};
