import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import {
  readJsonIfPresent,
  resolveWithinRuntime,
} from "./runtime.mjs";
import { classifySourceStatus } from "./gtr-test-version.mjs";

export const GTR_TEST_VERSION_SOURCE_ID = "nih-gtr-test-version";
export const GTR_CONDITION_GENE_SOURCE_ID = "nih-gtr-test-condition-gene";
export const DEFAULT_REVIEW_LIMIT = 25;
export const MAX_REVIEW_LIMIT = 100;
export const MINIMUM_TEST_VERSION_ADAPTER = "1.2.0";
export const MINIMUM_CONDITION_GENE_ADAPTER = "1.0.0";

const GTR_PUBLISHER_ID = "nih-gtr";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const CANDIDATE_STAGED_PATH_PATTERN = /^staged\/([a-f0-9]{64})\.candidates\.json$/;
const ENRICHMENT_STAGED_PATH_PATTERN = /^staged\/([a-f0-9]{64})\.(?:records|condition-gene)\.json$/;
const GTR_SOURCE_STATUS_FIELDS = [
  "nowCurrent",
  "testCurrentStatus",
  "testPublicationStatus",
  "labCurrentStatus",
  "labPublicationStatus",
  "lastTouchedAt",
  "createdAt",
  "deletedAt",
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function assertNullableString(value, label) {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }
  return value;
}

function assertNonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function assertStringArray(value, label, { optional = false } = {}) {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function assertNonemptyStringArray(value, label) {
  assertStringArray(value, label);
  value.forEach((item, index) => assertNonemptyString(item, `${label}[${index}]`));
  return value;
}

function assertIsoDateString(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  assertNonemptyString(value, label);
  if (!ISO_DATE_TIME_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid ISO date-time string.`);
  }
  return value;
}

function assertEqualStringArrays(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} does not match its structured references.`);
  }
}

function parseSemver(value, label) {
  const match = typeof value === "string" ? value.match(SEMVER_PATTERN) : null;
  if (!match) throw new Error(`${label} must be a three-part semantic version.`);
  return match.slice(1).map(Number);
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function assertMinimumAdapterVersion(actual, minimum) {
  if (compareSemver(parseSemver(actual, "Staged adapterVersion"), parseSemver(minimum, "Minimum adapter version")) < 0) {
    throw new Error(`Staged adapter ${actual} is older than the required ${minimum}; restage the immutable raw snapshot before review.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedCandidateHash(candidate) {
  const withoutDigest = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => key !== "normalizedSha256"),
  );
  return sha256(JSON.stringify(withoutDigest));
}

function parseEnvelopePrefix(line, arrayName, label) {
  const marker = `,"${arrayName}":[`;
  const markerIndex = line.lastIndexOf(marker);
  if (markerIndex <= 0 || line.slice(markerIndex) !== marker) {
    throw new Error(`${label} must use the streamed ${arrayName} envelope format.`);
  }
  try {
    return assertObject(JSON.parse(`${line.slice(0, markerIndex)}}`), `${label} metadata`);
  } catch (error) {
    throw new Error(`${label} metadata is invalid JSON: ${error.message}`);
  }
}

function parseEnvelopeFooter(line, label) {
  if (!/^\]\s*,/.test(line)) {
    throw new Error(`${label} is missing its streamed envelope footer.`);
  }
  try {
    return assertObject(JSON.parse(`{${line.replace(/^\]\s*,/, "")}`), `${label} footer`);
  } catch (error) {
    throw new Error(`${label} footer is invalid JSON: ${error.message}`);
  }
}

async function streamEnvelope(path, { arrayName, label, onMetadata, onEntry }) {
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let metadata = null;
  let footer = null;
  let entryCount = 0;

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!metadata) {
      metadata = parseEnvelopePrefix(line, arrayName, label);
      await onMetadata?.(metadata);
      continue;
    }
    if (footer) throw new Error(`${label} contains data after its envelope footer.`);
    if (line.startsWith("]")) {
      footer = parseEnvelopeFooter(line, label);
      continue;
    }

    const hasLeadingComma = line.startsWith(",");
    const hasTrailingComma = line.endsWith(",");
    if (hasLeadingComma && hasTrailingComma) {
      throw new Error(`${label} entry ${entryCount + 1} has ambiguous JSON delimiters.`);
    }
    const entryText = hasLeadingComma
      ? line.slice(1)
      : hasTrailingComma
        ? line.slice(0, -1)
        : line;
    if (!entryText || entryText.startsWith(",") || entryText.endsWith(",")) {
      throw new Error(`${label} entry ${entryCount + 1} has an invalid JSON delimiter.`);
    }
    let entry;
    try {
      entry = JSON.parse(entryText);
    } catch (error) {
      throw new Error(`${label} entry ${entryCount + 1} is invalid JSON: ${error.message}`);
    }
    entryCount += 1;
    await onEntry(entry, entryCount);
  }

  if (!metadata) throw new Error(`${label} is empty.`);
  if (!footer) throw new Error(`${label} is missing its envelope footer.`);
  return { metadata, footer, entryCount };
}

function validateCandidateMarker(marker, sourceId) {
  assertObject(marker, "Candidate latest-validated marker");
  if (marker.schemaVersion !== "1") throw new Error("Candidate latest-validated marker has an unsupported schemaVersion.");
  if (marker.sourceId !== sourceId) throw new Error("Candidate latest-validated marker sourceId does not match the requested source.");
  if (marker.adapterId !== GTR_TEST_VERSION_SOURCE_ID) {
    throw new Error(`Candidate latest-validated marker adapterId must be ${GTR_TEST_VERSION_SOURCE_ID}.`);
  }
  if (!SHA256_PATTERN.test(marker.snapshotSha256 ?? "")) throw new Error("Candidate latest-validated marker has an invalid snapshotSha256.");
  const stagedMatch = typeof marker.stagedPath === "string" ? marker.stagedPath.match(CANDIDATE_STAGED_PATH_PATTERN) : null;
  if (!stagedMatch || stagedMatch[1] !== marker.snapshotSha256) {
    throw new Error("Candidate latest-validated marker stagedPath does not match its snapshot SHA-256.");
  }
  assertPositiveInteger(marker.candidateCount, "Candidate marker candidateCount");
  assertNonnegativeInteger(marker.historicalRowCount, "Candidate marker historicalRowCount");
  assertNonnegativeInteger(marker.reviewRequiredCandidateCount, "Candidate marker reviewRequiredCandidateCount");
  assertNonnegativeInteger(marker.issueCount, "Candidate marker issueCount");
  if (marker.reviewRequiredCandidateCount > marker.candidateCount) {
    throw new Error("Candidate marker reviewRequiredCandidateCount exceeds candidateCount.");
  }
  if (marker.publicationStatus !== "staged-only") {
    throw new Error("Candidate latest-validated marker is not staged-only.");
  }
  assertIsoDateString(marker.validatedAt, "Candidate marker validatedAt");
  return marker;
}

function validateCandidateMetadata(metadata, marker, sourceId, minimumAdapterVersion) {
  if (metadata.schemaVersion !== "1") throw new Error("Staged candidate envelope has an unsupported schemaVersion.");
  if (metadata.sourceId !== sourceId) throw new Error("Staged candidate sourceId does not match its validated marker.");
  if (metadata.publisherId !== GTR_PUBLISHER_ID) {
    throw new Error(`Staged candidate publisherId must be ${GTR_PUBLISHER_ID}.`);
  }
  if (metadata.snapshotSha256 !== marker.snapshotSha256) {
    throw new Error("Staged candidate snapshotSha256 does not match its validated marker.");
  }
  assertMinimumAdapterVersion(metadata.adapterVersion, minimumAdapterVersion);
  if (metadata.publicationStatus !== "staged-only") throw new Error("Staged candidate envelope is not staged-only.");
  assertIsoDateString(metadata.sourceUpdatedAt, "Staged candidate sourceUpdatedAt", { nullable: true });
  assertIsoDateString(metadata.retrievedAt, "Staged candidate retrievedAt");
  return metadata.publisherId;
}

function validateCandidate(candidate, sourceId, publisherId, entryNumber) {
  assertObject(candidate, `Candidate ${entryNumber}`);
  if (candidate.sourceId !== sourceId) throw new Error(`Candidate ${entryNumber} sourceId does not match its envelope.`);
  if (candidate.publisherId !== publisherId) {
    throw new Error(`Candidate ${entryNumber} publisherId does not match its envelope.`);
  }
  assertNonemptyString(candidate.externalRecordId, `Candidate ${entryNumber} externalRecordId`);
  assertNonemptyString(candidate.publisherProviderId, `Candidate ${entryNumber} publisherProviderId`);
  assertPositiveInteger(candidate.sourceRowNumber, `Candidate ${entryNumber} sourceRowNumber`);
  const provider = assertObject(candidate.provider, `Candidate ${entryNumber} provider`);
  for (const field of ["laboratoryName", "institutionName", "country", "state", "postcode"]) {
    assertNullableString(provider[field], `Candidate ${entryNumber} provider.${field}`);
  }
  const offering = assertObject(candidate.offering, `Candidate ${entryNumber} offering`);
  for (const field of ["labTestName", "manufacturerTestName", "labTestId", "orderCode", "testDevelopment"]) {
    assertNullableString(offering[field], `Candidate ${entryNumber} offering.${field}`);
  }
  for (const field of ["methodCategories", "methods", "platforms", "genes", "conditions"]) {
    assertStringArray(offering[field], `Candidate ${entryNumber} offering.${field}`);
  }
  const sourceStatus = assertObject(candidate.sourceStatus, `Candidate ${entryNumber} sourceStatus`);
  for (const field of GTR_SOURCE_STATUS_FIELDS) {
    assertNullableString(sourceStatus[field], `Candidate ${entryNumber} sourceStatus.${field}`);
  }
  const reviewFlags = assertNonemptyStringArray(candidate.reviewFlags, `Candidate ${entryNumber} reviewFlags`);
  if (new Set(reviewFlags).size !== reviewFlags.length) {
    throw new Error(`Candidate ${entryNumber} reviewFlags contain duplicate values.`);
  }
  const expectedReviewFlags = classifySourceStatus(sourceStatus);
  if (
    reviewFlags.length !== expectedReviewFlags.length ||
    reviewFlags.some((flag, index) => flag !== expectedReviewFlags[index])
  ) {
    throw new Error(
      `Candidate ${entryNumber} reviewFlags contain unknown, out-of-order, or status-inconsistent values.`,
    );
  }
  const expectedCandidateState = expectedReviewFlags.length > 0
    ? "discovered-review-required"
    : "discovered";
  if (candidate.candidateState !== expectedCandidateState) {
    throw new Error(`Candidate ${entryNumber} candidateState does not match its reviewFlags.`);
  }
  if (candidate.publicationStatus !== "staged-only") {
    throw new Error(`Candidate ${entryNumber} is not staged-only.`);
  }
  if (!SHA256_PATTERN.test(candidate.normalizedSha256 ?? "")) {
    throw new Error(`Candidate ${entryNumber} has an invalid normalizedSha256.`);
  }
  if (normalizedCandidateHash(candidate) !== candidate.normalizedSha256) {
    throw new Error(`Candidate ${entryNumber} normalizedSha256 does not match its content.`);
  }
  return candidate;
}

function validateCandidateFooter(footer, marker, actualCount) {
  assertNonnegativeInteger(footer.candidateCount, "Staged footer candidateCount");
  assertNonnegativeInteger(footer.historicalRowCount, "Staged footer historicalRowCount");
  assertNonnegativeInteger(footer.reviewRequiredCandidateCount, "Staged footer reviewRequiredCandidateCount");
  assertNonnegativeInteger(footer.issueCount, "Staged footer issueCount");
  if (!Array.isArray(footer.issues)) throw new Error("Staged footer issues must be an array.");
  for (const field of ["candidateCount", "historicalRowCount", "reviewRequiredCandidateCount", "issueCount"]) {
    if (footer[field] !== marker[field]) throw new Error(`Staged footer ${field} does not match its validated marker.`);
  }
  if (footer.candidateCount !== actualCount) {
    throw new Error(`Staged footer candidateCount ${footer.candidateCount} does not match the ${actualCount} streamed candidates.`);
  }
  if (footer.issues.length !== footer.issueCount) throw new Error("Staged footer issueCount does not match its issues array.");
}

export async function readValidatedCandidateContext({
  sourceId = GTR_TEST_VERSION_SOURCE_ID,
  minimumAdapterVersion = MINIMUM_TEST_VERSION_ADAPTER,
} = {}) {
  assertNonemptyString(sourceId, "Candidate sourceId");
  const markerPath = resolveWithinRuntime("sources", sourceId, "latest-validated.json");
  const markerValue = await readJsonIfPresent(markerPath);
  if (markerValue === null) {
    throw new Error(
      `No validated snapshot exists for ${sourceId}. Run AssayIndex acquisition or restage its immutable raw snapshot first.`,
    );
  }
  const marker = validateCandidateMarker(markerValue, sourceId);
  const stagedPath = resolveWithinRuntime("sources", sourceId, ...marker.stagedPath.split("/"));
  return { marker, stagedPath, sourceId, minimumAdapterVersion };
}

function normalizeEnrichmentRecord(record, entryNumber, { sourceId, snapshotSha256, publisherId }) {
  assertObject(record, `Condition/gene record ${entryNumber}`);
  if (record.sourceId !== sourceId) {
    throw new Error(`Condition/gene record ${entryNumber} sourceId does not match its validated source.`);
  }
  if (record.snapshotSha256 !== snapshotSha256) {
    throw new Error(`Condition/gene record ${entryNumber} snapshotSha256 does not match its validated marker.`);
  }
  if (record.publisherId !== publisherId) {
    throw new Error(`Condition/gene record ${entryNumber} publisherId does not match its envelope.`);
  }
  if (record.publicationStatus !== "staged-only") {
    throw new Error(`Condition/gene record ${entryNumber} is not staged-only.`);
  }
  if (!SHA256_PATTERN.test(record.normalizedSha256 ?? "")) {
    throw new Error(`Condition/gene record ${entryNumber} has an invalid normalizedSha256.`);
  }
  if (record.normalizedSha256 !== normalizedCandidateHash(record)) {
    throw new Error(`Condition/gene record ${entryNumber} normalizedSha256 does not match its normalized content.`);
  }
  assertNonemptyString(record.gtrAccession, `Condition/gene record ${entryNumber} gtrAccession`);
  assertNonemptyString(record.accessionVersion, `Condition/gene record ${entryNumber} accessionVersion`);
  if (record.accessionVersion.replace(/\.\d+$/, "") !== record.gtrAccession) {
    throw new Error(`Condition/gene record ${entryNumber} gtrAccession does not match accessionVersion.`);
  }
  if (typeof record.testType !== "string") {
    throw new Error(`Condition/gene record ${entryNumber} testType must be a string.`);
  }
  if (record.candidateState !== "discovered") {
    throw new Error(`Condition/gene record ${entryNumber} has an invalid candidateState.`);
  }
  for (const field of ["referenceLaboratory", "specimenType", "testName", "turnaroundTime"]) {
    if (record[field] !== null) {
      throw new Error(`Condition/gene record ${entryNumber} ${field} must remain null when not supplied by GTR.`);
    }
  }

  const conditionIds = assertNonemptyStringArray(
    record.conditionIds,
    `Condition/gene record ${entryNumber} conditionIds`,
  );
  const conditionNames = assertNonemptyStringArray(
    record.conditionNames,
    `Condition/gene record ${entryNumber} conditionNames`,
  );
  const geneIds = assertNonemptyStringArray(record.geneIds, `Condition/gene record ${entryNumber} geneIds`);
  const geneSymbols = assertNonemptyStringArray(
    record.geneSymbols,
    `Condition/gene record ${entryNumber} geneSymbols`,
  );
  const geneMedgenIds = assertNonemptyStringArray(
    record.geneMedgenIds,
    `Condition/gene record ${entryNumber} geneMedgenIds`,
  );
  if (!Array.isArray(record.conditions)) {
    throw new Error(`Condition/gene record ${entryNumber} conditions must be an array.`);
  }
  const conditions = record.conditions.map((value, index) => {
    const condition = assertObject(value, `Condition/gene record ${entryNumber} conditions[${index}]`);
    return {
      medGenId: assertNonemptyString(
        condition.medGenId,
        `Condition/gene record ${entryNumber} conditions[${index}].medGenId`,
      ),
      mimNumber: assertNullableString(
        condition.mimNumber,
        `Condition/gene record ${entryNumber} conditions[${index}].mimNumber`,
      ),
      name: assertNullableString(
        condition.name,
        `Condition/gene record ${entryNumber} conditions[${index}].name`,
      ),
      snomedCtId: assertNullableString(
        condition.snomedCtId,
        `Condition/gene record ${entryNumber} conditions[${index}].snomedCtId`,
      ),
    };
  });
  if (!Array.isArray(record.genes)) {
    throw new Error(`Condition/gene record ${entryNumber} genes must be an array.`);
  }
  const genes = record.genes.map((value, index) => {
    const gene = assertObject(value, `Condition/gene record ${entryNumber} genes[${index}]`);
    return {
      medGenId: assertNonemptyString(
        gene.medGenId,
        `Condition/gene record ${entryNumber} genes[${index}].medGenId`,
      ),
      mimNumber: assertNullableString(
        gene.mimNumber,
        `Condition/gene record ${entryNumber} genes[${index}].mimNumber`,
      ),
      name: assertNullableString(gene.name, `Condition/gene record ${entryNumber} genes[${index}].name`),
      ncbiGeneId: assertNullableString(
        gene.ncbiGeneId,
        `Condition/gene record ${entryNumber} genes[${index}].ncbiGeneId`,
      ),
      symbol: assertNullableString(
        gene.symbol,
        `Condition/gene record ${entryNumber} genes[${index}].symbol`,
      ),
    };
  });
  const uniqueSorted = (values) => [...new Set(values.filter((value) => value !== null))].toSorted();
  assertEqualStringArrays(conditionIds, uniqueSorted(conditions.map((item) => item.medGenId)), "conditionIds");
  assertEqualStringArrays(conditionNames, uniqueSorted(conditions.map((item) => item.name)), "conditionNames");
  assertEqualStringArrays(geneIds, uniqueSorted(genes.map((item) => item.ncbiGeneId)), "geneIds");
  assertEqualStringArrays(geneSymbols, uniqueSorted(genes.map((item) => item.symbol)), "geneSymbols");
  assertEqualStringArrays(geneMedgenIds, uniqueSorted(genes.map((item) => item.medGenId)), "geneMedgenIds");
  return {
    accessionVersion: assertNonemptyString(record.accessionVersion, `Condition/gene record ${entryNumber} accessionVersion`),
    conditionIds,
    conditionNames,
    geneIds,
    geneSymbols,
    geneMedgenIds,
  };
}

async function loadOptionalConditionGeneEnrichment(sourceId = GTR_CONDITION_GENE_SOURCE_ID) {
  const markerPath = resolveWithinRuntime("sources", sourceId, "latest-validated.json");
  const marker = await readJsonIfPresent(markerPath);
  if (marker === null) return null;
  assertObject(marker, "Condition/gene latest-validated marker");
  if (marker.schemaVersion !== "1" || marker.sourceId !== sourceId) {
    throw new Error("Condition/gene latest-validated marker has an invalid schema or sourceId.");
  }
  if (marker.adapterId !== GTR_CONDITION_GENE_SOURCE_ID) {
    throw new Error(`Condition/gene latest-validated marker adapterId must be ${GTR_CONDITION_GENE_SOURCE_ID}.`);
  }
  if (!SHA256_PATTERN.test(marker.snapshotSha256 ?? "")) {
    throw new Error("Condition/gene latest-validated marker has an invalid snapshotSha256.");
  }
  const stagedMatch = typeof marker.stagedPath === "string" ? marker.stagedPath.match(ENRICHMENT_STAGED_PATH_PATTERN) : null;
  if (!stagedMatch || stagedMatch[1] !== marker.snapshotSha256) {
    throw new Error("Condition/gene latest-validated marker stagedPath does not match its snapshot SHA-256.");
  }
  const expectedCount = assertNonnegativeInteger(marker.recordCount, "Condition/gene marker recordCount");
  const expectedIssueCount = assertNonnegativeInteger(
    marker.issueCount,
    "Condition/gene marker issueCount",
  );
  if (marker.publicationStatus !== "staged-only") {
    throw new Error("Condition/gene latest-validated marker is not staged-only.");
  }
  assertIsoDateString(marker.validatedAt, "Condition/gene marker validatedAt");

  const stagedPath = resolveWithinRuntime("sources", sourceId, ...marker.stagedPath.split("/"));
  const records = new Map();
  let enrichmentPublisherId = null;
  const streamed = await streamEnvelope(stagedPath, {
    arrayName: "records",
    label: "Condition/gene staged artifact",
    onMetadata(metadata) {
      if (metadata.schemaVersion !== "1" || metadata.sourceId !== sourceId) {
        throw new Error("Condition/gene staged envelope has an invalid schema or sourceId.");
      }
      if (metadata.snapshotSha256 !== marker.snapshotSha256) {
        throw new Error("Condition/gene staged envelope snapshotSha256 does not match its validated marker.");
      }
      if (metadata.publisherId !== "nih-gtr") {
        throw new Error("Condition/gene staged envelope has an invalid publisherId.");
      }
      enrichmentPublisherId = metadata.publisherId;
      assertMinimumAdapterVersion(metadata.adapterVersion, MINIMUM_CONDITION_GENE_ADAPTER);
      if (metadata.publicationStatus !== "staged-only") {
        throw new Error("Condition/gene staged envelope is not staged-only.");
      }
      assertIsoDateString(metadata.retrievedAt, "Condition/gene staged retrievedAt");
      assertIsoDateString(metadata.sourceUpdatedAt, "Condition/gene staged sourceUpdatedAt", { nullable: true });
    },
    onEntry(value, entryNumber) {
      const record = normalizeEnrichmentRecord(value, entryNumber, {
        sourceId,
        snapshotSha256: marker.snapshotSha256,
        publisherId: enrichmentPublisherId,
      });
      if (records.has(record.accessionVersion)) {
        throw new Error(`Condition/gene staged artifact contains duplicate accessionVersion ${record.accessionVersion}.`);
      }
      records.set(record.accessionVersion, record);
    },
  });
  const footerCount = assertNonnegativeInteger(streamed.footer.recordCount, "Condition/gene footer recordCount");
  if (streamed.entryCount !== footerCount || footerCount !== expectedCount) {
    throw new Error("Condition/gene staged record counts do not match the validated marker.");
  }
  const footerIssueCount = assertNonnegativeInteger(
    streamed.footer.issueCount,
    "Condition/gene footer issueCount",
  );
  if (!Array.isArray(streamed.footer.issues)) {
    throw new Error("Condition/gene footer issues must be an array.");
  }
  if (
    footerIssueCount !== expectedIssueCount ||
    streamed.footer.issues.length !== footerIssueCount
  ) {
    throw new Error("Condition/gene staged issue counts do not match its validated marker and issues array.");
  }
  return {
    sourceId,
    snapshotSha256: marker.snapshotSha256,
    recordCount: expectedCount,
    issueCount: expectedIssueCount,
    records,
  };
}

function normalizeOptionalFilter(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function normalizeReviewOptions(options = {}) {
  const limit = options.limit ?? DEFAULT_REVIEW_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REVIEW_LIMIT) {
    throw new Error(`Review limit must be an integer from 1 through ${MAX_REVIEW_LIMIT}.`);
  }
  return {
    query: normalizeOptionalFilter(options.query, "Review query"),
    gene: normalizeOptionalFilter(options.gene, "Gene filter"),
    condition: normalizeOptionalFilter(options.condition, "Condition filter"),
    lab: normalizeOptionalFilter(options.lab, "Lab filter"),
    reviewRequired: options.reviewRequired === true,
    limit,
  };
}

function includesNeedle(values, value) {
  const needle = value?.toLocaleLowerCase("en-US") ?? null;
  return needle === null || values.some((item) => item.toLocaleLowerCase("en-US").includes(needle));
}

function compactStrings(values) {
  return values.flat(Infinity).filter((value) => typeof value === "string" && value.length > 0);
}

function candidateMatches(candidate, enrichment, filters) {
  const providerValues = compactStrings([
    candidate.publisherProviderId,
    Object.values(candidate.provider),
  ]);
  const offeringValues = compactStrings(Object.values(candidate.offering));
  const enrichmentValues = enrichment ? compactStrings(Object.values(enrichment)) : [];
  if (filters.reviewRequired && candidate.reviewFlags.length === 0) return false;
  if (!includesNeedle(
    compactStrings([candidate.externalRecordId, candidate.publisherId, providerValues, offeringValues, enrichmentValues]),
    filters.query,
  )) return false;
  if (!includesNeedle(
    compactStrings([
      candidate.offering.genes,
      enrichment?.geneIds ?? [],
      enrichment?.geneSymbols ?? [],
      enrichment?.geneMedgenIds ?? [],
    ]),
    filters.gene,
  )) return false;
  if (!includesNeedle(
    compactStrings([
      candidate.offering.conditions,
      enrichment?.conditionIds ?? [],
      enrichment?.conditionNames ?? [],
    ]),
    filters.condition,
  )) return false;
  return includesNeedle(providerValues, filters.lab);
}

async function streamValidatedCandidateRecords({ context, enrichment = null, onCandidate }) {
  let publisherId = null;
  const streamed = await streamEnvelope(context.stagedPath, {
    arrayName: "candidates",
    label: "GTR staged candidate artifact",
    onMetadata(metadata) {
      publisherId = validateCandidateMetadata(
        metadata,
        context.marker,
        context.sourceId,
        context.minimumAdapterVersion,
      );
    },
    onEntry(value, entryNumber) {
      const candidate = validateCandidate(value, context.sourceId, publisherId, entryNumber);
      const joined = enrichment?.records.get(candidate.externalRecordId) ?? null;
      return onCandidate(candidate, joined, entryNumber);
    },
  });
  validateCandidateFooter(streamed.footer, context.marker, streamed.entryCount);
  return streamed;
}

export async function visitValidatedGtrCandidates({
  sourceId = GTR_TEST_VERSION_SOURCE_ID,
  minimumAdapterVersion = MINIMUM_TEST_VERSION_ADAPTER,
  enrichmentSourceId = GTR_CONDITION_GENE_SOURCE_ID,
  enrichment = true,
  onCandidate,
} = {}) {
  if (typeof onCandidate !== "function") {
    throw new Error("Validated GTR candidate visitor requires an onCandidate function.");
  }

  const context = await readValidatedCandidateContext({ sourceId, minimumAdapterVersion });
  const joinedEnrichment = enrichment
    ? await loadOptionalConditionGeneEnrichment(enrichmentSourceId)
    : null;
  const streamed = await streamValidatedCandidateRecords({
    context,
    enrichment: joinedEnrichment,
    onCandidate,
  });

  return {
    schemaVersion: "1",
    sourceId,
    snapshotSha256: context.marker.snapshotSha256,
    adapterVersion: streamed.metadata.adapterVersion,
    retrievedAt: streamed.metadata.retrievedAt,
    sourceUpdatedAt: streamed.metadata.sourceUpdatedAt,
    candidateCount: streamed.entryCount,
    reviewRequiredCandidateCount: context.marker.reviewRequiredCandidateCount,
    issueCount: context.marker.issueCount,
    enrichment: joinedEnrichment
      ? {
          sourceId: joinedEnrichment.sourceId,
          snapshotSha256: joinedEnrichment.snapshotSha256,
          recordCount: joinedEnrichment.recordCount,
          issueCount: joinedEnrichment.issueCount,
        }
      : null,
  };
}

export async function streamCandidateReview({
  context,
  filters = {},
  enrichment = null,
}) {
  const normalizedFilters = normalizeReviewOptions(filters);
  const results = [];
  let matchedCount = 0;
  const streamed = await streamValidatedCandidateRecords({
    context,
    enrichment,
    onCandidate(candidate, joined) {
      if (!candidateMatches(candidate, joined, normalizedFilters)) return;
      matchedCount += 1;
      if (results.length < normalizedFilters.limit) {
        results.push({ ...candidate, enrichment: joined });
      }
    },
  });

  return {
    schemaVersion: "1",
    sourceId: context.sourceId,
    snapshotSha256: context.marker.snapshotSha256,
    adapterVersion: streamed.metadata.adapterVersion,
    retrievedAt: streamed.metadata.retrievedAt,
    sourceUpdatedAt: streamed.metadata.sourceUpdatedAt,
    enrichment: enrichment
      ? {
          sourceId: enrichment.sourceId,
          snapshotSha256: enrichment.snapshotSha256,
          recordCount: enrichment.recordCount,
        }
      : null,
    filters: {
      query: normalizedFilters.query,
      gene: normalizedFilters.gene,
      condition: normalizedFilters.condition,
      lab: normalizedFilters.lab,
      reviewRequired: normalizedFilters.reviewRequired,
    },
    limit: normalizedFilters.limit,
    matchedCount,
    scannedCandidateCount: streamed.entryCount,
    candidateCount: context.marker.candidateCount,
    truncated: matchedCount > results.length,
    results,
  };
}

export async function reviewCandidates(options = {}) {
  const context = await readValidatedCandidateContext({
    sourceId: options.sourceId ?? GTR_TEST_VERSION_SOURCE_ID,
    minimumAdapterVersion: options.minimumAdapterVersion ?? MINIMUM_TEST_VERSION_ADAPTER,
  });
  const enrichment = options.enrichment === false
    ? null
    : await loadOptionalConditionGeneEnrichment(
        options.enrichmentSourceId ?? GTR_CONDITION_GENE_SOURCE_ID,
      );
  return streamCandidateReview({ context, filters: options, enrichment });
}

export function parseCandidateReviewArguments(argv) {
  const options = {
    query: null,
    gene: null,
    condition: null,
    lab: null,
    reviewRequired: false,
    limit: DEFAULT_REVIEW_LIMIT,
    help: false,
  };
  const seen = new Set();
  const valueOptions = new Map([
    ["--query", "query"],
    ["--gene", "gene"],
    ["--condition", "condition"],
    ["--lab", "lab"],
    ["--limit", "limit"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--review-required") {
      if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`);
      seen.add(argument);
      options.reviewRequired = true;
      continue;
    }
    const field = valueOptions.get(argument);
    if (!field) throw new Error(`Unknown argument: ${argument}`);
    if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`);
    seen.add(argument);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    if (field === "limit") {
      if (!/^\d+$/.test(value)) throw new Error("--limit must be an integer.");
      options.limit = Number(value);
    } else {
      options[field] = value;
    }
  }

  normalizeReviewOptions(options);
  return options;
}
