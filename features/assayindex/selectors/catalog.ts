import { ASSAYINDEX_DISCLAIMER } from "@/features/assayindex/constants";
import type {
  Assay,
  AssayIndexCatalog,
  AssayLabRecord,
  AssayReport,
  AssaySearchDocument,
  CoOrderRelationshipSummary,
  CodeExplorerEntry,
  CompareRow,
  CuratedAssayRelationshipSummary,
  Lab,
  LabSummary,
  SourceOffering,
} from "@/features/assayindex/domain/types";
import { getSourceOfferingsForLab } from "@/features/assayindex/selectors/source-offerings";
import { renderListOrFallback, renderValueOrFallback } from "@/features/assayindex/utils/formatting";

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function sortOfferingRecords(catalog: AssayIndexCatalog, records: AssayLabRecord[]) {
  const labsById = new Map(catalog.labs.map((lab) => [lab.id, lab]));

  return records.toSorted((left, right) => {
    const leftLabName = labsById.get(left.labId)?.displayName ?? left.labId;
    const rightLabName = labsById.get(right.labId)?.displayName ?? right.labId;

    return (
      leftLabName.localeCompare(rightLabName) ||
      left.testName.localeCompare(right.testName) ||
      left.id.localeCompare(right.id)
    );
  });
}

function uniqueCodes(record: AssayLabRecord) {
  return dedupe([
    ...record.cptCodes,
    ...record.loincCodes,
    ...record.associatedIcd10.map((code) => code.code),
  ]);
}

function buildCodeSummary(record: AssayLabRecord) {
  return renderListOrFallback([
    record.testCode ? `Test ${record.testCode}` : null,
    record.orderCode ? `Order ${record.orderCode}` : null,
    record.cptCodes.length > 0 ? `CPT ${record.cptCodes.join(", ")}` : null,
    record.loincCodes.length > 0 ? `LOINC ${record.loincCodes.join(", ")}` : null,
    record.associatedIcd10.length > 0
      ? `ICD-10 ${record.associatedIcd10.map((code) => code.code).join(", ")}`
      : null,
  ]);
}

export function getAssayBySlug(catalog: AssayIndexCatalog, slug: string) {
  return catalog.assays.find((assay) => assay.slug === slug && assay.status === "published") ?? null;
}

export function getLabById(catalog: AssayIndexCatalog, labId: string) {
  return catalog.labs.find((lab) => lab.id === labId) ?? null;
}

export function getRecordsByAssaySlug(catalog: AssayIndexCatalog, assaySlug: string) {
  return sortOfferingRecords(
    catalog,
    catalog.assayLabRecords.filter(
      (record) => record.assaySlug === assaySlug && record.publicationStatus === "published",
    ),
  );
}

export function getCuratedRelationshipSummaries(
  catalog: AssayIndexCatalog,
  assaySlug: string,
): CuratedAssayRelationshipSummary[] {
  return catalog.curatedAssayRelationships
    .filter(
      (relationship) =>
        relationship.publicationStatus === "published" &&
        (relationship.sourceAssaySlug === assaySlug || relationship.targetAssaySlug === assaySlug),
    )
    .flatMap((relationship) => {
      const direction: CuratedAssayRelationshipSummary["direction"] =
        relationship.sourceAssaySlug === assaySlug ? "outgoing" : "incoming";
      const otherAssaySlug =
        direction === "outgoing" ? relationship.targetAssaySlug : relationship.sourceAssaySlug;
      const otherAssay = getAssayBySlug(catalog, otherAssaySlug);

      return otherAssay ? [{ relationship, otherAssay, direction }] : [];
    })
    .toSorted(
      (left, right) =>
        left.otherAssay.displayName.localeCompare(right.otherAssay.displayName) ||
        left.relationship.id.localeCompare(right.relationship.id),
    );
}

export function getCoOrderRelationshipSummaries(
  catalog: AssayIndexCatalog,
  assaySlug: string,
): CoOrderRelationshipSummary[] {
  return catalog.coOrderRelationships
    .filter(
      (relationship) =>
        relationship.publicationStatus === "published" &&
        (relationship.leftAssaySlug === assaySlug || relationship.rightAssaySlug === assaySlug),
    )
    .flatMap((relationship) => {
      const isLeft = relationship.leftAssaySlug === assaySlug;
      const otherAssay = getAssayBySlug(
        catalog,
        isLeft ? relationship.rightAssaySlug : relationship.leftAssaySlug,
      );

      if (!otherAssay) {
        return [];
      }

      const focalSetCount = isLeft
        ? relationship.counts.leftSetCount
        : relationship.counts.rightSetCount;
      const pairSetCount = relationship.counts.pairSetCount;

      return [
        {
          relationship,
          otherAssay,
          focalSetCount,
          pairSetCount,
          percentage: (pairSetCount / focalSetCount) * 100,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        right.percentage - left.percentage ||
        left.otherAssay.displayName.localeCompare(right.otherAssay.displayName) ||
        left.relationship.id.localeCompare(right.relationship.id),
    );
}

export function getSourceDocumentsByAssaySlug(catalog: AssayIndexCatalog, assaySlug: string) {
  const recordIds = new Set(getRecordsByAssaySlug(catalog, assaySlug).map((record) => record.id));

  return catalog.sourceDocuments
    .filter(
      (document) =>
        document.assaySlug === assaySlug ||
        document.relatedRecordIds.some((recordId) => recordIds.has(recordId)),
    )
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function getAssayLevelCodesByAssaySlug(catalog: AssayIndexCatalog, assaySlug: string) {
  return catalog.assayLevelCodes.filter((code) => code.assaySlug === assaySlug);
}

export function getAssayReport(catalog: AssayIndexCatalog, assaySlug: string): AssayReport | null {
  const assay = getAssayBySlug(catalog, assaySlug);

  if (!assay) {
    return null;
  }

  return {
    assay,
    labRecords: getRecordsByAssaySlug(catalog, assaySlug),
    assayLevelCodes: getAssayLevelCodesByAssaySlug(catalog, assaySlug),
    sources: getSourceDocumentsByAssaySlug(catalog, assaySlug),
    curatedRelationships: getCuratedRelationshipSummaries(catalog, assaySlug),
    coOrderRelationships: getCoOrderRelationshipSummaries(catalog, assaySlug),
    disclaimer: catalog.meta.disclaimer || ASSAYINDEX_DISCLAIMER,
    generatedAt: catalog.meta.lastPublishedAt,
  };
}

export function getAllAssayReports(catalog: AssayIndexCatalog) {
  return catalog.assays
    .filter((assay) => assay.status === "published")
    .map((assay) => getAssayReport(catalog, assay.slug))
    .filter((report): report is AssayReport => report !== null);
}

export function getCatalogStats(catalog: AssayIndexCatalog) {
  return {
    assayCount: catalog.assays.length,
    labCount: catalog.labs.length,
    recordCount: catalog.assayLabRecords.length,
    sourceCount: catalog.sourceDocuments.length,
  };
}

export function getFeaturedAssays(catalog: AssayIndexCatalog, count = 4) {
  return getAllAssayReports(catalog)
    .toSorted((left, right) => left.assay.displayName.localeCompare(right.assay.displayName))
    .slice(0, count);
}

export function getCatalogRecentAssays(catalog: AssayIndexCatalog, count = 4) {
  return catalog.assays
    .filter((assay) => assay.status === "published")
    .toSorted(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    )
    .slice(0, count);
}

export type LabSummaryWithSourceOfferings = LabSummary & {
  sourceOfferingCount: number;
  sourceOfferings: SourceOffering[];
};

export function getLabSummaries(catalog: AssayIndexCatalog): LabSummaryWithSourceOfferings[] {
  return catalog.labs
    .map((lab) => {
      const records = catalog.assayLabRecords.filter((record) => record.labId === lab.id);
      const sourceOfferings = getSourceOfferingsForLab(catalog, lab.id);
      const assaySlugs = dedupe([
        ...records.map((record) => record.assaySlug),
        ...sourceOfferings
          .map((offering) => offering.assaySlug)
          .filter((assaySlug): assaySlug is string => Boolean(assaySlug)),
      ]);
      const assays = catalog.assays.filter((assay) => assaySlugs.includes(assay.slug));
      const sourceCount = catalog.sourceDocuments.filter((document) => document.labId === lab.id).length;

      return {
        lab,
        assayCount: assays.length,
        recordCount: records.length,
        sourceOfferingCount: sourceOfferings.length,
        sourceCount,
        assays,
        sourceOfferings,
      };
    })
    .toSorted((left, right) => left.lab.displayName.localeCompare(right.lab.displayName));
}

export function getAssaysForLab(catalog: AssayIndexCatalog, labId: string) {
  return getLabSummaries(catalog).find((summary) => summary.lab.id === labId) ?? null;
}

export function buildSearchDocuments(catalog: AssayIndexCatalog): AssaySearchDocument[] {
  return getAllAssayReports(catalog).map((report) => {
    const labs = report.labRecords
      .map((record) => getLabById(catalog, record.labId))
      .filter((lab): lab is Lab => lab !== null);

    return {
      assaySlug: report.assay.slug,
      displayName: report.assay.displayName,
      summary: report.assay.summary,
      purpose: report.assay.purpose,
      specialty: report.assay.specialty,
      synonyms: dedupe([
        ...report.assay.synonyms,
        ...report.labRecords.flatMap((record) => record.synonyms),
      ]),
      keywords: report.assay.keywords,
      labIds: dedupe(report.labRecords.map((record) => record.labId)),
      labNames: dedupe(labs.map((lab) => lab.displayName)),
      categories: dedupe(report.labRecords.map((record) => record.category)),
      sourceTypes: dedupe([
        ...report.sources.map((source) => source.sourceType),
        ...report.labRecords.flatMap((record) => record.sourceLinks.map((link) => link.sourceType)),
      ]),
      testNames: dedupe(report.labRecords.map((record) => record.testName)),
      recordTitles: dedupe(report.labRecords.map((record) => record.recordTitle)),
      codes: dedupe([
        ...report.assayLevelCodes.map((code) => code.code),
        ...report.labRecords.flatMap(uniqueCodes),
      ]),
      specimenTypes: dedupe(
        report.labRecords
          .map((record) => record.specimenType)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
      methodologies: dedupe(
        report.labRecords
          .map((record) => record.methodology)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
      notes: dedupe(
        report.labRecords
          .flatMap((record) => [record.notes, record.limitations, record.interferences])
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
      hasReflexLogic: report.labRecords.some((record) => Boolean(record.reflexLogic)),
      hasCpt: report.labRecords.some((record) => record.cptCodes.length > 0),
      hasLoinc: report.labRecords.some((record) => record.loincCodes.length > 0),
      labCount: new Set(report.labRecords.map((record) => record.labId)).size,
      sourceCount: report.sources.length,
      updatedAt: report.assay.updatedAt,
    };
  });
}

export function getFilterOptions(catalog: AssayIndexCatalog) {
  const docs = buildSearchDocuments(catalog);

  return {
    specialties: dedupe(docs.flatMap((doc) => doc.specialty)).toSorted(),
    labs: catalog.labs
      .map((lab) => ({ id: lab.id, label: lab.displayName }))
      .toSorted((left, right) => left.label.localeCompare(right.label)),
    categories: dedupe(docs.flatMap((doc) => doc.categories)).toSorted(),
    sourceTypes: dedupe(docs.flatMap((doc) => doc.sourceTypes)).toSorted(),
    specimenTypes: dedupe(docs.flatMap((doc) => doc.specimenTypes)).toSorted(),
    methodologies: dedupe(docs.flatMap((doc) => doc.methodologies)).toSorted(),
  };
}

export function getAllCatalogFilterOptions(catalog: AssayIndexCatalog) {
  const assayOptions = getFilterOptions(catalog);
  const offerings = catalog.sourceOfferings ?? [];

  return {
    ...assayOptions,
    categories: dedupe([
      ...assayOptions.categories,
      ...(offerings.length > 0 ? ["source-offering"] : []),
    ]).toSorted(),
    sourceTypes: dedupe([
      ...assayOptions.sourceTypes,
      ...offerings.flatMap((offering) => offering.sourceLinks.map((link) => link.sourceType)),
      ...(offerings.length > 0 ? ["test-page"] : []),
    ]).toSorted(),
    // Source-native specimen and method fields can be long narrative requirements.
    // Keep them in full-text search and detail pages, but do not turn them into
    // unbounded exact-match select options until a reviewed normalization exists.
    specimenTypes: assayOptions.specimenTypes,
    methodologies: assayOptions.methodologies,
  };
}

export function getCodeExplorerEntries(catalog: AssayIndexCatalog): CodeExplorerEntry[] {
  const grouped = new Map<string, CodeExplorerEntry>();

  const upsert = (
    category: CodeExplorerEntry["category"],
    code: string,
    scope: CodeExplorerEntry["scope"],
    assaySlug: string,
    options?: {
      description?: string | null;
      note?: string | null;
      labId?: string;
      recordId?: string;
    },
  ) => {
    const key = `${category}:${code}:${scope}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.assaySlugs = dedupe([...existing.assaySlugs, assaySlug]);
      existing.labIds = dedupe([...existing.labIds, options?.labId ?? ""]);
      existing.recordIds = dedupe([...existing.recordIds, options?.recordId ?? ""]);
      existing.assayCount = existing.assaySlugs.length;
      existing.description = existing.description ?? options?.description ?? null;
      existing.note = existing.note ?? options?.note ?? null;
      return;
    }

    grouped.set(key, {
      category,
      code,
      description: options?.description ?? null,
      scope,
      note: options?.note ?? null,
      assaySlugs: [assaySlug],
      labIds: options?.labId ? [options.labId] : [],
      recordIds: options?.recordId ? [options.recordId] : [],
      assayCount: 1,
    });
  };

  for (const code of catalog.assayLevelCodes) {
    upsert(code.category, code.code, code.scope, code.assaySlug, {
      description: code.description,
      note: code.note ?? null,
    });
  }

  for (const record of catalog.assayLabRecords) {
    for (const cptCode of record.cptCodes) {
      upsert("CPT", cptCode, "lab-specific", record.assaySlug, {
        description: null,
        labId: record.labId,
        recordId: record.id,
      });
    }

    for (const loincCode of record.loincCodes) {
      upsert("LOINC", loincCode, "lab-specific", record.assaySlug, {
        description: null,
        labId: record.labId,
        recordId: record.id,
      });
    }

    for (const icdCode of record.associatedIcd10) {
      upsert("ICD10", icdCode.code, "lab-specific", record.assaySlug, {
        description: icdCode.description,
        note: icdCode.note ?? null,
        labId: record.labId,
        recordId: record.id,
      });
    }
  }

  return [...grouped.values()].toSorted((left, right) => {
    if (left.category !== right.category) {
      return left.category.localeCompare(right.category);
    }

    return left.code.localeCompare(right.code);
  });
}

export function buildCompareRows(records: AssayLabRecord[], labsById: Map<string, Lab>): CompareRow[] {
  return [
    {
      key: "category",
      label: "Category",
      values: Object.fromEntries(records.map((record) => [record.id, record.category])),
    },
    {
      key: "testName",
      label: "Test name",
      values: Object.fromEntries(records.map((record) => [record.id, record.testName])),
    },
    {
      key: "codes",
      label: "Codes",
      values: Object.fromEntries(records.map((record) => [record.id, buildCodeSummary(record)])),
    },
    {
      key: "specimenType",
      label: "Specimen",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.specimenType)]),
      ),
    },
    {
      key: "container",
      label: "Container",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.container)]),
      ),
    },
    {
      key: "handling",
      label: "Handling",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.handling)]),
      ),
    },
    {
      key: "storage",
      label: "Storage",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.storage)]),
      ),
    },
    {
      key: "turnaroundTime",
      label: "Turnaround time",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.turnaroundTime)]),
      ),
    },
    {
      key: "methodology",
      label: "Methodology",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.methodology)]),
      ),
    },
    {
      key: "price",
      label: "Source-listed price",
      values: Object.fromEntries(
        records.map((record) => [
          record.id,
          record.priceObservations?.map((price) => price.sourceText).join("; ") ||
            "Not listed by source",
        ]),
      ),
    },
    {
      key: "reflexLogic",
      label: "Reflex logic",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.reflexLogic)]),
      ),
    },
    {
      key: "limitations",
      label: "Limitations",
      values: Object.fromEntries(
        records.map((record) => [record.id, renderValueOrFallback(record.limitations)]),
      ),
    },
    {
      key: "sourceCoverage",
      label: "Source coverage",
      values: Object.fromEntries(
        records.map((record) => [
          record.id,
          `${labsById.get(record.labId)?.shortName ?? record.labId}: ${record.sourceLinks.length} source${record.sourceLinks.length === 1 ? "" : "s"}`,
        ]),
      ),
    },
  ];
}

export function getAssayCards(catalog: AssayIndexCatalog) {
  return catalog.assays
    .map((assay) => {
      const report = getAssayReport(catalog, assay.slug);
      const labCount = new Set(report?.labRecords.map((record) => record.labId) ?? []).size;
      const sourceCount = report?.sources.length ?? 0;

      return {
        assay,
        labCount,
        sourceCount,
        specimenTypes: dedupe(
          report?.labRecords
            .map((record) => record.specimenType)
            .filter((value): value is string => Boolean(value)) ?? [],
        ),
        methodologies: dedupe(
          report?.labRecords
            .map((record) => record.methodology)
            .filter((value): value is string => Boolean(value)) ?? [],
        ),
      };
    })
    .toSorted((left, right) => left.assay.displayName.localeCompare(right.assay.displayName));
}

export function buildLabMap(catalog: AssayIndexCatalog) {
  return new Map(catalog.labs.map((lab) => [lab.id, lab]));
}

export function getRelatedSourcesForRecord(catalog: AssayIndexCatalog, recordId: string) {
  return catalog.sourceDocuments.filter((document) => document.relatedRecordIds.includes(recordId));
}

export function getAssayNameMap(catalog: AssayIndexCatalog) {
  return new Map<string, Assay>(catalog.assays.map((assay) => [assay.slug, assay]));
}
