import { describe, expect, it } from "vitest";

import { projectPublicCatalog } from "@/features/assayindex/data/public-catalog";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import {
  createCoOrderRelationship,
  createCuratedRelationship,
} from "@/tests/assayindex/fixtures/relationships";

describe("public catalog projection", () => {
  it("excludes draft assays, their records, and draft records under published assays", () => {
    const catalog = structuredClone(publishedCatalog);
    const draftAssay = catalog.assays[0];
    const draftRecord = catalog.assayLabRecords.find(
      (record) => record.assaySlug !== draftAssay.slug,
    );

    expect(draftRecord).toBeDefined();

    draftAssay.status = "draft";
    draftRecord!.publicationStatus = "draft";

    const publicCatalog = projectPublicCatalog(catalog);
    const publicAssayIds = new Set(publicCatalog.assays.map((assay) => assay.slug));

    expect(publicAssayIds.has(draftAssay.slug)).toBe(false);
    expect(publicCatalog.assayLabRecords.some((record) => record.assaySlug === draftAssay.slug)).toBe(
      false,
    );
    expect(publicCatalog.assayLabRecords.some((record) => record.id === draftRecord!.id)).toBe(false);
    expect(publicCatalog.assays.every((assay) => assay.status === "published")).toBe(true);
    expect(
      publicCatalog.assayLabRecords.every(
        (record) => record.publicationStatus === "published" && publicAssayIds.has(record.assaySlug),
      ),
    ).toBe(true);
  });

  it("keeps only public record links while retaining record-independent assay sources", () => {
    const catalog = structuredClone(publishedCatalog);
    const publishedRecord = catalog.assayLabRecords[0];
    const sourceTemplate = catalog.sourceDocuments.find(
      (source) =>
        source.assaySlug === publishedRecord.assaySlug &&
        source.labId === publishedRecord.labId,
    );

    expect(sourceTemplate).toBeDefined();

    const draftRecord = {
      ...structuredClone(publishedRecord),
      id: `${publishedRecord.id}-draft-review`,
      publicationStatus: "draft" as const,
    };
    catalog.assayLabRecords.push(draftRecord);
    catalog.sourceDocuments.push(
      {
        ...structuredClone(sourceTemplate!),
        id: "source-draft-record-only",
        relatedRecordIds: [draftRecord.id],
      },
      {
        ...structuredClone(sourceTemplate!),
        id: "source-mixed-public-and-draft-records",
        relatedRecordIds: [publishedRecord.id, draftRecord.id],
      },
      {
        ...structuredClone(sourceTemplate!),
        id: "source-assay-level-reference",
        relatedRecordIds: [],
      },
    );

    const result = projectPublicCatalog(catalog);
    const sourcesById = new Map(result.sourceDocuments.map((source) => [source.id, source]));

    expect(sourcesById.has("source-draft-record-only")).toBe(false);
    expect(sourcesById.get("source-mixed-public-and-draft-records")?.relatedRecordIds).toEqual([
      publishedRecord.id,
    ]);
    expect(sourcesById.get("source-assay-level-reference")?.relatedRecordIds).toEqual([]);
  });

  it("publishes only published relationships whose two assay endpoints are public", () => {
    const catalog = structuredClone(publishedCatalog) as typeof publishedCatalog & {
      curatedAssayRelationships: Array<ReturnType<typeof createCuratedRelationship>>;
      coOrderRelationships: Array<ReturnType<typeof createCoOrderRelationship>>;
    };
    const hiddenAssaySlug = "factor-v-leiden-r506q";
    catalog.assays.find((assay) => assay.slug === hiddenAssaySlug)!.status = "draft";
    catalog.curatedAssayRelationships = [
      createCuratedRelationship({ id: "curated-public" }),
      createCuratedRelationship({ id: "curated-draft", publicationStatus: "draft" }),
      createCuratedRelationship({
        id: "curated-hidden-endpoint",
        targetAssaySlug: hiddenAssaySlug,
      }),
    ];
    catalog.coOrderRelationships = [
      createCoOrderRelationship({ id: "co-order-public" }),
      createCoOrderRelationship({ id: "co-order-draft", publicationStatus: "draft" }),
      createCoOrderRelationship({
        id: "co-order-hidden-endpoint",
        rightAssaySlug: hiddenAssaySlug,
      }),
    ];

    const publicCatalog = projectPublicCatalog(catalog);

    expect(publicCatalog.curatedAssayRelationships.map((relationship) => relationship.id)).toEqual([
      "curated-public",
    ]);
    expect(publicCatalog.coOrderRelationships.map((relationship) => relationship.id)).toEqual([
      "co-order-public",
    ]);
  });
});
