import { rm } from "node:fs/promises";
import { basename } from "node:path";
import {
  hashFileBounded,
  readJsonIfPresent,
  replaceFileAtomic,
  resolveWithinRuntime,
  streamToHashedTemporaryFile,
  writeJsonAtomic,
} from "./runtime.mjs";
import { validateExpectedPayload } from "./payload-validation.mjs";

const MAX_REDIRECTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function assertAllowedUrl(value, source) {
  const url = value instanceof URL ? value : new URL(value);
  const configured = new URL(source.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error(`Blocked unsafe acquisition URL: ${url.origin}`);
  }
  if (!source.allowedHosts.includes(url.hostname)) {
    throw new Error(`Blocked acquisition host: ${url.hostname}`);
  }
  if (url.hostname !== configured.hostname || url.pathname !== configured.pathname || url.search) {
    throw new Error(`Blocked acquisition path outside source policy: ${url.pathname}${url.search}`);
  }
  return url;
}

export function contentTypeAllowed(response, source) {
  const actual = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return Boolean(actual && source.expectedContentTypes.some((expected) => expected.toLowerCase() === actual));
}

async function fetchWithValidatedRedirects(url, source, headers, signal) {
  let current = assertAllowedUrl(url, source);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current, {
      headers,
      redirect: "manual",
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) {
      await response.body?.cancel();
      throw new Error("Source returned an invalid or excessive redirect chain.");
    }
    await response.body?.cancel();
    current = assertAllowedUrl(new URL(location, current), source);
  }
  throw new Error("Redirect validation failed.");
}

async function fetchWithRetry(url, source, headers, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithValidatedRedirects(
        url,
        source,
        headers,
        AbortSignal.timeout(source.timeoutMs),
      );
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) return response;
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

function safeSnapshotFileName(source, configuredName) {
  const fileName = configuredName || basename(new URL(source.url).pathname);
  if (
    !fileName ||
    fileName.length > 160 ||
    fileName === "." ||
    fileName === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)
  ) {
    throw new Error(`Unsafe acquisition snapshot file name: ${fileName || "<missing>"}`);
  }
  return fileName;
}

export async function acquireSnapshot(
  source,
  { retries = 2, snapshotFileName: configuredName, validateSnapshot = validateExpectedPayload } = {},
) {
  const snapshotFileName = safeSnapshotFileName(source, configuredName);
  if (typeof validateSnapshot !== "function") throw new Error("Snapshot validator must be a function.");
  const latestManifestPath = resolveWithinRuntime("sources", source.id, "latest.json");
  const previous = await readJsonIfPresent(latestManifestPath);
  const headers = {
    Accept: source.expectedContentTypes.join(", "),
    "User-Agent": "AssayIndex-acquisition/1.0 (+https://filippogalbo.com/assayindex)",
  };
  if (previous?.etag) headers["If-None-Match"] = previous.etag;
  if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;

  const response = await fetchWithRetry(source.url, source, headers, retries);
  if (response.status === 304) {
    await response.body?.cancel();
    if (!previous?.snapshotPath) throw new Error("Source returned 304 without a previous snapshot manifest.");
    if (
      previous.schemaVersion !== "1" ||
      previous.sourceId !== source.id ||
      previous.sourceUrl !== source.url ||
      !/^[a-f0-9]{64}$/.test(previous.sha256 ?? "") ||
      !Number.isInteger(previous.byteLength) ||
      previous.byteLength <= 0
    ) {
      throw new Error("Source returned 304 with an invalid cached snapshot manifest.");
    }
    const snapshotPath = snapshotPathForManifest(source.id, previous);
    const cached = await hashFileBounded(snapshotPath, source.maxDownloadBytes);
    if (cached.byteLength !== previous.byteLength) {
      throw new Error("Cached snapshot byte length does not match its manifest.");
    }
    if (cached.sha256 !== previous.sha256) {
      throw new Error("Cached snapshot SHA-256 does not match its manifest.");
    }
    await validateSnapshot(snapshotPath, source);
    return { manifest: previous, snapshotPath, unchanged: true };
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${source.id} acquisition failed with HTTP ${response.status}.`);
  }
  if (!contentTypeAllowed(response, source)) {
    await response.body.cancel();
    throw new Error(`Unexpected content type: ${response.headers.get("content-type") ?? "<missing>"}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > source.maxDownloadBytes) {
    await response.body.cancel();
    throw new Error(`Declared download size ${declaredLength} exceeds policy limit.`);
  }

  const provisional = resolveWithinRuntime("sources", source.id, `download.${snapshotFileName}`);
  const downloaded = await streamToHashedTemporaryFile(response.body, provisional, source.maxDownloadBytes);
  try {
    await validateSnapshot(downloaded.temporary, source);
    const snapshotName = `${downloaded.sha256}.${snapshotFileName}`;
    const snapshotPath = resolveWithinRuntime("sources", source.id, "raw", snapshotName);
    // A validated 200 response is authoritative even when a same-hash path already
    // exists. Replacing it repairs a corrupt local cache without changing its
    // content-addressed identity.
    await replaceFileAtomic(downloaded.temporary, snapshotPath);
    const retrievedAt = new Date().toISOString();
    const sourceUpdatedAt = response.headers.get("last-modified")
      ? new Date(response.headers.get("last-modified")).toISOString()
      : null;
    const manifest = {
      schemaVersion: "1",
      sourceId: source.id,
      publisherId: source.publisherId,
      sourceUrl: source.url,
      retrievedAt,
      sourceUpdatedAt,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      contentType: response.headers.get("content-type"),
      byteLength: downloaded.byteLength,
      sha256: downloaded.sha256,
      snapshotPath: `raw/${snapshotName}`,
      publicationStatus: "staged-only",
    };
    const immutableManifest = resolveWithinRuntime("sources", source.id, "manifests", `${downloaded.sha256}.json`);
    if (!(await readJsonIfPresent(immutableManifest))) await writeJsonAtomic(immutableManifest, manifest);
    await writeJsonAtomic(latestManifestPath, manifest);
    return { manifest, snapshotPath, unchanged: previous?.sha256 === manifest.sha256 };
  } catch (error) {
    await rm(downloaded.temporary, { force: true });
    throw error;
  }
}

export function snapshotPathForManifest(sourceId, manifest) {
  const match = manifest.snapshotPath?.match(
    /^raw\/([a-f0-9]{64})\.[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/,
  );
  if (!match || match[1] !== manifest.sha256) {
    throw new Error("Snapshot manifest contains an invalid relative path.");
  }
  return resolveWithinRuntime("sources", sourceId, ...manifest.snapshotPath.split("/"));
}
