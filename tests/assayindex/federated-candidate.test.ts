import { describe, expect, it } from "vitest";

import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import {
  assertSourceCandidateTransition,
  canTransitionSourceCandidate,
  sourceCandidateIdentity,
} from "@/features/assayindex/federated/candidate";
import { suggestAssayRelationship } from "@/features/assayindex/federated/matching";
import type { ParsedSourceOffering } from "@/features/assayindex/federated/types";

function parsedOffering(overrides: Partial<ParsedSourceOffering> = {}): ParsedSourceOffering {
  return {
    sourceLab: "arup",
    sourceRef: "arup:test:0095840",
    sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
    sourceTestCode: "0095840",
    sourceTitle: "Shared Assay",
    testName: "Shared Assay",
    aliases: [],
    analytes: [],
    genes: [],
    orderingRecommendation: null,
    methodology: null,
    methodClass: null,
    measurementType: null,
    specimenOptions: [],
    turnaroundTime: null,
    performingSchedule: null,
    performingLocation: null,
    cptCodes: [],
    loincCodes: [],
    resultComponents: [],
    reflexRules: [],
    clinicalUse: null,
    limitations: null,
    availability: null,
    serviceAreas: [],
    parseWarnings: [],
    fieldProvenance: {},
    parserVersion: "test-1",
    adapterVersion: "test-1",
    contentHash: "a".repeat(64),
    fetchedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function matchingCatalog(existingDescription: string): AssayIndexCatalog {
  return {
    assays: [{ slug: "shared-assay", displayName: "Shared Assay", synonyms: [] }],
    assayLabRecords: [{
      assaySlug: "shared-assay",
      testName: existingDescription,
      methodology: null,
      testCode: null,
      testId: null,
      orderCode: null,
      sourceLinks: [],
    }],
  } as unknown as AssayIndexCatalog;
}

describe("source candidate lifecycle primitives", () => {
  it("allows only the staged review lifecycle and keeps terminal decisions terminal", () => {
    expect(canTransitionSourceCandidate("discovered", "fetched")).toBe(true);
    expect(canTransitionSourceCandidate("fetched", "parsed")).toBe(true);
    expect(canTransitionSourceCandidate("parsed", "needs-review")).toBe(true);
    expect(canTransitionSourceCandidate("needs-review", "approved")).toBe(true);
    expect(canTransitionSourceCandidate("needs-review", "rejected")).toBe(true);
    expect(canTransitionSourceCandidate("error", "fetched")).toBe(true);

    for (const [current, next] of [
      ["discovered", "approved"],
      ["fetched", "approved"],
      ["parsed", "approved"],
      ["approved", "needs-review"],
      ["rejected", "approved"],
    ] as const) {
      expect(canTransitionSourceCandidate(current, next)).toBe(false);
      expect(() => assertSourceCandidateTransition(current, next)).toThrow(/invalid source candidate transition/i);
    }
  });

  it("uses source identity plus content hash for deterministic deduplication", () => {
    const hash = "a".repeat(64);
    const identity = sourceCandidateIdentity("arup", "arup:test:0095840", hash);

    expect(sourceCandidateIdentity("arup", "arup:test:0095840", hash)).toBe(identity);
    expect(sourceCandidateIdentity("arup", "arup:test:0095840", "b".repeat(64))).not.toBe(identity);
    expect(sourceCandidateIdentity("arup", "arup:test:3019466", hash)).not.toBe(identity);
    expect(() => sourceCandidateIdentity("arup", "arup:test:0095840", "not-a-hash")).toThrow(
      /content hash is invalid/i,
    );
  });
});

describe("assay relationship suggestions", () => {
  it.each([
    ["HLA-B27 Antigen", "HLA-B27 Genotyping", "antigen-versus-genotyping"],
    ["Qualitative assay", "Quantitative assay", "qualitative-versus-quantitative"],
    ["Single analyte", "Multi-analyte panel", "panel-versus-single-analyte"],
    ["Screening assay", "Confirmatory assay", "screen-versus-confirmation"],
    ["Tumor assay", "Germline assay", "tumor-versus-germline"],
    ["Standalone test", "Reflex cascade", "reflex-versus-standalone"],
    ["Culture", "Molecular PCR", "culture-versus-molecular"],
  ])("keeps %s separate from %s through the %s blocker", (candidate, existing, blocker) => {
    const suggestion = suggestAssayRelationship(
      parsedOffering({ sourceTestCode: "different-code", sourceTitle: candidate }),
      matchingCatalog(existing),
    );

    expect(suggestion).toMatchObject({
      assayId: "shared-assay",
      relationship: "related-method-variant",
      confidence: 0.35,
      hardBlockers: [blocker],
    });
    expect(suggestion.reasons.join(" ")).toMatch(/curator review/i);
  });

  it("can suggest an exact existing offering but never performs a merge", () => {
    const catalog = matchingCatalog("Any title");
    catalog.assayLabRecords[0]!.testCode = "0095840";

    expect(suggestAssayRelationship(parsedOffering(), catalog)).toEqual({
      assayId: "shared-assay",
      relationship: "existing-exact-offering",
      confidence: 1,
      reasons: ["Exact source test identifier or canonical source URL matched."],
      hardBlockers: [],
    });
  });
});
