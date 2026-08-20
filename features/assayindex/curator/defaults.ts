import { ASSAYINDEX_DISCLAIMER } from "@/features/assayindex/constants";
import type {
  Assay,
  AssayIndexCatalog,
  AssayLabRecord,
  AssayLevelCode,
  Lab,
  SourceDocument,
  SourceLink,
} from "@/features/assayindex/domain/types";

function isoNow() {
  return new Date().toISOString();
}

export function createEmptySourceLink(): SourceLink {
  return {
    label: "New source",
    url: "https://example.com/source",
    sourceType: "reference",
    note: null,
  };
}

export function createEmptyAssay(): Assay {
  const now = isoNow();

  return {
    slug: "new-assay",
    displayName: "New assay",
    summary: "Brief assay summary",
    purpose: "Clinical purpose",
    specialty: [],
    synonyms: [],
    keywords: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyLab(): Lab {
  return {
    id: "new-lab",
    displayName: "New laboratory",
    shortName: "New lab",
    website: null,
    notes: null,
  };
}

export function createEmptyRecord(assaySlug: string, labId: string): AssayLabRecord {
  const now = isoNow();

  return {
    id: `record-${Math.random().toString(36).slice(2, 10)}`,
    assaySlug,
    labId,
    category: "standard",
    displayOrder: 99,
    recordTitle: "New record",
    testName: "New test",
    testCode: null,
    testId: null,
    orderCode: null,
    synonyms: [],
    cptCodes: [],
    loincCodes: [],
    associatedIcd10: [],
    specimenType: null,
    specimenVolume: null,
    minimumVolume: null,
    container: null,
    handling: null,
    storage: null,
    transportTemperature: null,
    stability: null,
    turnaroundTime: null,
    methodology: null,
    priceObservations: null,
    useOrClinicalSignificance: null,
    patientPreparation: null,
    collectionInstructions: null,
    rejectionCriteria: null,
    includes: null,
    reflexLogic: null,
    limitations: null,
    interferences: null,
    performingSchedule: null,
    notes: null,
    sourceLinks: [createEmptySourceLink()],
    publicationStatus: "draft",
    sourceVerifiedAt: null,
    updatedAt: now,
  };
}

export function createEmptySourceDocument(assaySlug: string, labId: string): SourceDocument {
  return {
    id: `source-${Math.random().toString(36).slice(2, 10)}`,
    assaySlug,
    labId,
    label: "New source document",
    url: "https://example.com/source",
    sourceType: "reference",
    relatedRecordIds: [],
    note: null,
    verifiedAt: null,
  };
}

export function createEmptyAssayLevelCode(assaySlug: string): AssayLevelCode {
  return {
    id: `code-${Math.random().toString(36).slice(2, 10)}`,
    assaySlug,
    code: "NEWCODE",
    description: "Source-listed code",
    category: "OTHER",
    scope: "assay-level",
    note: null,
  };
}

export function createEmptyCatalog(): AssayIndexCatalog {
  const now = isoNow();

  return {
    meta: {
      title: "AssayIndex Published Catalog",
      version: "draft",
      lastPublishedAt: now,
      disclaimer: ASSAYINDEX_DISCLAIMER,
    },
    assays: [],
    labs: [],
    assayLabRecords: [],
    sourceDocuments: [],
    assayLevelCodes: [],
    curatedAssayRelationships: [],
    coOrderRelationships: [],
  };
}
