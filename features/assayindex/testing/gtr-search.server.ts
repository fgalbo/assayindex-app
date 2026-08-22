import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { get } from "@vercel/blob";

import { isClinicalCodeLikeQuery } from "@/features/assayindex/search/query-shape";
import type {
  GtrTestingSearchRecord,
  GtrTestingSearchResponse,
} from "@/features/assayindex/testing/types";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_QUERY_LENGTH = 120;
const MAX_QUERY_TOKENS = 10;
const MAX_RESULT_LIMIT = 50;
const REMOTE_INDEX_MAX_BYTES = 40 * 1024 * 1024;
const REMOTE_DATABASE_MAX_BYTES = 200 * 1024 * 1024;
const EXPECTED_SOURCE_ID = "nih-gtr-test-version";
const EXPECTED_ENRICHMENT_SOURCE_ID = "nih-gtr-test-condition-gene";
const EXPECTED_PUBLISHER_ID = "nih-gtr";
const EXPECTED_INDEX_VERSION = "1.1.0";

type SearchRow = {
  id: string;
  source_id: string;
  publisher_id: string;
  external_record_id: string;
  provider_id: string;
  test_name: string;
  lab_name: string;
  institution_name: string | null;
  location: string | null;
  order_code: string | null;
  source_test_id: string | null;
  genes_json: string;
  gene_ids_json: string;
  gene_medgen_ids_json: string;
  conditions_json: string;
  condition_ids_json: string;
  methods_json: string;
  review_flags_json: string;
  candidate_state: string;
  source_last_touched_at: string | null;
  official_url: string;
};

type IndexManifest = {
  schemaVersion?: string;
  status?: string;
  databasePath?: string;
  databaseSha256: string;
  compressedSha256?: string;
  compressedBytes?: number;
  databaseBytes?: number;
  blobPath?: string;
};

let productionDatabasePromise: Promise<DatabaseSync> | null = null;
const validatedMetadata = new WeakMap<DatabaseSync, Map<string, string>>();

function assertSha256(value: string | undefined, label: string) {
  if (!value || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function parseStringArray(value: string, label: string) {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} is not a string array.`);
  }
  return parsed;
}

function metadataMap(database: DatabaseSync) {
  const rows = database.prepare("SELECT key, value FROM metadata ORDER BY key").all() as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map((row) => [row.key, row.value]));
}

function requiredMetadata(metadata: Map<string, string>, key: string) {
  const value = metadata.get(key);
  if (!value) throw new Error(`GTR testing index metadata is missing ${key}.`);
  return value;
}

function integerMetadata(metadata: Map<string, string>, key: string) {
  const value = Number(requiredMetadata(metadata, key));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GTR testing index metadata ${key} is invalid.`);
  }
  return value;
}

function validateDatabase(database: DatabaseSync, expectedSha256?: string) {
  const metadata = metadataMap(database);
  if (requiredMetadata(metadata, "schemaVersion") !== "1") {
    throw new Error("GTR testing index schemaVersion is unsupported.");
  }
  if (requiredMetadata(metadata, "status") !== "validated-staged-testing") {
    throw new Error("GTR testing index is not a validated staged testing artifact.");
  }
  if (requiredMetadata(metadata, "indexVersion") !== EXPECTED_INDEX_VERSION) {
    throw new Error("GTR testing index version is unsupported.");
  }
  if (requiredMetadata(metadata, "sourceId") !== EXPECTED_SOURCE_ID) {
    throw new Error("GTR testing index source identity is invalid.");
  }
  if (requiredMetadata(metadata, "enrichmentSourceId") !== EXPECTED_ENRICHMENT_SOURCE_ID) {
    throw new Error("GTR testing index enrichment identity is invalid.");
  }
  if (integerMetadata(metadata, "issueCount") !== 0 || integerMetadata(metadata, "enrichmentIssueCount") !== 0) {
    throw new Error("GTR testing index contains staging issues.");
  }
  const quickCheck = database.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
  if (!quickCheck || Object.values(quickCheck)[0] !== "ok") {
    throw new Error("GTR testing index failed SQLite integrity validation.");
  }
  const recordCount = Number((database.prepare("SELECT COUNT(*) AS count FROM records").get() as { count: number | bigint }).count);
  const searchCount = Number((database.prepare("SELECT COUNT(*) AS count FROM records_fts").get() as { count: number | bigint }).count);
  const reviewCount = Number((database.prepare("SELECT COUNT(*) AS count FROM records WHERE review_flags_json <> '[]'").get() as { count: number | bigint }).count);
  const identities = database.prepare("SELECT DISTINCT source_id, publisher_id FROM records").all() as Array<{
    source_id: string;
    publisher_id: string;
  }>;
  if (
    recordCount !== integerMetadata(metadata, "candidateCount")
    || searchCount !== recordCount
    || reviewCount !== integerMetadata(metadata, "reviewRequiredCandidateCount")
    || identities.length !== 1
    || identities[0]?.source_id !== EXPECTED_SOURCE_ID
    || identities[0]?.publisher_id !== EXPECTED_PUBLISHER_ID
  ) {
    throw new Error("GTR testing index record counts or source identities are invalid.");
  }
  if (expectedSha256) assertSha256(expectedSha256, "Expected database SHA-256");
  validatedMetadata.set(database, metadata);
  return metadata;
}

function getValidatedMetadata(database: DatabaseSync) {
  return validatedMetadata.get(database) ?? validateDatabase(database);
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function openVerifiedDatabase(databasePath: string, expectedSha256: string, alreadyVerified = false) {
  if (!alreadyVerified && await sha256File(databasePath) !== assertSha256(expectedSha256, "Database SHA-256")) {
    throw new Error("GTR testing index database hash mismatch.");
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    validateDatabase(database, expectedSha256);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

async function loadLocalDatabase() {
  const explicitPath = process.env.ASSAYINDEX_GTR_TESTING_INDEX_PATH?.trim();
  if (explicitPath) {
    const expectedSha256 = assertSha256(
      process.env.ASSAYINDEX_GTR_TESTING_INDEX_SHA256?.trim(),
      "ASSAYINDEX_GTR_TESTING_INDEX_SHA256",
    );
    return openVerifiedDatabase(path.resolve(/* turbopackIgnore: true */ explicitPath), expectedSha256);
  }

  const manifestPath = path.resolve(
    process.cwd(),
    ".assayindex",
    "runtime",
    "generated-testing-search",
    "latest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as IndexManifest;
  if (!manifest.databasePath) throw new Error("Local GTR testing index manifest has no databasePath.");
  return openVerifiedDatabase(
    path.resolve(/* turbopackIgnore: true */ process.cwd(), manifest.databasePath),
    assertSha256(manifest.databaseSha256, "Local database SHA-256"),
  );
}

function countingHashTransform(hash: ReturnType<typeof createHash>, maximumBytes: number, label: string) {
  let byteCount = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteCount += chunk.byteLength;
      if (byteCount > maximumBytes) {
        callback(new Error(`GTR testing index exceeds the configured ${label}-size limit.`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { stream, bytes: () => byteCount };
}

async function loadRemoteDatabase() {
  const manifestBlobPath = process.env.ASSAYINDEX_GTR_TESTING_MANIFEST_BLOB_PATH?.trim();
  const blobToken = process.env.ASSAYINDEX_GTR_READ_WRITE_TOKEN?.trim();
  if (!manifestBlobPath || manifestBlobPath.startsWith("/") || manifestBlobPath.includes("..")) {
    throw new Error("ASSAYINDEX_GTR_TESTING_MANIFEST_BLOB_PATH is not configured safely.");
  }
  if (!blobToken) throw new Error("ASSAYINDEX_GTR_READ_WRITE_TOKEN is required for the private testing index.");

  const manifestResult = await get(manifestBlobPath, {
    access: "private",
    token: blobToken,
    useCache: false,
    abortSignal: AbortSignal.timeout(15_000),
  });
  if (!manifestResult || !manifestResult.stream) {
    throw new Error("The private GTR testing index manifest was not found.");
  }
  if (manifestResult.blob.size !== null && manifestResult.blob.size > 64 * 1024) {
    throw new Error("The private GTR testing index manifest is too large.");
  }
  const manifestChunks = [];
  let manifestBytes = 0;
  for await (const chunk of manifestResult.stream as unknown as AsyncIterable<Uint8Array>) {
    manifestBytes += chunk.byteLength;
    if (manifestBytes > 64 * 1024) throw new Error("The private GTR testing index manifest is too large.");
    manifestChunks.push(Buffer.from(chunk));
  }
  const manifest = JSON.parse(Buffer.concat(manifestChunks).toString("utf8")) as IndexManifest;
  if (manifest.schemaVersion !== "1" || manifest.status !== "validated-staged-testing") {
    throw new Error("The private GTR testing index manifest is invalid.");
  }
  const databaseSha256 = assertSha256(manifest.databaseSha256, "Manifest database SHA-256");
  const compressedSha256 = assertSha256(manifest.compressedSha256, "Manifest compressed SHA-256");
  const blobPath = manifest.blobPath;
  if (
    !blobPath
    || blobPath !== `assayindex/testing/gtr/${compressedSha256}.sqlite.gz`
    || blobPath.startsWith("/")
    || blobPath.includes("..")
  ) {
    throw new Error("The private GTR testing index manifest has an invalid Blob pathname.");
  }
  if (
    !Number.isSafeInteger(manifest.compressedBytes)
    || manifest.compressedBytes! < 1
    || manifest.compressedBytes! > REMOTE_INDEX_MAX_BYTES
    || !Number.isSafeInteger(manifest.databaseBytes)
    || manifest.databaseBytes! < 1
    || manifest.databaseBytes! > REMOTE_DATABASE_MAX_BYTES
  ) {
    throw new Error("The private GTR testing index manifest has invalid byte counts.");
  }

  const localDirectory = path.join(tmpdir(), "assayindex-gtr-testing-search");
  const localPath = path.join(localDirectory, `${databaseSha256}.sqlite`);
  await mkdir(localDirectory, { recursive: true });
  try {
    await access(localPath);
    return openVerifiedDatabase(localPath, databaseSha256);
  } catch {
    await rm(localPath, { force: true });
  }

  const result = await get(blobPath, {
    access: "private",
    token: blobToken,
    abortSignal: AbortSignal.timeout(30_000),
  });
  if (!result || !result.stream) throw new Error("The private GTR testing index was not found.");
  if (result.blob.size !== null && result.blob.size !== manifest.compressedBytes) {
    throw new Error("GTR testing index compressed byte count does not match its manifest.");
  }
  if (result.blob.size !== null && result.blob.size > REMOTE_INDEX_MAX_BYTES) {
    throw new Error("GTR testing index exceeds the configured compressed-size limit.");
  }
  const temporaryPath = path.join(localDirectory, `.${randomUUID()}.sqlite`);
  const compressedHash = createHash("sha256");
  const databaseHash = createHash("sha256");
  const compressedCounter = countingHashTransform(compressedHash, REMOTE_INDEX_MAX_BYTES, "compressed");
  const databaseCounter = countingHashTransform(databaseHash, REMOTE_DATABASE_MAX_BYTES, "expanded");
  try {
    await pipeline(
      Readable.from(result.stream as unknown as AsyncIterable<Uint8Array>),
      compressedCounter.stream,
      createGunzip(),
      databaseCounter.stream,
      createWriteStream(temporaryPath, { flags: "wx" }),
    );
    if (compressedHash.digest("hex") !== compressedSha256) {
      throw new Error("GTR testing index compressed hash mismatch.");
    }
    if (databaseHash.digest("hex") !== databaseSha256) {
      throw new Error("GTR testing index database hash mismatch after decompression.");
    }
    if (compressedCounter.bytes() !== manifest.compressedBytes || databaseCounter.bytes() !== manifest.databaseBytes) {
      throw new Error("GTR testing index byte counts do not match its manifest.");
    }
    try {
      await rename(temporaryPath, localPath);
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== "EEXIST" && fileError.code !== "EPERM") throw error;
      await rm(temporaryPath, { force: true });
    }
    return openVerifiedDatabase(localPath, databaseSha256, true);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function normalizeGtrTestingQuery(query: unknown) {
  if (typeof query !== "string") throw new Error("Search query must be a string.");
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_QUERY_LENGTH) {
    throw new Error(`Search query must contain 2-${MAX_QUERY_LENGTH} characters.`);
  }
  const tokens = trimmed.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0 || tokens.length > MAX_QUERY_TOKENS) {
    throw new Error(`Search query must contain 1-${MAX_QUERY_TOKENS} searchable terms.`);
  }
  const uniqueTokens = new Map<string, boolean>();
  for (const token of tokens) {
    const normalizedToken = token.toLocaleLowerCase("en-US");
    uniqueTokens.set(
      normalizedToken,
      (uniqueTokens.get(normalizedToken) ?? false) || isClinicalCodeLikeQuery(token),
    );
  }
  return {
    query: trimmed,
    match: [...uniqueTokens]
      .map(([token, exact]) => {
        return `"${token.replaceAll('"', '""')}"${exact ? "" : "*"}`;
      })
      .join(" AND "),
  };
}

export function normalizeGtrTestingLimit(limit: unknown) {
  const parsed = limit === undefined ? 25 : Number(limit);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_RESULT_LIMIT) {
    throw new Error(`Search limit must be an integer from 1 through ${MAX_RESULT_LIMIT}.`);
  }
  return parsed;
}

export async function getGtrTestingSearchDatabase() {
  productionDatabasePromise ??= (process.env.VERCEL
    ? loadRemoteDatabase()
    : loadLocalDatabase()).catch((error) => {
      productionDatabasePromise = null;
      throw error;
    });
  return productionDatabasePromise;
}

export async function searchGtrTestingIndex({
  query,
  limit,
  database,
}: {
  query: unknown;
  limit?: unknown;
  database?: DatabaseSync;
}): Promise<GtrTestingSearchResponse> {
  const normalized = normalizeGtrTestingQuery(query);
  const normalizedLimit = normalizeGtrTestingLimit(limit);
  const activeDatabase = database ?? await getGtrTestingSearchDatabase();
  const metadata = getValidatedMetadata(activeDatabase);
  const matchedCount = Number(
    (activeDatabase.prepare(
      "SELECT COUNT(*) AS count FROM records_fts WHERE records_fts MATCH ?",
    ).get(normalized.match) as { count: number | bigint }).count,
  );
  const rows = activeDatabase.prepare(`
    SELECT records.*
    FROM records_fts
    JOIN records ON records.row_number = records_fts.rowid
    WHERE records_fts MATCH ?
    ORDER BY bm25(records_fts), records.id
    LIMIT ?
  `).all(normalized.match, normalizedLimit) as SearchRow[];
  const results = rows.map<GtrTestingSearchRecord>((row) => ({
    id: row.id,
    kind: "validated-staged-gtr",
    sourceId: row.source_id,
    publisherId: row.publisher_id,
    externalRecordId: row.external_record_id,
    providerId: row.provider_id,
    testName: row.test_name,
    labName: row.lab_name,
    institutionName: row.institution_name,
    location: row.location,
    orderCode: row.order_code,
    sourceTestId: row.source_test_id,
    genes: parseStringArray(row.genes_json, `${row.id} genes`),
    geneIds: parseStringArray(row.gene_ids_json, `${row.id} geneIds`),
    geneMedgenIds: parseStringArray(row.gene_medgen_ids_json, `${row.id} geneMedgenIds`),
    conditions: parseStringArray(row.conditions_json, `${row.id} conditions`),
    conditionIds: parseStringArray(row.condition_ids_json, `${row.id} conditionIds`),
    methods: parseStringArray(row.methods_json, `${row.id} methods`),
    reviewFlags: parseStringArray(row.review_flags_json, `${row.id} reviewFlags`),
    candidateState: row.candidate_state,
    sourceLastTouchedAt: row.source_last_touched_at,
    officialUrl: row.official_url,
  }));

  return {
    schemaVersion: "1",
    status: "validated-staged-testing",
    query: normalized.query,
    matchedCount,
    resultCount: results.length,
    truncated: matchedCount > results.length,
    source: {
      sourceId: requiredMetadata(metadata, "sourceId"),
      snapshotSha256: requiredMetadata(metadata, "sourceSnapshotSha256"),
      enrichmentSourceId: requiredMetadata(metadata, "enrichmentSourceId"),
      enrichmentSnapshotSha256: requiredMetadata(metadata, "enrichmentSnapshotSha256"),
      retrievedAt: requiredMetadata(metadata, "sourceRetrievedAt"),
      updatedAt: metadata.get("sourceUpdatedAt") || null,
      candidateCount: integerMetadata(metadata, "candidateCount"),
      reviewRequiredCandidateCount: integerMetadata(metadata, "reviewRequiredCandidateCount"),
      attribution: requiredMetadata(metadata, "attribution"),
      attributionUrl: requiredMetadata(metadata, "attributionUrl"),
      disclaimer: requiredMetadata(metadata, "disclaimer"),
    },
    results,
  };
}

export function resetGtrTestingSearchDatabaseForTests() {
  productionDatabasePromise = null;
}
