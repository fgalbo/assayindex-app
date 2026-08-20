import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { put } from "@vercel/blob";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const sourcePath = resolve(projectRoot, "public/assayindex/catalog.json");
const manifestPath = resolve(projectRoot, "public/assayindex/downloads/manifest.json");
const blobPath = process.env.ASSAYINDEX_BLOB_PATH?.trim() || "assayindex/catalog.json";
const cacheControlMaxAge = Math.max(
  Number.parseInt(process.env.ASSAYINDEX_BLOB_CACHE_MAX_AGE ?? "60", 10) || 60,
  60,
);
const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

if (!token) {
  throw new Error("BLOB_READ_WRITE_TOKEN is required to publish the AssayIndex catalog snapshot.");
}

execFileSync(process.execPath, [resolve(scriptDirectory, "sync-assayindex-catalog.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true,
});

const catalogJson = readFileSync(sourcePath, "utf8");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const catalogManifestEntry = manifest.files?.find((entry) => entry.path === "catalog.json");
const catalogHash = createHash("sha256").update(catalogJson).digest("hex");

if (!catalogManifestEntry || catalogManifestEntry.sha256 !== catalogHash) {
  throw new Error("Generated AssayIndex catalog does not match its release manifest.");
}

const result = await put(blobPath, catalogJson, {
  access: "public",
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge,
  contentType: "application/json; charset=utf-8",
  token,
});

console.log(`Published AssayIndex catalog snapshot to ${result.url}`);
console.log(`Set NEXT_PUBLIC_ASSAYINDEX_CATALOG_URL=${result.url}`);
