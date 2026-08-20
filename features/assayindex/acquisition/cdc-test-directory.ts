export type CdcParseIssue = {
  code:
    | "schema_drift"
    | "missing_identity"
    | "duplicate_id"
    | "missing_required_field"
    | "invalid_value";
  field?: string;
  record?: number;
  message: string;
};

export type CdcProfessionalContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

export type CdcSourceLink = {
  url: string;
  label: string | null;
};

export type CdcTestDirectoryCandidate = {
  externalRecordId: string;
  providerId: "cdc-infectious-diseases-laboratories";
  providerName: "CDC Infectious Diseases Laboratories";
  sourceTestId: string | null;
  sourceLabId: string | null;
  sourceUnitNumber: string | null;
  testName: string;
  aliases: string[];
  method: string | null;
  turnaroundTimeText: string | null;
  turnaroundTime: { value: number; unit: "day" | "week" } | null;
  acceptableSampleForTestingText: string | null;
  minimumVolume: string | null;
  storageAndPreservation: string | null;
  transport: string | null;
  shippingInstructions: string | null;
  interferencesAndLimitations: string | null;
  additionalInformation: string | null;
  supplementalInformationRequired: string | null;
  specimenLabeling: string | null;
  sourceLinkText: string | null;
  legacyLinkText: string | null;
  sourceLinks: CdcSourceLink[];
  orderStatus: string;
  offline: boolean;
  clia: boolean;
  priorApprovalRequired: boolean;
  performedOn: { human: boolean; animal: boolean; other: boolean };
  contacts: {
    cdc: CdcProfessionalContact[];
    priorApproval: CdcProfessionalContact[];
  };
  sourceVersion: string;
  detailUrl: string;
  reviewFlags: string[];
  candidateState: "discovered" | "discovered-review-required";
};

export type CdcTestDirectoryParseResult = {
  sourceGeneratedAt: string;
  candidates: CdcTestDirectoryCandidate[];
  issues: CdcParseIssue[];
};

const ROOT_ELEMENT = "dataroot";
const RECORD_ELEMENT = "QryTableMerge";
const ACCEPTING_STATUS = "This Test Order is currently accepting specimens.";
const UNAVAILABLE_STATUS =
  "This Test Order is currently not accepting any specimens until further notice.";

const ALLOWED_FIELDS = new Set([
  "AcceptableSampleForTesting",
  "AdditionalInfo",
  "CDCPOCFirst1",
  "CDCPOCFirst2",
  "CDCPOCFirst3",
  "CDCPOCFirst4",
  "CDCPOCLast1",
  "CDCPOCLast2",
  "CDCPOCLast3",
  "CDCPOCLast4",
  "CDCPOCPhone1",
  "CDCPOCPhone2",
  "CDCPOCPhone3",
  "CDCPOCPhone4",
  "CDCPOCemail1",
  "CDCPOCemail2",
  "CDCPOCemail3",
  "CDCPOCemail4",
  "CDCTestCode",
  "CLIA",
  "FE",
  "InterferencesLimitations",
  "LabID",
  "Link",
  "Linkold",
  "Method",
  "MinimumVolume",
  "Offline",
  "PerformedOnAnimal",
  "PerformedOnFoodEnvironmentalMedicalBiologics",
  "PerformedOnHuman",
  "Performed_x0020_on_x0020_Specimans_x0020_from",
  "PriorApprovalFirst1",
  "PriorApprovalFirst2",
  "PriorApprovalLast1",
  "PriorApprovalLast2",
  "PriorApprovalPhone1",
  "PriorApprovalPhone2",
  "PriorApprovalRequired",
  "PriorApprovalemail1",
  "PriorApprovalemail2",
  "ShippingInstructions",
  "SpecimenLabeling",
  "StorageAndPreservation",
  "SupplementalInformationRequired",
  "TestID",
  "TestOrderNam",
  "TestOrderNamSort",
  "TestOrderStatus",
  "TestOrderSynonym",
  "Transport",
  "TurnAround",
  "TurnAroundTime",
  "TurnAroundTimeMeasure",
  "UnitNumber",
  "Version",
]);

const REQUIRED_FIELDS = [
  "CDCTestCode",
  "TestOrderNamSort",
  "TestOrderStatus",
  "Offline",
  "CLIA",
  "PriorApprovalRequired",
  "PerformedOnHuman",
  "PerformedOnAnimal",
  "PerformedOnFoodEnvironmentalMedicalBiologics",
  "Version",
] as const;

const NULL_TEXT = new Set(["n/a", "none", "not applicable", "null", "to be determined"]);
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
  plusmn: "±",
  micro: "µ",
  times: "×",
  middot: "·",
  hellip: "…",
  reg: "®",
  trade: "™",
  copy: "©",
};

function decodeCodePoint(value: string, radix: number) {
  const codePoint = Number.parseInt(value, radix);
  const isValidXmlCharacter =
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  if (!Number.isInteger(codePoint) || !isValidXmlCharacter) {
    throw new Error(`CDC XML contains an invalid numeric entity: ${value}`);
  }
  return String.fromCodePoint(codePoint);
}

function assertValidXmlEntitySyntax(value: string) {
  const withoutEntities = value.replace(
    /&(?:#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    "",
  );
  if (withoutEntities.includes("&")) {
    throw new Error("CDC XML contains a malformed or unsupported source entity reference.");
  }
}

export function isCdcSourceGeneratedAt(value: unknown): value is string {
  return isCdcSourceGeneratedAtValue(value);
}

function decodeXmlText(value: string) {
  assertValidXmlEntitySyntax(value);
  const decoded = value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    (entity, token: string) => {
      const normalized = token.toLowerCase();
      if (normalized.startsWith("#x")) return decodeCodePoint(normalized.slice(2), 16);
      if (normalized.startsWith("#")) return decodeCodePoint(normalized.slice(1), 10);
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      return entity;
    },
  );

  if (/&(?:#x?[0-9a-f]+|[a-z][a-z0-9]+);/i.test(decoded.replace(/&[a-z][a-z0-9]+;/gi, (entity) => {
    const name = entity.slice(1, -1).toLowerCase();
    return name in HTML_ENTITIES ? "" : entity;
  }))) {
    throw new Error("CDC XML contains an unsupported entity reference.");
  }

  return decoded.replace(/&([a-z][a-z0-9]+);/gi, (entity, name: string) => {
    return HTML_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function normalizeDecodedText(value: string) {
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<(?:div|p|li|tr|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ");
  return withBreaks
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeDecodedNarrative(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<(?:div|p|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/[\t\f\v\u00a0 ]+/g, " ")
    .replace(/ *\r?\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([,.;:!?])/g, "$1")
    .trim();
}

function isMissingSentinel(value: string) {
  const key = value.toLowerCase().replace(/[.!?;:]+$/g, "").trimEnd();
  return NULL_TEXT.has(key);
}

function normalizedText(raw: string | undefined) {
  const value = normalizeDecodedText(decodeXmlText(raw ?? ""));
  return value && !isMissingSentinel(value) ? value : null;
}

function normalizedNarrativeText(raw: string | undefined) {
  const value = normalizeDecodedNarrative(decodeXmlText(raw ?? ""));
  return value && !isMissingSentinel(value) ? value : null;
}

function normalizedList(raw: string | undefined) {
  if (!raw?.trim()) return [];
  const decoded = decodeXmlText(raw)
    .replace(/<br\s*\/?>/gi, ";")
    .replace(/<\/(?:div|p|li|tr)\s*>/gi, ";")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ");
  const values = decoded
    .split(/\s*;\s*|\r?\n+/)
    .map((value) => normalizeDecodedText(value))
    .filter((value) => value && !isMissingSentinel(value));
  return [...new Set(values)];
}

function parseAttributes(raw: string) {
  const attributes = new Map<string, string>();
  const pattern = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("[^"]*"|'[^']*')/g;
  let lastIndex = 0;
  for (const match of raw.matchAll(pattern)) {
    if (raw.slice(lastIndex, match.index).trim()) {
      throw new Error("CDC XML root contains malformed attributes.");
    }
    if (attributes.has(match[1])) throw new Error(`CDC XML root repeats attribute ${match[1]}.`);
    attributes.set(match[1], decodeXmlText(match[2].slice(1, -1)));
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  if (raw.slice(lastIndex).trim()) throw new Error("CDC XML root contains malformed attributes.");
  return attributes;
}

function unwrapDocument(input: string) {
  let xml = input.replace(/^\uFEFF/, "").trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) {
    throw new Error("CDC XML contains a prohibited control character.");
  }
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) {
    throw new Error("CDC XML contains a prohibited DOCTYPE, ENTITY, or CDATA construct.");
  }
  if (/^<\?xml\b/i.test(xml)) {
    const declarationEnd = xml.indexOf("?>");
    if (declarationEnd < 0) throw new Error("CDC XML declaration is malformed.");
    xml = xml.slice(declarationEnd + 2).trim();
  }
  if (/<\?/.test(xml) || /<!--|<!\[|<![A-Za-z]/.test(xml)) {
    throw new Error("CDC XML contains a prohibited processing or declaration construct.");
  }

  const rootOpen = xml.match(/^<dataroot\b([^>]*)>/);
  if (!rootOpen) throw new Error("CDC XML root must be dataroot.");
  const closing = `</${ROOT_ELEMENT}>`;
  if (!xml.endsWith(closing)) throw new Error("CDC XML dataroot element is malformed.");
  const rootAttributes = parseAttributes(rootOpen[1]);
  const sourceGeneratedAt = rootAttributes.get("generated") ?? "";
  if (!isCdcSourceGeneratedAt(sourceGeneratedAt)) {
    throw new Error("CDC XML dataroot has an invalid generated timestamp.");
  }
  return {
    sourceGeneratedAt,
    content: xml.slice(rootOpen[0].length, -closing.length),
  };
}

function readRecords(content: string) {
  const records: Map<string, string>[] = [];
  const issues: CdcParseIssue[] = [];
  const recordOpen = `<${RECORD_ELEMENT}>`;
  const recordClose = `</${RECORD_ELEMENT}>`;
  let position = 0;

  while (position < content.length) {
    const remainder = content.slice(position);
    const leadingWhitespace = remainder.match(/^\s*/)?.[0].length ?? 0;
    position += leadingWhitespace;
    if (position >= content.length) break;
    if (!content.startsWith(recordOpen, position)) {
      throw new Error("CDC XML dataroot contains an unexpected or malformed child element.");
    }
    const closeIndex = content.indexOf(recordClose, position + recordOpen.length);
    if (closeIndex < 0) throw new Error("CDC XML QryTableMerge record is malformed.");
    const body = content.slice(position + recordOpen.length, closeIndex);
    if (body.includes(recordOpen)) throw new Error("CDC XML contains nested QryTableMerge records.");
    const fields = new Map<string, string>();
    let fieldPosition = 0;

    while (fieldPosition < body.length) {
      const fieldRemainder = body.slice(fieldPosition);
      const fieldWhitespace = fieldRemainder.match(/^\s*/)?.[0].length ?? 0;
      fieldPosition += fieldWhitespace;
      if (fieldPosition >= body.length) break;
      const opening = body.slice(fieldPosition).match(/^<([A-Za-z_][A-Za-z0-9_.:-]*)>/);
      if (!opening || !FIELD_NAME_PATTERN.test(opening[1])) {
        throw new Error(`CDC XML record ${records.length + 1} contains malformed field XML.`);
      }
      const field = opening[1];
      const valueStart = fieldPosition + opening[0].length;
      const fieldClose = `</${field}>`;
      const valueEnd = body.indexOf(fieldClose, valueStart);
      if (valueEnd < 0) throw new Error(`CDC XML record ${records.length + 1} has malformed ${field}.`);
      const rawValue = body.slice(valueStart, valueEnd);
      if (rawValue.includes("<") || rawValue.includes(">")) {
        throw new Error(`CDC XML record ${records.length + 1} contains nested markup in ${field}.`);
      }
      if (fields.has(field)) {
        issues.push({
          code: "schema_drift",
          field,
          record: records.length + 1,
          message: `CDC record repeats field ${field}.`,
        });
      } else {
        fields.set(field, rawValue);
      }
      if (!ALLOWED_FIELDS.has(field)) {
        issues.push({
          code: "schema_drift",
          field,
          record: records.length + 1,
          message: `Unknown CDC field: ${field}`,
        });
      }
      fieldPosition = valueEnd + fieldClose.length;
    }
    records.push(fields);
    position = closeIndex + recordClose.length;
  }

  if (records.length === 0) throw new Error("CDC XML contains no QryTableMerge records.");
  return { records, issues };
}

function parseFlag(
  fields: Map<string, string>,
  field: string,
  record: number,
  issues: CdcParseIssue[],
  trueValue = "1",
  falseValue = "0",
) {
  const value = normalizedText(fields.get(field));
  if (value === trueValue) return true;
  if (value === falseValue) return false;
  issues.push({
    code: "invalid_value",
    field,
    record,
    message: `CDC ${field} must be ${trueValue} or ${falseValue}.`,
  });
  return null;
}

function parseTurnaround(fields: Map<string, string>, record: number, issues: CdcParseIssue[]) {
  const rawValue = normalizedText(fields.get("TurnAroundTime"));
  const rawUnit = normalizedText(fields.get("TurnAroundTimeMeasure"));
  if (rawValue === null && rawUnit === null) return null;
  if (rawValue === null && fields.get("TurnAroundTimeMeasure")?.trim().toLowerCase() === "n/a") {
    return null;
  }
  if (rawValue === null || rawUnit === null) {
    issues.push({
      code: "invalid_value",
      field: "TurnAroundTime",
      record,
      message: "CDC structured turnaround requires both a numeric value and a supported unit.",
    });
    return null;
  }
  const value = Number(rawValue);
  const unit = rawUnit === "Days" ? "day" : rawUnit === "Weeks" ? "week" : null;
  if (!Number.isFinite(value) || value <= 0 || !unit) {
    issues.push({
      code: "invalid_value",
      field: unit ? "TurnAroundTime" : "TurnAroundTimeMeasure",
      record,
      message: "CDC structured turnaround contains an unsupported numeric value or unit.",
    });
    return null;
  }
  return { value, unit } as const;
}

function contacts(fields: Map<string, string>, prefix: "CDCPOC" | "PriorApproval", count: number) {
  const results: CdcProfessionalContact[] = [];
  for (let index = 1; index <= count; index += 1) {
    const first = normalizedText(fields.get(`${prefix}First${index}`));
    const last = normalizedText(fields.get(`${prefix}Last${index}`));
    const phone = normalizedText(fields.get(`${prefix}Phone${index}`));
    const email = normalizedText(fields.get(`${prefix}email${index}`));
    const name = [first, last].filter(Boolean).join(" ") || null;
    if (name || phone || email) results.push({ name, phone, email });
  }
  return results;
}

function sourceLinks(fields: Map<string, string>) {
  const links = new Map<string, CdcSourceLink>();
  const addLink = (rawUrl: string, rawLabel: string | null) => {
    const candidate = rawUrl.trim().replace(/[),.;]+$/g, "");
    try {
      const url = new URL(candidate);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        return;
      }
      const label = rawLabel ? normalizeDecodedText(rawLabel) || null : null;
      const existing = links.get(url.href);
      if (!existing || (!existing.label && label)) links.set(url.href, { url: url.href, label });
    } catch {
      // The immutable XML and normalized link text retain unparseable source values.
    }
  };

  for (const field of ["Link", "Linkold"]) {
    const raw = fields.get(field);
    if (!raw?.trim()) continue;
    const decoded = decodeXmlText(raw);
    const withoutAnchors = decoded.replace(
      /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
      (_anchor, _quoted, doubleQuoted: string | undefined, singleQuoted: string | undefined, label: string) => {
        addLink(doubleQuoted ?? singleQuoted ?? "", label);
        return " ";
      },
    );
    for (const match of withoutAnchors.matchAll(/https?:\/\/[^\s<>"'#]+/gi)) {
      addLink(match[0], null);
    }
  }

  return [...links.values()].toSorted(
    (left, right) => left.url.localeCompare(right.url) || (left.label ?? "").localeCompare(right.label ?? ""),
  );
}

function buildCandidate(
  fields: Map<string, string>,
  record: number,
  issues: CdcParseIssue[],
): CdcTestDirectoryCandidate | null {
  let invalid = false;
  for (const field of REQUIRED_FIELDS) {
    if (!normalizedText(fields.get(field))) {
      issues.push({
        code: field === "CDCTestCode" ? "missing_identity" : "missing_required_field",
        field,
        record,
        message: `CDC record is missing required field ${field}.`,
      });
      invalid = true;
    }
  }
  if (invalid) return null;

  const offline = parseFlag(fields, "Offline", record, issues);
  const clia = parseFlag(fields, "CLIA", record, issues, "Y", "N");
  const priorApprovalRequired = parseFlag(fields, "PriorApprovalRequired", record, issues);
  const human = parseFlag(fields, "PerformedOnHuman", record, issues);
  const animal = parseFlag(fields, "PerformedOnAnimal", record, issues);
  const other = parseFlag(
    fields,
    "PerformedOnFoodEnvironmentalMedicalBiologics",
    record,
    issues,
  );
  const orderStatus = normalizedText(fields.get("TestOrderStatus"))!;
  const externalRecordId = normalizedText(fields.get("CDCTestCode"))!;
  if (!/^CDC-\d{5}$/.test(externalRecordId)) {
    issues.push({
      code: "invalid_value",
      field: "CDCTestCode",
      record,
      message: `Unsupported CDC test code format: ${externalRecordId}`,
    });
    invalid = true;
  }
  if (orderStatus !== ACCEPTING_STATUS && orderStatus !== UNAVAILABLE_STATUS) {
    issues.push({
      code: "invalid_value",
      field: "TestOrderStatus",
      record,
      message: `Unsupported CDC TestOrderStatus: ${orderStatus}`,
    });
    invalid = true;
  }
  if (offline !== null && ((offline && orderStatus !== UNAVAILABLE_STATUS) || (!offline && orderStatus !== ACCEPTING_STATUS))) {
    issues.push({
      code: "invalid_value",
      field: "TestOrderStatus",
      record,
      message: "CDC Offline and TestOrderStatus values are inconsistent.",
    });
    invalid = true;
  }
  const issueCountBeforeTurnaround = issues.length;
  const turnaroundTime = parseTurnaround(fields, record, issues);
  if (issues.length > issueCountBeforeTurnaround) invalid = true;
  if ([offline, clia, priorApprovalRequired, human, animal, other].some((value) => value === null)) {
    invalid = true;
  }
  if (invalid) return null;

  const testName = normalizedText(fields.get("TestOrderNamSort"))!;
  const aliases = [
    normalizedText(fields.get("TestOrderNam")),
    ...normalizedList(fields.get("TestOrderSynonym")),
  ].filter((value): value is string => Boolean(value) && value !== testName);
  const uniqueAliases = [...new Set(aliases)].toSorted((left, right) => left.localeCompare(right));
  const reviewFlags: string[] = [];
  if (offline) reviewFlags.push("source_offline");
  if (orderStatus === UNAVAILABLE_STATUS) reviewFlags.push("source_status_unavailable");
  if (!clia) reviewFlags.push("non_clia");
  if (priorApprovalRequired) reviewFlags.push("prior_approval_required");
  return {
    externalRecordId,
    providerId: "cdc-infectious-diseases-laboratories",
    providerName: "CDC Infectious Diseases Laboratories",
    sourceTestId: normalizedText(fields.get("TestID")),
    sourceLabId: normalizedText(fields.get("LabID")),
    sourceUnitNumber: normalizedText(fields.get("UnitNumber")),
    testName,
    aliases: uniqueAliases,
    method: normalizedText(fields.get("Method")),
    turnaroundTimeText: normalizedText(fields.get("TurnAround")),
    turnaroundTime,
    acceptableSampleForTestingText: normalizedNarrativeText(
      fields.get("AcceptableSampleForTesting"),
    ),
    minimumVolume: normalizedText(fields.get("MinimumVolume")),
    storageAndPreservation: normalizedText(fields.get("StorageAndPreservation")),
    transport: normalizedText(fields.get("Transport")),
    shippingInstructions: normalizedText(fields.get("ShippingInstructions")),
    interferencesAndLimitations: normalizedText(fields.get("InterferencesLimitations")),
    additionalInformation: normalizedText(fields.get("AdditionalInfo")),
    supplementalInformationRequired: normalizedNarrativeText(
      fields.get("SupplementalInformationRequired"),
    ),
    specimenLabeling: normalizedNarrativeText(fields.get("SpecimenLabeling")),
    sourceLinkText: normalizedText(fields.get("Link")),
    legacyLinkText: normalizedText(fields.get("Linkold")),
    sourceLinks: sourceLinks(fields),
    orderStatus,
    offline: offline!,
    clia: clia!,
    priorApprovalRequired: priorApprovalRequired!,
    performedOn: { human: human!, animal: animal!, other: other! },
    contacts: {
      cdc: contacts(fields, "CDCPOC", 4),
      priorApproval: contacts(fields, "PriorApproval", 2),
    },
    sourceVersion: normalizedText(fields.get("Version"))!,
    detailUrl: `https://www.cdc.gov/laboratory/specimen-submission/detail.html?CDCTestCode=${encodeURIComponent(externalRecordId)}`,
    reviewFlags,
    candidateState: reviewFlags.length > 0 ? "discovered-review-required" : "discovered",
  };
}

export function parseCdcTestDirectoryXml(input: string): CdcTestDirectoryParseResult {
  const document = unwrapDocument(input);
  const parsed = readRecords(document.content);
  const issues = [...parsed.issues];
  const candidates: CdcTestDirectoryCandidate[] = [];
  const identities = new Set<string>();

  parsed.records.forEach((fields, index) => {
    const issueCountBefore = issues.length;
    const candidate = buildCandidate(fields, index + 1, issues);
    if (!candidate || issues.length > issueCountBefore) return;
    if (identities.has(candidate.externalRecordId)) {
      issues.push({
        code: "duplicate_id",
        field: "CDCTestCode",
        record: index + 1,
        message: `Duplicate CDC test code: ${candidate.externalRecordId}`,
      });
      return;
    }
    identities.add(candidate.externalRecordId);
    candidates.push(candidate);
  });

  if (issues.some((issue) => issue.code === "schema_drift")) {
    return { sourceGeneratedAt: document.sourceGeneratedAt, candidates: [], issues };
  }

  return {
    sourceGeneratedAt: document.sourceGeneratedAt,
    candidates: candidates.toSorted((left, right) =>
      left.externalRecordId.localeCompare(right.externalRecordId)),
    issues,
  };
}
import { isCdcSourceGeneratedAtValue } from "./cdc-source-generated-at.shared.mjs";
