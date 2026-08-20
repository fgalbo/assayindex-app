import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { projectPublicCatalogData } from "../features/assayindex/data/public-catalog.shared.mjs";
import { mergeSourceOfferingSlices } from "../features/assayindex/data/source-offering-slices.shared.mjs";
import {
  buildReleaseBundle,
  deriveContributingSourcePublisherIds,
  sha256,
} from "../features/assayindex/acquisition/release.ts";
import {
  canRedistributeSource,
  parseSourceRegistry,
} from "../features/assayindex/acquisition/source-policy.ts";
import { parseCatalog } from "../features/assayindex/schema/catalog.ts";
import { buildRecordsCsv, buildSourceOfferingsCsv } from "./assayindex/download-csv.mjs";
import {
  requireSourcePromotionAdapter,
  SOURCE_PROMOTION_ADAPTERS,
} from "./promote-assayindex-source.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const catalogPath = resolve(projectRoot, "features/assayindex/data/published/catalog.json");
const publicRoot = resolve(projectRoot, "public/assayindex/downloads");
const releasePath = resolve(projectRoot, "features/assayindex/data/published/release.json");
const sourceRegistryPath = resolve(projectRoot, "features/assayindex/acquisition/source-registry.json");
const publishedSlicesModulePath = resolve(
  projectRoot,
  "features/assayindex/data/published/source-offering-slices.generated.ts",
);
const publishedSlicesRoot = resolve(
  projectRoot,
  "features/assayindex/data/published/source-offering-slices",
);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resolvePublishedSlicePath(adapter) {
  if (
    typeof adapter.publishedSliceRelativePath !== "string" ||
    isAbsolute(adapter.publishedSliceRelativePath)
  ) {
    throw new Error(`Promotion adapter ${adapter.id} has an invalid published slice path.`);
  }
  const path = resolve(projectRoot, adapter.publishedSliceRelativePath);
  const relativeToSlicesRoot = relative(publishedSlicesRoot, path);
  if (
    !relativeToSlicesRoot ||
    relativeToSlicesRoot === ".." ||
    relativeToSlicesRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToSlicesRoot) ||
    extname(path).toLowerCase() !== ".json"
  ) {
    throw new Error(
      `Promotion adapter ${adapter.id} published slice must be a JSON file under ${publishedSlicesRoot}.`,
    );
  }
  return path;
}

const sourceRegistry = parseSourceRegistry(JSON.parse(readFileSync(sourceRegistryPath, "utf8")));
for (const source of sourceRegistry.sources) {
  if (source.enabled && canRedistributeSource(source).allowed && !source.promotionAdapterId) {
    throw new Error(`Release-approved enabled source ${source.id} has no promotionAdapterId.`);
  }
}
const releasablePromotionSources = sourceRegistry.sources
  .filter((source) => source.promotionAdapterId && canRedistributeSource(source).allowed)
  .toSorted((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
const sourceOfferingSliceEntries = releasablePromotionSources.map((source) => {
  const adapter = requireSourcePromotionAdapter(source);
  return {
    path: resolvePublishedSlicePath(adapter),
    relativePath: adapter.publishedSliceRelativePath.replaceAll("\\", "/"),
    source,
  };
});
const activePromotionAdapterIds = new Set(
  sourceOfferingSliceEntries.map(({ source }) => source.promotionAdapterId),
);
const inactivePublishedSlicePaths = Object.values(SOURCE_PROMOTION_ADAPTERS)
  .filter((adapter) => !activePromotionAdapterIds.has(adapter.id))
  .map(resolvePublishedSlicePath)
  .toSorted();
const sourceOfferingSlices = sourceOfferingSliceEntries.map(({ path }) =>
  JSON.parse(readFileSync(path, "utf8")),
);
const generatedSlicesModule = [
  ...sourceOfferingSliceEntries.map(
    ({ relativePath }, index) =>
      `import sourceOfferingSlice${index + 1} from "@/${relativePath}";`,
  ),
  "",
  `export const publishedSourceOfferingSlices = [${sourceOfferingSliceEntries
    .map((_, index) => `sourceOfferingSlice${index + 1}`)
    .join(", ")}];`,
  "",
].join("\n");
const catalog = parseCatalog(
  mergeSourceOfferingSlices(
    parseCatalog(JSON.parse(readFileSync(catalogPath, "utf8"))),
    sourceOfferingSlices,
  ),
);
const publicCatalog = projectPublicCatalogData(catalog);

const catalogJson = stableJson(publicCatalog);
const provenance = publicCatalog.assayLabRecords.flatMap((record) =>
  record.sourceLinks.map((source, index) => ({
    recordId: record.id,
    sourceId: `${record.id}:source:${index + 1}`,
    sourceUrl: source.url,
    sourceLabel: source.label,
    sourceType: source.sourceType,
    sourceVerifiedAt: record.sourceVerifiedAt,
  })),
);
const recordsCsv = buildRecordsCsv(publicCatalog);
const contributingSourcePublisherIds = deriveContributingSourcePublisherIds(publicCatalog);
const referenceLaboratoryIds = [
  ...new Set([
    ...publicCatalog.assayLabRecords.map((record) => record.labId),
    ...publicCatalog.sourceDocuments.map((source) => source.labId),
    ...(publicCatalog.sourceOfferings ?? []).map((offering) => offering.labId),
  ]),
].toSorted();
const sourceReleaseDecisions = contributingSourcePublisherIds.map((sourcePublisherId) => ({
  sourcePublisherId,
  approved: sourceRegistry.sources.some(
    (source) => source.publisherId === sourcePublisherId && canRedistributeSource(source).allowed,
  ),
}));
const contributingAcquisitionSourceIds = [
  ...new Set((publicCatalog.sourceOfferings ?? []).map((offering) => offering.sourceId)),
].toSorted();
const sourceAttributionEntries = sourceRegistry.sources
  .filter(
    (source) =>
      contributingAcquisitionSourceIds.includes(source.id) ||
      contributingSourcePublisherIds.includes(source.publisherId),
  )
  .filter(
    (source, index, sources) =>
      sources.findIndex((candidate) => candidate.id === source.id) === index,
  )
  .map((source) => ({
    sourceId: source.id,
    sourcePublisherId: source.publisherId,
    datasetName: source.datasetName,
    requiredAttribution: source.requiredAttribution,
    requiredAttributionUrl: source.requiredAttributionUrl,
    policyUrl: source.policyUrl,
    disclaimer: source.disclaimer,
  }));
const sourceAttributionById = Object.fromEntries(
  sourceAttributionEntries.map((entry) => [entry.sourceId, entry]),
);
const sourceOfferingsCsv = buildSourceOfferingsCsv(publicCatalog, sourceAttributionById);
const sourceAttributionJson = stableJson({
  schemaVersion: "1",
  catalogVersion: publicCatalog.meta.version,
  generatedAt: publicCatalog.meta.lastPublishedAt,
  sources: sourceAttributionEntries,
});
const acquisitionSourceReleaseDecisions = contributingAcquisitionSourceIds.map((sourceId) => ({
  sourceId,
  approved: sourceRegistry.sources.some(
    (source) => source.id === sourceId && canRedistributeSource(source).allowed,
  ),
}));
const bundle = buildReleaseBundle({
  candidate: {
    catalog: publicCatalog,
    provenance,
    reviewed: true,
    sourceComplete: true,
    validationIssues: [],
    contributingSourcePublisherIds,
    sourceReleaseDecisions,
    acquisitionSourceReleaseDecisions,
  },
  sources: publicCatalog.sourceDocuments,
  generatedAt: publicCatalog.meta.lastPublishedAt,
  additionalFiles: {
    "assay-lab-records.csv": recordsCsv,
    "source-offerings.csv": sourceOfferingsCsv,
    "SOURCE-ATTRIBUTION.json": sourceAttributionJson,
  },
  manifestExtensions: {
    publishedAt: publicCatalog.meta.lastPublishedAt,
    generatedFrom: [
      "features/assayindex/data/published/catalog.json",
      ...sourceOfferingSliceEntries.map(({ relativePath }) => relativePath),
    ],
    contributingSourcePublishers: contributingSourcePublisherIds,
    contributingAcquisitionSources: contributingAcquisitionSourceIds,
    contributingAttributionSources: sourceAttributionEntries.map((entry) => entry.sourceId),
    contributingReferenceLaboratories: referenceLaboratoryIds,
  },
});
const filesWithManifest = Object.fromEntries(
  Object.entries(bundle.files).filter(([path]) => path !== "SHA256SUMS.txt"),
);
const checksums = bundle.files["SHA256SUMS.txt"];
const releaseBundle = stableJson({ manifest: bundle.manifest, files: filesWithManifest });

const downloads = [
  ["catalog", "Catalog JSON", "catalog.json", catalogJson],
  ["records-csv", "Lab records CSV", "assay-lab-records.csv", recordsCsv],
  ["source-offerings-csv", "Source offerings CSV", "source-offerings.csv", sourceOfferingsCsv],
  ["source-attribution", "Source attribution", "SOURCE-ATTRIBUTION.json", sourceAttributionJson],
  ["bundle", "Provenance bundle", "release-bundle.json", releaseBundle],
  ["checksums", "SHA-256 checksums", "SHA256SUMS.txt", checksums],
].map(([id, label, fileName, content]) => ({
  id,
  label,
  href: `/assayindex/downloads/${fileName}`,
  sha256: sha256(content),
  bytes: Buffer.byteLength(content),
}));

const release = {
  catalogVersion: publicCatalog.meta.version,
  generatedAt: publicCatalog.meta.lastPublishedAt,
  downloads,
  manifest: {
    contributingSourcePublishers: contributingSourcePublisherIds,
    contributingAcquisitionSources: contributingAcquisitionSourceIds,
    contributingReferenceLaboratories: referenceLaboratoryIds,
  },
  sourceAttributions: sourceAttributionEntries,
  sourcePublishers: contributingSourcePublisherIds.map((sourcePublisherId) => {
    const source = sourceRegistry.sources.find((entry) => entry.publisherId === sourcePublisherId);
    return {
      sourcePublisherId,
      label: source?.requiredAttribution ?? source?.publisherName ?? sourcePublisherId,
      href: source?.requiredAttributionUrl ?? source?.policyUrl ?? source?.url ?? null,
      notice: source?.disclaimer ?? "Source attribution for a contributing data publisher.",
    };
  }),
  referenceLaboratories: publicCatalog.labs
    .filter((lab) => referenceLaboratoryIds.includes(lab.id) && lab.website)
    .map((lab) => ({
      referenceLaboratoryId: lab.id,
      label: lab.displayName,
      href: lab.website,
      notice: "Source attribution for a contributing reference laboratory.",
    })),
};
const releaseJson = stableJson(release);

for (const inactiveSlicePath of inactivePublishedSlicePaths) {
  rmSync(inactiveSlicePath, { force: true });
}
writeFileSync(publishedSlicesModulePath, generatedSlicesModule, "utf8");
mkdirSync(publicRoot, { recursive: true });
for (const [fileName, content] of Object.entries(filesWithManifest)) {
  writeFileSync(resolve(publicRoot, fileName), content, "utf8");
}
writeFileSync(resolve(publicRoot, "SHA256SUMS.txt"), checksums, "utf8");
writeFileSync(resolve(publicRoot, "release-bundle.json"), releaseBundle, "utf8");
writeFileSync(releasePath, releaseJson, "utf8");

console.log(`Generated AssayIndex ${publicCatalog.meta.version} downloads in ${publicRoot}`);
