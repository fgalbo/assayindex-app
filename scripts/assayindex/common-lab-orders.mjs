const LOINC_CODE_PATTERN = /^\d{1,7}-\d$/;
const ORDER_OBSERVATION_VALUES = new Set(["Order", "Observation", "Both"]);

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Universal Lab Orders CSV contains an unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
}

export function parseUniversalLabOrdersCsv(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Universal Lab Orders CSV is empty.");
  }
  const rows = parseCsvRows(text).filter((row) => row.some((field) => field.trim()));
  const header = rows.shift();
  if (JSON.stringify(header) !== JSON.stringify(["LOINC_NUM", "LONG_COMMON_NAME", "ORDER_OBS"])) {
    throw new Error("Universal Lab Orders CSV header changed unexpectedly.");
  }

  const seenCodes = new Set();
  return rows.map((row, index) => {
    if (row.length !== 3) throw new Error(`Universal Lab Orders row ${index + 2} has ${row.length} fields.`);
    const [loincCode, longCommonName, orderObservation] = row.map((field) => field.trim());
    if (!LOINC_CODE_PATTERN.test(loincCode)) {
      throw new Error(`Universal Lab Orders row ${index + 2} has an invalid LOINC code.`);
    }
    if (!longCommonName) {
      throw new Error(`Universal Lab Orders row ${index + 2} has no long common name.`);
    }
    if (!ORDER_OBSERVATION_VALUES.has(orderObservation)) {
      throw new Error(`Universal Lab Orders row ${index + 2} has an invalid ORDER_OBS value.`);
    }
    if (seenCodes.has(loincCode)) {
      throw new Error(`Universal Lab Orders contains duplicate LOINC code ${loincCode}.`);
    }
    seenCodes.add(loincCode);
    return { loincCode, longCommonName, orderObservation };
  });
}

function hasExactKeys(value, keys) {
  return JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());
}

export function parseCommonMnemonicSupplement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Common mnemonic supplement must be an object.");
  }
  if (!hasExactKeys(value, ["schemaVersion", "sourceId", "selectionVersion", "concepts"])) {
    throw new Error("Common mnemonic supplement has unexpected fields.");
  }
  if (value.schemaVersion !== "1") throw new Error("Common mnemonic supplement schema changed.");
  if (typeof value.sourceId !== "string" || !value.sourceId.trim()) {
    throw new Error("Common mnemonic supplement source ID is invalid.");
  }
  if (typeof value.selectionVersion !== "string" || !value.selectionVersion.trim()) {
    throw new Error("Common mnemonic supplement selection version is invalid.");
  }
  if (!Array.isArray(value.concepts) || value.concepts.length === 0) {
    throw new Error("Common mnemonic supplement must contain concepts.");
  }

  const seenIds = new Set();
  const seenCodes = new Set();
  const concepts = value.concepts.map((concept) => {
    if (!concept || typeof concept !== "object" || Array.isArray(concept)) {
      throw new Error("Common mnemonic supplement concept is invalid.");
    }
    if (!hasExactKeys(concept, ["id", "loincCodes"])) {
      throw new Error("Common mnemonic supplement concept has unexpected fields.");
    }
    if (typeof concept.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(concept.id)) {
      throw new Error("Common mnemonic supplement concept ID is invalid.");
    }
    if (seenIds.has(concept.id)) throw new Error(`Duplicate mnemonic supplement ID ${concept.id}.`);
    seenIds.add(concept.id);
    if (!Array.isArray(concept.loincCodes) || concept.loincCodes.length === 0) {
      throw new Error(`Mnemonic supplement ${concept.id} must contain LOINC codes.`);
    }
    const loincCodes = concept.loincCodes.map((code) => {
      if (typeof code !== "string" || !LOINC_CODE_PATTERN.test(code)) {
        throw new Error(`Mnemonic supplement ${concept.id} has an invalid LOINC code.`);
      }
      if (seenCodes.has(code)) throw new Error(`Duplicate mnemonic supplement LOINC code ${code}.`);
      seenCodes.add(code);
      return code;
    });
    return { id: concept.id, loincCodes };
  });

  return {
    schemaVersion: "1",
    sourceId: value.sourceId.trim(),
    selectionVersion: value.selectionVersion.trim(),
    concepts,
  };
}

function requireParallelArray(value, expectedLength, field) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(`NLM Clinical Tables response has an invalid ${field} array.`);
  }
  return value;
}

function optionalText(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("NLM Clinical Tables returned a non-text field.");
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseNlmClinicalTablesResponse(payload) {
  if (!Array.isArray(payload) || payload.length < 4) {
    throw new Error("NLM Clinical Tables response shape changed unexpectedly.");
  }
  const codes = payload[1];
  const fields = payload[2];
  if (!Array.isArray(codes) || !fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("NLM Clinical Tables response is missing codes or fields.");
  }
  const shortNames = requireParallelArray(fields.SHORTNAME, codes.length, "SHORTNAME");
  const consumerNames = requireParallelArray(fields.CONSUMER_NAME, codes.length, "CONSUMER_NAME");
  const relatedNames = requireParallelArray(fields.RELATEDNAMES2, codes.length, "RELATEDNAMES2");
  const longCommonNames = requireParallelArray(fields.LONG_COMMON_NAME, codes.length, "LONG_COMMON_NAME");
  const entries = new Map();

  codes.forEach((code, index) => {
    if (typeof code !== "string" || !LOINC_CODE_PATTERN.test(code)) {
      throw new Error("NLM Clinical Tables returned an invalid LOINC code.");
    }
    const shortName = optionalText(shortNames[index]);
    if (!shortName) throw new Error(`NLM Clinical Tables returned no SHORTNAME for ${code}.`);
    const longCommonName = optionalText(longCommonNames[index]);
    if (!longCommonName) throw new Error(`NLM Clinical Tables returned no LONG_COMMON_NAME for ${code}.`);
    if (entries.has(code)) {
      throw new Error(`NLM Clinical Tables returned duplicate LOINC code ${code}.`);
    }
    const related = optionalText(relatedNames[index]);
    entries.set(code, {
      longCommonName,
      shortName,
      consumerName: optionalText(consumerNames[index]),
      relatedNames: related
        ? [...new Set(related.split(";").map((value) => value.trim()).filter(Boolean))]
        : [],
    });
  });
  return entries;
}

export function buildCommonLabOrderTerminologyIndex({
  sourceEntries,
  mnemonicSupplement,
  enrichedByCode,
  sourceSha256,
  supplementCodeSetSha256,
  sourceUpdatedAt,
  retrievedAt,
  enrichmentResponseSha256,
  enrichmentBatchCount,
}) {
  const validatedMnemonicSupplement = parseCommonMnemonicSupplement(mnemonicSupplement);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error("Source SHA-256 is invalid.");
  if (!/^[a-f0-9]{64}$/.test(supplementCodeSetSha256)) {
    throw new Error("Mnemonic supplement code-set SHA-256 is invalid.");
  }
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("Retrieved timestamp is invalid.");
  if (sourceUpdatedAt !== null && !Number.isFinite(Date.parse(sourceUpdatedAt))) {
    throw new Error("Source update timestamp is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(enrichmentResponseSha256)) {
    throw new Error("Enrichment response SHA-256 is invalid.");
  }
  if (!Number.isInteger(enrichmentBatchCount) || enrichmentBatchCount < 1) {
    throw new Error("Enrichment batch count is invalid.");
  }

  const sourceCodeSet = new Set(sourceEntries.map((entry) => entry.loincCode));
  const supplementalCodes = validatedMnemonicSupplement.concepts.flatMap((concept) => concept.loincCodes);
  for (const code of supplementalCodes) {
    if (sourceCodeSet.has(code)) {
      throw new Error(`Mnemonic supplement code ${code} is now present in the Common Lab Orders source.`);
    }
  }

  const commonOrderEntries = sourceEntries.flatMap((sourceEntry) => {
    const enrichment = enrichedByCode.get(sourceEntry.loincCode);
    return enrichment
      ? [{
          ...sourceEntry,
          sourceScope: "common-order-value-set",
          shortName: enrichment.shortName,
          consumerName: enrichment.consumerName,
          relatedNames: enrichment.relatedNames,
        }]
      : [];
  });
  const supplementalEntries = supplementalCodes.map((loincCode) => {
    const enrichment = enrichedByCode.get(loincCode);
    if (!enrichment) {
      throw new Error(`NLM enrichment did not return mnemonic supplement code ${loincCode}.`);
    }
    return {
      loincCode,
      longCommonName: enrichment.longCommonName,
      orderObservation: null,
      sourceScope: "assayindex-mnemonic-supplement",
      shortName: enrichment.shortName,
      consumerName: enrichment.consumerName,
      relatedNames: enrichment.relatedNames,
    };
  });
  const entries = [...commonOrderEntries, ...supplementalEntries].toSorted(
    (left, right) =>
      left.longCommonName.localeCompare(right.longCommonName) ||
      left.loincCode.localeCompare(right.loincCode),
  );
  const excludedEntryCount = sourceEntries.length - commonOrderEntries.length;
  if (sourceEntries.length < 1_000 || commonOrderEntries.length / sourceEntries.length < 0.9) {
    throw new Error(
      `Common Lab Orders retention gate failed: ${commonOrderEntries.length}/${sourceEntries.length} entries.`,
    );
  }

  return {
    schemaVersion: "1",
    source: {
      sourceId: "nlm-loinc-universal-lab-orders-v2",
      valueSetName: "LOINC Universal Lab Orders Value Set",
      valueSetVersion: "2.0",
      sourcePageUrl: "https://lhncbc.nlm.nih.gov/CHRB/Projects/top-LOINC-codes.html",
      sourceDataUrl: "https://lhncbc.nlm.nih.gov/assets/files/LOINCUniversalLabOrdersValueSet.csv",
      searchApiUrl: "https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search",
      searchApiDocsUrl: "https://clinicaltables.nlm.nih.gov/apidoc/loinc/v3/doc.html",
      enrichment: {
        sourceId: "nlm-clinical-tables-loinc-v3",
        retrievedAt,
        responseSha256: enrichmentResponseSha256,
        batchCount: enrichmentBatchCount,
        excludeCopyrighted: true,
        loincReleaseVersion: null,
        releaseVersionStatus: "not-exposed-by-source",
      },
      mnemonicSupplement: {
        sourceId: validatedMnemonicSupplement.sourceId,
        selectionVersion: validatedMnemonicSupplement.selectionVersion,
        codeSetSha256: supplementCodeSetSha256,
        entryCount: supplementalEntries.length,
      },
      licenseUrl: "https://loinc.org/license",
      licenseNotice: "This material contains content from LOINC (http://loinc.org). LOINC is copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is available at no cost under the license at http://loinc.org/license. LOINC® is a registered United States trademark of Regenstrief Institute, Inc.",
      sourceUpdatedAt,
      retrievedAt,
      sourceSha256,
      sourceEntryCount: sourceEntries.length,
      commonOrderPublishedEntryCount: commonOrderEntries.length,
      supplementalEntryCount: supplementalEntries.length,
      publishedEntryCount: entries.length,
      excludedEntryCount,
    },
    entries,
  };
}
