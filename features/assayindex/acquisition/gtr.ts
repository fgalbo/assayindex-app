export type GtrParseIssue = {
  code: "schema_drift" | "invalid_row";
  field?: string;
  row?: number;
  message: string;
};

export type GtrConditionReference = {
  medGenId: string;
  mimNumber: string | null;
  name: string | null;
  snomedCtId: string | null;
};

export type GtrGeneReference = {
  medGenId: string;
  mimNumber: string | null;
  name: string | null;
  ncbiGeneId: string | null;
  symbol: string | null;
};

export type GtrConditionGeneRecord = {
  gtrAccession: string;
  accessionVersion: string;
  testType: string;
  conditionIds: string[];
  conditionNames: string[];
  geneIds: string[];
  geneSymbols: string[];
  geneMedgenIds: string[];
  conditions: GtrConditionReference[];
  genes: GtrGeneReference[];
  referenceLaboratory: null;
  specimenType: null;
  testName: null;
  turnaroundTime: null;
};

export const GTR_CONDITION_GENE_FIELDS = [
  "accession_version",
  "test_type",
  "object",
  "GTR_identifier",
  "MIM_number",
  "object_name",
  "gene_or_SNOMED_CT_ID",
  "gene_symbol",
] as const;

const GTR_CONDITION_GENE_REQUIRED_FIELDS = [
  "accession_version",
  "test_type",
  "object",
  "GTR_identifier",
  "MIM_number",
  "gene_or_SNOMED_CT_ID",
] as const;

type GtrConditionGeneField = (typeof GTR_CONDITION_GENE_FIELDS)[number];

type GroupedRecord = {
  accessionVersion: string;
  testTypes: Set<string>;
  conditions: Map<string, GtrConditionReference>;
  genes: Map<string, GtrGeneReference>;
};

export function normalizeGtrConditionGeneHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().replace(/^#(?=accession_version$)/, "");
}

function nullable(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.toUpperCase() !== "N/A" ? normalized : null;
}

function stableReferenceKey(reference: unknown) {
  return JSON.stringify(reference);
}

function compareNullable(left: string | null, right: string | null) {
  return (left ?? "").localeCompare(right ?? "");
}

function compareConditions(left: GtrConditionReference, right: GtrConditionReference) {
  return (
    left.medGenId.localeCompare(right.medGenId) ||
    compareNullable(left.snomedCtId, right.snomedCtId) ||
    compareNullable(left.mimNumber, right.mimNumber) ||
    compareNullable(left.name, right.name)
  );
}

function compareGenes(left: GtrGeneReference, right: GtrGeneReference) {
  return (
    compareNullable(left.ncbiGeneId, right.ncbiGeneId) ||
    compareNullable(left.symbol, right.symbol) ||
    left.medGenId.localeCompare(right.medGenId) ||
    compareNullable(left.mimNumber, right.mimNumber) ||
    compareNullable(left.name, right.name)
  );
}

export function createGtrConditionGeneAccumulator(rawHeader: string[]) {
  const header = rawHeader.map(normalizeGtrConditionGeneHeader);
  const missingFields = GTR_CONDITION_GENE_REQUIRED_FIELDS.filter((field) => !header.includes(field));
  const issues: GtrParseIssue[] = missingFields.map((field) => ({
    code: "schema_drift",
    field,
    message: `Missing required GTR column: ${field}`,
  }));
  const indexes = Object.fromEntries(header.map((field, position) => [field, position])) as Record<string, number>;
  const grouped = new Map<string, GroupedRecord>();

  return {
    header,
    issues,
    addRow(cells: string[], rowNumber: number) {
      if (missingFields.length > 0) return;
      if (cells.length !== header.length) {
        issues.push({
          code: "invalid_row",
          row: rowNumber,
          message: `GTR condition/gene row has ${cells.length} columns; expected ${header.length}.`,
        });
        return;
      }

      const read = (field: GtrConditionGeneField) => cells[indexes[field]]?.trim() ?? "";
      const accessionVersion = read("accession_version");
      const medGenId = read("GTR_identifier");
      const objectType = read("object").toLowerCase();

      if (!accessionVersion || !medGenId || (objectType !== "condition" && objectType !== "gene")) {
        issues.push({
          code: "invalid_row",
          row: rowNumber,
          message: "GTR condition/gene row is missing accession_version, MedGen GTR_identifier, or a supported object type.",
        });
        return;
      }

      const existing = grouped.get(accessionVersion) ?? {
        accessionVersion,
        testTypes: new Set<string>(),
        conditions: new Map<string, GtrConditionReference>(),
        genes: new Map<string, GtrGeneReference>(),
      };
      const testType = read("test_type");
      if (testType) {
        if (existing.testTypes.size > 0 && !existing.testTypes.has(testType)) {
          issues.push({
            code: "invalid_row",
            row: rowNumber,
            message: `GTR condition/gene row has conflicting test_type ${testType} for ${accessionVersion}.`,
          });
        }
        existing.testTypes.add(testType);
      }

      if (objectType === "condition") {
        const condition: GtrConditionReference = {
          medGenId,
          mimNumber: nullable(read("MIM_number")),
          name: nullable(read("object_name")),
          snomedCtId: nullable(read("gene_or_SNOMED_CT_ID")),
        };
        existing.conditions.set(stableReferenceKey(condition), condition);
      } else {
        const gene: GtrGeneReference = {
          medGenId,
          mimNumber: nullable(read("MIM_number")),
          name: nullable(read("object_name")),
          ncbiGeneId: nullable(read("gene_or_SNOMED_CT_ID")),
          symbol: nullable(read("gene_symbol")),
        };
        existing.genes.set(stableReferenceKey(gene), gene);
      }

      grouped.set(accessionVersion, existing);
    },
    finish(): { records: GtrConditionGeneRecord[]; issues: GtrParseIssue[] } {
      const records = [...grouped.values()]
        .map((record) => {
          const conditions = [...record.conditions.values()].toSorted(compareConditions);
          const genes = [...record.genes.values()].toSorted(compareGenes);
          return {
            gtrAccession: record.accessionVersion.replace(/\.\d+$/, ""),
            accessionVersion: record.accessionVersion,
            testType: [...record.testTypes].toSorted()[0] ?? "",
            conditionIds: [...new Set(conditions.map((condition) => condition.medGenId))].toSorted(),
            conditionNames: [
              ...new Set(
                conditions
                  .map((condition) => condition.name)
                  .filter((name): name is string => Boolean(name)),
              ),
            ].toSorted(),
            geneIds: [
              ...new Set(
                genes
                  .map((gene) => gene.ncbiGeneId)
                  .filter((geneId): geneId is string => Boolean(geneId)),
              ),
            ].toSorted(),
            geneSymbols: [
              ...new Set(
                genes
                  .map((gene) => gene.symbol)
                  .filter((symbol): symbol is string => Boolean(symbol)),
              ),
            ].toSorted(),
            geneMedgenIds: [...new Set(genes.map((gene) => gene.medGenId))].toSorted(),
            conditions,
            genes,
            referenceLaboratory: null,
            specimenType: null,
            testName: null,
            turnaroundTime: null,
          } satisfies GtrConditionGeneRecord;
        })
        .toSorted(
          (left, right) =>
            left.gtrAccession.localeCompare(right.gtrAccession) ||
            left.accessionVersion.localeCompare(right.accessionVersion),
        );

      return { records, issues: [...issues] };
    },
  };
}

export function parseGtrTestConditionGeneTsv(tsv: string): {
  records: GtrConditionGeneRecord[];
  issues: GtrParseIssue[];
} {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0]?.split("\t") ?? [];
  const accumulator = createGtrConditionGeneAccumulator(header);

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    accumulator.addRow(lines[lineIndex].split("\t"), lineIndex + 1);
  }

  return accumulator.finish();
}
