import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const httpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "URL must use HTTP or HTTPS.");

const commonLabOrderEntrySchema = z.object({
  loincCode: z.string().regex(/^\d{1,7}-\d$/),
  longCommonName: z.string().min(1),
  orderObservation: z.enum(["Order", "Observation", "Both"]).nullable(),
  sourceScope: z.enum(["common-order-value-set", "assayindex-mnemonic-supplement"]),
  shortName: z.string().min(1),
  consumerName: z.string().min(1).nullable(),
  relatedNames: z.array(z.string().min(1)),
});

export const commonLabOrderTerminologyIndexSchema = z.object({
  schemaVersion: z.literal("1"),
  source: z.object({
    sourceId: z.string().min(1),
    valueSetName: z.string().min(1),
    valueSetVersion: z.string().min(1),
    sourcePageUrl: httpUrlSchema,
    sourceDataUrl: httpUrlSchema,
    searchApiUrl: httpUrlSchema,
    searchApiDocsUrl: httpUrlSchema,
    enrichment: z.object({
      sourceId: z.string().min(1),
      retrievedAt: z.string().datetime(),
      responseSha256: sha256Schema,
      batchCount: z.number().int().positive(),
      excludeCopyrighted: z.literal(true),
      loincReleaseVersion: z.null(),
      releaseVersionStatus: z.literal("not-exposed-by-source"),
    }),
    mnemonicSupplement: z.object({
      sourceId: z.string().min(1),
      selectionVersion: z.string().min(1),
      codeSetSha256: sha256Schema,
      entryCount: z.number().int().positive(),
    }),
    licenseUrl: httpUrlSchema,
    licenseNotice: z.string().min(1),
    sourceUpdatedAt: z.string().datetime().nullable(),
    retrievedAt: z.string().datetime(),
    sourceSha256: sha256Schema,
    sourceEntryCount: z.number().int().positive(),
    commonOrderPublishedEntryCount: z.number().int().positive(),
    supplementalEntryCount: z.number().int().positive(),
    publishedEntryCount: z.number().int().positive(),
    excludedEntryCount: z.number().int().nonnegative(),
  }),
  entries: z.array(commonLabOrderEntrySchema).min(1),
}).superRefine((index, context) => {
  if (index.source.publishedEntryCount !== index.entries.length) {
    context.addIssue({
      code: "custom",
      path: ["source", "publishedEntryCount"],
      message: "Published entry count must equal the terminology entry count.",
    });
  }

  if (index.source.commonOrderPublishedEntryCount + index.source.supplementalEntryCount !== index.source.publishedEntryCount) {
    context.addIssue({
      code: "custom",
      path: ["source", "publishedEntryCount"],
      message: "Common-order, supplemental, and total published entry counts must reconcile.",
    });
  }

  if (index.source.mnemonicSupplement.entryCount !== index.source.supplementalEntryCount) {
    context.addIssue({
      code: "custom",
      path: ["source", "mnemonicSupplement", "entryCount"],
      message: "Mnemonic supplement metadata must equal the supplemental entry count.",
    });
  }

  if (index.source.sourceEntryCount !== index.source.commonOrderPublishedEntryCount + index.source.excludedEntryCount) {
    context.addIssue({
      code: "custom",
      path: ["source", "excludedEntryCount"],
      message: "Source, published, and excluded entry counts must reconcile.",
    });
  }

  const seenCodes = new Set<string>();
  let actualCommonOrderEntryCount = 0;
  let actualSupplementalEntryCount = 0;
  index.entries.forEach((entry, entryIndex) => {
    if (seenCodes.has(entry.loincCode)) {
      context.addIssue({
        code: "custom",
        path: ["entries", entryIndex, "loincCode"],
        message: `Duplicate common-order LOINC code: ${entry.loincCode}`,
      });
    }
    if (entry.sourceScope === "common-order-value-set" && entry.orderObservation === null) {
      context.addIssue({
        code: "custom",
        path: ["entries", entryIndex, "orderObservation"],
        message: "Common-order value-set entries must retain their order/observation classification.",
      });
    }
    if (entry.sourceScope === "assayindex-mnemonic-supplement" && entry.orderObservation !== null) {
      context.addIssue({
        code: "custom",
        path: ["entries", entryIndex, "orderObservation"],
        message: "Supplemental entries must not invent an order/observation classification.",
      });
    }
    if (entry.sourceScope === "common-order-value-set") actualCommonOrderEntryCount += 1;
    else actualSupplementalEntryCount += 1;
    seenCodes.add(entry.loincCode);
  });

  if (actualCommonOrderEntryCount !== index.source.commonOrderPublishedEntryCount) {
    context.addIssue({
      code: "custom",
      path: ["source", "commonOrderPublishedEntryCount"],
      message: "Common-order metadata must equal the actual common-order entry count.",
    });
  }
  if (actualSupplementalEntryCount !== index.source.supplementalEntryCount) {
    context.addIssue({
      code: "custom",
      path: ["source", "supplementalEntryCount"],
      message: "Supplement metadata must equal the actual supplemental entry count.",
    });
  }
});

export function parseCommonLabOrderTerminologyIndex(input: unknown) {
  return commonLabOrderTerminologyIndexSchema.parse(input);
}
