export function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join(" | ") : String(value);
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replaceAll('"', '""')}"` : safeText;
}

export function buildRecordsCsv(catalog) {
  const assays = new Map(catalog.assays.map((assay) => [assay.slug, assay]));
  const labs = new Map(catalog.labs.map((lab) => [lab.id, lab]));
  const columns = [
    "record_id",
    "assay_slug",
    "assay_name",
    "laboratory_id",
    "laboratory_name",
    "test_name",
    "test_code",
    "test_id",
    "order_code",
    "category",
    "specimen_type",
    "methodology",
    "turnaround_time",
    "source_listed_prices",
    "price_source_urls",
    "cpt_codes",
    "loinc_codes",
    "source_urls",
    "source_verified_at",
    "updated_at",
  ];
  const rows = catalog.assayLabRecords
    .filter(
      (record) =>
        record.publicationStatus === "published" &&
        assays.get(record.assaySlug)?.status === "published",
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((record) => [
      record.id,
      record.assaySlug,
      assays.get(record.assaySlug)?.displayName ?? "",
      record.labId,
      labs.get(record.labId)?.displayName ?? "",
      record.testName,
      record.testCode,
      record.testId,
      record.orderCode,
      record.category,
      record.specimenType,
      record.methodology,
      record.turnaroundTime,
      record.priceObservations?.map((price) => price.sourceText) ?? [],
      record.priceObservations?.map((price) => price.sourceUrl) ?? [],
      record.cptCodes,
      record.loincCodes,
      record.sourceLinks.map((link) => link.url),
      record.sourceVerifiedAt,
      record.updatedAt,
    ]);

  return `${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildSourceOfferingsCsv(catalog, sourceAttributions = {}) {
  const assays = new Map(catalog.assays.map((assay) => [assay.slug, assay]));
  const labs = new Map(catalog.labs.map((lab) => [lab.id, lab]));
  const columns = [
    "offering_id",
    "assay_slug",
    "assay_name",
    "laboratory_id",
    "laboratory_name",
    "source_id",
    "source_publisher_id",
    "source_attribution",
    "source_attribution_url",
    "source_disclaimer",
    "external_record_id",
    "test_name",
    "aliases",
    "source_test_id",
    "source_lab_id",
    "source_unit_number",
    "methodology",
    "turnaround_time",
    "turnaround_time_value",
    "turnaround_time_unit",
    "acceptable_sample_for_testing",
    "minimum_volume",
    "storage_and_preservation",
    "transport",
    "shipping_instructions",
    "interferences_and_limitations",
    "additional_information",
    "supplemental_information_required",
    "specimen_labeling",
    "source_link_text",
    "legacy_link_text",
    "order_status",
    "offline",
    "clia",
    "prior_approval_required",
    "performed_on_human",
    "performed_on_animal",
    "performed_on_other",
    "source_presence",
    "cdc_contacts_json",
    "prior_approval_contacts_json",
    "source_version",
    "source_links_json",
    "attention_flags",
    "snapshot_sha256",
    "candidate_sha256",
    "retrieved_at",
    "source_updated_at",
    "first_seen_at",
    "last_seen_at",
    "missing_since",
    "detail_url",
    "publication_status",
    "updated_at",
  ];
  const rows = (catalog.sourceOfferings ?? [])
    .filter((offering) => offering.publicationStatus === "published")
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((offering) => {
      const attribution = sourceAttributions[offering.sourceId] ?? {};
      return [
        offering.id,
        offering.assaySlug,
        offering.assaySlug ? assays.get(offering.assaySlug)?.displayName ?? "" : "",
        offering.labId,
        labs.get(offering.labId)?.displayName ?? "",
        offering.sourceId,
        offering.sourcePublisherId,
        attribution.requiredAttribution ?? null,
        attribution.requiredAttributionUrl ?? null,
        attribution.disclaimer ?? null,
        offering.externalRecordId,
        offering.testName,
        offering.aliases,
        offering.sourceTestId,
        offering.sourceLabId,
        offering.sourceUnitNumber,
        offering.methodology,
        offering.turnaroundTime,
        offering.structuredTurnaroundTime?.value ?? null,
        offering.structuredTurnaroundTime?.unit ?? null,
        offering.acceptableSampleForTesting,
        offering.minimumVolume,
        offering.storageAndPreservation,
        offering.transport,
        offering.shippingInstructions,
        offering.interferencesAndLimitations,
        offering.additionalInformation,
        offering.supplementalInformationRequired,
        offering.specimenLabeling,
        offering.sourceLinkText,
        offering.legacyLinkText,
        offering.availability.orderStatus,
        offering.availability.offline,
        offering.availability.clia,
        offering.availability.priorApprovalRequired,
        offering.availability.performedOn.human,
        offering.availability.performedOn.animal,
        offering.availability.performedOn.other,
        offering.availability.sourcePresence,
        JSON.stringify(offering.contacts.cdc),
        JSON.stringify(offering.contacts.priorApproval),
        offering.sourceVersion,
        JSON.stringify(offering.sourceLinks),
        offering.attentionFlags,
        offering.provenance.snapshotSha256,
        offering.provenance.candidateSha256,
        offering.provenance.retrievedAt,
        offering.provenance.sourceUpdatedAt,
        offering.provenance.firstSeenAt,
        offering.provenance.lastSeenAt,
        offering.provenance.missingSince,
        offering.provenance.detailUrl,
        offering.publicationStatus,
        offering.updatedAt,
      ];
    });

  return `${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
