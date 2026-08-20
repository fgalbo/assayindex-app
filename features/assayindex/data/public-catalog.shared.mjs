export function projectPublicCatalogData(catalog) {
  const assays = catalog.assays.filter((assay) => assay.status === "published");
  const assayIds = new Set(assays.map((assay) => assay.slug));
  const assayLabRecords = catalog.assayLabRecords.filter(
    (record) => record.publicationStatus === "published" && assayIds.has(record.assaySlug),
  );
  const catalogLabIds = new Set(catalog.labs.map((lab) => lab.id));
  const sourceOfferings = (catalog.sourceOfferings ?? [])
    .filter(
      (offering) =>
        offering.publicationStatus === "published" && catalogLabIds.has(offering.labId),
    )
    .map((offering) =>
      offering.assaySlug !== null && !assayIds.has(offering.assaySlug)
        ? { ...offering, assaySlug: null }
        : offering,
    );
  const recordIds = new Set(assayLabRecords.map((record) => record.id));
  const sourceDocuments = catalog.sourceDocuments.flatMap((source) => {
    if (!assayIds.has(source.assaySlug)) {
      return [];
    }

    const relatedRecordIds = source.relatedRecordIds.filter((recordId) => recordIds.has(recordId));
    if (source.relatedRecordIds.length > 0 && relatedRecordIds.length === 0) {
      return [];
    }

    return [{ ...source, relatedRecordIds }];
  });
  const labIds = new Set([
    ...assayLabRecords.map((record) => record.labId),
    ...sourceOfferings.map((offering) => offering.labId),
    ...sourceDocuments.map((source) => source.labId),
  ]);
  const labs = catalog.labs.filter((lab) => labIds.has(lab.id));
  const assayLevelCodes = catalog.assayLevelCodes.filter((code) => assayIds.has(code.assaySlug));
  const curatedAssayRelationships = (catalog.curatedAssayRelationships ?? []).filter(
    (relationship) =>
      relationship.publicationStatus === "published" &&
      assayIds.has(relationship.sourceAssaySlug) &&
      assayIds.has(relationship.targetAssaySlug),
  );
  const coOrderRelationships = (catalog.coOrderRelationships ?? []).filter(
    (relationship) =>
      relationship.publicationStatus === "published" &&
      assayIds.has(relationship.leftAssaySlug) &&
      assayIds.has(relationship.rightAssaySlug),
  );

  return {
    ...catalog,
    assays,
    labs,
    assayLabRecords,
    sourceOfferings,
    sourceDocuments,
    assayLevelCodes,
    curatedAssayRelationships,
    coOrderRelationships,
  };
}
