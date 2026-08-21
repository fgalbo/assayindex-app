"use client";

import { useRef, useState } from "react";

import {
  LABORATORY_SOURCE_IDS,
  type FederatedSearchResponse,
  type LaboratorySourceId,
  type ParsedSourceOffering,
  type SourceSearchReference,
} from "@/features/assayindex/federated/types";
import {
  federatedDetailResponseSchema,
  federatedSearchResponseSchema,
} from "@/features/assayindex/federated/schema";
import { loincRecordUrl } from "@/features/assayindex/utils/loinc";

const SOURCE_NAMES: Record<LaboratorySourceId, string> = {
  arup: "ARUP Laboratories",
  mayo: "Mayo Clinic Laboratories",
  quest: "Quest Diagnostics",
  labcorp: "Labcorp",
};

const UNVERIFIED_WARNING =
  "This result was retrieved from the laboratory’s current test directory and has not yet been reviewed or verified by AssayIndex.";

type SearchState =
  | { status: "idle"; data: null; submittedQuery: null }
  | { status: "loading"; data: null; submittedQuery: string }
  | { status: "success"; data: FederatedSearchResponse; submittedQuery: string }
  | { status: "error"; data: null; submittedQuery: string };

type DetailState =
  | { status: "loading"; parsed: null }
  | { status: "success"; parsed: ParsedSourceOffering }
  | { status: "error"; parsed: null };

function DetailSummary({ parsed }: { parsed: ParsedSourceOffering }) {
  const specimen = parsed.specimenOptions[0];
  return (
    <div className="assayindex-provenance mt-4 p-4 text-sm leading-6">
      <p className="font-semibold text-[#153042]">Current official detail</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <p><span className="font-semibold">Methodology:</span> {parsed.methodology ?? "Not listed by source"}</p>
        <p><span className="font-semibold">Turnaround:</span> {parsed.turnaroundTime ?? "Not listed by source"}</p>
        <p><span className="font-semibold">Specimen / collection:</span> {specimen?.specimenType ?? "Not listed by source"}</p>
        <p><span className="font-semibold">Minimum volume:</span> {specimen?.minimumVolume ?? "Not listed by source"}</p>
        <p>
          <span className="font-semibold">Billing codes:</span>{" "}
          <a className="text-[#0f5f79] underline-offset-4 hover:underline" href={parsed.sourceUrl} rel="noreferrer" target="_blank">
            Verify at the official source
          </a>
          {" "}(CPT content is not republished by AssayIndex.)
        </p>
        <p>
          <span className="font-semibold">LOINC:</span>{" "}
          {parsed.loincCodes.length > 0
            ? parsed.loincCodes.map((code, index) => {
                const href = loincRecordUrl(code);
                return (
                  <span key={code}>
                    {index > 0 ? ", " : null}
                    {href ? (
                      <a className="text-[#0f5f79] underline-offset-4 hover:underline" href={href} rel="noreferrer" target="_blank">
                        {code}
                      </a>
                    ) : code}
                  </span>
                );
              })
            : "Not listed by source"}
        </p>
      </div>
      {parsed.parseWarnings.length > 0 ? (
        <p className="mt-2 text-amber-950">Parser notes: {parsed.parseWarnings.join(" ")}</p>
      ) : null}
    </div>
  );
}

function SourceCandidateCard({
  candidate,
  detail,
  onLoadDetails,
}: {
  candidate: SourceSearchReference;
  detail: DetailState | undefined;
  onLoadDetails: () => void;
}) {
  return (
    <article className="assayindex-result assayindex-result--live rounded-2xl border border-[#d8e3e8] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="assayindex-badge assayindex-badge--live">
          Live Source Candidate
        </span>
        <span className="assayindex-metadata">
          {SOURCE_NAMES[candidate.sourceLab]}
          {candidate.sourceTestCode ? ` · ${candidate.sourceTestCode}` : ""}
        </span>
      </div>
      <h3 className="mt-3 text-xl font-semibold text-[#102435]">{candidate.title}</h3>
      {candidate.orderingRecommendation ? (
        <p className="mt-2 text-sm leading-6 text-[#455b69]">{candidate.orderingRecommendation}</p>
      ) : candidate.summary ? (
        <p className="mt-2 text-sm leading-6 text-[#455b69]">{candidate.summary}</p>
      ) : null}
      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
        {UNVERIFIED_WARNING}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="assayindex-action assayindex-action--primary assayindex-focus-ring"
          href={candidate.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open official source
        </a>
        <button
          className="assayindex-action assayindex-focus-ring"
          disabled={detail?.status === "loading"}
          type="button"
          onClick={onLoadDetails}
        >
          {detail?.status === "loading" ? "Loading current details…" : "Load current details"}
        </button>
      </div>
      {detail?.status === "success" ? <DetailSummary parsed={detail.parsed} /> : null}
      {detail?.status === "error" ? (
        <p className="mt-3 text-sm text-amber-950" role="status">
          Current source details could not be loaded. The official link remains available.
        </p>
      ) : null}
      <p className="assayindex-metadata mt-3 leading-5">
        Curator import is not configured for this testing release. Nothing shown here enters the public catalog.
      </p>
    </article>
  );
}

export function FederatedSourceSearch({ query }: { query: string }) {
  const [state, setState] = useState<SearchState>({ status: "idle", data: null, submittedQuery: null });
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const searchController = useRef<AbortController | null>(null);
  const normalizedQuery = query.trim();
  const isCurrentSubmission = state.submittedQuery === normalizedQuery;
  const isCurrentLoading = isCurrentSubmission && state.status === "loading";

  const runSearch = async () => {
    const submittedQuery = query.trim();
    if (submittedQuery.length < 2) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setDetails({});
    setState({ status: "loading", data: null, submittedQuery });
    try {
      const response = await fetch("/api/assayindex/source-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: submittedQuery, sources: LABORATORY_SOURCE_IDS, refresh: false }),
        cache: "no-store",
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      const parsedBody = federatedSearchResponseSchema.safeParse(body);
      if (!response.ok || !parsedBody.success) throw new Error("invalid_federated_response");
      setState({ status: "success", data: parsedBody.data, submittedQuery });
    } catch {
      if (!controller.signal.aborted) setState({ status: "error", data: null, submittedQuery });
    }
  };

  const loadDetails = async (candidate: SourceSearchReference) => {
    setDetails((current) => ({ ...current, [candidate.sourceRef]: { status: "loading", parsed: null } }));
    try {
      const response = await fetch("/api/assayindex/source-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLab: candidate.sourceLab, sourceRef: candidate.sourceRef }),
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const parsedBody = federatedDetailResponseSchema.safeParse(body);
      if (!response.ok || !parsedBody.success) {
        throw new Error("invalid_detail_response");
      }
      const detailResponse = parsedBody.data;
      if (detailResponse.status !== "success") throw new Error("invalid_detail_response");
      const parsed = detailResponse.parsed;
      setDetails((current) => ({
        ...current,
        [candidate.sourceRef]: { status: "success", parsed },
      }));
    } catch {
      setDetails((current) => ({ ...current, [candidate.sourceRef]: { status: "error", parsed: null } }));
    }
  };

  return (
    <section aria-labelledby="federated-source-heading" className="assayindex-panel assayindex-section-band assayindex-section-band--live p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="assayindex-kicker">Current laboratory directories</p>
          <h2 className="mt-2 text-2xl font-semibold text-[#102435]" id="federated-source-heading">
            Live Source Candidates
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-7 text-[#526978]">
            Published AssayIndex records stay first. This explicit action checks enabled official directory adapters;
            typing alone never contacts a laboratory.
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5e7584]">ARUP · Mayo · Quest · Labcorp</p>
        </div>
        <button
          className="assayindex-action assayindex-action--primary assayindex-focus-ring"
          disabled={normalizedQuery.length < 2 || isCurrentLoading}
          type="button"
          onClick={() => void runSearch()}
        >
          {isCurrentLoading ? "Searching current directories…" : "Search current laboratory directories"}
        </button>
      </div>

      {normalizedQuery.length < 2 ? (
        <p className="mt-4 text-sm text-[#526978]">Enter at least two characters before searching current directories.</p>
      ) : null}
      {isCurrentSubmission && state.status === "error" ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          The current-directory search service is temporarily unavailable. Published results above are unaffected.
        </p>
      ) : null}
      {isCurrentSubmission && state.status === "loading" ? (
        <div className="mt-5 space-y-4" role="status" aria-label="Current laboratory search status">
          <p className="text-sm text-[#526978]">Searching live sources independently for “{state.submittedQuery}”.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {LABORATORY_SOURCE_IDS.map((sourceId) => (
              <section
                aria-busy="true"
                aria-label={SOURCE_NAMES[sourceId]}
                className="assayindex-source-card assayindex-source-card--loading p-4"
                key={sourceId}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-[#102435]">{SOURCE_NAMES[sourceId]}</h3>
                  <span className="assayindex-badge assayindex-badge--live" role="status">loading</span>
                </div>
                <p className="mt-2 text-sm text-[#526978]">Checking this source…</p>
              </section>
            ))}
          </div>
        </div>
      ) : null}
      {isCurrentSubmission && state.status === "success" ? (
        <div className="mt-5 space-y-5">
          <p className="text-sm text-[#526978]" role="status">
            Live source status for “{state.submittedQuery}”.
          </p>
          {LABORATORY_SOURCE_IDS.map((sourceId) => {
            const result = state.data.sources[sourceId];
            if (!result) return null;
            return (
              <section
                aria-label={SOURCE_NAMES[sourceId]}
                className={`assayindex-source-card assayindex-source-card--${result.status} p-4`}
                key={sourceId}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-[#102435]">{SOURCE_NAMES[sourceId]}</h3>
                  <span className="assayindex-badge assayindex-badge--live">{result.status.replaceAll("-", " ")}</span>
                </div>
                {result.message ? <p className="mt-2 text-sm leading-6 text-[#526978]">{result.message}</p> : null}
                <a
                  className="mt-3 inline-block text-sm text-[#0f5f79] underline-offset-4 hover:underline"
                  href={result.officialDirectoryUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open official test directory
                </a>
                {result.status === "success" && result.results.length === 0 ? (
                  <p className="mt-3 text-sm text-[#526978]">No current source candidates matched.</p>
                ) : null}
                {result.status === "success" && result.results.length > 0 ? (
                  <div className="mt-4 space-y-4">
                    {result.results.map((candidate) => (
                      <SourceCandidateCard
                        candidate={candidate}
                        detail={details[candidate.sourceRef]}
                        key={candidate.sourceRef}
                        onLoadDetails={() => void loadDetails(candidate)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
