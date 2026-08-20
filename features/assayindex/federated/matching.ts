import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import type { ParsedSourceOffering } from "@/features/assayindex/federated/types";

export type AssayRelationshipSuggestion = {
  assayId: string | null;
  relationship:
    | "existing-exact-offering"
    | "equivalent-orderable"
    | "related-method-variant"
    | "same-clinical-assay-family"
    | "new-assay-candidate";
  confidence: number;
  reasons: string[];
  hardBlockers: string[];
};

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}
const HARD_BLOCKER_PAIRS: Array<[RegExp, RegExp, string]> = [
  [/\bantigen\b/i, /\bgenotyp(?:e|ing)\b|\bpcr\b/i, "antigen-versus-genotyping"],
  [/\bqualitative\b/i, /\bquantitative\b/i, "qualitative-versus-quantitative"],
  [/\bpanel\b/i, /\bsingle\b|\bisolated\b/i, "panel-versus-single-analyte"],
  [/\bscreen(?:ing)?\b/i, /\bconfirm(?:ation|atory)?\b/i, "screen-versus-confirmation"],
  [/\btumou?r\b/i, /\bgermline\b/i, "tumor-versus-germline"],
  [/\breflex\b|\bcascade\b/i, /\bstandalone\b|\bsingle test\b/i, "reflex-versus-standalone"],
  [/\bculture\b/i, /\bmolecular\b|\bpcr\b/i, "culture-versus-molecular"],
];

function hardBlockers(left: string, right: string) {
  return HARD_BLOCKER_PAIRS.flatMap(([first, second, label]) =>
    (first.test(left) && second.test(right)) || (second.test(left) && first.test(right))
      ? [label]
      : [],
  );
}

export function suggestAssayRelationship(
  parsed: ParsedSourceOffering,
  catalog: AssayIndexCatalog,
): AssayRelationshipSuggestion {
  const exactRecord = catalog.assayLabRecords.find((record) =>
    (parsed.sourceTestCode && [record.testCode, record.testId, record.orderCode].includes(parsed.sourceTestCode))
    || record.sourceLinks.some((link) => link.url === parsed.sourceUrl),
  );
  if (exactRecord) {
    return {
      assayId: exactRecord.assaySlug,
      relationship: "existing-exact-offering",
      confidence: 1,
      reasons: ["Exact source test identifier or canonical source URL matched."],
      hardBlockers: [],
    };
  }

  const candidateName = normalized(parsed.testName ?? parsed.sourceTitle);
  const nameMatch = catalog.assays.find((assay) =>
    [assay.displayName, ...assay.synonyms].some((value) => normalized(value) === candidateName),
  );
  if (!nameMatch) {
    return {
      assayId: null,
      relationship: "new-assay-candidate",
      confidence: 0,
      reasons: ["No exact stable identifier or normalized assay name matched."],
      hardBlockers: [],
    };
  }

  const relatedRecords = catalog.assayLabRecords.filter((record) => record.assaySlug === nameMatch.slug);
  const blockers = relatedRecords.flatMap((record) => hardBlockers(
    `${parsed.sourceTitle} ${parsed.methodology ?? ""}`,
    `${record.testName} ${record.methodology ?? ""}`,
  ));
  const uniqueBlockers = [...new Set(blockers)];
  return {
    assayId: nameMatch.slug,
    relationship: uniqueBlockers.length > 0 ? "related-method-variant" : "same-clinical-assay-family",
    confidence: uniqueBlockers.length > 0 ? 0.35 : 0.7,
    reasons: ["Normalized assay name matched; curator review is still required."],
    hardBlockers: uniqueBlockers,
  };
}
