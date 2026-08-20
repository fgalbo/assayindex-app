import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  normalizeGtrTestingLimit,
  normalizeGtrTestingQuery,
  searchGtrTestingIndex,
} from "@/features/assayindex/testing/gtr-search.server";

let fixtureDirectory = "";
let database: DatabaseSync;

function addMetadata(key: string, value: string | number) {
  database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run(key, String(value));
}

function addRecord({ id, testName, searchText, reviewFlags = [] }: {
  id: string;
  testName: string;
  searchText: string;
  reviewFlags?: string[];
}) {
  const result = database.prepare(`
    INSERT INTO records (
      id, source_id, publisher_id, external_record_id, provider_id, test_name, lab_name,
      institution_name, location, order_code, source_test_id, genes_json, gene_ids_json,
      gene_medgen_ids_json, conditions_json, condition_ids_json, methods_json, review_flags_json,
      candidate_state, normalized_sha256, source_last_touched_at, official_url
    ) VALUES (?, 'nih-gtr-test-version', 'nih-gtr', ?, 'provider-1', ?, 'University Genetics Lab',
      'University Hospital', 'Colorado, United States', 'ORDER-1', 'TEST-1', '["TP53"]', '["7157"]',
      '["C0043194"]', '["Li-Fraumeni syndrome"]', '["C0085390"]', '["Sequencing"]', ?,
      ?, ?, '2026-08-09', ?)
  `).run(
    id,
    id,
    testName,
    JSON.stringify(reviewFlags),
    reviewFlags.length ? "discovered-review-required" : "discovered",
    "a".repeat(64),
    `https://www.ncbi.nlm.nih.gov/gtr/tests/${id.replace(/\D/g, "")}/`,
  );
  database.prepare("INSERT INTO records_fts (rowid, all_text) VALUES (?, ?)").run(
    result.lastInsertRowid,
    searchText,
  );
}

beforeEach(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), "assayindex-gtr-search-"));
  database = new DatabaseSync(path.join(fixtureDirectory, "fixture.sqlite"));
  database.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE records (
      row_number INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, source_id TEXT NOT NULL,
      publisher_id TEXT NOT NULL, external_record_id TEXT NOT NULL, provider_id TEXT NOT NULL,
      test_name TEXT NOT NULL, lab_name TEXT NOT NULL, institution_name TEXT, location TEXT,
      order_code TEXT, source_test_id TEXT, genes_json TEXT NOT NULL, gene_ids_json TEXT NOT NULL,
      gene_medgen_ids_json TEXT NOT NULL, conditions_json TEXT NOT NULL, condition_ids_json TEXT NOT NULL,
      methods_json TEXT NOT NULL, review_flags_json TEXT NOT NULL, candidate_state TEXT NOT NULL,
      normalized_sha256 TEXT NOT NULL, source_last_touched_at TEXT, official_url TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE records_fts USING fts5(all_text, content = '', tokenize = 'unicode61 remove_diacritics 2');
  `);
  for (const [key, value] of Object.entries({
    schemaVersion: "1",
    indexVersion: "1.1.0",
    status: "validated-staged-testing",
    sourceId: "nih-gtr-test-version",
    sourceSnapshotSha256: "b".repeat(64),
    sourceRetrievedAt: "2026-08-12T00:00:00.000Z",
    sourceUpdatedAt: "2026-08-09T00:00:00.000Z",
    candidateCount: 2,
    reviewRequiredCandidateCount: 1,
    issueCount: 0,
    enrichmentSourceId: "nih-gtr-test-condition-gene",
    enrichmentSnapshotSha256: "c".repeat(64),
    enrichmentIssueCount: 0,
    attribution: "NIH Genetic Testing Registry (GTR)",
    attributionUrl: "https://www.ncbi.nlm.nih.gov/gtr/",
    disclaimer: "GTR data are submitted by laboratories and are not independently verified by NIH.",
  })) addMetadata(key, value);
  addRecord({
    id: "GTR000000001.1",
    testName: "TP53 hereditary cancer test",
    searchText: "TP53 hereditary cancer Li-Fraumeni syndrome University Genetics Lab Sequencing",
  });
  addRecord({
    id: "GTR000000002.1",
    testName: "FMR1 repeat analysis",
    searchText: "FMR1 Fragile X repeat analysis University Genetics Lab PCR",
    reviewFlags: ["test-not-current"],
  });
});

afterEach(async () => {
  database.close();
  await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("validated GTR testing search", () => {
  it("searches genes, conditions, laboratories, and methods through the validated index", async () => {
    for (const query of ["TP53", "Li-Fraumeni", "University", "Sequencing"]) {
      const response = await searchGtrTestingIndex({ query, limit: 10, database });
      expect(response.matchedCount, query).toBeGreaterThan(0);
      expect(response.results[0]?.officialUrl).toMatch(/^https:\/\/www\.ncbi\.nlm\.nih\.gov\/gtr\/tests\//);
      expect(response.status).toBe("validated-staged-testing");
    }
  });

  it("returns only the allowlisted staged result shape with source disclosure", async () => {
    const response = await searchGtrTestingIndex({ query: "TP53", database });
    expect(Object.keys(response.results[0] ?? {}).toSorted()).toEqual([
      "candidateState", "conditionIds", "conditions", "externalRecordId", "geneIds",
      "geneMedgenIds", "genes", "id", "institutionName", "kind", "labName", "location",
      "methods", "officialUrl", "orderCode", "providerId", "publisherId", "reviewFlags",
      "sourceId", "sourceLastTouchedAt", "sourceTestId", "testName",
    ].toSorted());
    expect(JSON.stringify(response)).not.toMatch(/sourceRowNumber|normalizedSha256|patient|contact/i);
    expect(response.source.attribution).toBe("NIH Genetic Testing Registry (GTR)");
  });

  it("bounds and escapes user input", async () => {
    expect(() => normalizeGtrTestingQuery("x")).toThrow(/2-120/);
    expect(() => normalizeGtrTestingQuery("a b c d e f g h i j k")).toThrow(/1-10/);
    expect(() => normalizeGtrTestingLimit(51)).toThrow(/1 through 50/);
    const normalized = normalizeGtrTestingQuery('TP53" OR 1=1 --');
    expect(normalized.match).toBe('"tp53"* AND "or"* AND "1"*');
    await expect(searchGtrTestingIndex({ query: 'TP53" OR 1=1 --', database })).resolves.toMatchObject({
      matchedCount: 0,
    });
  });
});
