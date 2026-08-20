"use client";

import Link from "next/link";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";
import type {
  Assay,
  Lab,
  SourceOffering,
  SourceOfferingContact,
} from "@/features/assayindex/domain/types";
import {
  formatDateTime,
  renderListOrFallback,
  renderValueOrFallback,
} from "@/features/assayindex/utils/formatting";

type SourceOfferingDetailPageProps = {
  offering: SourceOffering | null;
  lab: Lab | null;
  assay: Assay | null;
  sourceAttribution: {
    label: string;
    url: string;
    disclaimer: string | null;
  } | null;
};

type DetailFieldProps = {
  label: string;
  value: string | null | undefined;
};

const ATTENTION_NOTICES: Record<SourceOffering["attentionFlags"][number], string> = {
  source_offline: "CDC marks this test offering offline.",
  source_status_unavailable: "CDC currently lists this test as not accepting specimens.",
  non_clia: "CDC identifies this offering as non-CLIA testing.",
  prior_approval_required: "CDC requires prior approval before specimen submission.",
  source_missing:
    "This offering was absent from the latest source snapshot. Its last source-listed details remain available for reference.",
};

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <dl className="rounded-2xl border border-[#d9e3e8] p-4">
      <dt className="text-xs uppercase tracking-[0.16em] text-[#5a707f]">{label}</dt>
      <dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#153042]">
        {renderValueOrFallback(value)}
      </dd>
    </dl>
  );
}

function BooleanValue({ value }: { value: boolean }) {
  return <>{value ? "Yes" : "No"}</>;
}

function ContactList({ contacts }: { contacts: SourceOfferingContact[] }) {
  if (contacts.length === 0) {
    return <p className="text-sm leading-6 text-[#153042]">Not listed by source</p>;
  }

  return (
    <ul className="space-y-3">
      {contacts.map((contact, index) => (
        <li
          key={`${contact.email ?? contact.phone ?? contact.name ?? "contact"}-${index}`}
          className="rounded-2xl border border-[#d9e3e8] p-4 text-sm leading-6 text-[#153042]"
        >
          <p className="font-semibold">{renderValueOrFallback(contact.name)}</p>
          <p>{renderValueOrFallback(contact.phone)}</p>
          {contact.email ? (
            <a
              className="text-[#0f5f79] underline-offset-4 hover:underline"
              href={`mailto:${encodeURIComponent(contact.email)}`}
            >
              {contact.email}
            </a>
          ) : (
            <p>Not listed by source</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function sourceLinks(offering: SourceOffering) {
  const links = [
    ...offering.sourceLinks,
    {
      label: "CDC test directory detail",
      url: offering.provenance.detailUrl,
      sourceType: "test-page" as const,
      note: null,
    },
  ];
  const seen = new Set<string>();

  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

export function SourceOfferingDetailPage({
  offering,
  lab,
  assay,
  sourceAttribution,
}: SourceOfferingDetailPageProps) {
  if (!offering) {
    return (
      <AssayIndexShell
        title="Source offering not found"
        description="This source-listed test offering is not available in the current public catalog snapshot."
        eyebrow="AssayIndex / Source offering"
      >
        <section className="assayindex-panel p-8 text-center">
          <Link className="assayindex-nav-link assayindex-focus-ring" href="/assayindex/search">
            Search the catalog
          </Link>
        </section>
      </AssayIndexShell>
    );
  }

  const structuredTurnaround = offering.structuredTurnaroundTime
    ? `${offering.structuredTurnaroundTime.value} ${offering.structuredTurnaroundTime.unit}${
        offering.structuredTurnaroundTime.value === 1 ? "" : "s"
      }`
    : null;

  return (
    <AssayIndexShell
      title={offering.testName}
      description="A source-native laboratory test offering. Source status and operational details are preserved without hiding offline, non-CLIA, prior-approval, or source-missing records."
      eyebrow="AssayIndex / Source offering"
      actions={
        <button
          className="assayindex-nav-link assayindex-focus-ring"
          type="button"
          onClick={() => window.print()}
        >
          Print
        </button>
      }
    >
      {offering.attentionFlags.length > 0 ? (
        <section aria-label="Source notices" className="grid gap-3 md:grid-cols-2">
          {offering.attentionFlags.map((flag) => (
            <div key={flag} className="rounded-2xl border border-[#d6a85f] bg-[#fff9ed] p-4">
              <p className="text-sm font-semibold leading-6 text-[#5b3d12]">
                {ATTENTION_NOTICES[flag]}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="assayindex-panel p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="assayindex-badge">Source-listed offering</span>
          <span className="assayindex-badge">{offering.externalRecordId}</span>
          <span className="assayindex-badge">Version {offering.sourceVersion}</span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Offering ID" value={offering.id} />
          <DetailField label="Laboratory" value={lab?.displayName ?? offering.labId} />
          <DetailField label="Laboratory ID" value={offering.labId} />
          <DetailField label="Mapped assay slug" value={offering.assaySlug} />
          <DetailField label="Test name" value={offering.testName} />
          <DetailField label="Aliases" value={renderListOrFallback(offering.aliases)} />
          <DetailField label="CDC test code" value={offering.externalRecordId} />
          <DetailField label="Source test ID" value={offering.sourceTestId} />
          <DetailField label="Source lab ID" value={offering.sourceLabId} />
          <DetailField label="Source unit number" value={offering.sourceUnitNumber} />
          <DetailField label="Methodology" value={offering.methodology} />
          <DetailField label="Turnaround time" value={offering.turnaroundTime} />
          <DetailField label="Structured turnaround" value={structuredTurnaround} />
          <DetailField label="Order status" value={offering.availability.orderStatus} />
          <DetailField label="Source presence" value={offering.availability.sourcePresence} />
          <DetailField label="Publication status" value={offering.publicationStatus} />
          <DetailField label="Offering updated" value={formatDateTime(offering.updatedAt)} />
        </div>
        {assay ? (
          <p className="mt-5 text-sm leading-7 text-[#526978]">
            Mapped assay concept:{" "}
            <Link
              className="text-[#0f5f79] underline-offset-4 hover:underline"
              href={`/assayindex/assays/${assay.slug}`}
            >
              {assay.displayName}
            </Link>
          </p>
        ) : (
          <p className="mt-5 text-sm leading-7 text-[#526978]">
            This source offering remains fully browsable without a normalized assay-concept mapping.
          </p>
        )}
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <h2 className="assayindex-kicker">Availability and applicability</h2>
        <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div><dt className="font-semibold">Offline</dt><dd><BooleanValue value={offering.availability.offline} /></dd></div>
          <div><dt className="font-semibold">CLIA</dt><dd><BooleanValue value={offering.availability.clia} /></dd></div>
          <div><dt className="font-semibold">Prior approval required</dt><dd><BooleanValue value={offering.availability.priorApprovalRequired} /></dd></div>
          <div><dt className="font-semibold">Performed on human specimens</dt><dd><BooleanValue value={offering.availability.performedOn.human} /></dd></div>
          <div><dt className="font-semibold">Performed on animal specimens</dt><dd><BooleanValue value={offering.availability.performedOn.animal} /></dd></div>
          <div><dt className="font-semibold">Food, environmental, or medical biologics</dt><dd><BooleanValue value={offering.availability.performedOn.other} /></dd></div>
        </dl>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <h2 className="assayindex-kicker">Specimen and submission details</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <DetailField label="Acceptable samples" value={offering.acceptableSampleForTesting} />
          <DetailField label="Minimum volume" value={offering.minimumVolume} />
          <DetailField label="Storage and preservation" value={offering.storageAndPreservation} />
          <DetailField label="Transport" value={offering.transport} />
          <DetailField label="Shipping instructions" value={offering.shippingInstructions} />
          <DetailField label="Supplemental information required" value={offering.supplementalInformationRequired} />
          <DetailField label="Specimen labeling" value={offering.specimenLabeling} />
          <DetailField label="Interferences and limitations" value={offering.interferencesAndLimitations} />
          <DetailField label="Additional information" value={offering.additionalInformation} />
          <DetailField label="Source link text" value={offering.sourceLinkText} />
          <DetailField label="Legacy link text" value={offering.legacyLinkText} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="assayindex-panel p-5 md:p-6">
          <h2 className="assayindex-kicker">CDC professional contacts</h2>
          <div className="mt-4"><ContactList contacts={offering.contacts.cdc} /></div>
        </article>
        <article className="assayindex-panel p-5 md:p-6">
          <h2 className="assayindex-kicker">Prior-approval contacts</h2>
          <div className="mt-4"><ContactList contacts={offering.contacts.priorApproval} /></div>
        </article>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <h2 className="assayindex-kicker">Provenance</h2>
        {sourceAttribution ? (
          <div className="mt-4 rounded-2xl border border-[#d9e3e8] bg-[#f7fafb] p-4 text-sm leading-6 text-[#526978]">
            <p>
              Source: {" "}
              <a
                className="font-semibold text-[#0f5f79] underline-offset-4 hover:underline"
                href={sourceAttribution.url}
                rel="noreferrer"
                target="_blank"
              >
                {sourceAttribution.label}
              </a>
            </p>
            {sourceAttribution.disclaimer ? (
              <p className="mt-2">{sourceAttribution.disclaimer}</p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Source dataset" value={offering.sourceId} />
          <DetailField label="Source publisher" value={offering.sourcePublisherId} />
          <DetailField label="Snapshot SHA-256" value={offering.provenance.snapshotSha256} />
          <DetailField label="Candidate SHA-256" value={offering.provenance.candidateSha256} />
          <DetailField label="Retrieved" value={formatDateTime(offering.provenance.retrievedAt)} />
          <DetailField label="Source updated" value={offering.provenance.sourceUpdatedAt ? formatDateTime(offering.provenance.sourceUpdatedAt) : null} />
          <DetailField label="First seen" value={formatDateTime(offering.provenance.firstSeenAt)} />
          <DetailField label="Last seen" value={formatDateTime(offering.provenance.lastSeenAt)} />
          <DetailField label="Missing since" value={offering.provenance.missingSince ? formatDateTime(offering.provenance.missingSince) : null} />
        </div>
        <ul className="mt-5 space-y-2 text-sm leading-6">
          {sourceLinks(offering).map((link) => (
            <li key={link.url}>
              <a
                className="text-[#0f5f79] underline-offset-4 hover:underline"
                href={link.url}
                rel="noreferrer"
                target="_blank"
              >
                {link.label}
              </a>
              <span className="ml-2 text-[#617886]">({link.sourceType})</span>
              {link.note ? <p className="text-[#617886]">{link.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </AssayIndexShell>
  );
}
