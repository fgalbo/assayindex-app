import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseGtrTestConditionGeneTsv } from "@/features/assayindex/acquisition/gtr";

function fixturePath(fileName: string) {
  return resolve(
    process.cwd(),
    "tests",
    "assayindex",
    "fixtures",
    "acquisition",
    "gtr",
    fileName,
  );
}

async function loadFixture(fileName: string) {
  return readFile(fixturePath(fileName), "utf8");
}

describe("GTR test-condition-gene acquisition", () => {
  it("parses deterministic staged rows without inventing a reference laboratory", async () => {
    const rawTsv = await loadFixture("test-condition-gene.sample.tsv");

    const first = parseGtrTestConditionGeneTsv(rawTsv);
    const second = parseGtrTestConditionGeneTsv(rawTsv);

    expect(first).toEqual(second);
    expect(first.issues).toEqual([]);
    expect(first.records.map((record) => record.gtrAccession)).toEqual([
      "GTR000004036",
      "GTR000004528",
    ]);

    expect(first.records[0]).toMatchObject({
      accessionVersion: "GTR000004036.6",
      conditionIds: ["C0016667", "C1839780", "C4552079"],
      geneIds: ["2332"],
      gtrAccession: "GTR000004036",
      referenceLaboratory: null,
      specimenType: null,
      testType: "Clinical",
      testName: null,
      turnaroundTime: null,
    });

    expect(first.records[0].conditions).toEqual([
      {
        medGenId: "C0016667",
        mimNumber: "300624",
        name: "Fragile X syndrome",
        snomedCtId: "613003",
      },
      {
        medGenId: "C1839780",
        mimNumber: "300623",
        name: "Fragile X-associated tremor/ataxia syndrome",
        snomedCtId: null,
      },
      {
        medGenId: "C4552079",
        mimNumber: "311360",
        name: "Premature ovarian failure 1",
        snomedCtId: null,
      },
    ]);
    expect(first.records[0].genes).toEqual([
      {
        medGenId: "C1414649",
        mimNumber: "309550",
        name: "FMR1:fragile X messenger ribonucleoprotein 1",
        ncbiGeneId: "2332",
        symbol: "FMR1",
      },
    ]);
    expect(first.records[1]).toMatchObject({
      conditionIds: ["C2713442"],
      geneIds: ["324", "4595"],
    });
    expect(first.records[1].genes.map((gene) => gene.medGenId)).toEqual([
      "C0162832",
      "C1417505",
    ]);
  });

  it("does not mistake a gene MedGen CUI for its NCBI Gene identifier", async () => {
    const result = parseGtrTestConditionGeneTsv(
      await loadFixture("test-condition-gene.sample.tsv"),
    );

    expect(result.records[0].geneIds).toEqual(["2332"]);
    expect(result.records[0].geneIds).not.toContain("C1414649");
    expect(result.records[0].genes[0]).toMatchObject({
      medGenId: "C1414649",
      ncbiGeneId: "2332",
      symbol: "FMR1",
    });
  });

  it("keeps staged record ordering and normalized identifiers stable when rows are reordered", async () => {
    const original = parseGtrTestConditionGeneTsv(
      await loadFixture("test-condition-gene.sample.tsv"),
    );
    const reordered = parseGtrTestConditionGeneTsv(
      await loadFixture("test-condition-gene.reordered.tsv"),
    );

    expect(reordered).toEqual(original);
  });

  it("flags conflicting non-empty test types while keeping record output deterministic", () => {
    const header = [
      "#accession_version",
      "test_type",
      "object",
      "GTR_identifier",
      "MIM_number",
      "object_name",
      "gene_or_SNOMED_CT_ID",
      "gene_symbol",
    ].join("\t");
    const condition = [
      "GTR000004006.1",
      "Clinical",
      "condition",
      "C0016667",
      "300624",
      "Fragile X syndrome",
      "613003",
      "N/A",
    ].join("\t");
    const gene = [
      "GTR000004006.1",
      "Research",
      "gene",
      "C1414649",
      "309550",
      "FMR1:fragile X messenger ribonucleoprotein 1",
      "2332",
      "FMR1",
    ].join("\t");

    const conditionFirst = parseGtrTestConditionGeneTsv(
      `${header}\n${condition}\n${gene}\n`,
    );
    const geneFirst = parseGtrTestConditionGeneTsv(
      `${header}\n${gene}\n${condition}\n`,
    );

    expect(conditionFirst.records).toEqual(geneFirst.records);
    expect(conditionFirst.records[0].testType).toBe("Clinical");
    for (const result of [conditionFirst, geneFirst]) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid_row",
          row: 3,
          message: expect.stringMatching(/conflicting.*test_type/i),
        }),
      );
    }
  });

  it("stops on required-header drift instead of silently producing partial records", async () => {
    const result = parseGtrTestConditionGeneTsv(
      await loadFixture("test-condition-gene.schema-drift.tsv"),
    );

    expect(result.records).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "schema_drift",
        field: "accession_version",
      }),
    );
  });
});
