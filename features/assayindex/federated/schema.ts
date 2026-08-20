import { z } from "zod";

import { LABORATORY_SOURCE_IDS } from "@/features/assayindex/federated/types";

export const laboratorySourceIdSchema = z.enum(LABORATORY_SOURCE_IDS);

export const federatedSearchRequestSchema = z
  .object({
    query: z.string().trim().min(2).max(120),
    sources: z.array(laboratorySourceIdSchema).min(1).max(LABORATORY_SOURCE_IDS.length),
    refresh: z.boolean().default(false),
  })
  .strict()
  .transform((input) => ({
    ...input,
    sources: [...new Set(input.sources)],
  }));

export const federatedDetailRequestSchema = z
  .object({
    sourceLab: laboratorySourceIdSchema,
    sourceRef: z.string().trim().min(1).max(80),
    refresh: z.boolean().default(false),
  })
  .strict();

export const sourceSearchReferenceSchema = z
  .object({
    sourceLab: laboratorySourceIdSchema,
    sourceRef: z.string().min(1).max(80),
    sourceUrl: z.string().url().startsWith("https://"),
    sourceTestCode: z.string().min(1).max(80).nullable(),
    title: z.string().min(1).max(500),
    summary: z.string().max(4_000).nullable(),
    orderingRecommendation: z.string().max(4_000).nullable(),
    sourceStatus: z.string().max(120).nullable(),
  })
  .strict();

export const rawSourceSnapshotSchema = z
  .object({
    sourceLab: laboratorySourceIdSchema,
    sourceRef: z.string().min(1).max(80),
    sourceUrl: z.string().url().startsWith("https://"),
    fetchedAt: z.string().datetime(),
    mediaType: z.string().min(1).max(200),
    body: z.string(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    responseMetadata: z.record(z.string(), z.string()),
  })
  .strict();

const nullableText = z.string().max(20_000).nullable();

export const parsedSourceOfferingSchema = z
  .object({
    sourceLab: laboratorySourceIdSchema,
    sourceRef: z.string().min(1).max(80),
    sourceUrl: z.string().url().startsWith("https://"),
    sourceTestCode: z.string().min(1).max(80).nullable(),
    sourceTitle: z.string().min(1).max(500),
    testName: z.string().min(1).max(500).nullable(),
    aliases: z.array(z.string().min(1).max(500)),
    analytes: z.array(z.string().min(1).max(500)),
    genes: z.array(z.string().min(1).max(500)),
    orderingRecommendation: nullableText,
    methodology: nullableText,
    methodClass: nullableText,
    measurementType: nullableText,
    specimenOptions: z.array(
      z
        .object({
          specimenType: nullableText,
          preferred: z.boolean().nullable(),
          container: nullableText,
          preferredVolume: nullableText,
          minimumVolume: nullableText,
          patientPreparation: nullableText,
          collectionInstructions: nullableText,
          transportTemperature: nullableText,
          ambientStability: nullableText,
          refrigeratedStability: nullableText,
          frozenStability: nullableText,
          rejectionCriteria: z.array(z.string().min(1).max(4_000)),
        })
        .strict(),
    ),
    turnaroundTime: nullableText,
    performingSchedule: nullableText,
    performingLocation: nullableText,
    cptCodes: z.array(z.string().min(1).max(40)),
    loincCodes: z.array(z.string().min(1).max(40)),
    resultComponents: z.array(
      z
        .object({
          sourceTestCode: z.string().min(1).max(80).nullable(),
          name: nullableText,
          loincCode: z.string().min(1).max(40).nullable(),
          units: nullableText,
        })
        .strict(),
    ),
    reflexRules: z.array(z.string().min(1).max(20_000)),
    clinicalUse: nullableText,
    limitations: nullableText,
    availability: nullableText,
    serviceAreas: z.array(z.string().min(1).max(500)),
    parseWarnings: z.array(z.string().min(1).max(500)),
    fieldProvenance: z.record(
      z.string(),
      z
        .object({
          rawValue: z.unknown(),
          normalizedValue: z.unknown().nullable(),
          sourceUrl: z.string().url().startsWith("https://"),
          sourcePath: z.string().min(1).max(500),
          fetchedAt: z.string().datetime(),
          parserVersion: z.string().min(1),
          confidence: z.number().min(0).max(1).nullable(),
        })
        .strict(),
    ),
    parserVersion: z.string().min(1),
    adapterVersion: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    fetchedAt: z.string().datetime(),
  })
  .strict();

const sourceSearchResultStatusSchema = z.enum([
  "success",
  "disabled",
  "not-configured",
  "permission-required",
  "official-directory-only",
  "source-unavailable",
  "parser-not-implemented",
  "timeout",
  "rate-limited",
  "error",
]);

const sourceSearchResultSchema = z
  .object({
    status: sourceSearchResultStatusSchema,
    cached: z.boolean(),
    results: z.array(sourceSearchReferenceSchema),
    message: z.string().nullable(),
    officialDirectoryUrl: z.string().url().startsWith("https://"),
  })
  .strict();

export const federatedSearchResponseSchema = z
  .object({
    requestId: z.string().min(1),
    query: z.string().min(2).max(120),
    searchedAt: z.string().datetime(),
    sources: z
      .object({
        arup: sourceSearchResultSchema.optional(),
        mayo: sourceSearchResultSchema.optional(),
        quest: sourceSearchResultSchema.optional(),
        labcorp: sourceSearchResultSchema.optional(),
      })
      .strict(),
  })
  .strict();

const federatedDetailUnavailableSchema = z
  .object({
    requestId: z.string().min(1),
    sourceLab: laboratorySourceIdSchema,
    status: z.enum(["disabled", "not-configured", "permission-required", "official-directory-only", "source-unavailable", "parser-not-implemented"]),
    message: z.string().nullable(),
    parsed: z.null(),
  })
  .strict();

const federatedDetailSuccessSchema = z
  .object({
    requestId: z.string().min(1),
    sourceLab: laboratorySourceIdSchema,
    status: z.literal("success"),
    message: z.null(),
    snapshot: rawSourceSnapshotSchema.omit({ body: true, responseMetadata: true }),
    parsed: parsedSourceOfferingSchema,
    curator: z
      .object({
        status: z.literal("not-configured"),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const federatedDetailResponseSchema = z.union([
  federatedDetailSuccessSchema,
  federatedDetailUnavailableSchema,
]);
