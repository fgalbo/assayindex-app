import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import publishedRelease from "@/features/assayindex/data/published/release.json";
import {
  DownloadsPage,
  type DownloadRelease,
} from "@/features/assayindex/pages/downloads-page";
import sourceAttributionArtifact from "@/public/assayindex/downloads/SOURCE-ATTRIBUTION.json";
import { buildSourceOfferingsCsv } from "@/scripts/assayindex/download-csv.mjs";

const CDC_SOURCE_ID = "cdc-infectious-diseases-test-directory";
const CDC_PROVIDER_ID = "cdc-infectious-diseases-laboratories";
const CDC_REQUIRED_ATTRIBUTION =
  "Centers for Disease Control and Prevention (CDC), Infectious Diseases Laboratory Test Directory";
const CDC_REQUIRED_ATTRIBUTION_URL =
  "https://www.cdc.gov/infectious-diseases-labs/php/test-directory/index.html";
const CDC_DISCLAIMER =
  "Source: CDC. AssayIndex is not endorsed by CDC, HHS, or the U.S. Government. The original Test Directory is available from CDC at no charge and is continually updated; verify current requirements with CDC.";
const CDC_SOURCE_ATTRIBUTIONS = {
  [CDC_SOURCE_ID]: {
    requiredAttribution: CDC_REQUIRED_ATTRIBUTION,
    requiredAttributionUrl: CDC_REQUIRED_ATTRIBUTION_URL,
    disclaimer: CDC_DISCLAIMER,
  },
};

const SOURCE_OFFERING_COLUMNS = [
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
] as const;

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" && input[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("CSV ended inside a quoted cell.");
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function rowsByHeader(csv: string) {
  const [header, ...rows] = parseCsv(csv);
  const indexes = new Map(header.map((column, index) => [column, index]));
  const read = (row: string[], column: string) => {
    const index = indexes.get(column);
    if (index === undefined) throw new Error(`Missing CSV column: ${column}`);
    return row[index];
  };
  return { header, rows, read };
}

function buildCdcSourceOfferingsCsv(catalog = publishedCatalog) {
  return buildSourceOfferingsCsv(catalog, CDC_SOURCE_ATTRIBUTIONS);
}

describe("source-offering CSV export", () => {
  it("exports all 250 published offerings once in stable offering-ID order", () => {
    expect(publishedCatalog.sourceOfferings).toHaveLength(250);

    const first = buildCdcSourceOfferingsCsv();
    const reversedCatalog = structuredClone(publishedCatalog);
    reversedCatalog.sourceOfferings?.reverse();
    const second = buildCdcSourceOfferingsCsv(reversedCatalog);
    const parsed = rowsByHeader(first);
    const exportedIds = parsed.rows.map((row) => parsed.read(row, "offering_id"));
    const expectedIds = publishedCatalog.sourceOfferings!
      .map((offering) => offering.id)
      .toSorted((left, right) => left.localeCompare(right));

    expect(second).toBe(first);
    expect(parsed.header).toEqual(SOURCE_OFFERING_COLUMNS);
    expect(parsed.header).toHaveLength(54);
    expect(parsed.rows).toHaveLength(250);
    expect(new Set(exportedIds).size).toBe(250);
    expect(exportedIds).toEqual(expectedIds);
  });

  it("preserves source, provider, status, attention, contact, link, and provenance fields", () => {
    const parsed = rowsByHeader(buildCdcSourceOfferingsCsv());
    const offering = publishedCatalog.sourceOfferings!.find(
      (candidate) => candidate.externalRecordId === "CDC-10106",
    );
    const row = parsed.rows.find(
      (candidate) => parsed.read(candidate, "external_record_id") === "CDC-10106",
    );

    expect(offering).toBeDefined();
    expect(row).toBeDefined();
    expect(parsed.read(row!, "offering_id")).toBe(offering!.id);
    expect(parsed.read(row!, "laboratory_id")).toBe(offering!.labId);
    expect(parsed.read(row!, "laboratory_name")).toBe(
      "CDC Infectious Diseases Laboratories",
    );
    expect(parsed.read(row!, "source_id")).toBe(offering!.sourceId);
    expect(parsed.read(row!, "source_publisher_id")).toBe(offering!.sourcePublisherId);
    expect(parsed.read(row!, "source_attribution")).toBe(CDC_REQUIRED_ATTRIBUTION);
    expect(parsed.read(row!, "source_attribution_url")).toBe(CDC_REQUIRED_ATTRIBUTION_URL);
    expect(parsed.read(row!, "source_disclaimer")).toBe(CDC_DISCLAIMER);
    expect(parsed.read(row!, "test_name")).toBe(offering!.testName);
    expect(parsed.read(row!, "aliases")).toBe(offering!.aliases.join(" | "));
    expect(parsed.read(row!, "methodology")).toBe(offering!.methodology);
    expect(parsed.read(row!, "turnaround_time")).toBe(offering!.turnaroundTime ?? "");
    expect(parsed.read(row!, "acceptable_sample_for_testing")).toBe(
      offering!.acceptableSampleForTesting,
    );
    expect(parsed.read(row!, "shipping_instructions")).toBe(offering!.shippingInstructions);
    expect(parsed.read(row!, "order_status")).toBe(offering!.availability.orderStatus);
    expect(parsed.read(row!, "offline")).toBe(String(offering!.availability.offline));
    expect(parsed.read(row!, "clia")).toBe(String(offering!.availability.clia));
    expect(parsed.read(row!, "prior_approval_required")).toBe(
      String(offering!.availability.priorApprovalRequired),
    );
    expect(parsed.read(row!, "performed_on_human")).toBe(
      String(offering!.availability.performedOn.human),
    );
    expect(parsed.read(row!, "performed_on_animal")).toBe(
      String(offering!.availability.performedOn.animal),
    );
    expect(parsed.read(row!, "performed_on_other")).toBe(
      String(offering!.availability.performedOn.other),
    );
    expect(parsed.read(row!, "source_presence")).toBe(offering!.availability.sourcePresence);
    expect(JSON.parse(parsed.read(row!, "cdc_contacts_json"))).toEqual(offering!.contacts.cdc);
    expect(JSON.parse(parsed.read(row!, "prior_approval_contacts_json"))).toEqual(
      offering!.contacts.priorApproval,
    );
    expect(JSON.parse(parsed.read(row!, "source_links_json"))).toEqual(offering!.sourceLinks);
    expect(parsed.read(row!, "attention_flags")).toBe(offering!.attentionFlags.join(" | "));
    expect(parsed.read(row!, "source_version")).toBe(offering!.sourceVersion);
    expect(parsed.read(row!, "snapshot_sha256")).toBe(offering!.provenance.snapshotSha256);
    expect(parsed.read(row!, "candidate_sha256")).toBe(offering!.provenance.candidateSha256);
    expect(parsed.read(row!, "retrieved_at")).toBe(offering!.provenance.retrievedAt);
    expect(parsed.read(row!, "source_updated_at")).toBe(
      offering!.provenance.sourceUpdatedAt ?? "",
    );
    expect(parsed.read(row!, "first_seen_at")).toBe(offering!.provenance.firstSeenAt);
    expect(parsed.read(row!, "last_seen_at")).toBe(offering!.provenance.lastSeenAt);
    expect(parsed.read(row!, "missing_since")).toBe(offering!.provenance.missingSince ?? "");
    expect(parsed.read(row!, "detail_url")).toBe(offering!.provenance.detailUrl);
    expect(parsed.read(row!, "publication_status")).toBe("published");
    expect(parsed.read(row!, "updated_at")).toBe(offering!.updatedAt);
  });

  it("embeds exact source-keyed CDC attribution in every published offering row", () => {
    const parsed = rowsByHeader(buildCdcSourceOfferingsCsv());

    expect(parsed.rows).toHaveLength(250);
    for (const row of parsed.rows) {
      expect(parsed.read(row, "source_id")).toBe(CDC_SOURCE_ID);
      expect(parsed.read(row, "source_attribution")).toBe(CDC_REQUIRED_ATTRIBUTION);
      expect(parsed.read(row, "source_attribution_url")).toBe(CDC_REQUIRED_ATTRIBUTION_URL);
      expect(parsed.read(row, "source_disclaimer")).toBe(CDC_DISCLAIMER);
    }
  });

  it("neutralizes spreadsheet-formula prefixes in ordinary and multiline cells", () => {
    const catalog = structuredClone(publishedCatalog);
    const offering = catalog.sourceOfferings![0];
    offering.testName = "=HYPERLINK(\"https://example.test\")";
    offering.methodology = "@SUM(A1:A2)";
    offering.additionalInformation = "+cmd";
    offering.specimenLabeling = "\tformula";
    offering.legacyLinkText = "\rformula";
    offering.availability.orderStatus = "-1";
    offering.contacts.cdc = [
      { name: "=formula inside JSON", phone: null, email: null },
    ];

    const parsed = rowsByHeader(buildCdcSourceOfferingsCsv(catalog));
    const row = parsed.rows.find(
      (candidate) => parsed.read(candidate, "offering_id") === offering.id,
    );

    expect(row).toBeDefined();
    expect(parsed.read(row!, "test_name")).toBe("'=HYPERLINK(\"https://example.test\")");
    expect(parsed.read(row!, "methodology")).toBe("'@SUM(A1:A2)");
    expect(parsed.read(row!, "additional_information")).toBe("'+cmd");
    expect(parsed.read(row!, "specimen_labeling")).toBe("'\tformula");
    expect(parsed.read(row!, "legacy_link_text")).toBe("'\rformula");
    expect(parsed.read(row!, "order_status")).toBe("'-1");
    expect(JSON.parse(parsed.read(row!, "cdc_contacts_json"))).toEqual(offering.contacts.cdc);
    expect(row!.every((cell) => !/^[=+\-@\t\r]/.test(cell))).toBe(true);
  });
});

describe("source-offering download messaging", () => {
  it("links source offerings and attribution with source-batch validation wording", () => {
    const release = structuredClone(publishedRelease) as DownloadRelease;

    render(<DownloadsPage release={release} />);

    expect(screen.getByRole("link", { name: "Download Source offerings CSV" })).toHaveAttribute(
      "href",
      "/assayindex/downloads/source-offerings.csv",
    );
    expect(screen.getByRole("link", { name: "Download Source attribution" })).toHaveAttribute(
      "href",
      "/assayindex/downloads/SOURCE-ATTRIBUTION.json",
    );
    expect(
      screen.getByText(
        /source batches publish after automated integrity, provenance, and release-policy validation—not page-by-page approval/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/candidate records never appear here before review/i)).not.toBeInTheDocument();
  });

  it("publishes exact CDC attribution under the acquisition source ID", () => {
    const artifactEntries = sourceAttributionArtifact.sources.filter(
      (entry) => entry.sourceId === CDC_SOURCE_ID,
    );
    const releaseEntries = publishedRelease.sourceAttributions.filter(
      (entry) => entry.sourceId === CDC_SOURCE_ID,
    );
    const attributionDownload = publishedRelease.downloads.find(
      (download) => download.id === "source-attribution",
    );
    const attributionArtifactText = readFileSync(
      resolve(process.cwd(), "public", "assayindex", "downloads", "SOURCE-ATTRIBUTION.json"),
      "utf8",
    );
    const attributionArtifactSha256 = createHash("sha256")
      .update(attributionArtifactText, "utf8")
      .digest("hex");
    const releaseChecksums = readFileSync(
      resolve(process.cwd(), "public", "assayindex", "downloads", "SHA256SUMS.txt"),
      "utf8",
    );

    expect(artifactEntries).toHaveLength(1);
    expect(releaseEntries).toHaveLength(1);
    for (const entry of [...artifactEntries, ...releaseEntries]) {
      expect(entry).toMatchObject({
        sourceId: CDC_SOURCE_ID,
        requiredAttribution: CDC_REQUIRED_ATTRIBUTION,
        requiredAttributionUrl: CDC_REQUIRED_ATTRIBUTION_URL,
        disclaimer: CDC_DISCLAIMER,
      });
    }
    expect(sourceAttributionArtifact.sources.some((entry) => entry.sourceId === CDC_PROVIDER_ID)).toBe(
      false,
    );
    expect(publishedRelease.sourceAttributions.some((entry) => entry.sourceId === CDC_PROVIDER_ID)).toBe(
      false,
    );
    expect(attributionDownload).toMatchObject({
      id: "source-attribution",
      label: "Source attribution",
      href: "/assayindex/downloads/SOURCE-ATTRIBUTION.json",
      sha256: attributionArtifactSha256,
      bytes: new TextEncoder().encode(attributionArtifactText).byteLength,
    });
    expect(releaseChecksums).toContain(
      `${attributionArtifactSha256}  SOURCE-ATTRIBUTION.json\n`,
    );
  });

  it("describes an unavailable release as an incomplete source-level batch, not pending page review", () => {
    render(<DownloadsPage release={null} />);

    expect(
      screen.getByText(
        /no source-authorized batch has completed the integrity, provenance, and release-policy gates yet/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/curator review|individual page review/i)).not.toBeInTheDocument();
  });
});
