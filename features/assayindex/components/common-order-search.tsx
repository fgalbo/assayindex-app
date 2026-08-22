"use client";

import { useEffect, useState } from "react";

import type { CommonLabOrderSearchResponse } from "@/features/assayindex/terminology/types";

const SEARCH_DELAY_MS = 250;

type SearchState =
  | { status: "idle"; query: string; data: null }
  | { status: "loading"; query: string; data: null }
  | { status: "success"; query: string; data: CommonLabOrderSearchResponse }
  | { status: "error"; query: string; data: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCommonLabOrderSearchResponse(value: unknown): value is CommonLabOrderSearchResponse {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<CommonLabOrderSearchResponse>;
  const interpretation = candidate.interpretation;
  const hasValidInterpretation = interpretation === null
    || Boolean(
      interpretation
      && interpretation.interpretationType === "assayindex-search-heuristic"
      && typeof interpretation.label === "string"
      && typeof interpretation.evidenceLabel === "string"
      && typeof interpretation.evidenceUrl === "string"
      && (interpretation.ambiguityNote === null || typeof interpretation.ambiguityNote === "string"),
    );
  const source = candidate.source;
  const mnemonicSupplement = isRecord(source?.mnemonicSupplement)
    ? source.mnemonicSupplement
    : null;
  const hasValidSource = Boolean(
    source
    && typeof source.sourcePageUrl === "string"
    && typeof source.valueSetName === "string"
    && typeof source.valueSetVersion === "string"
    && typeof source.searchApiDocsUrl === "string"
    && (source.sourceUpdatedAt === null || typeof source.sourceUpdatedAt === "string")
    && typeof source.retrievedAt === "string"
    && typeof source.licenseNotice === "string"
    && mnemonicSupplement
    && typeof mnemonicSupplement.entryCount === "number"
    && Number.isInteger(mnemonicSupplement.entryCount)
    && mnemonicSupplement.entryCount >= 0,
  );
  const validMatchReasons = new Set([
    "loinc-code",
    "long-common-name",
    "short-name",
    "consumer-name",
    "related-name",
    "assayindex-interpretation",
    "punctuation-folded",
  ]);
  const hasValidResults = Array.isArray(candidate.results)
    && candidate.results.every((result) => isRecord(result)
      && typeof result.loincCode === "string"
      && typeof result.longCommonName === "string"
      && (result.orderObservation === null
        || result.orderObservation === "Order"
        || result.orderObservation === "Observation"
        || result.orderObservation === "Both")
      && (result.sourceScope === "common-order-value-set"
        || result.sourceScope === "assayindex-mnemonic-supplement")
      && typeof result.officialUrl === "string"
      && typeof result.matchedTerm === "string"
      && typeof result.matchReason === "string"
      && validMatchReasons.has(result.matchReason));
  return candidate.schemaVersion === "1"
    && candidate.status === "published-common-order-terminology"
    && hasValidInterpretation
    && typeof candidate.matchedCount === "number"
    && typeof candidate.resultCount === "number"
    && typeof candidate.truncated === "boolean"
    && hasValidResults
    && hasValidSource;
}

function formatSourceDate(value: string | null) {
  if (!value) return "date unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function matchReasonLabel(reason: CommonLabOrderSearchResponse["results"][number]["matchReason"]) {
  switch (reason) {
    case "loinc-code":
      return "LOINC code";
    case "long-common-name":
      return "long common name";
    case "short-name":
      return "LOINC short name";
    case "consumer-name":
      return "consumer name";
    case "related-name":
      return "related search term";
    case "assayindex-interpretation":
      return "disclosed AssayIndex search interpretation";
    case "punctuation-folded":
      return "punctuation-insensitive related term";
  }
}

export function CommonOrderSearch({
  query,
  onSearchLabs,
}: {
  query: string;
  onSearchLabs: (query: string) => void;
}) {
  const [state, setState] = useState<SearchState>({ status: "idle", query: "", data: null });
  const normalizedQuery = query.trim();
  const currentState: SearchState = state.query === normalizedQuery
    ? state
    : {
        status: normalizedQuery.length >= 2 ? "loading" : "idle",
        query: normalizedQuery,
        data: null,
      };

  useEffect(() => {
    if (normalizedQuery.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setState({ status: "loading", query: normalizedQuery, data: null });
      try {
        const response = await fetch("/api/assayindex/terminology-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: normalizedQuery, limit: 20 }),
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (!response.ok || !isCommonLabOrderSearchResponse(body)) {
          throw new Error("The common-order terminology snapshot is unavailable.");
        }
        setState({ status: "success", query: normalizedQuery, data: body });
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: "error", query: normalizedQuery, data: null });
        }
      }
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [normalizedQuery]);

  if (normalizedQuery.length < 2) return null;

  return (
    <section
      aria-labelledby="common-order-results-heading"
      className="assayindex-panel assayindex-section-band assayindex-section-band--testing p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="assayindex-kicker">Licensed terminology snapshot</p>
          <h2 className="mt-2 text-2xl font-semibold text-[#102435]" id="common-order-results-heading">
            Common laboratory order terminology
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-7 text-[#526978]">
            Searches the NLM common-order subset plus audited supplemental LOINC concepts by official
            long names, short names, and related search terms. These are terminology candidates, not
            proof that a laboratory currently performs an equivalent test. This is not the complete LOINC release.
          </p>
        </div>
        <span className="assayindex-badge assayindex-badge--testing">NLM + LOINC · local snapshot</span>
      </div>

      {currentState.status === "loading" ? (
        <p className="mt-5 text-sm text-[#526978]" role="status">Searching common order terminology…</p>
      ) : null}

      {currentState.status === "error" ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="status">
          The common-order terminology snapshot is temporarily unavailable. Published catalog and
          connected-source searches are unaffected.
        </div>
      ) : null}

      {currentState.status === "success" ? (
        <div className="mt-5 space-y-4">
          <p className="text-sm leading-6 text-[#526978]" role="status">
            {currentState.data.matchedCount === 0
              ? "No common-order terminology matched this search."
              : `Showing ${currentState.data.resultCount} of ${currentState.data.matchedCount.toLocaleString("en-US")} terminology matches.`}
          </p>

          {currentState.data.interpretation ? (
            <div className="rounded-2xl border border-[#b9d9df] bg-[#edf8f8] p-4 text-sm leading-6 text-[#244553]">
              <p className="font-semibold">AssayIndex search interpretation · heuristic</p>
              <p>
                Interpreted in the laboratory-order context as <span className="font-semibold">{currentState.data.interpretation.label}</span>.
                {" "}This expands retrieval only; it does not assert that every result is equivalent.
              </p>
              {currentState.data.interpretation.ambiguityNote ? (
                <p className="mt-2">{currentState.data.interpretation.ambiguityNote}</p>
              ) : null}
              <a
                className="mt-2 inline-block underline"
                href={currentState.data.interpretation.evidenceUrl}
                rel="noreferrer"
                target="_blank"
              >
                {currentState.data.interpretation.evidenceLabel}
              </a>
              <p className="mt-2">
                The evidence link identifies the target terminology or documented usage; it does not make the entered shorthand an official LOINC synonym.
              </p>
            </div>
          ) : null}

          {currentState.data.results.map((result) => (
            <article
              className="assayindex-result assayindex-result--testing rounded-2xl border border-[#d8e3e8] p-4"
              key={result.loincCode}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="assayindex-badge assayindex-badge--testing">
                  {result.sourceScope === "common-order-value-set"
                    ? "Common-order value set"
                    : "Audited mnemonic supplement"}
                </span>
                <span className="assayindex-badge">
                  {result.orderObservation ?? "Order role not classified by source"}
                </span>
                <span className="assayindex-metadata">LOINC {result.loincCode}</span>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-[#102435]">{result.longCommonName}</h3>
              <p className="mt-2 text-sm leading-6 text-[#526978]">
                Matched by {matchReasonLabel(result.matchReason)}: <span className="font-semibold">{result.matchedTerm}</span>
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  className="assayindex-nav-link assayindex-focus-ring"
                  href={result.officialUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open official LOINC record
                </a>
                <button
                  className="assayindex-nav-link assayindex-focus-ring"
                  type="button"
                  onClick={() => onSearchLabs(result.longCommonName)}
                >
                  Search labs using this name
                </button>
              </div>
            </article>
          ))}

          <div className="assayindex-provenance p-4 text-xs leading-6">
            <p>
              Source: <a className="underline" href={currentState.data.source.sourcePageUrl} rel="noreferrer" target="_blank">{currentState.data.source.valueSetName} v{currentState.data.source.valueSetVersion}</a>,
              enriched through the <a className="underline" href={currentState.data.source.searchApiDocsUrl} rel="noreferrer" target="_blank">NLM Clinical Tables API</a>.
              Source last modified {formatSourceDate(currentState.data.source.sourceUpdatedAt)} and retrieved {formatSourceDate(currentState.data.source.retrievedAt)}.
              {" "}Search runs against AssayIndex&apos;s bundled snapshot; this query is not sent to NLM.
            </p>
            <p className="mt-2">
              The public NLM enrichment response does not identify its underlying LOINC release version; the exact response set is tracked by SHA-256 in this snapshot.
            </p>
            <p className="mt-2">
              AssayIndex also includes {currentState.data.source.mnemonicSupplement.entryCount.toLocaleString("en-US")} audited LOINC concepts for common mnemonics missing from the common-order value set. Those entries are visibly labeled and do not invent an order/observation role.
            </p>
            <p className="mt-2">{currentState.data.source.licenseNotice}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
