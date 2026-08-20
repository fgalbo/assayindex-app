import { describe, expect, it } from "vitest";

import {
  canAcquireSource,
  canRedistributeSource,
  canExposeTestingSearch,
  canUseFallback,
  parseSourceRegistry,
  resolveSourcePlan,
  sourceRegistrySchema,
} from "@/features/assayindex/acquisition/source-policy";

import sourceRegistryFixture from "./fixtures/acquisition/source-registry.json";

describe("AssayIndex acquisition source policy", () => {
  it("rejects an unknown runtime permission status in both schema and policy checks", () => {
    const registry = parseSourceRegistry(sourceRegistryFixture);
    const malformedSource = {
      ...registry.sources[0],
      permissionStatus: "future-permission-status",
    } as unknown as Parameters<typeof canAcquireSource>[0];
    const malformedRegistry = {
      ...registry,
      sources: [malformedSource, ...registry.sources.slice(1)],
    };

    expect(sourceRegistrySchema.safeParse(malformedRegistry).success).toBe(false);
    expect(canAcquireSource(malformedSource)).toEqual({
      allowed: false,
      reason: "permission_not_approved",
    });
  });

  it("prefers structured sources and excludes unapproved scraping fallbacks", () => {
    const registry = parseSourceRegistry(sourceRegistryFixture);

    expect(resolveSourcePlan(registry, "nih-gtr").map((source) => source.id)).toEqual([
      "gtr-test-condition-gene-download",
      "gtr-data-api",
    ]);

    const unapprovedHtml = registry.sources.find((source) => source.id === "gtr-html")!;

    expect(canUseFallback(unapprovedHtml)).toEqual({
      allowed: false,
      reason: "permission_not_approved",
    });
  });

  it("accepts an arbitrary source publisher without a hardcoded vendor list", () => {
    const registry = structuredClone(parseSourceRegistry(sourceRegistryFixture));
    registry.sources.push({
      ...registry.sources[0],
      id: "county-public-health-catalog",
      publisherId: "county-public-health-department",
      publisherName: "County Public Health Department",
      datasetName: "Public health reference laboratory catalog",
      url: "https://public-health.example.gov/open-data/test-catalog.tsv",
      allowedHosts: ["public-health.example.gov"],
      policyUrl: "https://public-health.example.gov/open-data/policy",
      requiredAttribution: "County Public Health Department",
      requiredAttributionUrl: "https://public-health.example.gov/open-data",
      disclaimer: null,
    });

    expect(resolveSourcePlan(registry, "county-public-health-department")).toEqual([
      expect.objectContaining({
        id: "county-public-health-catalog",
        kind: "bulk-download",
      }),
    ]);
  });

  it("allows an explicitly approved university-publisher fallback after its download", () => {
    const registry = parseSourceRegistry(sourceRegistryFixture);
    const plan = resolveSourcePlan(registry, "north-ridge-university");

    expect(plan.map((source) => source.id)).toEqual([
      "north-ridge-open-catalog",
      "north-ridge-permitted-html",
    ]);
    expect(canUseFallback(plan[1])).toEqual({ allowed: true, reason: null });
  });

  it("blocks review-required redistribution until release and redistribution are explicitly approved", () => {
    const registry = parseSourceRegistry(sourceRegistryFixture);
    const reviewRequired = registry.sources.find((source) => source.id === "gtr-data-api")!;

    expect(
      canRedistributeSource({
        ...reviewRequired,
        releaseEnabled: true,
        redistributionApproved: false,
      }),
    ).toEqual({
      allowed: false,
      reason: "redistribution_review_required",
    });
    expect(
      canRedistributeSource({
        ...reviewRequired,
        releaseEnabled: true,
        redistributionApproved: true,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  it("requires an explicit public non-patient testing disclosure without enabling release", () => {
    const source = parseSourceRegistry(sourceRegistryFixture).sources[0];
    const testingSource = {
      ...source,
      releaseEnabled: false,
      redistributionApproved: false,
      redistributionStatus: "review-required" as const,
      testingSearchEnabled: true,
      testingSearchDataClassification: "public-non-patient" as const,
      requiredAttribution: "Public source",
      requiredAttributionUrl: "https://example.org/source",
      disclaimer: "Source records are not independently verified.",
      maxStagingIssueCount: 0,
    };

    expect(canExposeTestingSearch(testingSource)).toEqual({ allowed: true, reason: null });
    expect(canRedistributeSource(testingSource)).toEqual({ allowed: false, reason: "release_disabled" });
    expect(canExposeTestingSearch({ ...testingSource, testingSearchDataClassification: null })).toEqual({
      allowed: false,
      reason: "testing_search_data_classification_required",
    });
    expect(canExposeTestingSearch({ ...testingSource, redistributionStatus: "prohibited" })).toEqual({
      allowed: false,
      reason: "testing_search_prohibited",
    });
  });
});
