import Fuse from "fuse.js";

import type {
  AssayIndexCatalog,
  AssaySearchDocument,
  AssaySearchResult,
  SearchFilters,
  SearchSort,
} from "@/features/assayindex/domain/types";
import { isClinicalCodeLikeQuery } from "@/features/assayindex/search/query-shape";
import { buildSearchDocuments } from "@/features/assayindex/selectors/catalog";
import {
  getPublishedSourceOfferings,
  getSourceOfferingRouteSegment,
} from "@/features/assayindex/selectors/source-offerings";

export type AllCatalogSearchDocument = Omit<AssaySearchDocument, "assaySlug"> & {
  id: string;
  kind: "assay" | "source-offering";
  href: string;
  assaySlug: string | null;
};

export type AllCatalogSearchResult = {
  document: AllCatalogSearchDocument;
  score: number | null;
};

type SearchCacheEntry = {
  documents: AssaySearchDocument[];
  fuse: Fuse<AssaySearchDocument> | null;
};

let searchCache = new WeakMap<AssayIndexCatalog, SearchCacheEntry>();
let allCatalogSearchCache = new WeakMap<
  AssayIndexCatalog,
  { documents: AllCatalogSearchDocument[]; fuse: Fuse<AllCatalogSearchDocument> | null }
>();

const SEARCH_KEYS = [
  { name: "displayName", weight: 0.5 },
  { name: "synonyms", weight: 0.32 },
  { name: "keywords", weight: 0.22 },
  { name: "labNames", weight: 0.2 },
  { name: "recordTitles", weight: 0.22 },
  { name: "testNames", weight: 0.22 },
  { name: "codes", weight: 0.42 },
  { name: "specimenTypes", weight: 0.14 },
  { name: "methodologies", weight: 0.16 },
  { name: "notes", weight: 0.12 },
  { name: "specialty", weight: 0.16 },
];

// Fuse's threshold applies while matching individual fields. With weighted,
// long source narratives, the final document score can still be close to 1
// and therefore visibly unrelated. Keep the fuzzy matcher, but reject weak
// document-level matches before they reach the UI.
const MAX_RELEVANT_SEARCH_SCORE = 0.34;

function mapRelevantFuseResults<T>(
  results: Array<{ item: T; score?: number }>,
): Array<{ document: T; score: number }> {
  return results.flatMap((result) => {
    const score = result.score ?? 1;
    return score <= MAX_RELEVANT_SEARCH_SCORE
      ? [{ document: result.item, score }]
      : [];
  });
}

function normalizeExactSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesWholeSearchPhrase(value: string, normalizedQuery: string) {
  const normalizedValue = normalizeExactSearchText(value);
  if (` ${normalizedValue} `.includes(` ${normalizedQuery} `)) return true;

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  if (compactQuery.length < 4) return false;
  const valueTokens = normalizedValue.split(" ").filter(Boolean);
  for (let start = 0; start < valueTokens.length; start += 1) {
    let candidate = "";
    for (let end = start; end < valueTokens.length; end += 1) {
      candidate += valueTokens[end];
      if (candidate === compactQuery) return true;
      if (candidate.length >= compactQuery.length) break;
    }
  }
  return false;
}

function getSearchableValues(
  document: AssaySearchDocument | AllCatalogSearchDocument,
) {
  return [
    document.displayName,
    document.summary,
    document.purpose,
    ...document.specialty,
    ...document.synonyms,
    ...document.keywords,
    ...document.labNames,
    ...document.recordTitles,
    ...document.testNames,
    ...document.codes,
    ...document.specimenTypes,
    ...document.methodologies,
    ...document.notes,
  ];
}

function searchRelevantDocuments<
  T extends AssaySearchDocument | AllCatalogSearchDocument,
>(
  documents: T[],
  fuseResults: Array<{ item: T; score?: number }>,
  query: string,
): Array<{ document: T; score: number }> {
  const normalizedQuery = normalizeExactSearchText(query);
  const requiresWholePhrase = isClinicalCodeLikeQuery(query);
  const exactDocuments = normalizedQuery
    ? documents.filter((document) =>
        getSearchableValues(document).some((value) =>
          requiresWholePhrase
            ? includesWholeSearchPhrase(value, normalizedQuery)
            : normalizeExactSearchText(value).includes(normalizedQuery),
        ),
      )
    : [];
  const exactDocumentSet = new Set(exactDocuments);

  return [
    ...exactDocuments.map((document) => ({ document, score: 0 })),
    ...mapRelevantFuseResults(requiresWholePhrase ? [] : fuseResults).filter(
      (result) => !exactDocumentSet.has(result.document),
    ),
  ];
}

function getCacheEntry(catalog: AssayIndexCatalog) {
  const cached = searchCache.get(catalog);

  if (cached) {
    return cached;
  }

  const entry: SearchCacheEntry = {
    documents: buildSearchDocuments(catalog),
    fuse: null,
  };
  searchCache.set(catalog, entry);
  return entry;
}

function getDocuments(catalog: AssayIndexCatalog) {
  return getCacheEntry(catalog).documents;
}

function getFuse(catalog: AssayIndexCatalog) {
  const entry = getCacheEntry(catalog);

  if (entry.fuse) {
    return entry.fuse;
  }

  entry.fuse = new Fuse(entry.documents, {
    includeScore: true,
    threshold: 0.34,
    ignoreLocation: true,
    keys: SEARCH_KEYS,
  });

  return entry.fuse;
}

function matchesFilters(
  document: AssaySearchDocument | AllCatalogSearchDocument,
  filters: SearchFilters,
) {
  if (filters.labId && !document.labIds.includes(filters.labId)) {
    return false;
  }

  if (filters.specialty && !document.specialty.includes(filters.specialty)) {
    return false;
  }

  if (filters.category && !document.categories.includes(filters.category)) {
    return false;
  }

  if (filters.sourceType && !document.sourceTypes.includes(filters.sourceType)) {
    return false;
  }

  if (filters.specimenType && !document.specimenTypes.includes(filters.specimenType)) {
    return false;
  }

  if (filters.methodology && !document.methodologies.includes(filters.methodology)) {
    return false;
  }

  if (filters.hasReflexLogic && !document.hasReflexLogic) {
    return false;
  }

  if (filters.hasCpt && !document.hasCpt) {
    return false;
  }

  if (filters.hasLoinc && !document.hasLoinc) {
    return false;
  }

  return true;
}

function sourceOfferingSearchDocuments(catalog: AssayIndexCatalog): AllCatalogSearchDocument[] {
  const labsById = new Map(catalog.labs.map((lab) => [lab.id, lab]));

  return getPublishedSourceOfferings(catalog).map((offering) => {
    const sourceIds = [
      offering.externalRecordId,
      offering.sourceId,
      offering.sourcePublisherId,
      offering.sourceTestId,
      offering.sourceLabId,
      offering.sourceUnitNumber,
    ].filter((value): value is string => Boolean(value));
    const contactValues = [...offering.contacts.cdc, ...offering.contacts.priorApproval]
      .flatMap((contact) => [contact.name, contact.phone, contact.email])
      .filter((value): value is string => Boolean(value));
    const narrativeValues = [
      offering.turnaroundTime,
      offering.acceptableSampleForTesting,
      offering.minimumVolume,
      offering.storageAndPreservation,
      offering.transport,
      offering.shippingInstructions,
      offering.interferencesAndLimitations,
      offering.additionalInformation,
      offering.supplementalInformationRequired,
      offering.specimenLabeling,
      offering.sourceLinkText,
      offering.legacyLinkText,
      offering.availability.orderStatus,
      offering.availability.sourcePresence,
      ...offering.attentionFlags,
      ...contactValues,
    ].filter((value): value is string => Boolean(value));
    const labName = labsById.get(offering.labId)?.displayName ?? offering.labId;

    return {
      id: offering.id,
      kind: "source-offering",
      href: `/assayindex/offerings/${getSourceOfferingRouteSegment(offering)}`,
      assaySlug: offering.assaySlug,
      displayName: offering.testName,
      summary: offering.additionalInformation ?? offering.availability.orderStatus,
      purpose: offering.availability.orderStatus,
      specialty: [],
      synonyms: offering.aliases,
      keywords: sourceIds,
      labIds: [offering.labId],
      labNames: [labName],
      categories: ["source-offering"],
      sourceTypes: [
        ...new Set([
          ...offering.sourceLinks.map((link) => link.sourceType),
          "test-page" as const,
        ]),
      ],
      testNames: [offering.testName],
      recordTitles: [offering.testName],
      codes: [...new Set(sourceIds)],
      specimenTypes: offering.acceptableSampleForTesting
        ? [offering.acceptableSampleForTesting]
        : [],
      methodologies: offering.methodology ? [offering.methodology] : [],
      notes: [...new Set(narrativeValues)],
      hasReflexLogic: false,
      hasCpt: false,
      hasLoinc: false,
      labCount: 1,
      sourceCount: new Set([
        ...offering.sourceLinks.map((link) => link.url),
        offering.provenance.detailUrl,
      ]).size,
      updatedAt: offering.updatedAt,
    };
  });
}

function getAllCatalogSearchEntry(catalog: AssayIndexCatalog) {
  const cached = allCatalogSearchCache.get(catalog);
  if (cached) return cached;

  const documents: AllCatalogSearchDocument[] = [
    ...buildSearchDocuments(catalog).map((document) => ({
      ...document,
      id: document.assaySlug,
      kind: "assay" as const,
      href: `/assayindex/assays/${document.assaySlug}`,
      assaySlug: document.assaySlug,
    })),
    ...sourceOfferingSearchDocuments(catalog),
  ];
  const entry = { documents, fuse: null } satisfies {
    documents: AllCatalogSearchDocument[];
    fuse: Fuse<AllCatalogSearchDocument> | null;
  };
  allCatalogSearchCache.set(catalog, entry);
  return entry;
}

function getAllCatalogFuse(catalog: AssayIndexCatalog) {
  const entry = getAllCatalogSearchEntry(catalog);
  if (entry.fuse) return entry.fuse;

  entry.fuse = new Fuse(entry.documents, {
    includeScore: true,
    threshold: 0.34,
    ignoreLocation: true,
    keys: SEARCH_KEYS,
  });
  return entry.fuse;
}

function sortAllCatalogResults(
  results: AllCatalogSearchResult[],
  sort: SearchSort,
): AllCatalogSearchResult[] {
  return [...results].sort((left, right) => {
    switch (sort) {
      case "alphabetical":
        return left.document.displayName.localeCompare(right.document.displayName);
      case "recently-updated":
        return (
          new Date(right.document.updatedAt).getTime() -
          new Date(left.document.updatedAt).getTime()
        );
      case "source-coverage":
        return right.document.sourceCount - left.document.sourceCount;
      case "lab-count":
        return right.document.labCount - left.document.labCount;
      case "relevance":
      default:
        return (left.score ?? Number.MAX_SAFE_INTEGER) - (right.score ?? Number.MAX_SAFE_INTEGER);
    }
  });
}

function sortResults(results: AssaySearchResult[], sort: SearchSort) {
  return [...results].sort((left, right) => {
    switch (sort) {
      case "alphabetical":
        return left.document.displayName.localeCompare(right.document.displayName);
      case "recently-updated":
        return (
          new Date(right.document.updatedAt).getTime() -
          new Date(left.document.updatedAt).getTime()
        );
      case "source-coverage":
        return right.document.sourceCount - left.document.sourceCount;
      case "lab-count":
        return right.document.labCount - left.document.labCount;
      case "relevance":
      default:
        return (left.score ?? Number.MAX_SAFE_INTEGER) - (right.score ?? Number.MAX_SAFE_INTEGER);
    }
  });
}

export function searchCatalog(
  catalog: AssayIndexCatalog,
  query: string,
  filters: SearchFilters,
  sort: SearchSort,
) {
  const normalizedQuery = query.trim();

  const initialResults: AssaySearchResult[] = normalizedQuery
    ? searchRelevantDocuments(
        getDocuments(catalog),
        isClinicalCodeLikeQuery(normalizedQuery)
          ? []
          : getFuse(catalog).search(normalizedQuery),
        normalizedQuery,
      )
    : getDocuments(catalog).map((document) => ({
        document,
        score: null,
      }));

  const filteredResults = initialResults.filter((result) => matchesFilters(result.document, filters));
  return sortResults(filteredResults, sort);
}

export function searchAllCatalog(
  catalog: AssayIndexCatalog,
  query: string,
  filters: SearchFilters,
  sort: SearchSort,
): AllCatalogSearchResult[] {
  const normalizedQuery = query.trim();
  const searchEntry = getAllCatalogSearchEntry(catalog);
  const initialResults: AllCatalogSearchResult[] = normalizedQuery
    ? searchRelevantDocuments(
        searchEntry.documents,
        isClinicalCodeLikeQuery(normalizedQuery)
          ? []
          : getAllCatalogFuse(catalog).search(normalizedQuery),
        normalizedQuery,
      )
    : searchEntry.documents.map((document) => ({
        document,
        score: null,
      }));

  return sortAllCatalogResults(
    initialResults.filter((result) => matchesFilters(result.document, filters)),
    sort,
  );
}

export function resetSearchCache() {
  searchCache = new WeakMap<AssayIndexCatalog, SearchCacheEntry>();
  allCatalogSearchCache = new WeakMap();
}
