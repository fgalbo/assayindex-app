import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { canExposeTestingSearch } from "../../features/assayindex/acquisition/source-policy.ts";
import {
  GTR_CONDITION_GENE_SOURCE_ID,
  GTR_TEST_VERSION_SOURCE_ID,
  visitValidatedGtrCandidates,
} from "./acquisition/candidate-review.mjs";
import { loadSourceRegistry } from "./acquisition/source-registry.mjs";
import {
  PROJECT_ROOT,
  resolveWithinRuntime,
  writeJsonAtomic,
} from "./acquisition/runtime.mjs";

export const GTR_TESTING_SEARCH_SCHEMA_VERSION = "1";
export const GTR_TESTING_SEARCH_INDEX_VERSION = "1.1.0";

function json(value) {
  return JSON.stringify(value);
}

function compactStrings(values) {
  return values.flat(Infinity).filter((value) => typeof value === "string" && value.trim());
}

function uniqueSorted(values) {
  return [...new Set(compactStrings(values))].toSorted((left, right) => left.localeCompare(right));
}

function officialGtrUrl(accessionVersion) {
  const match = accessionVersion.match(/^GTR0*(\d+)(?:\.\d+)?$/);
  if (!match) throw new Error(`Cannot build an official GTR URL for ${accessionVersion}.`);
  return `https://www.ncbi.nlm.nih.gov/gtr/tests/${match[1]}/`;
}

function publicTestingRecord(candidate, enrichment) {
  const genes = uniqueSorted([candidate.offering.genes, enrichment?.geneSymbols ?? []]);
  const geneIds = uniqueSorted(enrichment?.geneIds ?? []);
  const geneMedgenIds = uniqueSorted(enrichment?.geneMedgenIds ?? []);
  const conditions = uniqueSorted([candidate.offering.conditions, enrichment?.conditionNames ?? []]);
  const conditionIds = uniqueSorted(enrichment?.conditionIds ?? []);
  const methods = uniqueSorted([
    ...candidate.offering.methodCategories,
    ...candidate.offering.methods,
    ...candidate.offering.platforms,
  ]);
  const labName = candidate.provider.laboratoryName ?? "Laboratory not listed by source";
  const institutionName = candidate.provider.institutionName;
  const testName = candidate.offering.labTestName
    ?? candidate.offering.manufacturerTestName
    ?? candidate.externalRecordId;
  const location = compactStrings([
    candidate.provider.state,
    candidate.provider.country,
  ]).join(", ") || null;

  return {
    id: `${candidate.sourceId}:${candidate.externalRecordId}`,
    sourceId: candidate.sourceId,
    publisherId: candidate.publisherId,
    externalRecordId: candidate.externalRecordId,
    providerId: candidate.publisherProviderId,
    testName,
    labName,
    institutionName,
    location,
    orderCode: candidate.offering.orderCode,
    sourceTestId: candidate.offering.labTestId,
    genes,
    geneIds,
    geneMedgenIds,
    conditions,
    conditionIds,
    methods,
    reviewFlags: candidate.reviewFlags,
    candidateState: candidate.candidateState,
    normalizedSha256: candidate.normalizedSha256,
    sourceLastTouchedAt: candidate.sourceStatus.lastTouchedAt,
    officialUrl: officialGtrUrl(candidate.externalRecordId),
    searchOnlyValues: compactStrings([
      candidate.sourceId,
      candidate.publisherId,
      candidate.provider.postcode,
      candidate.offering.manufacturerTestName,
      candidate.offering.testDevelopment,
    ]),
  };
}

function createDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE records (
      row_number INTEGER PRIMARY KEY,
      id TEXT UNIQUE NOT NULL,
      source_id TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      external_record_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      test_name TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      institution_name TEXT,
      location TEXT,
      order_code TEXT,
      source_test_id TEXT,
      genes_json TEXT NOT NULL,
      gene_ids_json TEXT NOT NULL,
      gene_medgen_ids_json TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      condition_ids_json TEXT NOT NULL,
      methods_json TEXT NOT NULL,
      review_flags_json TEXT NOT NULL,
      candidate_state TEXT NOT NULL,
      normalized_sha256 TEXT NOT NULL,
      source_last_touched_at TEXT,
      official_url TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE records_fts USING fts5(
      all_text,
      content = '',
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  return database;
}

function prepareInsertStatements(database) {
  return {
    record: database.prepare(`
    INSERT INTO records (
      id, source_id, publisher_id, external_record_id, provider_id,
      test_name, lab_name, institution_name, location, order_code, source_test_id,
      genes_json, gene_ids_json, gene_medgen_ids_json, conditions_json, condition_ids_json, methods_json,
      review_flags_json, candidate_state, normalized_sha256, source_last_touched_at,
      official_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    search: database.prepare(`
      INSERT INTO records_fts (rowid, all_text)
      VALUES (?, ?)
    `),
  };
}

function insertTestingRecord(statements, record) {
  const inserted = statements.record.run(
    record.id,
    record.sourceId,
    record.publisherId,
    record.externalRecordId,
    record.providerId,
    record.testName,
    record.labName,
    record.institutionName,
    record.location,
    record.orderCode,
    record.sourceTestId,
    json(record.genes),
    json(record.geneIds),
    json(record.geneMedgenIds),
    json(record.conditions),
    json(record.conditionIds),
    json(record.methods),
    json(record.reviewFlags),
    record.candidateState,
    record.normalizedSha256,
    record.sourceLastTouchedAt,
    record.officialUrl,
  );

  const allText = compactStrings([
    record.externalRecordId,
    record.providerId,
    record.testName,
    record.labName,
    record.institutionName,
    record.location,
    record.orderCode,
    record.sourceTestId,
    record.genes,
    record.geneIds,
    record.geneMedgenIds,
    record.conditions,
    record.conditionIds,
    record.methods,
    record.searchOnlyValues,
  ]).join(" ");
  statements.search.run(inserted.lastInsertRowid, allText);
}

function assertTestingSources(registry) {
  const selected = new Map();
  for (const sourceId of [GTR_TEST_VERSION_SOURCE_ID, GTR_CONDITION_GENE_SOURCE_ID]) {
    const source = registry.sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error(`Testing search source is missing from the registry: ${sourceId}`);
    const decision = canExposeTestingSearch(source);
    if (!decision.allowed) {
      throw new Error(`Testing search source ${sourceId} is blocked: ${decision.reason}`);
    }
    selected.set(sourceId, source);
  }
  return selected;
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function moveContentAddressed(temporaryPath, destinationPath, expectedSha256) {
  try {
    const existingSha256 = await sha256File(destinationPath);
    if (existingSha256 !== expectedSha256) {
      throw new Error(`Content-addressed destination is corrupt: ${destinationPath}`);
    }
    await rm(temporaryPath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await rename(temporaryPath, destinationPath);
  }
}

export async function buildGtrTestingSearchIndex({ outputDirectory } = {}) {
  const registry = await loadSourceRegistry();
  const testingSources = assertTestingSources(registry);
  const sourcePolicy = testingSources.get(GTR_TEST_VERSION_SOURCE_ID);
  const enrichmentPolicy = testingSources.get(GTR_CONDITION_GENE_SOURCE_ID);
  if (!sourcePolicy || !enrichmentPolicy || sourcePolicy.publisherId !== enrichmentPolicy.publisherId) {
    throw new Error("GTR testing sources must share one validated publisher identity.");
  }
  const directory = outputDirectory
    ?? resolveWithinRuntime("generated-testing-search");
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${directory}/.${randomUUID()}.sqlite`;
  let temporaryCompressedPath = null;
  let database = null;
  let committed = false;

  try {
    database = createDatabase(temporaryPath);
    const insertStatements = prepareInsertStatements(database);
    database.exec("BEGIN IMMEDIATE");
    const validation = await visitValidatedGtrCandidates({
      onCandidate(candidate, enrichment) {
        insertTestingRecord(insertStatements, publicTestingRecord(candidate, enrichment));
      },
    });
    if (validation.issueCount !== 0) {
      throw new Error(`GTR testing search requires zero staging issues; received ${validation.issueCount}.`);
    }
    if (
      !validation.enrichment
      || validation.enrichment.issueCount !== 0
      || validation.enrichment.recordCount < validation.candidateCount
    ) {
      throw new Error("GTR testing search requires the validated condition/gene enrichment snapshot.");
    }

    const metadata = {
      schemaVersion: GTR_TESTING_SEARCH_SCHEMA_VERSION,
      indexVersion: GTR_TESTING_SEARCH_INDEX_VERSION,
      status: "validated-staged-testing",
      sourceId: validation.sourceId,
      sourceSnapshotSha256: validation.snapshotSha256,
      sourceAdapterVersion: validation.adapterVersion,
      sourceRetrievedAt: validation.retrievedAt,
      sourceUpdatedAt: validation.sourceUpdatedAt,
      candidateCount: validation.candidateCount,
      reviewRequiredCandidateCount: validation.reviewRequiredCandidateCount,
      issueCount: validation.issueCount,
      enrichmentSourceId: validation.enrichment.sourceId,
      enrichmentSnapshotSha256: validation.enrichment.snapshotSha256,
      enrichmentRecordCount: validation.enrichment.recordCount,
      enrichmentIssueCount: validation.enrichment.issueCount,
      attribution: sourcePolicy.requiredAttribution,
      attributionUrl: sourcePolicy.requiredAttributionUrl,
      disclaimer: sourcePolicy.disclaimer,
    };
    const insertMetadata = database.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(metadata)) {
      insertMetadata.run(key, typeof value === "string" ? value : json(value));
    }
    database.exec("COMMIT");
    committed = true;
    database.exec("VACUUM");
    database.close();
    database = null;

    const databaseSha256 = await sha256File(temporaryPath);
    const databasePath = `${directory}/gtr-testing-search-${databaseSha256}.sqlite`;
    await moveContentAddressed(temporaryPath, databasePath, databaseSha256);
    const databaseStats = await stat(databasePath);
    const compressedPath = `${databasePath}.gz`;
    temporaryCompressedPath = `${directory}/.${randomUUID()}.sqlite.gz`;
    await pipeline(
      createReadStream(databasePath),
      createGzip({ level: 9 }),
      createWriteStream(temporaryCompressedPath, { flags: "wx" }),
    );
    const compressedSha256 = await sha256File(temporaryCompressedPath);
    await moveContentAddressed(temporaryCompressedPath, compressedPath, compressedSha256);
    const compressedStats = await stat(compressedPath);
    const manifest = {
      ...metadata,
      databaseSha256,
      databaseBytes: databaseStats.size,
      databasePath: relative(PROJECT_ROOT, databasePath).replaceAll("\\", "/"),
      compressedSha256,
      compressedBytes: compressedStats.size,
      compressedPath: relative(PROJECT_ROOT, compressedPath).replaceAll("\\", "/"),
    };
    const manifestPath = `${directory}/latest.json`;
    await writeJsonAtomic(manifestPath, manifest);
    return { databasePath, compressedPath, manifestPath, manifest };
  } catch (error) {
    if (database) {
      if (!committed) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // The original validation or write error remains the useful failure.
        }
      }
      database.close();
    }
    await rm(temporaryPath, { force: true });
    if (temporaryCompressedPath) await rm(temporaryCompressedPath, { force: true });
    throw error;
  }
}
