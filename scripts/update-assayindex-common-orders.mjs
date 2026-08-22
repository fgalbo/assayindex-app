#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCommonLabOrderTerminologyIndex,
  parseCommonMnemonicSupplement,
  parseNlmClinicalTablesResponse,
  parseUniversalLabOrdersCsv,
} from "./assayindex/common-lab-orders.mjs";

const SOURCE_DATA_URL = "https://lhncbc.nlm.nih.gov/assets/files/LOINCUniversalLabOrdersValueSet.csv";
const SEARCH_API_URL = "https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const BATCH_SIZE = 50;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(scriptDirectory, "..");
const OUTPUT_PATH = resolve(
  PROJECT_ROOT,
  "features/assayindex/data/terminology/common-lab-orders.generated.json",
);
const MNEMONIC_SUPPLEMENT_PATH = resolve(
  PROJECT_ROOT,
  "features/assayindex/data/terminology/common-mnemonic-supplement.source.json",
);

function usage() {
  return [
    "Usage: node scripts/update-assayindex-common-orders.mjs --allow-network [--write]",
    "",
    "Downloads the official NLM Common Lab Orders value set, enriches its LOINC codes through",
    "the public NLM Clinical Tables API, excludes externally copyrighted terms, validates a",
    "minimum 90% retention ratio, adds a 100%-validated AssayIndex mnemonic supplement, and",
    "writes the versioned public terminology snapshot only",
    "when --write is present.",
  ].join("\n");
}

export function parseArguments(argv) {
  const options = { allowNetwork: false, write: false, help: false };
  for (const argument of argv) {
    if (argument === "--allow-network") options.allowNetwork = true;
    else if (argument === "--write") options.write = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.allowNetwork) {
    throw new Error("Network acquisition is disabled. Re-run with the explicit --allow-network gate.");
  }
  return options;
}

function contentTypeAllowed(response, expectedContentTypes) {
  const actual = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return Boolean(actual && expectedContentTypes.includes(actual));
}

export async function readBoundedUtf8Response(response, maximumBytes) {
  if (!response.body) throw new Error("Source response did not include a body.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body.cancel();
    throw new Error("Source response exceeded the declared byte limit.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > maximumBytes) {
      await reader.cancel();
      throw new Error("Source response exceeded the byte limit.");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  if (body.includes("\u0000")) throw new Error("Source response contained a NUL character.");
  return body;
}

async function fetchWithRetry(url, { accept, expectedContentTypes, maximumBytes }) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": "AssayIndex-terminology-acquisition/1.0 (+https://filippogalbo.com/assayindex)",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (RETRYABLE_STATUS.has(response.status) && attempt < 2) {
        await response.body?.cancel();
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1_000, 5_000)
          : 250 * 2 ** attempt;
        await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.origin}.`);
      if (!contentTypeAllowed(response, expectedContentTypes)) {
        await response.body?.cancel();
        throw new Error(`Unexpected content type from ${url.origin}.`);
      }
      const body = await readBoundedUtf8Response(response, maximumBytes);
      return { body, headers: response.headers };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

function batched(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

export function buildSearchUrl(codes) {
  const url = new URL(SEARCH_API_URL);
  url.searchParams.set("terms", "*");
  url.searchParams.set("count", String(codes.length));
  url.searchParams.set("excludeCopyrighted", "true");
  url.searchParams.set("df", "text,LOINC_NUM");
  url.searchParams.set("ef", "SHORTNAME,CONSUMER_NAME,RELATEDNAMES2,LONG_COMMON_NAME");
  url.searchParams.set(
    "q",
    `LOINC_NUM:(${codes.map((code) => `\"${code}\"`).join(" OR ")})`,
  );
  return url;
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function updateCommonLabOrders({ allowNetwork = false, write = false } = {}) {
  if (!allowNetwork) {
    throw new Error("Network acquisition is disabled. Re-run with the explicit --allow-network gate.");
  }
  const retrievedAt = new Date().toISOString();
  const source = await fetchWithRetry(new URL(SOURCE_DATA_URL), {
    accept: "text/csv",
    expectedContentTypes: ["text/csv"],
    maximumBytes: MAX_SOURCE_BYTES,
  });
  const sourceEntries = parseUniversalLabOrdersCsv(source.body);
  const mnemonicSupplement = parseCommonMnemonicSupplement(
    JSON.parse(await readFile(MNEMONIC_SUPPLEMENT_PATH, "utf8")),
  );
  const supplementalCodes = mnemonicSupplement.concepts.flatMap((concept) => concept.loincCodes);
  const sourceCodeSet = new Set(sourceEntries.map((entry) => entry.loincCode));
  const overlappingCode = supplementalCodes.find((code) => sourceCodeSet.has(code));
  if (overlappingCode) {
    throw new Error(
      `Mnemonic supplement code ${overlappingCode} is now present in the Common Lab Orders source.`,
    );
  }
  const supplementCodeSetSha256 = createHash("sha256")
    .update(`${supplementalCodes.join("\n")}\n`, "utf8")
    .digest("hex");
  const sourceSha256 = createHash("sha256").update(source.body).digest("hex");
  const sourceUpdatedHeader = source.headers.get("last-modified");
  const sourceUpdatedAt = sourceUpdatedHeader
    ? new Date(sourceUpdatedHeader).toISOString()
    : null;
  const enrichedByCode = new Map();
  const enrichmentResponseHash = createHash("sha256");
  const requestedCodes = [...sourceEntries.map((entry) => entry.loincCode), ...supplementalCodes];
  const sourceBatches = batched(requestedCodes, BATCH_SIZE);

  for (const [batchIndex, batch] of sourceBatches.entries()) {
    const response = await fetchWithRetry(buildSearchUrl(batch), {
      accept: "application/json",
      expectedContentTypes: ["application/json"],
      maximumBytes: MAX_API_RESPONSE_BYTES,
    });
    const responseBytes = Buffer.from(response.body, "utf8");
    enrichmentResponseHash.update(`${batchIndex}:${responseBytes.byteLength}:`, "utf8");
    enrichmentResponseHash.update(responseBytes);
    const parsed = parseNlmClinicalTablesResponse(JSON.parse(response.body));
    for (const [code, entry] of parsed) {
      if (!batch.includes(code)) throw new Error(`NLM response included unrequested code ${code}.`);
      if (enrichedByCode.has(code)) throw new Error(`NLM response repeated code ${code}.`);
      enrichedByCode.set(code, entry);
    }
  }

  const index = buildCommonLabOrderTerminologyIndex({
    sourceEntries,
    mnemonicSupplement,
    enrichedByCode,
    sourceSha256,
    supplementCodeSetSha256,
    sourceUpdatedAt,
    retrievedAt,
    enrichmentResponseSha256: enrichmentResponseHash.digest("hex"),
    enrichmentBatchCount: sourceBatches.length,
  });
  if (write) await writeJsonAtomic(OUTPUT_PATH, index);
  return {
    write,
    outputPath: write ? OUTPUT_PATH : null,
    sourceSha256,
    enrichmentResponseSha256: index.source.enrichment.responseSha256,
    enrichmentBatchCount: index.source.enrichment.batchCount,
    loincReleaseVersion: index.source.enrichment.loincReleaseVersion,
    releaseVersionStatus: index.source.enrichment.releaseVersionStatus,
    sourceUpdatedAt,
    sourceEntryCount: index.source.sourceEntryCount,
    commonOrderPublishedEntryCount: index.source.commonOrderPublishedEntryCount,
    supplementalEntryCount: index.source.supplementalEntryCount,
    publishedEntryCount: index.source.publishedEntryCount,
    excludedEntryCount: index.source.excludedEntryCount,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  console.log(JSON.stringify(await updateCommonLabOrders(options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`AssayIndex common-order update failed: ${error.message}`);
    process.exitCode = 1;
  });
}
