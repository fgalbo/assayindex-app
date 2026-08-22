import { describe, expect, it } from "vitest";

import {
  buildCommonLabOrderTerminologyIndex,
  parseCommonMnemonicSupplement,
  parseNlmClinicalTablesResponse,
  parseUniversalLabOrdersCsv,
} from "../../scripts/assayindex/common-lab-orders.mjs";
import {
  buildSearchUrl,
  parseArguments,
  readBoundedUtf8Response,
} from "../../scripts/update-assayindex-common-orders.mjs";

describe("common laboratory order acquisition", () => {
  it("requires the explicit network gate", () => {
    expect(() => parseArguments([])).toThrow(/Network acquisition is disabled/);
    expect(parseArguments(["--allow-network", "--write"])).toEqual({
      allowNetwork: true,
      write: true,
      help: false,
    });
  });

  it("enforces the byte limit while streaming an undeclared response", async () => {
    const response = new Response(new TextEncoder().encode("abcdef"));
    await expect(readBoundedUtf8Response(response, 5)).rejects.toThrow(/byte limit/i);
  });

  it("builds fixed-code enrichment requests that exclude copyrighted content", () => {
    const url = buildSearchUrl(["24323-8", "24321-2"]);
    expect(url.origin + url.pathname).toBe("https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search");
    expect(url.searchParams.get("excludeCopyrighted")).toBe("true");
    expect(url.searchParams.get("count")).toBe("2");
    expect(url.searchParams.get("q")).toBe('LOINC_NUM:("24323-8" OR "24321-2")');
    expect(url.searchParams.get("ef")).toContain("LONG_COMMON_NAME");
    expect([...url.searchParams.keys()].toSorted()).toEqual(
      ["count", "df", "ef", "excludeCopyrighted", "q", "terms"].toSorted(),
    );
  });

  it("parses quoted CSV names without changing official field values", () => {
    const rows = parseUniversalLabOrdersCsv([
      "LOINC_NUM,LONG_COMMON_NAME,ORDER_OBS",
      '1234-5,"Panel, example - Serum",Order',
      "2345-6,Another example,Both",
      "",
    ].join("\r\n"));
    expect(rows).toEqual([
      { loincCode: "1234-5", longCommonName: "Panel, example - Serum", orderObservation: "Order" },
      { loincCode: "2345-6", longCommonName: "Another example", orderObservation: "Both" },
    ]);
  });

  it("parses parallel NLM fields and splits related names losslessly", () => {
    const parsed = parseNlmClinicalTablesResponse([
      1,
      ["1234-5"],
      {
        SHORTNAME: ["Example Pnl Ser"],
        CONSUMER_NAME: [""],
        RELATEDNAMES2: ["ABC; Alpha beta; ABC"],
        LONG_COMMON_NAME: ["Example panel - Serum"],
      },
      [["Example", "1234-5"]],
    ]);
    expect(parsed.get("1234-5")).toEqual({
      longCommonName: "Example panel - Serum",
      shortName: "Example Pnl Ser",
      consumerName: null,
      relatedNames: ["ABC", "Alpha beta"],
    });
  });

  it("rejects duplicate codes inside one NLM enrichment response", () => {
    expect(() => parseNlmClinicalTablesResponse([
      2,
      ["1234-5", "1234-5"],
      {
        SHORTNAME: ["First", "Second"],
        CONSUMER_NAME: ["", ""],
        RELATEDNAMES2: ["", ""],
        LONG_COMMON_NAME: ["First concept", "Conflicting duplicate"],
      },
      [["First", "1234-5"], ["Second", "1234-5"]],
    ])).toThrow(/duplicate LOINC code 1234-5/i);
  });

  it("validates the local mnemonic supplement as a unique fixed-code allowlist", () => {
    expect(parseCommonMnemonicSupplement({
      schemaVersion: "1",
      sourceId: "assayindex-test-supplement",
      selectionVersion: "1.0.0",
      concepts: [
        { id: "hematocrit", loincCodes: ["4544-3"] },
        { id: "mcv", loincCodes: ["787-2"] },
      ],
    })).toMatchObject({
      sourceId: "assayindex-test-supplement",
      concepts: [{ id: "hematocrit" }, { id: "mcv" }],
    });
    expect(() => parseCommonMnemonicSupplement({
      schemaVersion: "1",
      sourceId: "assayindex-test-supplement",
      selectionVersion: "1.0.0",
      concepts: [
        { id: "hematocrit", loincCodes: ["4544-3"] },
        { id: "duplicate", loincCodes: ["4544-3"] },
      ],
    })).toThrow(/duplicate.*LOINC code/i);
  });

  it("fails when an audited supplement code moves into the common-order source", () => {
    expect(() => buildCommonLabOrderTerminologyIndex({
      sourceEntries: [{
        loincCode: "4544-3",
        longCommonName: "Hematocrit [Volume Fraction] of Blood by Automated count",
        orderObservation: "Both",
      }],
      mnemonicSupplement: {
        schemaVersion: "1",
        sourceId: "assayindex-test-supplement",
        selectionVersion: "1.0.0",
        concepts: [{ id: "hematocrit", loincCodes: ["4544-3"] }],
      },
      enrichedByCode: new Map(),
      sourceSha256: "a".repeat(64),
      supplementCodeSetSha256: "c".repeat(64),
      sourceUpdatedAt: null,
      retrievedAt: "2026-08-21T00:00:00.000Z",
      enrichmentResponseSha256: "b".repeat(64),
      enrichmentBatchCount: 1,
    })).toThrow(/now present in the Common Lab Orders source/i);
  });

  it("fails when NLM enrichment omits any audited supplemental code", () => {
    expect(() => buildCommonLabOrderTerminologyIndex({
      sourceEntries: [{
        loincCode: "1234-5",
        longCommonName: "Example source concept",
        orderObservation: "Order",
      }],
      mnemonicSupplement: {
        schemaVersion: "1",
        sourceId: "assayindex-test-supplement",
        selectionVersion: "1.0.0",
        concepts: [{ id: "mcv", loincCodes: ["787-2"] }],
      },
      enrichedByCode: new Map([["1234-5", {
        longCommonName: "Example source concept",
        shortName: "Example",
        consumerName: null,
        relatedNames: [],
      }]]),
      sourceSha256: "a".repeat(64),
      supplementCodeSetSha256: "c".repeat(64),
      sourceUpdatedAt: null,
      retrievedAt: "2026-08-21T00:00:00.000Z",
      enrichmentResponseSha256: "b".repeat(64),
      enrichmentBatchCount: 1,
    })).toThrow(/did not return mnemonic supplement code 787-2/i);
  });

  it("refuses a public snapshot below the 90 percent retention gate", () => {
    const sourceEntries = Array.from({ length: 1_000 }, (_, index) => ({
      loincCode: `${index + 1}-${index % 10}`,
      longCommonName: `Example ${index}`,
      orderObservation: "Order",
    }));
    const enrichedByCode = new Map(sourceEntries.slice(0, 899).map((entry) => [entry.loincCode, {
      longCommonName: entry.longCommonName,
      shortName: entry.longCommonName,
      consumerName: null,
      relatedNames: [],
    }]));
    expect(() => buildCommonLabOrderTerminologyIndex({
      sourceEntries,
      mnemonicSupplement: {
        schemaVersion: "1",
        sourceId: "assayindex-test-supplement",
        selectionVersion: "1.0.0",
        concepts: [{ id: "supplement", loincCodes: ["2000-0"] }],
      },
      enrichedByCode: new Map([
        ...enrichedByCode,
        ["2000-0", {
          longCommonName: "Supplemental example",
          shortName: "Supplemental example",
          consumerName: null,
          relatedNames: [],
        }],
      ]),
      sourceSha256: "a".repeat(64),
      supplementCodeSetSha256: "c".repeat(64),
      sourceUpdatedAt: null,
      retrievedAt: "2026-08-21T00:00:00.000Z",
      enrichmentResponseSha256: "b".repeat(64),
      enrichmentBatchCount: 20,
    })).toThrow(/retention gate failed/);
  });
});
