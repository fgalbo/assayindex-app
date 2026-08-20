import { pathToFileURL } from "node:url";

import { buildGtrTestingSearchIndex } from "./assayindex/gtr-testing-search-index.mjs";

export async function generateAssayIndexGtrTestingSearch() {
  return buildGtrTestingSearchIndex();
}

function isMainModule() {
  return process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = await generateAssayIndexGtrTestingSearch();
  console.log(JSON.stringify({
    databasePath: result.databasePath,
    compressedPath: result.compressedPath,
    manifestPath: result.manifestPath,
    databaseSha256: result.manifest.databaseSha256,
    databaseBytes: result.manifest.databaseBytes,
    compressedBytes: result.manifest.compressedBytes,
    candidateCount: result.manifest.candidateCount,
    reviewRequiredCandidateCount: result.manifest.reviewRequiredCandidateCount,
  }, null, 2));
}
