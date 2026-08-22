export type CommonLabOrderObservation = "Order" | "Observation" | "Both";
export type CommonLabOrderSourceScope =
  | "common-order-value-set"
  | "assayindex-mnemonic-supplement";

export type CommonLabOrderTerminologyEntry = {
  loincCode: string;
  longCommonName: string;
  orderObservation: CommonLabOrderObservation | null;
  sourceScope: CommonLabOrderSourceScope;
  shortName: string;
  consumerName: string | null;
  relatedNames: string[];
};

export type CommonLabOrderTerminologyIndex = {
  schemaVersion: "1";
  source: {
    sourceId: string;
    valueSetName: string;
    valueSetVersion: string;
    sourcePageUrl: string;
    sourceDataUrl: string;
    searchApiUrl: string;
    searchApiDocsUrl: string;
    enrichment: {
      sourceId: string;
      retrievedAt: string;
      responseSha256: string;
      batchCount: number;
      excludeCopyrighted: true;
      loincReleaseVersion: null;
      releaseVersionStatus: "not-exposed-by-source";
    };
    mnemonicSupplement: {
      sourceId: string;
      selectionVersion: string;
      codeSetSha256: string;
      entryCount: number;
    };
    licenseUrl: string;
    licenseNotice: string;
    sourceUpdatedAt: string | null;
    retrievedAt: string;
    sourceSha256: string;
    sourceEntryCount: number;
    commonOrderPublishedEntryCount: number;
    supplementalEntryCount: number;
    publishedEntryCount: number;
    excludedEntryCount: number;
  };
  entries: CommonLabOrderTerminologyEntry[];
};

export type CommonLabOrderMatchReason =
  | "loinc-code"
  | "long-common-name"
  | "short-name"
  | "consumer-name"
  | "related-name"
  | "assayindex-interpretation"
  | "punctuation-folded";

export type CommonLabOrderSearchResult = {
  loincCode: string;
  longCommonName: string;
  orderObservation: CommonLabOrderObservation | null;
  sourceScope: CommonLabOrderSourceScope;
  officialUrl: string;
  matchedTerm: string;
  matchReason: CommonLabOrderMatchReason;
};

export type CommonLabOrderQueryInterpretation = {
  interpretationType: "assayindex-search-heuristic";
  label: string;
  evidenceLabel: string;
  evidenceUrl: string;
  ambiguityNote: string | null;
};

export type CommonLabOrderSearchResponse = {
  schemaVersion: "1";
  status: "published-common-order-terminology";
  query: string;
  interpretation: CommonLabOrderQueryInterpretation | null;
  matchedCount: number;
  resultCount: number;
  truncated: boolean;
  source: CommonLabOrderTerminologyIndex["source"];
  results: CommonLabOrderSearchResult[];
};
