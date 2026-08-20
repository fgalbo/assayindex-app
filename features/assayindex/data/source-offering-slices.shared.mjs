function stableSort(values, selector) {
  return [...values].toSorted((left, right) => selector(left).localeCompare(selector(right)));
}

export function mergeSourceOfferingSlices(catalog, slices) {
  const next = structuredClone(catalog);
  const sourceIds = new Set();
  const labById = new Map(next.labs.map((lab) => [lab.id, lab]));
  const offeringById = new Map((next.sourceOfferings ?? []).map((offering) => [offering.id, offering]));
  const sourceKeyByOfferingId = new Map(
    (next.sourceOfferings ?? []).map((offering) => [offering.id, `${offering.sourceId}:${offering.externalRecordId}`]),
  );

  for (const slice of slices) {
    if (
      !slice ||
      slice.schemaVersion !== "1" ||
      !slice.source?.sourceId ||
      typeof slice.source.retrievedAt !== "string" ||
      !Number.isFinite(Date.parse(slice.source.retrievedAt))
    ) {
      throw new Error("AssayIndex source-offering slice has an unsupported schema.");
    }
    if (sourceIds.has(slice.source.sourceId)) {
      throw new Error(`Duplicate source-offering slice: ${slice.source.sourceId}`);
    }
    sourceIds.add(slice.source.sourceId);
    if (Date.parse(slice.source.retrievedAt) > Date.parse(next.meta.lastPublishedAt)) {
      next.meta.lastPublishedAt = slice.source.retrievedAt;
    }
    for (const lab of slice.labs) {
      const existing = labById.get(lab.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(lab)) {
        throw new Error(`Source-offering lab conflicts with canonical lab: ${lab.id}`);
      }
      labById.set(lab.id, lab);
    }
    for (const offering of slice.sourceOfferings) {
      const sourceKey = `${offering.sourceId}:${offering.externalRecordId}`;
      const existingSourceKey = sourceKeyByOfferingId.get(offering.id);
      if (existingSourceKey && existingSourceKey !== sourceKey) {
        throw new Error(`Source-offering id collision: ${offering.id}`);
      }
      const duplicateSourceIdentity = [...offeringById.values()].find(
        (candidate) =>
          candidate.id !== offering.id &&
          candidate.sourceId === offering.sourceId &&
          candidate.externalRecordId === offering.externalRecordId,
      );
      if (duplicateSourceIdentity) {
        throw new Error(`Duplicate source-offering identity: ${sourceKey}`);
      }
      offeringById.set(offering.id, offering);
      sourceKeyByOfferingId.set(offering.id, sourceKey);
    }
  }

  next.labs = [...labById.values()];
  next.sourceOfferings = stableSort(offeringById.values(), (offering) => offering.id);
  return next;
}
