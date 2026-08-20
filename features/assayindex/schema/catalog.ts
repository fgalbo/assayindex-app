import { z } from "zod";

import type { AssayIndexCatalog, ValidationIssue } from "@/features/assayindex/domain/types";

const sourceTypeSchema = z.enum([
  "test-page",
  "test-guide",
  "faq",
  "overview",
  "pdf",
  "brochure",
  "reference",
  "other",
]);

const codeCategorySchema = z.enum(["CPT", "ICD10", "LOINC", "OTHER"]);
const codeScopeSchema = z.enum(["assay-level", "lab-specific"]);
const assayStatusSchema = z.enum(["draft", "published"]);
const httpUrlSchema = z.string().url().refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "URL must use HTTP or HTTPS." },
);
const recordCategorySchema = z.enum([
  "standard",
  "with-reflex",
  "resistance",
  "quantification",
  "panel",
  "reference",
  "faq",
  "other",
]);
const decimalAmountSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, "Amount must be a non-negative decimal string.");
const dateOnlySchema = z.iso.date({ error: "Date must be a valid YYYY-MM-DD calendar date." });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 must use 64 lowercase hexadecimal characters.");

function compareDecimalStrings(left: string, right: string) {
  const normalize = (value: string) => {
    const [rawWhole, rawFraction = ""] = value.split(".");
    const whole = rawWhole.replace(/^0+(?=\d)/, "");
    const fraction = rawFraction.replace(/0+$/, "");
    return { whole, fraction };
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);

  if (normalizedLeft.whole.length !== normalizedRight.whole.length) {
    return normalizedLeft.whole.length - normalizedRight.whole.length;
  }
  const wholeComparison =
    normalizedLeft.whole === normalizedRight.whole
      ? 0
      : normalizedLeft.whole < normalizedRight.whole
        ? -1
        : 1;
  if (wholeComparison !== 0) return wholeComparison;

  const fractionLength = Math.max(
    normalizedLeft.fraction.length,
    normalizedRight.fraction.length,
  );
  const leftFraction = normalizedLeft.fraction.padEnd(fractionLength, "0");
  const rightFraction = normalizedRight.fraction.padEnd(fractionLength, "0");
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
}

export const sourceLinkSchema = z.object({
  label: z.string().min(1),
  url: httpUrlSchema,
  sourceType: sourceTypeSchema,
  note: z.string().nullable().optional(),
});

export const associatedCodeSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  category: codeCategorySchema,
  scope: codeScopeSchema,
  note: z.string().nullable().optional(),
});

export const priceObservationSchema = z
  .object({
    priceType: z.enum(["cash", "list", "medicare-clfs", "negotiated", "other"]),
    sourceText: z.string().min(1),
    amount: decimalAmountSchema.nullable(),
    minimumAmount: decimalAmountSchema.nullable(),
    maximumAmount: decimalAmountSchema.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be exactly three uppercase letters."),
    effectiveDate: dateOnlySchema.nullable(),
    sourceUrl: httpUrlSchema,
    note: z.string().nullable(),
  })
  .strict()
  .superRefine((observation, context) => {
    const hasAmount = observation.amount !== null;
    const hasMinimum = observation.minimumAmount !== null;
    const hasMaximum = observation.maximumAmount !== null;
    const hasCompleteRange = hasMinimum && hasMaximum;

    if (hasMinimum !== hasMaximum) {
      context.addIssue({
        code: "custom",
        path: hasMinimum ? ["maximumAmount"] : ["minimumAmount"],
        message: "A price range requires both minimumAmount and maximumAmount.",
      });
    }
    if (hasAmount === hasCompleteRange) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Provide either amount or a complete minimum/maximum range, but not both.",
      });
    }
    if (
      observation.minimumAmount !== null &&
      observation.maximumAmount !== null &&
      compareDecimalStrings(observation.minimumAmount, observation.maximumAmount) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["maximumAmount"],
        message: "maximumAmount must be greater than or equal to minimumAmount.",
      });
    }
  });

export const assaySchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  summary: z.string().min(1),
  purpose: z.string().min(1),
  specialty: z.array(z.string()),
  synonyms: z.array(z.string()),
  keywords: z.array(z.string()),
  status: assayStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const labSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  shortName: z.string().min(1),
  website: httpUrlSchema.nullable(),
  notes: z.string().nullable(),
});

export const assayLabRecordSchema = z
  .object({
    id: z.string().min(1),
    assaySlug: z.string().min(1),
    labId: z.string().min(1),
    category: recordCategorySchema,
    displayOrder: z.number().int().nonnegative(),
    recordTitle: z.string().min(1),
    testName: z.string().min(1),
    testCode: z.string().nullable(),
    testId: z.string().nullable(),
    orderCode: z.string().nullable(),
    synonyms: z.array(z.string()),
    cptCodes: z.array(z.string()),
    loincCodes: z.array(z.string()),
    associatedIcd10: z.array(associatedCodeSchema),
    specimenType: z.string().nullable(),
    specimenVolume: z.string().nullable(),
    minimumVolume: z.string().nullable(),
    container: z.string().nullable(),
    handling: z.string().nullable(),
    storage: z.string().nullable(),
    transportTemperature: z.string().nullable(),
    stability: z.string().nullable(),
    turnaroundTime: z.string().nullable(),
    methodology: z.string().nullable(),
    priceObservations: z.array(priceObservationSchema).nullable().default(null),
    useOrClinicalSignificance: z.string().nullable(),
    patientPreparation: z.string().nullable(),
    collectionInstructions: z.string().nullable(),
    rejectionCriteria: z.string().nullable(),
    includes: z.string().nullable(),
    reflexLogic: z.string().nullable(),
    limitations: z.string().nullable(),
    interferences: z.string().nullable(),
    performingSchedule: z.string().nullable(),
    notes: z.string().nullable(),
    sourceLinks: z.array(sourceLinkSchema),
    publicationStatus: assayStatusSchema,
    sourceVerifiedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((record, context) => {
    const sourceUrls = new Set(record.sourceLinks.map((source) => source.url));
    record.priceObservations?.forEach((observation, index) => {
      if (!sourceUrls.has(observation.sourceUrl)) {
        context.addIssue({
          code: "custom",
          path: ["priceObservations", index, "sourceUrl"],
          message: "Price sourceUrl must match one of the record's sourceLinks.",
          params: { issueCode: "invalid_reference" },
        });
      }
    });
  });

const sourceOfferingAttentionFlagSchema = z.enum([
  "source_offline",
  "source_status_unavailable",
  "non_clia",
  "prior_approval_required",
  "source_missing",
]);

const sourceOfferingContactSchema = z
  .object({
    name: z.string().min(1).nullable(),
    phone: z.string().min(1).nullable(),
    email: z.string().min(1).nullable(),
  })
  .strict();

export const sourceOfferingSchema = z
  .object({
    id: z.string().min(1),
    assaySlug: z.string().min(1).nullable(),
    labId: z.string().min(1),
    sourceId: z.string().min(1),
    sourcePublisherId: z.string().min(1),
    externalRecordId: z.string().min(1),
    testName: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    sourceTestId: z.string().min(1).nullable(),
    sourceLabId: z.string().min(1).nullable(),
    sourceUnitNumber: z.string().min(1).nullable(),
    methodology: z.string().min(1).nullable(),
    turnaroundTime: z.string().min(1).nullable(),
    structuredTurnaroundTime: z
      .object({
        value: z.number().positive(),
        unit: z.enum(["day", "week"]),
      })
      .strict()
      .nullable(),
    acceptableSampleForTesting: z.string().min(1).nullable(),
    minimumVolume: z.string().min(1).nullable(),
    storageAndPreservation: z.string().min(1).nullable(),
    transport: z.string().min(1).nullable(),
    shippingInstructions: z.string().min(1).nullable(),
    interferencesAndLimitations: z.string().min(1).nullable(),
    additionalInformation: z.string().min(1).nullable(),
    supplementalInformationRequired: z.string().min(1).nullable(),
    specimenLabeling: z.string().min(1).nullable(),
    sourceLinkText: z.string().min(1).nullable(),
    legacyLinkText: z.string().min(1).nullable(),
    availability: z
      .object({
        orderStatus: z.string().min(1),
        offline: z.boolean(),
        clia: z.boolean(),
        priorApprovalRequired: z.boolean(),
        performedOn: z
          .object({
            human: z.boolean(),
            animal: z.boolean(),
            other: z.boolean(),
          })
          .strict(),
        sourcePresence: z.enum(["listed", "source-missing"]),
      })
      .strict(),
    contacts: z
      .object({
        cdc: z.array(sourceOfferingContactSchema),
        priorApproval: z.array(sourceOfferingContactSchema),
      })
      .strict(),
    sourceVersion: z.string().min(1),
    sourceLinks: z.array(sourceLinkSchema),
    attentionFlags: z.array(sourceOfferingAttentionFlagSchema),
    provenance: z
      .object({
        snapshotSha256: sha256Schema,
        candidateSha256: sha256Schema,
        retrievedAt: z.string().datetime(),
        sourceUpdatedAt: z.string().datetime().nullable(),
        firstSeenAt: z.string().datetime(),
        lastSeenAt: z.string().datetime(),
        missingSince: z.string().datetime().nullable(),
        detailUrl: httpUrlSchema,
      })
      .strict(),
    publicationStatus: assayStatusSchema,
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((offering, context) => {
    if (new Set(offering.attentionFlags).size !== offering.attentionFlags.length) {
      context.addIssue({
        code: "custom",
        path: ["attentionFlags"],
        message: "Source offering attention flags must be unique.",
      });
    }
    if (offering.availability.sourcePresence === "listed" && offering.provenance.missingSince !== null) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "missingSince"],
        message: "A listed source offering cannot have missingSince.",
      });
    }
    if (offering.availability.sourcePresence === "source-missing") {
      if (offering.provenance.missingSince === null) {
        context.addIssue({
          code: "custom",
          path: ["provenance", "missingSince"],
          message: "A source-missing offering requires missingSince.",
        });
      }
      if (!offering.attentionFlags.includes("source_missing")) {
        context.addIssue({
          code: "custom",
          path: ["attentionFlags"],
          message: "A source-missing offering requires the source_missing attention flag.",
        });
      }
    }
    if (offering.publicationStatus === "published" && offering.sourceLinks.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceLinks"],
        message: "Published source offerings require at least one source link.",
        params: { issueCode: "missing_provenance" },
      });
    }
  });

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  assaySlug: z.string().min(1),
  labId: z.string().min(1),
  label: z.string().min(1),
  url: httpUrlSchema,
  sourceType: sourceTypeSchema,
  relatedRecordIds: z.array(z.string()),
  note: z.string().nullable(),
  verifiedAt: z.string().datetime().nullable(),
});

export const assayLevelCodeSchema = associatedCodeSchema.extend({
  id: z.string().min(1),
  assaySlug: z.string().min(1),
});

export const curatedAssayRelationshipSchema = z
  .object({
    id: z.string().min(1),
    sourcePublisherId: z.string().min(1),
    sourceAssaySlug: z.string().min(1),
    targetAssaySlug: z.string().min(1),
    relationshipType: z.enum([
      "reflex-to",
      "confirmatory-for",
      "alternative-to",
      "component-of",
      "other",
    ]),
    rationale: z.string().min(1),
    sourceLinks: z.array(sourceLinkSchema).min(1),
    reviewedAt: z.string().datetime(),
    publicationStatus: assayStatusSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

const coOrderCountsSchema = z
  .object({
    eligibleSetCount: z.number().int().positive(),
    leftSetCount: z.number().int().positive(),
    rightSetCount: z.number().int().positive(),
    pairSetCount: z.number().int().positive(),
  })
  .strict();

const coOrderCohortSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

const coOrderObservationWindowSchema = z
  .object({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
  })
  .strict();

const coOrderSourceSchema = z
  .object({
    publisherId: z.string().min(1),
    datasetId: z.string().min(1),
    datasetVersion: z.string().min(1),
    snapshotSha256: sha256Schema,
    url: httpUrlSchema,
    retrievedAt: z.string().datetime(),
  })
  .strict();

const coOrderMappingSchema = z
  .object({
    codeSystem: z.string().min(1),
    leftCodes: z.array(z.string().min(1)).min(1),
    rightCodes: z.array(z.string().min(1)).min(1),
    mappingVersion: z.string().min(1),
    method: z.string().min(1),
    reviewedAt: z.string().datetime(),
  })
  .strict();

const coOrderDisclosureReviewSchema = z
  .object({
    status: z.literal("passed"),
    reviewedAt: z.string().datetime(),
    method: z.string().min(1),
    note: z.string().nullable(),
  })
  .strict();

export const coOrderRelationshipSchema = z
  .object({
    id: z.string().min(1),
    leftAssaySlug: z.string().min(1),
    rightAssaySlug: z.string().min(1),
    basis: z.enum([
      "same-order",
      "same-claim",
      "same-visit-ordered-or-provided",
      "same-visit-measurement",
      "synthetic",
    ]),
    counts: coOrderCountsSchema,
    cohort: coOrderCohortSchema,
    observationWindow: coOrderObservationWindowSchema,
    source: coOrderSourceSchema,
    mapping: coOrderMappingSchema,
    disclosureReview: coOrderDisclosureReviewSchema,
    publicationStatus: assayStatusSchema,
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((relationship, context) => {
    if (relationship.leftAssaySlug > relationship.rightAssaySlug) {
      context.addIssue({
        code: "custom",
        path: ["leftAssaySlug"],
        message: "Co-order assay pairs must be canonical with leftAssaySlug before rightAssaySlug.",
      });
    }
    if (relationship.leftAssaySlug === relationship.rightAssaySlug) {
      context.addIssue({
        code: "custom",
        path: ["rightAssaySlug"],
        message: "Co-order assay relationships cannot link an assay to itself.",
      });
    }
    if (relationship.counts.pairSetCount > relationship.counts.leftSetCount) {
      context.addIssue({
        code: "custom",
        path: ["counts", "pairSetCount"],
        message: "pairSetCount cannot exceed leftSetCount.",
      });
    }
    if (relationship.counts.pairSetCount > relationship.counts.rightSetCount) {
      context.addIssue({
        code: "custom",
        path: ["counts", "pairSetCount"],
        message: "pairSetCount cannot exceed rightSetCount.",
      });
    }
    const unionSetCount =
      relationship.counts.leftSetCount +
      relationship.counts.rightSetCount -
      relationship.counts.pairSetCount;
    if (unionSetCount > relationship.counts.eligibleSetCount) {
      context.addIssue({
        code: "custom",
        path: ["counts", "eligibleSetCount"],
        message: "The left/right set union cannot exceed eligibleSetCount.",
      });
    }
    if (relationship.observationWindow.startDate > relationship.observationWindow.endDate) {
      context.addIssue({
        code: "custom",
        path: ["observationWindow", "endDate"],
        message: "observationWindow endDate must be on or after startDate.",
      });
    }
  });

function addDuplicateIssues(
  values: string[],
  collection: string,
  field: string,
  context: z.RefinementCtx,
  messageForValue: (value: string) => string = (value) => `Duplicate ${field}: ${value}`,
) {
  const seen = new Set<string>();

  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [collection, index, field],
        message: messageForValue(value),
        params: { issueCode: "duplicate_id" },
      });
    }
    seen.add(value);
  });
}

function addReferenceIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  target: string,
) {
  context.addIssue({
    code: "custom",
    path,
    message: `Unknown catalog reference: ${target}`,
    params: { issueCode: "invalid_reference" },
  });
}

export const assayIndexCatalogSchema = z
  .object({
    meta: z.object({
      title: z.string().min(1),
      version: z.string().min(1),
      lastPublishedAt: z.string().datetime(),
      disclaimer: z.string().min(1),
    }),
    assays: z.array(assaySchema),
    labs: z.array(labSchema),
    assayLabRecords: z.array(assayLabRecordSchema),
    sourceOfferings: z.array(sourceOfferingSchema).default([]),
    sourceDocuments: z.array(sourceDocumentSchema),
    assayLevelCodes: z.array(assayLevelCodeSchema),
    curatedAssayRelationships: z.array(curatedAssayRelationshipSchema).default([]),
    coOrderRelationships: z.array(coOrderRelationshipSchema).default([]),
  })
  .superRefine((catalog, context) => {
    addDuplicateIssues(catalog.assays.map((assay) => assay.slug), "assays", "slug", context);
    addDuplicateIssues(catalog.labs.map((lab) => lab.id), "labs", "id", context);
    addDuplicateIssues(catalog.assayLabRecords.map((record) => record.id), "assayLabRecords", "id", context);
    addDuplicateIssues(catalog.sourceOfferings.map((offering) => offering.id), "sourceOfferings", "id", context);
    addDuplicateIssues(
      catalog.sourceOfferings.map((offering) =>
        JSON.stringify([offering.sourceId, offering.externalRecordId]),
      ),
      "sourceOfferings",
      "externalRecordId",
      context,
      () => "Duplicate source offering for the same sourceId and externalRecordId.",
    );
    addDuplicateIssues(catalog.sourceDocuments.map((source) => source.id), "sourceDocuments", "id", context);
    addDuplicateIssues(catalog.assayLevelCodes.map((code) => code.id), "assayLevelCodes", "id", context);
    addDuplicateIssues(
      catalog.curatedAssayRelationships.map((relationship) => relationship.id),
      "curatedAssayRelationships",
      "id",
      context,
    );
    addDuplicateIssues(
      catalog.coOrderRelationships.map((relationship) => relationship.id),
      "coOrderRelationships",
      "id",
      context,
    );
    addDuplicateIssues(
      catalog.coOrderRelationships.map((relationship) =>
        JSON.stringify([
          relationship.source.publisherId,
          relationship.source.datasetId,
          relationship.source.datasetVersion,
          relationship.source.snapshotSha256,
          relationship.basis,
          relationship.cohort.label,
          relationship.cohort.description,
          relationship.observationWindow.startDate,
          relationship.observationWindow.endDate,
          relationship.leftAssaySlug,
          relationship.rightAssaySlug,
        ]),
      ),
      "coOrderRelationships",
      "id",
      context,
      () => "Duplicate co-order aggregate for the same source, cohort, window, basis, and assay pair.",
    );

    const assayIds = new Set(catalog.assays.map((assay) => assay.slug));
    const labIds = new Set(catalog.labs.map((lab) => lab.id));
    const recordIds = new Set(catalog.assayLabRecords.map((record) => record.id));

    catalog.assayLabRecords.forEach((record, index) => {
      if (!assayIds.has(record.assaySlug)) {
        addReferenceIssue(context, ["assayLabRecords", index, "assaySlug"], record.assaySlug);
      }
      if (!labIds.has(record.labId)) {
        addReferenceIssue(context, ["assayLabRecords", index, "labId"], record.labId);
      }
      if (record.publicationStatus === "published" && record.sourceLinks.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["assayLabRecords", index, "sourceLinks"],
          message: "Published records require at least one source link.",
          params: { issueCode: "missing_provenance" },
        });
      }
    });

    catalog.sourceOfferings.forEach((offering, index) => {
      if (!labIds.has(offering.labId)) {
        addReferenceIssue(context, ["sourceOfferings", index, "labId"], offering.labId);
      }
      if (offering.assaySlug !== null && !assayIds.has(offering.assaySlug)) {
        addReferenceIssue(
          context,
          ["sourceOfferings", index, "assaySlug"],
          offering.assaySlug,
        );
      }
    });

    catalog.sourceDocuments.forEach((source, index) => {
      if (!assayIds.has(source.assaySlug)) {
        addReferenceIssue(context, ["sourceDocuments", index, "assaySlug"], source.assaySlug);
      }
      if (!labIds.has(source.labId)) {
        addReferenceIssue(context, ["sourceDocuments", index, "labId"], source.labId);
      }
      source.relatedRecordIds.forEach((recordId, recordIndex) => {
        if (!recordIds.has(recordId)) {
          addReferenceIssue(context, ["sourceDocuments", index, "relatedRecordIds", recordIndex], recordId);
        }
      });
    });

    catalog.assayLevelCodes.forEach((code, index) => {
      if (!assayIds.has(code.assaySlug)) {
        addReferenceIssue(context, ["assayLevelCodes", index, "assaySlug"], code.assaySlug);
      }
    });

    catalog.curatedAssayRelationships.forEach((relationship, index) => {
      if (!assayIds.has(relationship.sourceAssaySlug)) {
        addReferenceIssue(
          context,
          ["curatedAssayRelationships", index, "sourceAssaySlug"],
          relationship.sourceAssaySlug,
        );
      }
      if (!assayIds.has(relationship.targetAssaySlug)) {
        addReferenceIssue(
          context,
          ["curatedAssayRelationships", index, "targetAssaySlug"],
          relationship.targetAssaySlug,
        );
      }
      if (relationship.sourceAssaySlug === relationship.targetAssaySlug) {
        context.addIssue({
          code: "custom",
          path: ["curatedAssayRelationships", index, "targetAssaySlug"],
          message: "Curated assay relationships cannot link an assay to itself.",
          params: { issueCode: "self_reference" },
        });
      }
    });

    catalog.coOrderRelationships.forEach((relationship, index) => {
      if (!assayIds.has(relationship.leftAssaySlug)) {
        addReferenceIssue(
          context,
          ["coOrderRelationships", index, "leftAssaySlug"],
          relationship.leftAssaySlug,
        );
      }
      if (!assayIds.has(relationship.rightAssaySlug)) {
        addReferenceIssue(
          context,
          ["coOrderRelationships", index, "rightAssaySlug"],
          relationship.rightAssaySlug,
        );
      }
    });
  });

export function parseCatalog(input: unknown): AssayIndexCatalog {
  return assayIndexCatalogSchema.parse(input);
}

export function validateCatalog(input: unknown) {
  return assayIndexCatalogSchema.safeParse(input);
}

export function mapValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "catalog",
    message: issue.message,
    code:
      "params" in issue && typeof issue.params?.issueCode === "string"
        ? issue.params.issueCode
        : issue.code,
  }));
}
