import { createHash } from "node:crypto";
import { z } from "zod";

import { parsedSourceOfferingSchema, sourceSearchReferenceSchema } from "@/features/assayindex/federated/schema";
import type {
  FieldProvenance,
  ParsedSourceOffering,
  SourceSearchReference,
} from "@/features/assayindex/federated/types";

export const ARUP_ADAPTER_VERSION = "1.0.0";
export const ARUP_PARSER_VERSION = "1.0.0";
export const ARUP_SOURCE_POLICY_ID = "arup-curated-catalog";
export const ARUP_SEARCH_ENDPOINT = "https://ltd.aruplab.com/api/ltdsearch";
export const ARUP_DETAIL_ORIGIN = "https://ltd.aruplab.com";

const ARUP_TEST_CODE_PATTERN = /^\d{7}$/;
const ARUP_SOURCE_REF_PATTERN = /^arup:test:(\d{7})$/;

const arupSearchResultSchema = z.object({
  testNumber: z.string().regex(ARUP_TEST_CODE_PATTERN),
  testName: z.string().trim().min(1).max(500),
  orderingRecommendation: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  status: z.string().trim().max(40).nullable().optional(),
});

const arupSearchResponseSchema = z.object({
  resultList: z.object({
    total: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    results: z.array(arupSearchResultSchema).max(100),
  }),
});

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (entity, token: string) => {
    if (token.startsWith("#x") || token.startsWith("#X")) {
      const codePoint = Number.parseInt(token.slice(2), 16);
      return isValidHtmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (token.startsWith("#")) {
      const codePoint = Number.parseInt(token.slice(1), 10);
      return isValidHtmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[token.toLowerCase()] ?? entity;
  });
}

function isValidHtmlCodePoint(value: number) {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= 0x10ffff
    && !(value >= 0xd800 && value <= 0xdfff);
}

export function sanitizeSourceText(value: string | null | undefined) {
  if (!value) return null;
  const withoutActiveContent = value
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  const separated = withoutActiveContent
    .replace(/<(?:br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr|section|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(decodeHtmlEntities(separated));
  const normalized = decoded
    .replace(/\u0000/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized || null;
}

export function arupSourceRefForTestCode(testCode: string) {
  if (!ARUP_TEST_CODE_PATTERN.test(testCode)) {
    throw new Error("ARUP test code must contain exactly seven digits.");
  }
  return `arup:test:${testCode}`;
}

export function arupTestCodeFromSourceRef(sourceRef: string) {
  const match = ARUP_SOURCE_REF_PATTERN.exec(sourceRef);
  if (!match) throw new Error("ARUP source reference is invalid.");
  return match[1];
}

export function arupDetailUrlForSourceRef(sourceRef: string) {
  return `${ARUP_DETAIL_ORIGIN}/Tests/Pub/${arupTestCodeFromSourceRef(sourceRef)}`;
}

export function arupSearchUrlForQuery(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("ARUP search query must be between 2 and 120 characters.");
  }
  const url = new URL(ARUP_SEARCH_ENDPOINT);
  url.searchParams.set("searchterm", normalized);
  url.searchParams.set("rows", "25");
  url.searchParams.set("start", "0");
  return url;
}

export function assertAllowedArupUrl(value: string | URL, kind: "search" | "detail") {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "ltd.aruplab.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new Error("Blocked unsafe ARUP source URL.");
  }

  if (kind === "search") {
    if (url.pathname !== "/api/ltdsearch") throw new Error("Blocked unexpected ARUP search path.");
    const allowedKeys = new Set(["searchterm", "rows", "start"]);
    const keys = [...url.searchParams.keys()];
    for (const key of keys) {
      if (!allowedKeys.has(key)) throw new Error("Blocked unexpected ARUP search parameter.");
    }
    if (
      keys.length !== 3 ||
      new Set(keys).size !== 3 ||
      !url.searchParams.get("searchterm") ||
      url.searchParams.get("rows") !== "25" ||
      url.searchParams.get("start") !== "0"
    ) {
      throw new Error("Blocked invalid ARUP search request.");
    }
    return url;
  }

  if (url.search || !/^\/Tests\/Pub\/\d{7}$/.test(url.pathname)) {
    throw new Error("Blocked unexpected ARUP detail path.");
  }
  return url;
}

export function parseArupSearchResponse(input: unknown): SourceSearchReference[] {
  const parsedInput = typeof input === "string" ? JSON.parse(input) : input;
  const response = arupSearchResponseSchema.parse(parsedInput);
  const seen = new Set<string>();
  const references: SourceSearchReference[] = [];

  for (const result of response.resultList.results) {
    if (seen.has(result.testNumber)) continue;
    seen.add(result.testNumber);
    const sourceRef = arupSourceRefForTestCode(result.testNumber);
    const title = sanitizeSourceText(result.testName);
    if (!title) throw new Error("ARUP search result title is empty after normalization.");
    references.push(
      sourceSearchReferenceSchema.parse({
        sourceLab: "arup",
        sourceRef,
        sourceUrl: arupDetailUrlForSourceRef(sourceRef),
        sourceTestCode: result.testNumber,
        title,
        summary: sanitizeSourceText(result.summary),
        orderingRecommendation: sanitizeSourceText(result.orderingRecommendation),
        sourceStatus: sanitizeSourceText(result.status),
      }),
    );
  }

  return references;
}

function extractElementByFieldClass(html: string, fieldName: string) {
  const markerPattern = new RegExp(
    `<div\\b[^>]*class=["'][^"']*\\bfield--name-${fieldName}\\b[^"']*["'][^>]*>`,
    "i",
  );
  const marker = markerPattern.exec(html);
  if (!marker || marker.index === undefined) return null;

  const openingStart = marker.index;
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = openingStart;
  let depth = 0;
  let openingEnd = openingStart + marker[0].length;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    if (match.index === openingStart) openingEnd = tagPattern.lastIndex;
    if (/^<\/div/i.test(match[0])) {
      depth -= 1;
      if (depth === 0) return html.slice(openingEnd, match.index);
    } else {
      depth += 1;
    }
  }
  return null;
}

function extractField(html: string, fieldName: string) {
  const fieldHtml = extractElementByFieldClass(html, fieldName);
  if (!fieldHtml) return null;
  const item = /<div\b[^>]*class=["'][^"']*\bfield__item\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(fieldHtml);
  return sanitizeSourceText(item?.[1] ?? fieldHtml);
}

function extractList(html: string | null) {
  if (!html) return [];
  const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => sanitizeSourceText(match[1]))
    .filter((value): value is string => Boolean(value));
  if (items.length > 0) return [...new Set(items)].sort((left, right) => left.localeCompare(right));
  const text = sanitizeSourceText(html);
  return text ? [text] : [];
}

function extractLabeledStability(stability: string | null, label: string) {
  if (!stability) return null;
  const match = new RegExp(`${label}:\\s*([^;\\n]+)`, "i").exec(stability);
  return match?.[1]?.trim() || null;
}

function extractVolume(preparation: string | null, minimum = false) {
  if (!preparation) return null;
  if (minimum) return /\bMin:\s*([^\)]+)/i.exec(preparation)?.[1]?.trim() ?? null;
  return /\bTransport\s+(.+?)(?:\.\s*\(Min:|$)/i.exec(preparation)?.[1]?.trim() ?? null;
}

function extractCodes(value: string | null, pattern: RegExp) {
  if (!value) return [];
  return [...new Set(value.match(pattern) ?? [])].sort((left, right) => left.localeCompare(right));
}

function parseComponents(html: string | null) {
  if (!html) return [];
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.flatMap((row) => {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => sanitizeSourceText(cell[1]));
    if (cells.length < 3 || !cells[0] || /component test code/i.test(cells[0])) return [];
    return [{
      sourceTestCode: /^\d+$/.test(cells[0]) ? cells[0] : null,
      name: cells[1] ?? null,
      loincCode: cells[2]?.match(/^\d{1,7}-\d$/)?.[0] ?? null,
      units: cells[3] ?? null,
    }];
  });
}

function provenance<T>(
  rawValue: unknown,
  normalizedValue: T | null,
  sourcePath: string,
  context: { sourceUrl: string; fetchedAt: string },
  confidence = 1,
): FieldProvenance<T> {
  return {
    rawValue,
    normalizedValue,
    sourceUrl: context.sourceUrl,
    sourcePath,
    fetchedAt: context.fetchedAt,
    parserVersion: ARUP_PARSER_VERSION,
    confidence,
  };
}

export function parseArupDetailHtml(
  html: string,
  context: {
    sourceUrl: string;
    sourceRef: string;
    fetchedAt?: string;
    contentHash?: string;
  },
): ParsedSourceOffering {
  assertAllowedArupUrl(context.sourceUrl, "detail");
  const testCode = arupTestCodeFromSourceRef(context.sourceRef);
  if (context.sourceUrl !== arupDetailUrlForSourceRef(context.sourceRef)) {
    throw new Error("ARUP detail URL does not match its source reference.");
  }
  const fetchedAt = context.fetchedAt ?? new Date().toISOString();
  const provenanceContext = { sourceUrl: context.sourceUrl, fetchedAt };

  const titleRaw = extractField(html, "field-plain-title");
  const title = titleRaw
    ?? sanitizeSourceText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]);
  if (!title) throw new Error("ARUP detail page is missing its test title.");
  const pageTestCode = extractField(html, "field-test-number");
  if (pageTestCode && pageTestCode !== testCode) {
    throw new Error("ARUP detail page test code does not match its source reference.");
  }

  const orderingRecommendation = extractField(html, "field-ordering-recommendation");
  const methodology = extractField(html, "field-methodology");
  const collection = extractField(html, "field-specimen-collect");
  const preparation = extractField(html, "field-specimen-preparation");
  const transport = extractField(html, "field-specimen-transport");
  const patientPreparation = extractField(html, "field-patient-preparation");
  const stability = extractField(html, "field-specimen-stability");
  const rejection = extractField(html, "field-specimen-unacceptable-con");
  const turnaround = extractField(html, "field-reported-schedule");
  const performed = extractField(html, "field-performed-schedule");
  const cptText = extractField(html, "field-cpt-codes");
  const clinicalUse = extractField(html, "field-interpretive-data");
  const note = extractField(html, "field-note");
  const aliasesHtml = extractElementByFieldClass(html, "field-cross-references");
  const componentsHtml = extractElementByFieldClass(html, "field-published-component-table");
  const aliases = extractList(aliasesHtml);
  const components = parseComponents(componentsHtml);
  const cptCodes = extractCodes(cptText, /\b\d{5}\b/g);
  const loincCodes = [...new Set(components.flatMap((component) => component.loincCode ? [component.loincCode] : []))];
  const parseWarnings: string[] = [];
  for (const [label, value] of [["methodology", methodology], ["reported schedule", turnaround]] as const) {
    if (!value) parseWarnings.push(`ARUP did not provide ${label} in the expected semantic field.`);
  }

  return parsedSourceOfferingSchema.parse({
    sourceLab: "arup",
    sourceRef: context.sourceRef,
    sourceUrl: context.sourceUrl,
    sourceTestCode: testCode,
    sourceTitle: title,
    testName: title,
    aliases,
    analytes: [],
    genes: [],
    orderingRecommendation,
    methodology,
    methodClass: null,
    measurementType: methodology?.match(/\b(qualitative|quantitative)\b/i)?.[1] ?? null,
    specimenOptions: collection || preparation || transport || stability || rejection
      ? [{
          specimenType: collection,
          preferred: null,
          container: collection,
          preferredVolume: extractVolume(preparation),
          minimumVolume: extractVolume(preparation, true),
          patientPreparation,
          collectionInstructions: preparation,
          transportTemperature: transport,
          ambientStability: extractLabeledStability(stability, "Ambient"),
          refrigeratedStability: extractLabeledStability(stability, "Refrigerated"),
          frozenStability: extractLabeledStability(stability, "Frozen"),
          rejectionCriteria: rejection ? [rejection] : [],
        }]
      : [],
    turnaroundTime: turnaround,
    performingSchedule: performed,
    performingLocation: null,
    cptCodes,
    loincCodes,
    resultComponents: components,
    reflexRules: [],
    clinicalUse,
    limitations: note,
    availability: null,
    serviceAreas: [],
    parseWarnings,
    fieldProvenance: {
      testName: provenance(titleRaw, title, "field--name-field-plain-title", provenanceContext),
      testCode: provenance(pageTestCode, testCode, "field--name-field-test-number", provenanceContext),
      orderingRecommendation: provenance(orderingRecommendation, orderingRecommendation, "field--name-field-ordering-recommendation", provenanceContext),
      methodology: provenance(methodology, methodology, "field--name-field-methodology", provenanceContext),
      specimen: provenance(collection, collection, "field--name-field-specimen-collect", provenanceContext),
      container: provenance(collection, collection, "field--name-field-specimen-collect", provenanceContext, 0.75),
      minimumVolume: provenance(preparation, extractVolume(preparation, true), "field--name-field-specimen-preparation", provenanceContext),
      stability: provenance(stability, stability, "field--name-field-specimen-stability", provenanceContext),
      turnaroundTime: provenance(turnaround, turnaround, "field--name-field-reported-schedule", provenanceContext),
      cptCodes: provenance(cptText, cptCodes, "field--name-field-cpt-codes", provenanceContext),
      loincCodes: provenance(sanitizeSourceText(componentsHtml), loincCodes, "field--name-field-published-component-table", provenanceContext),
      resultComponents: provenance(sanitizeSourceText(componentsHtml), components, "field--name-field-published-component-table", provenanceContext),
      reflexRules: provenance(note, [], "field--name-field-note", provenanceContext, 0.5),
    },
    parserVersion: ARUP_PARSER_VERSION,
    adapterVersion: ARUP_ADAPTER_VERSION,
    contentHash: context.contentHash ?? createHash("sha256").update(html).digest("hex"),
    fetchedAt,
  });
}
