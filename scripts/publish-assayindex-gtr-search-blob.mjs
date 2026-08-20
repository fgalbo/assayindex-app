import { createReadStream } from "node:fs";

import { put } from "@vercel/blob";

import { buildGtrTestingSearchIndex } from "./assayindex/gtr-testing-search-index.mjs";

const token = process.env.ASSAYINDEX_GTR_READ_WRITE_TOKEN?.trim();
if (!token) {
  throw new Error("ASSAYINDEX_GTR_READ_WRITE_TOKEN is required to publish the private GTR testing index.");
}

const generated = await buildGtrTestingSearchIndex();
const blobPath = `assayindex/testing/gtr/${generated.manifest.compressedSha256}.sqlite.gz`;
const manifestBlobPath = "assayindex/testing/gtr/latest.json";

const result = await put(blobPath, createReadStream(generated.compressedPath), {
  access: "private",
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 31_536_000,
  contentType: "application/gzip",
  multipart: true,
  token,
});

if (result.pathname !== blobPath) {
  throw new Error("Private GTR testing index was published to an unexpected Blob pathname.");
}

const remoteManifest = {
  ...generated.manifest,
  databasePath: undefined,
  compressedPath: undefined,
  blobPath,
};
const manifestResult = await put(manifestBlobPath, JSON.stringify(remoteManifest), {
  access: "private",
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 60,
  contentType: "application/json; charset=utf-8",
  token,
});
if (manifestResult.pathname !== manifestBlobPath) {
  throw new Error("Private GTR testing manifest was published to an unexpected Blob pathname.");
}

console.log(JSON.stringify({
  blobPath,
  manifestBlobPath,
  databaseSha256: generated.manifest.databaseSha256,
  compressedSha256: generated.manifest.compressedSha256,
  databaseBytes: generated.manifest.databaseBytes,
  compressedBytes: generated.manifest.compressedBytes,
  candidateCount: generated.manifest.candidateCount,
  reviewRequiredCandidateCount: generated.manifest.reviewRequiredCandidateCount,
}, null, 2));
