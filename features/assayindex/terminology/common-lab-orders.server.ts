import commonLabOrderData from "@/features/assayindex/data/terminology/common-lab-orders.generated.json";
import { isClinicalCodeLikeQuery } from "@/features/assayindex/search/query-shape";
import { resolveCommonLabOrderQueryInterpretation } from "@/features/assayindex/terminology/query-interpretations";
import { parseCommonLabOrderTerminologyIndex } from "@/features/assayindex/terminology/schema";
import type {
  CommonLabOrderMatchReason,
  CommonLabOrderSearchResponse,
  CommonLabOrderTerminologyEntry,
  CommonLabOrderTerminologyIndex,
} from "@/features/assayindex/terminology/types";

const MAX_QUERY_LENGTH = 120;
const MAX_QUERY_TOKENS = 10;
const MAX_RESULT_LIMIT = 50;

type SearchField = {
  value: string;
  matchReason: Exclude<CommonLabOrderMatchReason, "punctuation-folded">;
  fieldRank: number;
};

type RankedMatch = {
  entry: CommonLabOrderTerminologyEntry;
  matchedTerm: string;
  matchReason: CommonLabOrderMatchReason;
  score: number;
};

let parsedIndex: CommonLabOrderTerminologyIndex | null = null;

function getTerminologyIndex() {
  parsedIndex ??= parseCommonLabOrderTerminologyIndex(commonLabOrderData);
  return parsedIndex;
}

export function normalizeClinicalSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactClinicalSearchText(value: string) {
  return normalizeClinicalSearchText(value).replaceAll(" ", "");
}

function searchableFields(entry: CommonLabOrderTerminologyEntry): SearchField[] {
  return [
    { value: entry.loincCode, matchReason: "loinc-code", fieldRank: 0 },
    { value: entry.longCommonName, matchReason: "long-common-name", fieldRank: 1 },
    { value: entry.shortName, matchReason: "short-name", fieldRank: 2 },
    ...(entry.consumerName
      ? [{ value: entry.consumerName, matchReason: "consumer-name" as const, fieldRank: 3 }]
      : []),
    ...entry.relatedNames.map((value) => ({
      value,
      matchReason: "related-name" as const,
      fieldRank: 4,
    })),
  ];
}

function wholeTokenOrPhraseMatch(value: string, query: string) {
  if (value === query) return true;
  return ` ${value} `.includes(` ${query} `);
}

function scoreField(
  field: SearchField,
  normalizedQuery: string,
  compactQuery: string,
  exactFieldOnly: boolean,
) {
  const normalizedValue = normalizeClinicalSearchText(field.value);
  if (!normalizedValue) return null;

  if (normalizedValue === normalizedQuery) {
    return { score: field.fieldRank, matchReason: field.matchReason };
  }

  const compactValue = compactClinicalSearchText(field.value);
  if (
    compactQuery.length >= 4
    && compactValue !== normalizedValue
    && compactValue === compactQuery
  ) {
    return { score: 5 + field.fieldRank, matchReason: "punctuation-folded" as const };
  }

  if (exactFieldOnly) return null;

  if (wholeTokenOrPhraseMatch(normalizedValue, normalizedQuery)) {
    return { score: 10 + field.fieldRank, matchReason: field.matchReason };
  }

  if (
    compactQuery.length >= 4 &&
    compactValue !== normalizedValue &&
    (compactValue === compactQuery || compactValue.startsWith(compactQuery))
  ) {
    return { score: 20 + field.fieldRank, matchReason: "punctuation-folded" as const };
  }

  if (normalizedQuery.length >= 4 && normalizedValue.startsWith(`${normalizedQuery} `)) {
    return { score: 30 + field.fieldRank, matchReason: field.matchReason };
  }

  if (normalizedQuery.length >= 4 && normalizedValue.includes(normalizedQuery)) {
    return { score: 40 + field.fieldRank, matchReason: field.matchReason };
  }

  return null;
}

function rankEntry(
  entry: CommonLabOrderTerminologyEntry,
  normalizedQuery: string,
  exactFieldOnly: boolean,
) {
  const compactQuery = compactClinicalSearchText(normalizedQuery);
  let best: RankedMatch | null = null;

  for (const field of searchableFields(entry)) {
    const score = scoreField(field, normalizedQuery, compactQuery, exactFieldOnly);
    if (!score || (best && score.score >= best.score)) continue;
    best = {
      entry,
      matchedTerm: field.value,
      matchReason: score.matchReason,
      score: score.score,
    };
  }

  return best;
}

export function normalizeCommonLabOrderQuery(query: unknown) {
  if (typeof query !== "string") throw new Error("Search query must be a string.");
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_QUERY_LENGTH) {
    throw new Error(`Search query must contain 2-${MAX_QUERY_LENGTH} characters.`);
  }
  const normalized = normalizeClinicalSearchText(trimmed);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_QUERY_TOKENS) {
    throw new Error(`Search query must contain 1-${MAX_QUERY_TOKENS} searchable terms.`);
  }
  return { query: trimmed, normalized };
}

export function normalizeCommonLabOrderLimit(limit: unknown) {
  const parsed = limit === undefined ? 20 : limit;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_RESULT_LIMIT) {
    throw new Error(`Search limit must be an integer from 1 through ${MAX_RESULT_LIMIT}.`);
  }
  return parsed;
}

export function searchCommonLabOrders({
  query,
  limit,
  index = getTerminologyIndex(),
}: {
  query: unknown;
  limit?: unknown;
  index?: CommonLabOrderTerminologyIndex;
}): CommonLabOrderSearchResponse {
  const normalized = normalizeCommonLabOrderQuery(query);
  const normalizedLimit = normalizeCommonLabOrderLimit(limit);
  const interpretation = resolveCommonLabOrderQueryInterpretation(
    normalized.query,
    normalized.normalized,
    compactClinicalSearchText(normalized.normalized),
  );
  const exactFieldOnly = !interpretation && isClinicalCodeLikeQuery(normalized.query);
  const entriesByCode = new Map(index.entries.map((entry) => [entry.loincCode, entry]));
  const interpretedMatches: RankedMatch[] | null = interpretation
    ? interpretation.targetLoincCodes.map((loincCode, codeIndex) => {
        const entry = entriesByCode.get(loincCode);
        if (!entry) {
          throw new Error(`Common-order interpretation references missing LOINC code ${loincCode}.`);
        }
        return {
          entry,
          matchedTerm: normalized.query,
          matchReason: "assayindex-interpretation",
          score: codeIndex,
        };
      })
    : null;
  const matches = (interpretedMatches ?? index.entries.flatMap((entry) => {
      const match = rankEntry(entry, normalized.normalized, exactFieldOnly);
      return match ? [match] : [];
    }))
    .toSorted(
      (left, right) =>
        left.score - right.score ||
        left.entry.longCommonName.localeCompare(right.entry.longCommonName) ||
        left.entry.loincCode.localeCompare(right.entry.loincCode),
    );
  const results = matches.slice(0, normalizedLimit).map((match) => ({
    loincCode: match.entry.loincCode,
    longCommonName: match.entry.longCommonName,
    orderObservation: match.entry.orderObservation,
    sourceScope: match.entry.sourceScope,
    officialUrl: `https://loinc.org/${match.entry.loincCode}/`,
    matchedTerm: match.matchedTerm,
    matchReason: match.matchReason,
  }));

  return {
    schemaVersion: "1",
    status: "published-common-order-terminology",
    query: normalized.query,
    interpretation: interpretation?.publicInterpretation ?? null,
    matchedCount: matches.length,
    resultCount: results.length,
    truncated: matches.length > results.length,
    source: index.source,
    results,
  };
}
