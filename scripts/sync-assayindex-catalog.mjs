import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const targetPath = resolve(projectRoot, "public/assayindex/catalog.json");
const generatedCatalogPath = resolve(projectRoot, "public/assayindex/downloads/catalog.json");

export function syncAssayIndexCatalog() {
  mkdirSync(dirname(targetPath), { recursive: true });
  execFileSync(process.execPath, [resolve(scriptDirectory, "generate-assayindex-downloads.mjs")], {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  copyFileSync(generatedCatalogPath, targetPath);

  const result = { generatedCatalogPath, targetPath };
  console.log(`Synced AssayIndex catalog snapshot to ${targetPath}`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    syncAssayIndexCatalog();
  } catch (error) {
    console.error(`AssayIndex catalog sync failed: ${error.message}`);
    process.exitCode = 1;
  }
}
