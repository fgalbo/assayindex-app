import { z } from "zod";

const acquisitionMethodSchema = z.enum(["bulk-download", "api", "pdf", "html"]);
const permissionStatusSchema = z.enum(["evaluation-authorized", "approved", "not-approved", "disabled"]);
const redistributionStatusSchema = z.enum(["allowed", "review-required", "prohibited", "unknown"]);
const httpUrlSchema = z.string().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "URL must use HTTP or HTTPS.");

export const acquisitionSourceSchema = z.object({
  id: z.string().min(1),
  adapterId: z.string().min(1).nullable().default(null),
  promotionAdapterId: z.string().min(1).nullable().default(null),
  publisherId: z.string().min(1),
  publisherName: z.string().min(1),
  datasetName: z.string().min(1),
  kind: acquisitionMethodSchema,
  url: httpUrlSchema,
  allowedHosts: z.array(z.string().min(1)).min(1),
  enabled: z.boolean(),
  priority: z.number().int().nonnegative(),
  fallback: z.boolean(),
  permissionStatus: permissionStatusSchema,
  redistributionStatus: redistributionStatusSchema,
  releaseEnabled: z.boolean().default(false),
  redistributionApproved: z.boolean().default(false),
  federatedSearchEnabled: z.boolean().default(false),
  testingSearchEnabled: z.boolean().default(false),
  testingSearchDataClassification: z.enum(["public-non-patient"]).nullable().default(null),
  policyUrl: httpUrlSchema.nullable(),
  policyReviewedAt: z.string().datetime().nullable(),
  requiredAttribution: z.string().nullable(),
  requiredAttributionUrl: httpUrlSchema.nullable(),
  disclaimer: z.string().nullable(),
  cadence: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  maxDownloadBytes: z.number().int().positive(),
  maxExpandedBytes: z.number().int().positive(),
  maxStagingIssueCount: z.number().int().nonnegative().default(0),
  minimumCandidateCount: z.number().int().positive().default(1),
  minimumCandidateRetentionRatio: z.number().min(0).max(1).default(0.9),
  expectedContentTypes: z.array(z.string().min(1)).min(1),
});

export const sourceRegistrySchema = z.object({
  schemaVersion: z.literal("1"),
  reviewedAt: z.string().datetime(),
  sources: z.array(acquisitionSourceSchema),
});

export type AcquisitionSource = z.infer<typeof acquisitionSourceSchema>;
export type SourceRegistry = z.infer<typeof sourceRegistrySchema>;

export function parseSourceRegistry(input: unknown): SourceRegistry {
  return sourceRegistrySchema.parse(input);
}

export function resolveSourcePlan(registry: SourceRegistry, publisherId: string): AcquisitionSource[] {
  return registry.sources
    .filter((source) => source.publisherId === publisherId && source.enabled)
    .filter((source) => source.permissionStatus === "approved" || source.permissionStatus === "evaluation-authorized")
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

export function canAcquireSource(
  source: AcquisitionSource,
): { allowed: true; reason: null } | { allowed: false; reason: string } {
  if (!source.enabled || source.permissionStatus === "disabled") {
    return { allowed: false, reason: "source_disabled" };
  }

  if (
    source.permissionStatus === "approved" ||
    source.permissionStatus === "evaluation-authorized"
  ) {
    return { allowed: true, reason: null };
  }

  return { allowed: false, reason: "permission_not_approved" };
}

export function canUseFallback(
  source: AcquisitionSource,
): { allowed: true; reason: null } | { allowed: false; reason: string } {
  const acquisition = canAcquireSource(source);
  if (!acquisition.allowed) {
    return acquisition;
  }

  if (!source.fallback) {
    return { allowed: false, reason: "not_a_fallback_source" };
  }

  return { allowed: true, reason: null };
}

export function canUseFederatedSearch(source: AcquisitionSource) {
  if (source.permissionStatus === "disabled") {
    return { allowed: false as const, reason: "source_disabled" };
  }

  if (
    source.permissionStatus !== "approved" &&
    source.permissionStatus !== "evaluation-authorized"
  ) {
    return { allowed: false as const, reason: "permission_not_approved" };
  }

  if (!source.federatedSearchEnabled) {
    return { allowed: false as const, reason: "federated_search_disabled" };
  }

  return { allowed: true as const, reason: null };
}

export function canRedistributeSource(source: AcquisitionSource) {
  if (!source.releaseEnabled) {
    return { allowed: false as const, reason: "release_disabled" };
  }

  if (source.redistributionStatus === "allowed") {
    return { allowed: true as const, reason: null };
  }

  if (source.redistributionStatus === "review-required" && source.redistributionApproved) {
    return { allowed: true as const, reason: null };
  }

  return {
    allowed: false as const,
    reason: `redistribution_${source.redistributionStatus.replace("-", "_")}`,
  };
}

export function canExposeTestingSearch(source: AcquisitionSource) {
  const acquisition = canAcquireSource(source);
  if (!acquisition.allowed) return acquisition;

  if (!source.testingSearchEnabled) {
    return { allowed: false as const, reason: "testing_search_disabled" };
  }

  if (source.maxStagingIssueCount !== 0) {
    return { allowed: false as const, reason: "testing_search_requires_zero_issues" };
  }

  if (source.redistributionStatus === "prohibited") {
    return { allowed: false as const, reason: "testing_search_prohibited" };
  }

  if (source.testingSearchDataClassification !== "public-non-patient") {
    return { allowed: false as const, reason: "testing_search_data_classification_required" };
  }

  if (!source.requiredAttribution || !source.requiredAttributionUrl || !source.disclaimer) {
    return { allowed: false as const, reason: "testing_search_disclosure_required" };
  }

  return { allowed: true as const, reason: null };
}
