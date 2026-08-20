// Kept outside Vitest's .test/.spec patterns; run through the dedicated package script.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  acquireSnapshot,
  assertAllowedUrl,
  contentTypeAllowed,
} from "../../scripts/assayindex/acquisition/download.mjs";
import {
  ACQUISITION_ADAPTERS,
  requireAcquisitionAdapter,
  validatePreviousAcquisitionMarker,
} from "../../scripts/assayindex/acquisition/adapters.mjs";
import {
  parseCandidateReviewArguments,
  readValidatedCandidateContext,
  reviewCandidates,
} from "../../scripts/assayindex/acquisition/candidate-review.mjs";
import { stageGtrTestVersion } from "../../scripts/assayindex/acquisition/gtr-test-version.mjs";
import { stageGtrConditionGene } from "../../scripts/assayindex/acquisition/gtr-condition-gene.mjs";
import { stageCdcTestDirectory } from "../../scripts/assayindex/acquisition/cdc-test-directory.mjs";
import {
  validateGzipSnapshot,
  validateTextSnapshot,
  validateXmlSnapshot,
} from "../../scripts/assayindex/acquisition/payload-validation.mjs";
import {
  loadSourceRegistry,
  requireAcquirableSource,
} from "../../scripts/assayindex/acquisition/source-registry.mjs";
import {
  ensureRuntimeDirectory,
  readJsonIfPresent,
  resolveWithinRuntime,
  writeJsonAtomic,
} from "../../scripts/assayindex/acquisition/runtime.mjs";
import { buildRecordsCsv } from "../../scripts/assayindex/download-csv.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "../..");
const cli = resolve(projectRoot, "scripts/acquire-assayindex.mjs");
const source = {
  url: "https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_version.gz",
  allowedHosts: ["ftp.ncbi.nlm.nih.gov"],
  expectedContentTypes: ["application/gzip", "application/x-gzip"],
};
const cdcSourceUrl =
  "https://www.cdc.gov/laboratory/specimen-submission/js-app/data.xml";

async function createGtrFixture(tsv) {
  const sourceId = `unit-gtr-${randomUUID()}`;
  const root = resolveWithinRuntime("sources", sourceId);
  const snapshotPath = resolveWithinRuntime("sources", sourceId, "fixture.gz");
  await ensureRuntimeDirectory(root);
  await writeFile(snapshotPath, gzipSync(tsv), { flag: "wx" });
  return {
    root,
    snapshotPath,
    source: { ...source, id: sourceId, publisherId: "nih-gtr", maxExpandedBytes: 1_000_000 },
    manifest: {
      sha256: "a".repeat(64),
      retrievedAt: "2026-08-12T00:00:00.000Z",
      sourceUpdatedAt: "2026-08-10T00:00:00.000Z",
    },
  };
}

async function createGtrConditionGeneFixture(tsv, sourceOverrides = {}) {
  const sourceId = `unit-gtr-condition-gene-${randomUUID()}`;
  const root = resolveWithinRuntime("sources", sourceId);
  const snapshotPath = resolveWithinRuntime("sources", sourceId, "fixture.txt");
  await ensureRuntimeDirectory(root);
  await writeFile(snapshotPath, tsv, { flag: "wx" });
  return {
    root,
    snapshotPath,
    source: {
      id: sourceId,
      adapterId: "nih-gtr-test-condition-gene",
      publisherId: "nih-gtr",
      url: "https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_condition_gene.txt",
      allowedHosts: ["ftp.ncbi.nlm.nih.gov"],
      expectedContentTypes: ["text/plain"],
      maxExpandedBytes: 1_000_000,
      maxStagingIssueCount: 0,
      minimumCandidateCount: 1,
      minimumCandidateRetentionRatio: 0.9,
      ...sourceOverrides,
    },
    manifest: {
      sha256: "d".repeat(64),
      retrievedAt: "2026-08-12T00:00:00.000Z",
      sourceUpdatedAt: "2026-08-10T00:00:00.000Z",
    },
  };
}

async function createCdcTestDirectoryFixture(xml, sourceOverrides = {}) {
  const sourceId = `unit-cdc-test-directory-${randomUUID()}`;
  const root = resolveWithinRuntime("sources", sourceId);
  const snapshotPath = resolveWithinRuntime("sources", sourceId, "fixture.xml");
  await ensureRuntimeDirectory(root);
  await writeFile(snapshotPath, xml, { flag: "wx" });
  return {
    root,
    snapshotPath,
    source: {
      id: sourceId,
      adapterId: "cdc-infectious-diseases-test-directory",
      publisherId: "cdc",
      url: cdcSourceUrl,
      allowedHosts: ["www.cdc.gov"],
      expectedContentTypes: ["text/xml", "application/xml"],
      maxExpandedBytes: 2_000_000,
      maxStagingIssueCount: 0,
      minimumCandidateCount: 1,
      minimumCandidateRetentionRatio: 0.9,
      ...sourceOverrides,
    },
    manifest: {
      sha256: "c".repeat(64),
      retrievedAt: "2026-08-12T00:00:00.000Z",
      sourceUpdatedAt: "2026-08-10T00:00:00.000Z",
    },
  };
}

async function loadCdcFixture(fileName) {
  return readFile(
    resolve(testDirectory, "fixtures", "acquisition", "cdc", fileName),
    "utf8",
  );
}

function candidateReviewTsv() {
  const header = [
    "test_accession_ver",
    "name_of_laboratory",
    "name_of_institution",
    "facility_country",
    "lab_id",
    "lab_test_name",
    "genes",
    "condition_identifiers",
    "methods",
    "now_current",
    "test_currStat",
    "test_pubStat",
    "test_deletion_date",
  ].join("\t");
  const rows = [
    [
      "GTR000004036.6",
      "Mountain University Rare Disorders Laboratory",
      "Mountain University Hospital",
      "United States",
      "506123",
      "Fragile X syndrome testing",
      "FMR1",
      "C0016667",
      "Repeat expansion analysis",
      "1",
      "1",
      "3",
      "",
    ],
    [
      "GTR000004162.1",
      "Regional Children's Molecular Laboratory",
      "Regional Children's Hospital",
      "United States",
      "506124",
      "Cystic fibrosis sequencing",
      "",
      "",
      "Sequence analysis",
      "1",
      "72",
      "3",
      "2024-10-17",
    ],
    [
      "GTR000004528.1",
      "Academic Cancer Genetics Laboratory",
      "Academic Medical Center",
      "United States",
      "506125",
      "Familial polyposis panel",
      "APC|MUTYH",
      "C2713442",
      "Deletion/duplication analysis|Sequence analysis",
      "1",
      "1",
      "3",
      "",
    ],
  ].map((row) => row.join("\t"));
  return `${header}\n${rows.join("\n")}\n`;
}

async function createValidatedCandidateReviewFixture() {
  const fixture = await createGtrFixture(candidateReviewTsv());
  const staged = await stageGtrTestVersion(
    fixture.snapshotPath,
    fixture.manifest,
    fixture.source,
  );
  const markerPath = resolveWithinRuntime(
    "sources",
    fixture.source.id,
    "latest-validated.json",
  );
  const marker = {
    schemaVersion: "1",
    sourceId: fixture.source.id,
    adapterId: "nih-gtr-test-version",
    snapshotSha256: fixture.manifest.sha256,
    stagedPath: `staged/${fixture.manifest.sha256}.candidates.json`,
    validatedAt: "2026-08-12T00:00:00.000Z",
    candidateCount: staged.candidateCount,
    historicalRowCount: staged.historicalRowCount,
    reviewRequiredCandidateCount: staged.reviewRequiredCandidateCount,
    issueCount: staged.issueCount,
    publicationStatus: "staged-only",
  };
  await writeJsonAtomic(markerPath, marker);
  return { ...fixture, staged, marker, markerPath };
}

function conditionGeneEnrichmentTsv() {
  return [
    "#accession_version\ttest_type\tobject\tGTR_identifier\tMIM_number\tobject_name\tgene_or_SNOMED_CT_ID\tgene_symbol",
    "GTR000004036.6\tClinical\tcondition\tC0016667\t300624\tFragile X syndrome\t613003\tN/A",
    "GTR000004036.6\tClinical\tgene\tC1414649\t309550\tFMR1:fragile X messenger ribonucleoprotein 1\t2332\tFMR1",
    "GTR000004162.1\tClinical\tcondition\tC0010674\t219700\tCystic fibrosis\t190905008\tN/A",
    "GTR000004162.1\tClinical\tgene\tC1413365\t602421\tCFTR:CF transmembrane conductance regulator\t1080\tCFTR",
    "",
  ].join("\n");
}

async function createConditionGeneEnrichmentFixture(tsv) {
  const fixture = await createGtrConditionGeneFixture(tsv);
  const staged = await stageGtrConditionGene(
    fixture.snapshotPath,
    fixture.manifest,
    fixture.source,
  );
  await writeJsonAtomic(resolveWithinRuntime("sources", fixture.source.id, "latest-validated.json"), {
    schemaVersion: "1",
    sourceId: fixture.source.id,
    adapterId: "nih-gtr-test-condition-gene",
    snapshotSha256: fixture.manifest.sha256,
    stagedPath: `staged/${fixture.manifest.sha256}.records.json`,
    validatedAt: "2026-08-12T00:00:00.000Z",
    recordCount: staged.recordCount,
    issueCount: staged.issueCount,
    publicationStatus: "staged-only",
  });
  return { ...fixture, staged, sourceId: fixture.source.id };
}

function acquisitionSource(id) {
  return {
    ...source,
    id,
    publisherId: "nih-gtr",
    timeoutMs: 5_000,
    maxDownloadBytes: 1_000_000,
  };
}

function acquireGzipSnapshot(sourcePolicy, options = {}) {
  return acquireSnapshot(sourcePolicy, {
    retries: 0,
    snapshotFileName: "test_version.gz",
    validateSnapshot: validateGzipSnapshot,
    ...options,
  });
}

async function assertNoStagedArtifacts(sourceId) {
  try {
    assert.deepEqual(
      await readdir(resolveWithinRuntime("sources", sourceId, "staged")),
      [],
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function mutateEnvelopeEntry(path, mutate, targetEntryNumber = 1) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const entryIndexes = lines.flatMap((line, index) => {
    const trimmed = line.trim();
    return index > 0 && trimmed && !trimmed.startsWith("]") ? [index] : [];
  });
  const entryIndex = entryIndexes[targetEntryNumber - 1] ?? -1;
  assert.notEqual(entryIndex, -1, `Expected staged envelope entry ${targetEntryNumber} to tamper.`);
  const raw = lines[entryIndex].trim();
  const leadingComma = raw.startsWith(",");
  const trailingComma = raw.endsWith(",");
  const json = raw.slice(leadingComma ? 1 : 0, trailingComma ? -1 : undefined);
  const entry = JSON.parse(json);
  mutate(entry);
  lines[entryIndex] = `${leadingComma ? "," : ""}${JSON.stringify(entry)}${trailingComma ? "," : ""}`;
  await writeFile(path, lines.join("\n"));
}

async function mutateEnvelopeMetadata(path, arrayName, mutate) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const arrayMarker = `,"${arrayName}":[`;
  const markerIndex = lines[0]?.lastIndexOf(arrayMarker) ?? -1;
  assert.ok(markerIndex > 0, `Expected a staged ${arrayName} envelope metadata line.`);
  const metadata = JSON.parse(`${lines[0].slice(0, markerIndex)}}`);
  mutate(metadata);
  lines[0] = `${JSON.stringify(metadata).slice(0, -1)}${arrayMarker}`;
  await writeFile(path, lines.join("\n"));
}

async function mutateEnvelopeFooter(path, mutate) {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const footerIndex = lines.findIndex((line) => line.trim().startsWith("]"));
  assert.notEqual(footerIndex, -1, "Expected a staged envelope footer to tamper.");
  const footerLine = lines[footerIndex].trim();
  const footer = JSON.parse(`{${footerLine.replace(/^\]\s*,/, "")}`);
  mutate(footer);
  lines[footerIndex] = `],${JSON.stringify(footer).slice(1)}`;
  await writeFile(path, lines.join("\n"));
}

function normalizedStagedHash(entry) {
  const withoutDigest = Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== "normalizedSha256"),
  );
  return createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex");
}

test("the CLI refuses acquisition without the explicit network gate", () => {
  const result = spawnSync(process.execPath, [cli, "--source", "nih-gtr-test-version"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Network acquisition is disabled/);
});

test("the GTR source policy accepts only its exact HTTPS host and path", () => {
  assert.equal(assertAllowedUrl(source.url, source).href, source.url);
  assert.throws(
    () => assertAllowedUrl("https://127.0.0.1/pub/GTR/data/test_version.gz", source),
    /Blocked acquisition host/,
  );
  assert.throws(
    () => assertAllowedUrl("https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/other.gz", source),
    /Blocked acquisition path/,
  );
  assert.throws(
    () => assertAllowedUrl("http://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_version.gz", source),
    /Blocked unsafe acquisition URL/,
  );
});

test("adapter dispatch refuses unknown adapters and registry endpoint drift", () => {
  const registered = {
    ...source,
    id: "nih-gtr-test-version",
    adapterId: "nih-gtr-test-version",
  };
  assert.equal(requireAcquisitionAdapter(registered), ACQUISITION_ADAPTERS[registered.adapterId]);
  assert.throws(
    () => requireAcquisitionAdapter({ ...registered, adapterId: "unknown-adapter" }),
    /Unknown AssayIndex acquisition adapter/,
  );
  assert.throws(
    () => requireAcquisitionAdapter({ ...registered, adapterId: undefined }),
    /no implemented adapter/,
  );
  assert.throws(
    () => requireAcquisitionAdapter({
      ...registered,
      url: "https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/other.gz",
    }),
    /URL does not match its hardcoded adapter allowlist/,
  );
  assert.throws(
    () => requireAcquisitionAdapter({
      ...registered,
      allowedHosts: ["ftp.ncbi.nlm.nih.gov", "example.test"],
    }),
    /hosts do not match its hardcoded adapter allowlist/,
  );
});

test("the CDC adapter dispatch accepts only its exact public XML endpoint", () => {
  const registered = {
    id: "cdc-infectious-diseases-test-directory",
    adapterId: "cdc-infectious-diseases-test-directory",
    publisherId: "cdc",
    url: cdcSourceUrl,
    allowedHosts: ["www.cdc.gov"],
  };
  const adapter = requireAcquisitionAdapter(registered);

  assert.equal(adapter, ACQUISITION_ADAPTERS[registered.adapterId]);
  assert.equal(adapter.snapshotFileName, "data.xml");
  assert.equal(
    adapter.stagedRelativePath({ sha256: "c".repeat(64) }),
    `staged/${"c".repeat(64)}.candidates.json`,
  );
  assert.throws(
    () => requireAcquisitionAdapter({
      ...registered,
      url: "https://www.cdc.gov/laboratory/specimen-submission/js-app/other.xml",
    }),
    /URL does not match its hardcoded adapter allowlist/,
  );
  assert.throws(
    () => requireAcquisitionAdapter({ ...registered, allowedHosts: ["cdc.gov"] }),
    /hosts do not match its hardcoded adapter allowlist/,
  );
});

test("previous validated acquisition markers are fully checked before count reuse", async (t) => {
  const adapter = ACQUISITION_ADAPTERS["nih-gtr-test-condition-gene"];
  const source = {
    id: `unit-previous-marker-${randomUUID()}`,
    adapterId: adapter.id,
    publisherId: "nih-gtr",
  };
  const snapshotSha256 = "f".repeat(64);
  const validMarker = {
    schemaVersion: "1",
    sourceId: source.id,
    adapterId: adapter.id,
    snapshotSha256,
    stagedPath: adapter.stagedRelativePath({ sha256: snapshotSha256 }),
    validatedAt: "2026-08-12T00:00:00.000Z",
    recordCount: 2,
    issueCount: 0,
    publicationStatus: "staged-only",
  };
  assert.equal(
    validatePreviousAcquisitionMarker(validMarker, { source, adapter }).recordCount,
    2,
  );

  const cases = [
    {
      name: "adapterId mismatch",
      mutate(marker) {
        marker.adapterId = "nih-gtr-test-version";
      },
      expected: /adapterId/,
    },
    {
      name: "invalid snapshot SHA",
      mutate(marker) {
        marker.snapshotSha256 = "not-a-sha256";
      },
      expected: /snapshotSha256|SHA-256/,
    },
    {
      name: "stagedPath mismatch",
      mutate(marker) {
        marker.stagedPath = `staged/${"e".repeat(64)}.records.json`;
      },
      expected: /stagedPath/,
    },
    {
      name: "publication status",
      mutate(marker) {
        marker.publicationStatus = "published";
      },
      expected: /staged-only|publicationStatus/,
    },
    {
      name: "invalid validatedAt",
      mutate(marker) {
        marker.validatedAt = "not-an-iso-instant";
      },
      expected: /validatedAt/,
    },
    {
      name: "invalid issueCount",
      mutate(marker) {
        marker.issueCount = -1;
      },
      expected: /issueCount/,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const marker = structuredClone(validMarker);
      testCase.mutate(marker);
      assert.throws(
        () => validatePreviousAcquisitionMarker(marker, { source, adapter }),
        testCase.expected,
      );
    });
  }
});

test("previous CDC markers validate candidate and review-required counts before reuse", () => {
  const adapter = ACQUISITION_ADAPTERS["cdc-infectious-diseases-test-directory"];
  const source = {
    id: `unit-previous-cdc-marker-${randomUUID()}`,
    adapterId: adapter.id,
    publisherId: "cdc",
  };
  const snapshotSha256 = "b".repeat(64);
  const validMarker = {
    schemaVersion: "1",
    sourceId: source.id,
    adapterId: adapter.id,
    snapshotSha256,
    stagedPath: adapter.stagedRelativePath({ sha256: snapshotSha256 }),
    validatedAt: "2026-08-12T00:00:00.000Z",
    recordCount: 2,
    candidateCount: 2,
    reviewRequiredCandidateCount: 2,
    sourceGeneratedAt: "2026-08-03T10:06:35",
    issueCount: 0,
    publicationStatus: "staged-only",
  };

  assert.equal(
    validatePreviousAcquisitionMarker(validMarker, { source, adapter }).candidateCount,
    2,
  );
  assert.throws(
    () => validatePreviousAcquisitionMarker(
      { ...validMarker, candidateCount: 1 },
      { source, adapter },
    ),
    /candidateCount/,
  );
  assert.throws(
    () => validatePreviousAcquisitionMarker(
      { ...validMarker, reviewRequiredCandidateCount: 3 },
      { source, adapter },
    ),
    /reviewRequiredCandidateCount/,
  );
  assert.throws(
    () => validatePreviousAcquisitionMarker(
      { ...validMarker, sourceGeneratedAt: "2026-02-30T10:06:35" },
      { source, adapter },
    ),
    /sourceGeneratedAt/,
  );
  assert.throws(
    () => validatePreviousAcquisitionMarker(
      { ...validMarker, sourceGeneratedAt: undefined },
      { source, adapter },
    ),
    /sourceGeneratedAt/,
  );
});

test("the configured GTR source requires clean staging and guards candidate volume", async () => {
  const registry = await loadSourceRegistry();
  const configured = requireAcquirableSource(registry, "nih-gtr-test-version");

  assert.equal(configured.maxStagingIssueCount, 0);
  assert.equal(configured.minimumCandidateCount, 50_000);
  assert.equal(configured.minimumCandidateRetentionRatio, 0.9);
  assert.equal(configured.releaseEnabled, false);
  assert.equal(configured.redistributionApproved, false);
});

test("the configured CDC source is release-approved, exact, and volume guarded", async () => {
  const registry = await loadSourceRegistry();
  const configured = requireAcquirableSource(
    registry,
    "cdc-infectious-diseases-test-directory",
  );

  assert.equal(configured.adapterId, "cdc-infectious-diseases-test-directory");
  assert.equal(configured.publisherId, "cdc");
  assert.equal(configured.url, cdcSourceUrl);
  assert.deepEqual(configured.allowedHosts, ["www.cdc.gov"]);
  assert.ok(configured.expectedContentTypes.includes("text/xml"));
  assert.equal(configured.maxStagingIssueCount, 0);
  assert.ok(configured.minimumCandidateCount >= 200);
  assert.equal(configured.minimumCandidateRetentionRatio, 0.9);
  assert.equal(configured.releaseEnabled, true);
  assert.equal(configured.redistributionApproved, true);
});

test("content type matching ignores parameters but rejects HTML", () => {
  assert.equal(
    contentTypeAllowed(new Response(null, { headers: { "content-type": "application/x-gzip; charset=binary" } }), source),
    true,
  );
  assert.equal(
    contentTypeAllowed(new Response(null, { headers: { "content-type": "text/html" } }), source),
    false,
  );
});

test("text snapshot validation scans beyond the initial 16 KiB inspection window", async (t) => {
  const header = "#accession_version\ttest_type\tobject\tGTR_identifier\tMIM_number\tobject_name\tgene_or_SNOMED_CT_ID\tgene_symbol\n";
  const requiredHeaderFields = [
    "accession_version",
    "test_type",
    "object",
    "GTR_identifier",
    "MIM_number",
    "object_name",
    "gene_or_SNOMED_CT_ID",
    "gene_symbol",
  ];

  await t.test("invalid UTF-8 after byte 16384", async () => {
    const fixture = await createGtrConditionGeneFixture(header);
    try {
      const validPrefix = Buffer.from(`${header}${"A".repeat(17_000)}`, "utf8");
      assert.ok(validPrefix.length > 16_384);
      await writeFile(
        fixture.snapshotPath,
        Buffer.concat([validPrefix, Buffer.from([0xc3, 0x28])]),
      );
      await assert.rejects(
        validateTextSnapshot(fixture.snapshotPath, { requiredHeaderFields }),
        /valid UTF-8/,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("binary NUL after byte 16384", async () => {
    const fixture = await createGtrConditionGeneFixture(header);
    try {
      const validPrefix = Buffer.from(`${header}${"A".repeat(17_000)}`, "utf8");
      assert.ok(validPrefix.length > 16_384);
      await writeFile(
        fixture.snapshotPath,
        Buffer.concat([validPrefix, Buffer.from([0x00])]),
      );
      await assert.rejects(
        validateTextSnapshot(fixture.snapshotPath, { requiredHeaderFields }),
        /NUL bytes/,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("CDC XML payload validation rejects non-dataset and unsafe XML", async (t) => {
  const valid = await loadCdcFixture("test-directory.sample.xml");
  const cases = [
    {
      name: "HTML masquerading as XML",
      payload: "<!doctype html><html><body>not a dataset</body></html>",
      expected: /HTML|dataroot|XML/i,
    },
    {
      name: "malformed nesting",
      payload: await loadCdcFixture("test-directory.malformed.xml"),
      expected: /malformed|XML/i,
    },
    {
      name: "a DTD and external entity declaration",
      payload: valid.replace(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<?xml version=\"1.0\"?><!DOCTYPE dataroot [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>",
      ),
      expected: /DOCTYPE|ENTITY|prohibited|unsafe/i,
    },
    {
      name: "CDATA",
      payload: valid.replace("RT-PCR", "<![CDATA[RT-PCR]]>"),
      expected: /CDATA|prohibited|unsafe/i,
    },
    {
      name: "the wrong root",
      payload: valid
        .replace("<dataroot", "<wrongroot")
        .replace("</dataroot>", "</wrongroot>"),
      expected: /dataroot|root/i,
    },
    {
      name: "a malformed source entity",
      payload: valid.replace("RT-PCR", "R&D"),
      expected: /entity|malformed|unsupported/i,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fixture = await createCdcTestDirectoryFixture(testCase.payload);
      try {
        await assert.rejects(
          validateXmlSnapshot(fixture.snapshotPath, {
            rootElement: "dataroot",
            recordElement: "QryTableMerge",
          }),
          testCase.expected,
        );
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("candidate review argument parsing enforces a bounded read-only result limit", () => {
  assert.deepEqual(
    parseCandidateReviewArguments([
      "--gene",
      "CFTR",
      "--condition",
      "cystic fibrosis",
      "--lab",
      "children's",
      "--review-required",
      "--limit",
      "7",
    ]),
    {
      query: null,
      gene: "CFTR",
      condition: "cystic fibrosis",
      lab: "children's",
      reviewRequired: true,
      limit: 7,
      help: false,
    },
  );
  assert.throws(() => parseCandidateReviewArguments(["--limit", "0"]), /1 through 100/);
  assert.throws(() => parseCandidateReviewArguments(["--limit", "101"]), /1 through 100/);
});

test("candidate review explains how to create a missing validated snapshot marker", async () => {
  const sourceId = `unit-missing-marker-${randomUUID()}`;
  await assert.rejects(
    readValidatedCandidateContext({ sourceId }),
    (error) => {
      assert.match(error.message, /no validated snapshot/i);
      assert.match(error.message, /acquir|restag/i);
      return true;
    },
  );
});

test("candidate review rejects test-version marker adapter and validation-time tampering", async (t) => {
  const fixture = await createValidatedCandidateReviewFixture();
  const originalMarker = await readFile(fixture.markerPath, "utf8");
  const cases = [
    {
      name: "adapterId mismatch",
      mutate(marker) {
        marker.adapterId = "nih-gtr-test-condition-gene";
      },
      expected: /adapterId/,
    },
    {
      name: "invalid validatedAt",
      mutate(marker) {
        marker.validatedAt = "not-an-iso-instant";
      },
      expected: /validatedAt/,
    },
  ];

  try {
    for (const testCase of cases) {
      await t.test(testCase.name, async () => {
        const marker = JSON.parse(originalMarker);
        testCase.mutate(marker);
        await writeFile(fixture.markerPath, `${JSON.stringify(marker, null, 2)}\n`);
        await assert.rejects(
          readValidatedCandidateContext({ sourceId: fixture.source.id }),
          testCase.expected,
        );
      });
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("candidate review rejects test-version envelope metadata tampering", async (t) => {
  const fixture = await createValidatedCandidateReviewFixture();
  const originalArtifact = await readFile(fixture.staged.path, "utf8");
  const cases = [
    {
      name: "publisherId mismatch",
      mutate(metadata) {
        metadata.publisherId = "tampered-publisher";
      },
      expected: /publisherId/,
    },
    {
      name: "invalid retrievedAt",
      mutate(metadata) {
        metadata.retrievedAt = "not-an-iso-instant";
      },
      expected: /retrievedAt/,
    },
    {
      name: "invalid sourceUpdatedAt",
      mutate(metadata) {
        metadata.sourceUpdatedAt = "not-an-iso-instant";
      },
      expected: /sourceUpdatedAt/,
    },
  ];

  try {
    for (const testCase of cases) {
      await t.test(testCase.name, async () => {
        await writeFile(fixture.staged.path, originalArtifact);
        await mutateEnvelopeMetadata(fixture.staged.path, "candidates", testCase.mutate);
        await assert.rejects(
          reviewCandidates({ sourceId: fixture.source.id, enrichment: false }),
          testCase.expected,
        );
      });
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("candidate review rejects rehashed test-version candidate semantic tampering", async (t) => {
  const fixture = await createValidatedCandidateReviewFixture();
  const originalArtifact = await readFile(fixture.staged.path, "utf8");
  const cases = [
    {
      name: "publisherId mismatch",
      entryNumber: 1,
      mutate(candidate) {
        candidate.publisherId = "tampered-publisher";
      },
      expected: /publisherId/,
    },
    {
      name: "malformed sourceStatus field",
      entryNumber: 1,
      mutate(candidate) {
        candidate.sourceStatus.nowCurrent = 1;
      },
      expected: /sourceStatus\.nowCurrent|nowCurrent/,
    },
    {
      name: "unknown reviewFlag",
      entryNumber: 2,
      mutate(candidate) {
        candidate.reviewFlags.push("unknown_review_flag");
      },
      expected: /unknown.*review|reviewFlags.*unknown/i,
    },
    {
      name: "duplicate reviewFlag",
      entryNumber: 2,
      mutate(candidate) {
        candidate.reviewFlags.push(candidate.reviewFlags[0]);
      },
      expected: /duplicate.*review|reviewFlags.*duplicate/i,
    },
    {
      name: "candidateState inconsistent with reviewFlags",
      entryNumber: 1,
      mutate(candidate) {
        candidate.candidateState = "discovered-review-required";
      },
      expected: /candidateState.*reviewFlags|reviewFlags.*candidateState|inconsistent/i,
    },
  ];

  try {
    for (const testCase of cases) {
      await t.test(testCase.name, async () => {
        await writeFile(fixture.staged.path, originalArtifact);
        await mutateEnvelopeEntry(
          fixture.staged.path,
          (candidate) => {
            testCase.mutate(candidate);
            candidate.normalizedSha256 = normalizedStagedHash(candidate);
          },
          testCase.entryNumber,
        );
        await assert.rejects(
          reviewCandidates({ sourceId: fixture.source.id, enrichment: false }),
          testCase.expected,
        );
      });
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("candidate review combines rare gene, condition, lab, and review-required filters with optional enrichment", async () => {
  const fixture = await createValidatedCandidateReviewFixture();
  const enrichment = await createConditionGeneEnrichmentFixture(
    conditionGeneEnrichmentTsv(),
  );
  try {
    const candidateArtifactBefore = await readFile(fixture.staged.path, "utf8");
    const candidateMarkerBefore = await readFile(fixture.markerPath, "utf8");
    const enrichmentArtifactBefore = await readFile(enrichment.staged.path, "utf8");
    const result = await reviewCandidates({
      sourceId: fixture.source.id,
      enrichmentSourceId: enrichment.sourceId,
      gene: "cftr",
      condition: "CYSTIC",
      lab: "children's",
      reviewRequired: true,
      limit: 1,
    });

    assert.equal(result.matchedCount, 1);
    assert.equal(result.scannedCandidateCount, 3);
    assert.equal(result.candidateCount, 3);
    assert.equal(result.truncated, false);
    assert.equal(result.results[0].externalRecordId, "GTR000004162.1");
    assert.deepEqual(result.results[0].enrichment, {
      accessionVersion: "GTR000004162.1",
      conditionIds: ["C0010674"],
      conditionNames: ["Cystic fibrosis"],
      geneIds: ["1080"],
      geneSymbols: ["CFTR"],
      geneMedgenIds: ["C1413365"],
    });
    assert.equal(result.enrichment.sourceId, enrichment.sourceId);

    const bounded = await reviewCandidates({
      sourceId: fixture.source.id,
      enrichment: false,
      lab: "United States",
      limit: 1,
    });
    assert.equal(bounded.matchedCount, 3);
    assert.equal(bounded.results.length, 1);
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.enrichment, null);
    assert.equal(await readFile(fixture.staged.path, "utf8"), candidateArtifactBefore);
    assert.equal(await readFile(fixture.markerPath, "utf8"), candidateMarkerBefore);
    assert.equal(await readFile(enrichment.staged.path, "utf8"), enrichmentArtifactBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(enrichment.root, { recursive: true, force: true });
  }
});

test("candidate review rejects tampered condition/gene staged record integrity fields", async (t) => {
  const candidateFixture = await createValidatedCandidateReviewFixture();
  const enrichment = await createConditionGeneEnrichmentFixture(
    conditionGeneEnrichmentTsv(),
  );
  const originalArtifact = await readFile(enrichment.staged.path, "utf8");
  const cases = [
    {
      name: "sourceId",
      mutate(record) {
        record.sourceId = "tampered-source";
      },
      expected: /sourceId/,
    },
    {
      name: "publisherId",
      mutate(record) {
        record.publisherId = "tampered-publisher";
      },
      expected: /publisherId/,
    },
    {
      name: "snapshotSha256",
      mutate(record) {
        record.snapshotSha256 = "e".repeat(64);
      },
      expected: /snapshotSha256|snapshot SHA-256/,
    },
    {
      name: "publicationStatus",
      mutate(record) {
        record.publicationStatus = "published";
      },
      expected: /staged-only|publicationStatus/,
    },
    {
      name: "candidateState",
      mutate(record) {
        record.candidateState = "published";
      },
      expected: /candidateState/,
    },
    {
      name: "structured conditions",
      mutate(record) {
        record.conditions = [{ medGenId: "C0016667", mimNumber: 300624 }];
      },
      expected: /conditions|mimNumber/,
    },
    {
      name: "normalizedSha256",
      mutate(record) {
        record.normalizedSha256 = "0".repeat(64);
      },
      expected: /normalizedSha256.*content|normalized SHA-256/i,
    },
  ];

  try {
    for (const testCase of cases) {
      await t.test(testCase.name, async () => {
        await writeFile(enrichment.staged.path, originalArtifact);
        await mutateEnvelopeEntry(enrichment.staged.path, (record) => {
          testCase.mutate(record);
          if (testCase.name !== "normalizedSha256") {
            record.normalizedSha256 = normalizedStagedHash(record);
          }
        });
        await assert.rejects(
          reviewCandidates({
            sourceId: candidateFixture.source.id,
            enrichmentSourceId: enrichment.sourceId,
          }),
          testCase.expected,
        );
      });
    }
  } finally {
    await rm(candidateFixture.root, { recursive: true, force: true });
    await rm(enrichment.root, { recursive: true, force: true });
  }
});

test("candidate review rejects condition/gene marker and footer integrity mismatches", async (t) => {
  const candidateFixture = await createValidatedCandidateReviewFixture();
  const enrichment = await createConditionGeneEnrichmentFixture(
    conditionGeneEnrichmentTsv(),
  );
  const markerPath = resolveWithinRuntime(
    "sources",
    enrichment.sourceId,
    "latest-validated.json",
  );
  const originalMarker = await readFile(markerPath, "utf8");
  const originalArtifact = await readFile(enrichment.staged.path, "utf8");
  const review = () => reviewCandidates({
    sourceId: candidateFixture.source.id,
    enrichmentSourceId: enrichment.sourceId,
  });

  const markerCases = [
    {
      name: "marker adapterId mismatch",
      mutate(marker) {
        marker.adapterId = "nih-gtr-test-version";
      },
      expected: /adapterId/,
    },
    {
      name: "marker invalid validatedAt",
      mutate(marker) {
        marker.validatedAt = "not-an-iso-instant";
      },
      expected: /validatedAt/,
    },
    {
      name: "marker invalid issueCount",
      mutate(marker) {
        marker.issueCount = -1;
      },
      expected: /issueCount/,
    },
    {
      name: "marker issueCount differs from footer",
      mutate(marker) {
        marker.issueCount = 1;
      },
      expected: /issue count|issueCount/i,
    },
  ];
  const footerCases = [
    {
      name: "footer recordCount mismatch",
      mutate(footer) {
        footer.recordCount += 1;
      },
      expected: /record count|recordCount/i,
    },
    {
      name: "footer issueCount differs from issues",
      mutate(footer) {
        footer.issueCount = 1;
      },
      expected: /issueCount|issues/,
    },
  ];

  try {
    for (const testCase of markerCases) {
      await t.test(testCase.name, async () => {
        await writeFile(enrichment.staged.path, originalArtifact);
        const marker = JSON.parse(originalMarker);
        testCase.mutate(marker);
        await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
        await assert.rejects(review(), testCase.expected);
      });
    }
    for (const testCase of footerCases) {
      await t.test(testCase.name, async () => {
        await writeFile(markerPath, originalMarker);
        await writeFile(enrichment.staged.path, originalArtifact);
        await mutateEnvelopeFooter(enrichment.staged.path, testCase.mutate);
        await assert.rejects(review(), testCase.expected);
      });
    }
  } finally {
    await rm(candidateFixture.root, { recursive: true, force: true });
    await rm(enrichment.root, { recursive: true, force: true });
  }
});

test("candidate review rejects marker path, normalized hash, and staged count mismatches", async (t) => {
  await t.test("marker path hash mismatch", async () => {
    const fixture = await createValidatedCandidateReviewFixture();
    try {
      await writeFile(
        fixture.markerPath,
        `${JSON.stringify({
          ...fixture.marker,
          stagedPath: `staged/${"c".repeat(64)}.candidates.json`,
        }, null, 2)}\n`,
      );
      await assert.rejects(
        readValidatedCandidateContext({ sourceId: fixture.source.id }),
        /stagedPath does not match its snapshot SHA-256/,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("candidate normalized hash mismatch", async () => {
    const fixture = await createValidatedCandidateReviewFixture();
    try {
      const stagedText = await readFile(fixture.staged.path, "utf8");
      await writeFile(
        fixture.staged.path,
        stagedText.replace("Cystic fibrosis sequencing", "Tampered test name"),
      );
      await assert.rejects(
        reviewCandidates({ sourceId: fixture.source.id, enrichment: false }),
        /normalizedSha256 does not match its content/,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("validated marker count mismatch", async () => {
    const fixture = await createValidatedCandidateReviewFixture();
    try {
      await writeFile(
        fixture.markerPath,
        `${JSON.stringify({
          ...fixture.marker,
          candidateCount: fixture.marker.candidateCount + 1,
        }, null, 2)}\n`,
      );
      await assert.rejects(
        reviewCandidates({ sourceId: fixture.source.id, enrichment: false }),
        /footer candidateCount does not match its validated marker/,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("the downloadable records CSV neutralizes formula-leading cells", () => {
  const csv = buildRecordsCsv({
    assays: [{ slug: "formula-safety", displayName: "Formula safety", status: "published" }],
    labs: [{ id: "reference-lab", displayName: "Reference Laboratory" }],
    assayLabRecords: [
      {
        id: "formula-record",
        assaySlug: "formula-safety",
        labId: "reference-lab",
        testName: "=2+3",
        testCode: "+2+3",
        testId: "-2+3",
        orderCode: "@SUM",
        category: "standard",
        specimenType: null,
        methodology: null,
        turnaroundTime: null,
        cptCodes: [],
        loincCodes: [],
        sourceLinks: [],
        sourceVerifiedAt: null,
        updatedAt: "2026-08-12T00:00:00.000Z",
        publicationStatus: "published",
      },
    ],
  });

  assert.match(csv, /,'=2\+3,'\+2\+3,'-2\+3,'@SUM,/);
  assert.doesNotMatch(csv, /(?:^|,)[=+\-@]/m);
});

test("the downloader hashes immutable gzip bytes and uses conditional validators", async () => {
  const sourceId = `unit-download-${randomUUID()}`;
  const runtimeSourceRoot = resolveWithinRuntime("sources", sourceId);
  const payload = gzipSync("test_accession_ver\tlab_id\nGTR000123456.1\t506123\n");
  const expectedHash = createHash("sha256").update(payload).digest("hex");
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let conditionalHeaders;
  globalThis.fetch = async (_url, options) => {
    requestCount += 1;
    assert.equal(options.redirect, "manual");
    if (requestCount === 2) {
      conditionalHeaders = options.headers;
      return new Response(null, { status: 304 });
    }
    return new Response(payload, {
      status: 200,
      headers: {
        "content-length": String(payload.length),
        "content-type": "application/x-gzip",
        etag: '"unit-etag"',
        "last-modified": "Sun, 09 Aug 2026 14:20:03 GMT",
      },
    });
  };

  try {
    const first = await acquireGzipSnapshot(acquisitionSource(sourceId));
    assert.equal(first.manifest.sha256, expectedHash);
    assert.equal(first.manifest.sourceUpdatedAt, "2026-08-09T14:20:03.000Z");
    assert.equal(first.manifest.publicationStatus, "staged-only");
    assert.match(first.manifest.snapshotPath, new RegExp(`^raw/${expectedHash}\\.test_version\\.gz$`));
    assert.ok(await readJsonIfPresent(resolveWithinRuntime("sources", sourceId, "latest.json")));

    const second = await acquireGzipSnapshot(acquisitionSource(sourceId));
    assert.equal(second.unchanged, true);
    assert.equal(conditionalHeaders["If-None-Match"], '"unit-etag"');
    assert.equal(conditionalHeaders["If-Modified-Since"], "Sun, 09 Aug 2026 14:20:03 GMT");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeSourceRoot, { recursive: true, force: true });
  }
});

test("a 304 response cannot bless a corrupted cached raw snapshot", async () => {
  const sourceId = `unit-corrupt-cache-${randomUUID()}`;
  const runtimeSourceRoot = resolveWithinRuntime("sources", sourceId);
  const payload = gzipSync("test_accession_ver\tlab_id\nGTR000123456.1\t506123\n");
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(payload, {
        status: 200,
        headers: {
          "content-length": String(payload.length),
          "content-type": "application/x-gzip",
          etag: '"unit-corrupt-cache"',
        },
      });
    }
    return new Response(null, { status: 304 });
  };

  try {
    const first = await acquireGzipSnapshot(acquisitionSource(sourceId));
    await writeFile(first.snapshotPath, Buffer.alloc(payload.length, 0x41));
    await assert.rejects(
      acquireGzipSnapshot(acquisitionSource(sourceId)),
      (error) => {
        assert.match(error.message, /cached|snapshot/i);
        assert.match(error.message, /sha|hash|digest|corrupt|valid|mismatch/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeSourceRoot, { recursive: true, force: true });
  }
});

test("a fresh 200 response cannot retain a corrupt content-addressed destination collision", async () => {
  const sourceId = `unit-raw-collision-${randomUUID()}`;
  const runtimeSourceRoot = resolveWithinRuntime("sources", sourceId);
  const payload = gzipSync("test_accession_ver\tlab_id\nGTR000123456.1\t506123\n");
  const expectedHash = createHash("sha256").update(payload).digest("hex");
  const destination = resolveWithinRuntime(
    "sources",
    sourceId,
    "raw",
    `${expectedHash}.test_version.gz`,
  );
  await ensureRuntimeDirectory(dirname(destination));
  await writeFile(destination, Buffer.alloc(payload.length, 0x41), { flag: "wx" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(payload, {
    status: 200,
    headers: {
      "content-length": String(payload.length),
      "content-type": "application/x-gzip",
    },
  });

  try {
    const result = await acquireGzipSnapshot(acquisitionSource(sourceId));
    assert.equal(result.manifest.sha256, expectedHash);
    assert.deepEqual(await readFile(result.snapshotPath), payload);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeSourceRoot, { recursive: true, force: true });
  }
});

test("the generic downloader preserves and validates an immutable UTF-8 text snapshot", async () => {
  const sourceId = `unit-text-download-${randomUUID()}`;
  const runtimeSourceRoot = resolveWithinRuntime("sources", sourceId);
  const payload = conditionGeneEnrichmentTsv();
  const expectedHash = createHash("sha256").update(payload).digest("hex");
  const textSource = {
    id: sourceId,
    publisherId: "nih-gtr",
    url: "https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_condition_gene.txt",
    allowedHosts: ["ftp.ncbi.nlm.nih.gov"],
    expectedContentTypes: ["text/plain"],
    timeoutMs: 5_000,
    maxDownloadBytes: 1_000_000,
  };
  const adapter = ACQUISITION_ADAPTERS["nih-gtr-test-condition-gene"];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(payload, {
    status: 200,
    headers: {
      "content-length": String(Buffer.byteLength(payload)),
      "content-type": "text/plain; charset=utf-8",
      "last-modified": "Sun, 09 Aug 2026 14:20:03 GMT",
    },
  });
  try {
    const result = await acquireSnapshot(textSource, {
      retries: 0,
      snapshotFileName: adapter.snapshotFileName,
      validateSnapshot: adapter.validateSnapshot,
    });
    assert.equal(result.manifest.sha256, expectedHash);
    assert.equal(
      result.manifest.snapshotPath,
      `raw/${expectedHash}.test_condition_gene.txt`,
    );
    assert.equal(await readFile(result.snapshotPath, "utf8"), payload);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeSourceRoot, { recursive: true, force: true });
  }
});

test("the generic downloader preserves and validates an immutable CDC XML snapshot", async () => {
  const sourceId = `unit-cdc-xml-download-${randomUUID()}`;
  const runtimeSourceRoot = resolveWithinRuntime("sources", sourceId);
  const payload = await loadCdcFixture("test-directory.sample.xml");
  const expectedHash = createHash("sha256").update(payload).digest("hex");
  const xmlSource = {
    id: sourceId,
    publisherId: "cdc",
    url: cdcSourceUrl,
    allowedHosts: ["www.cdc.gov"],
    expectedContentTypes: ["text/xml", "application/xml"],
    timeoutMs: 5_000,
    maxDownloadBytes: 2_000_000,
  };
  const adapter = ACQUISITION_ADAPTERS["cdc-infectious-diseases-test-directory"];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(payload, {
    status: 200,
    headers: {
      "content-length": String(Buffer.byteLength(payload)),
      "content-type": "text/xml; charset=utf-8",
      "last-modified": "Mon, 03 Aug 2026 16:06:35 GMT",
    },
  });
  try {
    const result = await acquireSnapshot(xmlSource, {
      retries: 0,
      snapshotFileName: adapter.snapshotFileName,
      validateSnapshot: adapter.validateSnapshot,
    });
    assert.equal(result.manifest.sha256, expectedHash);
    assert.equal(result.manifest.snapshotPath, `raw/${expectedHash}.data.xml`);
    assert.equal(await readFile(result.snapshotPath, "utf8"), payload);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeSourceRoot, { recursive: true, force: true });
  }
});

test("the downloader rejects redirect escapes and deceptive gzip responses", async () => {
  const sourceId = `unit-reject-${randomUUID()}`;
  const runtimeSourceRoot = resolveWithinRuntime("sources", sourceId);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("redirect", {
      status: 302,
      headers: { location: "https://127.0.0.1/private" },
    });
    await assert.rejects(
      acquireGzipSnapshot(acquisitionSource(sourceId)),
      /Blocked acquisition host/,
    );

    globalThis.fetch = async () => new Response("<html>not gzip</html>", {
      status: 200,
      headers: { "content-type": "application/x-gzip" },
    });
    await assert.rejects(
      acquireGzipSnapshot(acquisitionSource(sourceId)),
      /magic mismatch/,
    );

    globalThis.fetch = async () => new Response("small", {
      status: 200,
      headers: {
        "content-length": "1001",
        "content-type": "application/x-gzip",
      },
    });
    const smallPolicy = { ...acquisitionSource(sourceId), maxDownloadBytes: 1_000 };
    await assert.rejects(acquireGzipSnapshot(smallPolicy), /exceeds policy limit/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeSourceRoot, { recursive: true, force: true });
  }
});

test("the CDC adapter stages deterministic source-listed candidates without publishing them", async () => {
  const originalXml = await loadCdcFixture("test-directory.sample.xml");
  const reorderedXml = await loadCdcFixture("test-directory.reordered.xml");
  const fixture = await createCdcTestDirectoryFixture(originalXml);
  const canonicalCatalogPath = resolve(
    projectRoot,
    "features",
    "assayindex",
    "data",
    "published",
    "catalog.json",
  );
  const canonicalBefore = await readFile(canonicalCatalogPath, "utf8");

  try {
    const first = await stageCdcTestDirectory(
      fixture.snapshotPath,
      fixture.manifest,
      fixture.source,
    );
    const firstArtifact = await readFile(first.path, "utf8");
    const firstEnvelope = JSON.parse(firstArtifact);

    assert.equal(first.candidateCount, 2);
    assert.equal(first.reviewRequiredCandidateCount, 2);
    assert.equal(first.issueCount, 0);
    assert.equal(firstEnvelope.adapterVersion, "1.1.0");
    assert.equal(firstEnvelope.sourceId, fixture.source.id);
    assert.equal(firstEnvelope.publisherId, "cdc");
    assert.equal(firstEnvelope.snapshotSha256, fixture.manifest.sha256);
    assert.equal(firstEnvelope.sourceGeneratedAt, "2026-08-03T10:06:35");
    assert.equal(firstEnvelope.publicationStatus, "staged-only");
    assert.equal(firstEnvelope.ordering, "cdc-test-code");
    assert.equal(firstEnvelope.candidateCount, 2);
    assert.equal(firstEnvelope.reviewRequiredCandidateCount, 2);
    assert.equal(firstEnvelope.issueCount, 0);
    assert.deepEqual(firstEnvelope.issues, []);
    assert.deepEqual(
      firstEnvelope.candidates.map((candidate) => candidate.externalRecordId),
      ["CDC-10471", "CDC-10472"],
    );
    for (const candidate of firstEnvelope.candidates) {
      assert.equal(candidate.sourceId, fixture.source.id);
      assert.equal(candidate.publisherId, "cdc");
      assert.equal(candidate.snapshotSha256, fixture.manifest.sha256);
      assert.equal(candidate.publicationStatus, "staged-only");
      assert.equal(candidate.normalizedSha256, normalizedStagedHash(candidate));
    }

    await writeFile(fixture.snapshotPath, reorderedXml);
    const refreshedManifest = {
      ...fixture.manifest,
      retrievedAt: "2026-08-13T00:00:00.000Z",
    };
    const reordered = await stageCdcTestDirectory(
      fixture.snapshotPath,
      refreshedManifest,
      fixture.source,
    );
    const reorderedArtifact = await readFile(reordered.path, "utf8");
    const reorderedEnvelope = JSON.parse(reorderedArtifact);

    assert.notEqual(reorderedArtifact, firstArtifact);
    assert.equal(reorderedEnvelope.retrievedAt, refreshedManifest.retrievedAt);
    assert.deepEqual(reorderedEnvelope.candidates, firstEnvelope.candidates);
    assert.equal(await readFile(canonicalCatalogPath, "utf8"), canonicalBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the CDC adapter cleans up partial staging after schema, value, size, and count gates", async (t) => {
  const valid = await loadCdcFixture("test-directory.sample.xml");
  const cases = [
    {
      name: "schema drift",
      payload: await loadCdcFixture("test-directory.schema-drift.xml"),
      sourceOverrides: {},
      options: {},
      expected: /schema drift|schema_drift|staging issue gate/i,
    },
    {
      name: "duplicate source identity",
      payload: valid.replace(
        "<CDCTestCode>CDC-10472</CDCTestCode>",
        "<CDCTestCode>CDC-10471</CDCTestCode>",
      ),
      sourceOverrides: {},
      options: {},
      expected: /duplicate_id|staging issue gate/i,
    },
    {
      name: "invalid source enum",
      payload: valid.replace("<CLIA>Y</CLIA>", "<CLIA>MAYBE</CLIA>"),
      sourceOverrides: {},
      options: {},
      expected: /invalid_value|staging issue gate/i,
    },
    {
      name: "expanded byte limit",
      payload: valid,
      sourceOverrides: { maxExpandedBytes: 32 },
      options: {},
      expected: /exceeded 32 byte limit/i,
    },
    {
      name: "minimum candidate count",
      payload: valid,
      sourceOverrides: { minimumCandidateCount: 3 },
      options: {},
      expected: /candidate count gate failed/i,
    },
    {
      name: "candidate count retention",
      payload: valid,
      sourceOverrides: {},
      options: { previousRecordCount: 3 },
      expected: /candidate count regression gate failed/i,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fixture = await createCdcTestDirectoryFixture(
        testCase.payload,
        testCase.sourceOverrides,
      );
      try {
        await assert.rejects(
          stageCdcTestDirectory(
            fixture.snapshotPath,
            fixture.manifest,
            fixture.source,
            testCase.options,
          ),
          testCase.expected,
        );
        await assertNoStagedArtifacts(fixture.source.id);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("the condition/gene adapter stages live-header records deterministically", async () => {
  const originalTsv = await readFile(
    resolve(testDirectory, "fixtures/acquisition/gtr/test-condition-gene.sample.tsv"),
    "utf8",
  );
  const reorderedTsv = await readFile(
    resolve(testDirectory, "fixtures/acquisition/gtr/test-condition-gene.reordered.tsv"),
    "utf8",
  );
  const fixture = await createGtrConditionGeneFixture(originalTsv);
  try {
    const first = await stageGtrConditionGene(
      fixture.snapshotPath,
      fixture.manifest,
      fixture.source,
    );
    const firstArtifact = await readFile(first.path, "utf8");
    const firstEnvelope = JSON.parse(firstArtifact);
    assert.equal(first.recordCount, 2);
    assert.equal(firstEnvelope.publicationStatus, "staged-only");
    assert.deepEqual(firstEnvelope.records.map((record) => record.accessionVersion), [
      "GTR000004036.6",
      "GTR000004528.1",
    ]);
    assert.deepEqual(firstEnvelope.records[0].conditionIds, [
      "C0016667",
      "C1839780",
      "C4552079",
    ]);
    assert.deepEqual(firstEnvelope.records[0].geneIds, ["2332"]);
    assert.equal(firstEnvelope.records[0].genes[0].medGenId, "C1414649");
    assert.equal(firstEnvelope.records[0].genes[0].ncbiGeneId, "2332");
    assert.match(firstEnvelope.records[0].normalizedSha256, /^[a-f0-9]{64}$/);

    await writeFile(fixture.snapshotPath, reorderedTsv);
    const refreshedManifest = {
      ...fixture.manifest,
      retrievedAt: "2026-08-13T00:00:00.000Z",
    };
    const reordered = await stageGtrConditionGene(
      fixture.snapshotPath,
      refreshedManifest,
      fixture.source,
    );
    const reorderedArtifact = await readFile(reordered.path, "utf8");
    const reorderedEnvelope = JSON.parse(reorderedArtifact);
    assert.notEqual(reorderedArtifact, firstArtifact);
    assert.equal(reorderedEnvelope.retrievedAt, refreshedManifest.retrievedAt);
    assert.deepEqual(reorderedEnvelope.records, firstEnvelope.records);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the condition/gene adapter cleans up after schema, size, and count gates", async (t) => {
  await t.test("schema drift", async () => {
    const raw = await readFile(
      resolve(testDirectory, "fixtures/acquisition/gtr/test-condition-gene.schema-drift.tsv"),
      "utf8",
    );
    const fixture = await createGtrConditionGeneFixture(raw);
    const stagedPath = resolveWithinRuntime(
      "sources",
      fixture.source.id,
      "staged",
      `${fixture.manifest.sha256}.records.json`,
    );
    try {
      await assert.rejects(
        stageGtrConditionGene(fixture.snapshotPath, fixture.manifest, fixture.source),
        /schema drift.*accession_version/,
      );
      assert.equal(await readJsonIfPresent(stagedPath), null);
      await assertNoStagedArtifacts(fixture.source.id);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("expanded byte limit", async () => {
    const fixture = await createGtrConditionGeneFixture(conditionGeneEnrichmentTsv(), {
      maxExpandedBytes: 32,
    });
    const stagedPath = resolveWithinRuntime(
      "sources",
      fixture.source.id,
      "staged",
      `${fixture.manifest.sha256}.records.json`,
    );
    try {
      await assert.rejects(
        stageGtrConditionGene(fixture.snapshotPath, fixture.manifest, fixture.source),
        /exceeded 32 byte limit/,
      );
      assert.equal(await readJsonIfPresent(stagedPath), null);
      await assertNoStagedArtifacts(fixture.source.id);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("record count regression", async () => {
    const fixture = await createGtrConditionGeneFixture(conditionGeneEnrichmentTsv());
    const stagedPath = resolveWithinRuntime(
      "sources",
      fixture.source.id,
      "staged",
      `${fixture.manifest.sha256}.records.json`,
    );
    try {
      await assert.rejects(
        stageGtrConditionGene(
          fixture.snapshotPath,
          fixture.manifest,
          fixture.source,
          { previousRecordCount: 3 },
        ),
        /record count regression gate failed/,
      );
      assert.equal(await readJsonIfPresent(stagedPath), null);
      await assertNoStagedArtifacts(fixture.source.id);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("the GTR adapter stages an arbitrary provider without publishing it", async () => {
  const header = [
    "test_accession_ver",
    "name_of_laboratory",
    "name_of_institution",
    "facility_country",
    "lab_id",
    "lab_test_name",
    "genes",
    "methods",
    "now_current",
    "test_currStat",
    "test_pubStat",
  ].join("\t");
  const row = [
    "GTR000123456.1",
    '"Mountain University Molecular Laboratory"',
    '"Mountain University Hospital"',
    '"United States"',
    "506123",
    '"Inherited disease panel"',
    '"BRCA2|BRCA1|BRCA1"',
    '"Sequence analysis|Deletion/duplication analysis"',
    "1",
    "1",
    "3",
  ].join("\t");
  const historicalRow = [
    "GTR000123456.0",
    '"Mountain University Molecular Laboratory"',
    '"Mountain University Hospital"',
    '"United States"',
    "506123",
    '"Historical disease panel"',
    '"BRCA1"',
    '"Sequence analysis"',
    "0",
    "1",
    "3",
  ].join("\t");
  const fixture = await createGtrFixture(`${header}\n${historicalRow}\n${row}\n`);
  try {
    const result = await stageGtrTestVersion(
      fixture.snapshotPath,
      fixture.manifest,
      fixture.source,
    );
    const staged = JSON.parse(await readFile(result.path, "utf8"));
    assert.equal(result.candidateCount, 1);
    assert.equal(result.historicalRowCount, 1);
    assert.equal(staged.historicalRowCount, 1);
    assert.equal(staged.publicationStatus, "staged-only");
    assert.equal(staged.candidates[0].provider.laboratoryName, "Mountain University Molecular Laboratory");
    assert.equal(staged.candidates[0].provider.institutionName, "Mountain University Hospital");
    assert.equal(staged.candidates[0].publisherProviderId, "506123");
    assert.deepEqual(staged.candidates[0].offering.genes, ["BRCA1", "BRCA2"]);
    assert.deepEqual(staged.candidates[0].offering.methods, [
      "Deletion/duplication analysis",
      "Sequence analysis",
    ]);
    assert.equal(staged.candidates[0].candidateState, "discovered");
    assert.deepEqual(staged.candidates[0].reviewFlags, []);
    assert.match(staged.candidates[0].normalizedSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the GTR adapter rejects malformed rows instead of publishing a partial staged file", async () => {
  const header = [
    "test_accession_ver",
    "name_of_laboratory",
    "name_of_institution",
    "lab_id",
    "lab_test_name",
    "now_current",
    "test_currStat",
    "test_pubStat",
  ].join("\t");
  const fixture = await createGtrFixture(`${header}\nGTR000123456.1\tOnly two cells\n`);
  try {
    await assert.rejects(
      stageGtrTestVersion(fixture.snapshotPath, fixture.manifest, fixture.source),
      /staging issue gate failed.*invalid_column_count/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the GTR adapter rejects a material candidate-count regression", async () => {
  const header = [
    "test_accession_ver",
    "name_of_laboratory",
    "name_of_institution",
    "lab_id",
    "lab_test_name",
    "now_current",
    "test_currStat",
    "test_pubStat",
  ].join("\t");
  const row = [
    "GTR000123456.1",
    '"Mountain University Molecular Laboratory"',
    '"Mountain University Hospital"',
    "506123",
    '"Inherited disease panel"',
    "1",
    "1",
    "3",
  ].join("\t");
  const fixture = await createGtrFixture(`${header}\n${row}\n`);
  try {
    await assert.rejects(
      stageGtrTestVersion(fixture.snapshotPath, fixture.manifest, fixture.source, {
        previousCandidateCount: 2,
      }),
      /candidate count regression gate failed/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the GTR adapter rejects an implausibly small first snapshot", async () => {
  const header = [
    "test_accession_ver",
    "name_of_laboratory",
    "name_of_institution",
    "lab_id",
    "lab_test_name",
    "now_current",
    "test_currStat",
    "test_pubStat",
  ].join("\t");
  const row = [
    "GTR000123456.1",
    '"Mountain University Molecular Laboratory"',
    '"Mountain University Hospital"',
    "506123",
    '"Inherited disease panel"',
    "1",
    "1",
    "3",
  ].join("\t");
  const fixture = await createGtrFixture(`${header}\n${row}\n`);
  fixture.source.minimumCandidateCount = 2;
  try {
    await assert.rejects(
      stageGtrTestVersion(fixture.snapshotPath, fixture.manifest, fixture.source),
      /candidate count gate failed/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the GTR adapter preserves and flags deletion and unrecognized source status", async () => {
  const header = [
    "test_accession_ver",
    "name_of_laboratory",
    "name_of_institution",
    "lab_id",
    "lab_test_name",
    "now_current",
    "test_currStat",
    "test_pubStat",
    "test_deletion_date",
  ].join("\t");
  const row = [
    "GTR000551924.12",
    '"Specialty Molecular Laboratory"',
    '"Specialty Hospital"',
    "506124",
    '"Status review panel"',
    "1",
    "72",
    "3",
    "2024-10-17",
  ].join("\t");
  const fixture = await createGtrFixture(`${header}\n${row}\n`);
  try {
    const result = await stageGtrTestVersion(fixture.snapshotPath, fixture.manifest, fixture.source);
    const staged = JSON.parse(await readFile(result.path, "utf8"));
    assert.equal(result.reviewRequiredCandidateCount, 1);
    assert.equal(staged.candidates[0].sourceStatus.testCurrentStatus, "72");
    assert.equal(staged.candidates[0].sourceStatus.deletedAt, "2024-10-17");
    assert.equal(staged.candidates[0].candidateState, "discovered-review-required");
    assert.deepEqual(staged.candidates[0].reviewFlags, [
      "source_deleted",
      "unrecognized_test_current_status",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the GTR adapter fails loudly when required columns drift", async () => {
  const fixture = await createGtrFixture("test_accession_ver\tlab_id\nGTR000123456.1\t506123\n");
  try {
    await assert.rejects(
      stageGtrTestVersion(fixture.snapshotPath, fixture.manifest, fixture.source),
      /GTR schema drift/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the GTR adapter enforces its expanded byte limit", async () => {
  const header = [
    "test_accession_ver",
    "name_of_laboratory",
    "name_of_institution",
    "lab_id",
    "lab_test_name",
    "now_current",
    "test_currStat",
    "test_pubStat",
  ].join("\t");
  const oversizedRow = [
    "GTR000123456.1",
    '"Mountain University Molecular Laboratory"',
    '"Mountain University Hospital"',
    "506123",
    `"${"x".repeat(1_000)}"`,
    "1",
    "1",
    "3",
  ].join("\t");
  const fixture = await createGtrFixture(`${header}\n${oversizedRow}\n`);
  fixture.source.maxExpandedBytes = 100;
  try {
    await assert.rejects(
      stageGtrTestVersion(fixture.snapshotPath, fixture.manifest, fixture.source),
      /Expanded GTR data exceeded/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
