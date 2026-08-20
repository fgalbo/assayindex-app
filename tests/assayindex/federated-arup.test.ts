import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  arupDetailUrlForSourceRef,
  arupSearchUrlForQuery,
  arupSourceRefForTestCode,
  assertAllowedArupUrl,
  parseArupDetailHtml,
  parseArupSearchResponse,
} from "@/features/assayindex/federated/arup";

type SearchFixture = {
  sourceUrl: string;
  retrievedAt: string;
  response: unknown;
};

const searchFixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tests", "assayindex", "fixtures", "federated", "arup-hla-b27-search.json"),
    "utf8",
  ),
) as SearchFixture;
const detailFixture = readFileSync(
  resolve(process.cwd(), "tests", "assayindex", "fixtures", "federated", "arup-hla-b27-detail.html"),
  "utf8",
);

describe("ARUP source parsers", () => {
  it("maps a synthetic ARUP-shaped response to stable, server-resolvable references", () => {
    expect(searchFixture.sourceUrl).toBe(
      "https://ltd.aruplab.com/api/ltdsearch?searchterm=HLA-B27",
    );

    const references = parseArupSearchResponse(searchFixture.response);

    expect(references).toHaveLength(3);
    expect(references[0]).toMatchObject({
      sourceLab: "arup",
      sourceTestCode: "0095840",
      title: "HLA-B27",
      sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
      sourceStatus: "A",
      orderingRecommendation:
        "Synthetic fixture: interpret only with supporting clinical findings.",
    });
    expect(references[0]?.sourceRef).toMatch(/^arup:test:\d{7}$/);
    expect(references[0]?.summary).not.toMatch(/<[^>]+>|&nbsp;/);
    expect(references[1]).toMatchObject({
      sourceTestCode: "3019466",
      title: "Ankylosing Spondylitis (HLA-B27) Genotyping",
      sourceStatus: "A",
    });
    expect(references[2]).toMatchObject({ sourceTestCode: "0050392", sourceStatus: "I" });

    expect(parseArupSearchResponse(searchFixture.response)).toEqual(references);
    expect(arupDetailUrlForSourceRef(references[0]!.sourceRef)).toBe(references[0]!.sourceUrl);
  });

  it("parses a synthetic detail page without collapsing antigen testing into genotyping", () => {
    const parsed = parseArupDetailHtml(detailFixture, {
      sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
      sourceRef: arupSourceRefForTestCode("0095840"),
      fetchedAt: "2026-08-19T00:00:00.000Z",
    });

    expect(parsed).toMatchObject({
      sourceLab: "arup",
      sourceTestCode: "0095840",
      sourceTitle: "HLA-B27",
      testName: "HLA-B27",
      methodology: "Qualitative Synthetic Flow Cytometry",
      measurementType: "Qualitative",
      turnaroundTime: "2-4 days",
      performingSchedule: "Mon-Fri",
      cptCodes: ["00000"],
      loincCodes: ["00000-0"],
      parserVersion: "1.0.0",
      adapterVersion: "1.0.0",
      fetchedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(parsed.aliases).toEqual([
      "Synthetic Marker Alias",
      "Synthetic Marker B27",
    ]);
    expect(parsed.specimenOptions).toEqual([
      expect.objectContaining({
        specimenType: "Synthetic EDTA whole blood specimen",
        preferredVolume: "3 mL whole blood",
        minimumVolume: "1 mL",
        transportTemperature: "Ambient",
        ambientStability: "48 hours",
        refrigeratedStability: "Unacceptable",
        frozenStability: "Unacceptable",
      }),
    ]);
    expect(parsed.resultComponents).toEqual([
      {
        sourceTestCode: "0000001",
        name: "Synthetic HLA-B27 Component",
        loincCode: "00000-0",
        units: null,
      },
    ]);
    expect(parsed.limitations).toContain("recommendation of genotype testing");
    expect(parsed.limitations).toContain("3019466");
    expect(parsed.methodology).not.toMatch(/PCR|genotyp/i);
    expect(parsed.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.parseWarnings).toEqual([]);
  });

  it("rejects a source reference that does not match the official detail page", () => {
    expect(() =>
      parseArupDetailHtml(detailFixture, {
        sourceUrl: "https://ltd.aruplab.com/Tests/Pub/3019466",
        sourceRef: arupSourceRefForTestCode("3019466"),
        fetchedAt: "2026-08-19T00:00:00.000Z",
      }),
    ).toThrow(/test code does not match/i);
  });

  it("constructs bounded official URLs and rejects lookalike or client-controlled targets", () => {
    expect(arupSearchUrlForQuery("  HLA   B27  ").toString()).toBe(
      "https://ltd.aruplab.com/api/ltdsearch?searchterm=HLA+B27&rows=25&start=0",
    );
    expect(() => arupSourceRefForTestCode("https://attacker.example/private")).toThrow(
      /exactly seven digits/i,
    );

    for (const target of [
      "http://ltd.aruplab.com/api/ltdsearch?searchterm=HLA-B27&rows=25&start=0",
      "https://ltd.aruplab.com.attacker.example/api/ltdsearch?searchterm=HLA-B27&rows=25&start=0",
      "https://user:password@ltd.aruplab.com/api/ltdsearch?searchterm=HLA-B27&rows=25&start=0",
      "https://ltd.aruplab.com:444/api/ltdsearch?searchterm=HLA-B27&rows=25&start=0",
      "https://ltd.aruplab.com/api/ltdsearch?searchterm=HLA-B27&rows=25&start=0&url=https://attacker.example",
      "https://ltd.aruplab.com/Tests/Pub/0095840?redirect=https://attacker.example",
    ]) {
      const kind: "search" | "detail" = target.includes("/api/ltdsearch") ? "search" : "detail";
      expect(() => assertAllowedArupUrl(target, kind)).toThrow(/blocked/i);
    }
  });
});
