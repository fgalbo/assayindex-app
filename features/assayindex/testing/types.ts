export type GtrTestingSearchRecord = {
  id: string;
  kind: "validated-staged-gtr";
  sourceId: string;
  publisherId: string;
  externalRecordId: string;
  providerId: string;
  testName: string;
  labName: string;
  institutionName: string | null;
  location: string | null;
  orderCode: string | null;
  sourceTestId: string | null;
  genes: string[];
  geneIds: string[];
  geneMedgenIds: string[];
  conditions: string[];
  conditionIds: string[];
  methods: string[];
  reviewFlags: string[];
  candidateState: string;
  sourceLastTouchedAt: string | null;
  officialUrl: string;
};

export type GtrTestingSearchResponse = {
  schemaVersion: "1";
  status: "validated-staged-testing";
  query: string;
  matchedCount: number;
  resultCount: number;
  truncated: boolean;
  source: {
    sourceId: string;
    snapshotSha256: string;
    enrichmentSourceId: string;
    enrichmentSnapshotSha256: string;
    retrievedAt: string;
    updatedAt: string | null;
    candidateCount: number;
    reviewRequiredCandidateCount: number;
    attribution: string;
    attributionUrl: string;
    disclaimer: string;
  };
  results: GtrTestingSearchRecord[];
};
