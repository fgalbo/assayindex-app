export const LABORATORY_SOURCE_IDS = ["arup", "mayo", "quest", "labcorp"] as const;

export type LaboratorySourceId = (typeof LABORATORY_SOURCE_IDS)[number];

export type SourceAdapterStatus =
  | "enabled"
  | "disabled"
  | "not-configured"
  | "permission-required"
  | "official-directory-only"
  | "source-unavailable"
  | "parser-not-implemented";

export type SourceSearchResultStatus =
  | "success"
  | "disabled"
  | "not-configured"
  | "permission-required"
  | "official-directory-only"
  | "source-unavailable"
  | "parser-not-implemented"
  | "timeout"
  | "rate-limited"
  | "error";

export type SourceSearchContext = {
  requestId: string;
  signal: AbortSignal;
  cacheMode?: "default" | "refresh";
};

export type SourceSearchReference = {
  sourceLab: LaboratorySourceId;
  sourceRef: string;
  sourceUrl: string;
  sourceTestCode: string | null;
  title: string;
  summary: string | null;
  orderingRecommendation: string | null;
  sourceStatus: string | null;
};

export type RawSourceSnapshot = {
  sourceLab: LaboratorySourceId;
  sourceRef: string;
  sourceUrl: string;
  fetchedAt: string;
  mediaType: string;
  body: string;
  contentHash: string;
  responseMetadata: Record<string, string>;
};

export type FieldProvenance<T = unknown> = {
  rawValue: unknown;
  normalizedValue: T | null;
  sourceUrl: string;
  sourcePath: string;
  fetchedAt: string;
  parserVersion: string;
  confidence: number | null;
};

export type ParsedSpecimenOption = {
  specimenType: string | null;
  preferred: boolean | null;
  container: string | null;
  preferredVolume: string | null;
  minimumVolume: string | null;
  patientPreparation: string | null;
  collectionInstructions: string | null;
  transportTemperature: string | null;
  ambientStability: string | null;
  refrigeratedStability: string | null;
  frozenStability: string | null;
  rejectionCriteria: string[];
};

export type ParsedSourceOffering = {
  sourceLab: LaboratorySourceId;
  sourceRef: string;
  sourceUrl: string;
  sourceTestCode: string | null;
  sourceTitle: string;
  testName: string | null;
  aliases: string[];
  analytes: string[];
  genes: string[];
  orderingRecommendation: string | null;
  methodology: string | null;
  methodClass: string | null;
  measurementType: string | null;
  specimenOptions: ParsedSpecimenOption[];
  turnaroundTime: string | null;
  performingSchedule: string | null;
  performingLocation: string | null;
  cptCodes: string[];
  loincCodes: string[];
  resultComponents: Array<{
    sourceTestCode: string | null;
    name: string | null;
    loincCode: string | null;
    units: string | null;
  }>;
  reflexRules: string[];
  clinicalUse: string | null;
  limitations: string | null;
  availability: string | null;
  serviceAreas: string[];
  parseWarnings: string[];
  fieldProvenance: Record<string, FieldProvenance>;
  parserVersion: string;
  adapterVersion: string;
  contentHash: string;
  fetchedAt: string;
};

export type LaboratorySourceAdapter = {
  id: LaboratorySourceId;
  displayName: string;
  sourcePolicyId: string;
  officialDirectoryUrl: string;
  status: SourceAdapterStatus;
  adapterVersion: string;
  parserVersion: string;
  statusMessage: string | null;
  resolveReference(sourceRef: string): SourceSearchReference;
  search(query: string, context: SourceSearchContext): Promise<SourceSearchReference[]>;
  fetchDetails(reference: SourceSearchReference, context: SourceSearchContext): Promise<RawSourceSnapshot>;
  parse(snapshot: RawSourceSnapshot): Promise<ParsedSourceOffering>;
};

export type SourceSearchResult = {
  status: SourceSearchResultStatus;
  cached: boolean;
  results: SourceSearchReference[];
  message: string | null;
  officialDirectoryUrl: string;
};

export type FederatedSearchResponse = {
  requestId: string;
  query: string;
  searchedAt: string;
  sources: Partial<Record<LaboratorySourceId, SourceSearchResult>>;
};

export type SourceCandidateStatus =
  | "discovered"
  | "fetched"
  | "parsed"
  | "needs-review"
  | "approved"
  | "rejected"
  | "error";

export type SourceCandidate = {
  id: string;
  sourceLab: LaboratorySourceId;
  sourceRef: string;
  sourceUrl: string;
  sourceTestCode: string | null;
  sourceTitle: string;
  discoveryQuery: string;
  status: SourceCandidateStatus;
  rawSnapshotLocation: string | null;
  rawSnapshotHash: string | null;
  rawSnapshotMediaType: string | null;
  parsedData: ParsedSourceOffering | null;
  normalizedData: Record<string, unknown> | null;
  parserVersion: string;
  adapterVersion: string;
  parseWarnings: string[];
  lastError: string | null;
  discoveredAt: string;
  fetchedAt: string | null;
  importedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};
