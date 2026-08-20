import { createHash } from "node:crypto";

import sourceRegistryJson from "@/features/assayindex/acquisition/source-registry.json";
import {
  canUseFederatedSearch,
  parseSourceRegistry,
  type AcquisitionSource,
  type SourceRegistry,
} from "@/features/assayindex/acquisition/source-policy";
import {
  ARUP_ADAPTER_VERSION,
  ARUP_PARSER_VERSION,
  ARUP_SOURCE_POLICY_ID,
  arupDetailUrlForSourceRef,
  arupSearchUrlForQuery,
  assertAllowedArupUrl,
  parseArupDetailHtml,
  parseArupSearchResponse,
} from "@/features/assayindex/federated/arup";
import { getFederatedSearchConfig } from "@/features/assayindex/federated/config.server";
import { fetchBoundedSourceText } from "@/features/assayindex/federated/http.server";
import {
  LABORATORY_SOURCE_IDS,
  type LaboratorySourceAdapter,
  type LaboratorySourceId,
  type SourceAdapterStatus,
  type SourceSearchReference,
} from "@/features/assayindex/federated/types";

export { LABORATORY_SOURCE_IDS } from "@/features/assayindex/federated/types";

const defaultSourcePolicyRegistry = parseSourceRegistry(sourceRegistryJson);

function requireSourcePolicy(registry: SourceRegistry, id: string) {
  const source = registry.sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Federated source policy is missing: ${id}`);
  return source;
}

function unavailableAdapter(
  id: LaboratorySourceId,
  source: AcquisitionSource,
  status: Exclude<SourceAdapterStatus, "enabled">,
  statusMessage: string,
): LaboratorySourceAdapter {
  const reject = async () => {
    throw new Error(statusMessage);
  };
  return {
    id,
    displayName: source.publisherName,
    sourcePolicyId: source.id,
    officialDirectoryUrl: source.url,
    status,
    adapterVersion: "not-implemented",
    parserVersion: "not-implemented",
    statusMessage,
    resolveReference() {
      throw new Error(statusMessage);
    },
    search: reject,
    fetchDetails: reject,
    parse: reject,
  };
}

function createArupAdapter(
  requested: boolean,
  requestTimeoutMs: number,
  sourcePolicyRegistry: SourceRegistry,
  fetchImpl?: typeof fetch,
): LaboratorySourceAdapter {
  const source = requireSourcePolicy(sourcePolicyRegistry, ARUP_SOURCE_POLICY_ID);
  const policy = canUseFederatedSearch(source);
  if (!requested || !policy.allowed) {
    const disabledByPolicy = requested && (
      policy.reason === "source_disabled" || policy.reason === "federated_search_disabled"
    );
    return unavailableAdapter(
      "arup",
      source,
      disabledByPolicy ? "disabled" : "permission-required",
      !requested
        ? "Live ARUP evaluation requires the explicit source feature flags."
        : policy.reason === "permission_not_approved"
          ? "Live ARUP evaluation is blocked by the source permission policy."
          : "Live ARUP evaluation is disabled by the source policy.",
    );
  }

  const resolveReference = (sourceRef: string): SourceSearchReference => ({
    sourceLab: "arup",
    sourceRef,
    sourceUrl: arupDetailUrlForSourceRef(sourceRef),
    sourceTestCode: sourceRef.split(":").at(-1) ?? null,
    title: sourceRef,
    summary: null,
    orderingRecommendation: null,
    sourceStatus: null,
  });

  return {
    id: "arup",
    displayName: source.publisherName,
    sourcePolicyId: source.id,
    officialDirectoryUrl: source.url,
    status: "enabled",
    adapterVersion: ARUP_ADAPTER_VERSION,
    parserVersion: ARUP_PARSER_VERSION,
    statusMessage: null,
    resolveReference,
    async search(query, context) {
      const response = await fetchBoundedSourceText(arupSearchUrlForQuery(query), {
        signal: context.signal,
        timeoutMs: Math.min(requestTimeoutMs, source.timeoutMs),
        maxBytes: Math.min(source.maxDownloadBytes, 2 * 1024 * 1024),
        expectedContentTypes: ["application/json", "text/json"],
        accept: "application/json",
        assertUrl: (url) => assertAllowedArupUrl(url, "search"),
        fetchImpl,
      });
      return parseArupSearchResponse(response.body);
    },
    async fetchDetails(reference, context) {
      const canonical = resolveReference(reference.sourceRef);
      const response = await fetchBoundedSourceText(new URL(canonical.sourceUrl), {
        signal: context.signal,
        timeoutMs: Math.min(requestTimeoutMs, source.timeoutMs),
        maxBytes: Math.min(source.maxDownloadBytes, 4 * 1024 * 1024),
        expectedContentTypes: ["text/html"],
        accept: "text/html,application/xhtml+xml",
        assertUrl: (url) => assertAllowedArupUrl(url, "detail"),
        fetchImpl,
      });
      const fetchedAt = new Date().toISOString();
      return {
        sourceLab: "arup",
        sourceRef: reference.sourceRef,
        sourceUrl: response.finalUrl.toString(),
        fetchedAt,
        mediaType: response.mediaType,
        body: response.body,
        contentHash: createHash("sha256").update(response.body).digest("hex"),
        responseMetadata: response.responseMetadata,
      };
    },
    async parse(snapshot) {
      return parseArupDetailHtml(snapshot.body, {
        sourceRef: snapshot.sourceRef,
        sourceUrl: snapshot.sourceUrl,
        fetchedAt: snapshot.fetchedAt,
        contentHash: snapshot.contentHash,
      });
    },
  };
}

export function createLaboratorySourceAdapterRegistry(
  overrides: Partial<Record<LaboratorySourceId, LaboratorySourceAdapter>> = {},
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    sourceRegistry?: SourceRegistry;
  } = {},
) {
  const config = getFederatedSearchConfig(options.env);
  const sourcePolicyRegistry = options.sourceRegistry ?? defaultSourcePolicyRegistry;
  const mayoSource = requireSourcePolicy(sourcePolicyRegistry, "mayo-clinic-labs-curated-catalog");
  const questSource = requireSourcePolicy(sourcePolicyRegistry, "quest-curated-catalog");
  const labcorpSource = requireSourcePolicy(sourcePolicyRegistry, "labcorp-curated-catalog");
  const adapters: Record<LaboratorySourceId, LaboratorySourceAdapter> = {
    arup: createArupAdapter(
      config.enabled && config.sourceEnabled.arup,
      config.requestTimeoutMs,
      sourcePolicyRegistry,
      options.fetchImpl,
    ),
    mayo: unavailableAdapter(
      "mayo",
      mayoSource,
      "official-directory-only",
      "Connected to Mayo's official directory for manual testing. Automated catalog search is not used because the official robots policy excludes those paths.",
    ),
    quest: unavailableAdapter(
      "quest",
      questSource,
      "official-directory-only",
      "Connected to Quest's official directory for manual testing. No documented public test-directory API or universal service-area contract is available.",
    ),
    labcorp: unavailableAdapter(
      "labcorp",
      labcorpSource,
      "official-directory-only",
      "Connected to Labcorp's official Test Finder for manual testing. Automated collection is not used because the current agreement requires prior written permission.",
    ),
  };

  return { ...adapters, ...overrides };
}

export type LaboratorySourceAdapterRegistry = ReturnType<typeof createLaboratorySourceAdapterRegistry>;

export function assertCompleteAdapterRegistry(registry: LaboratorySourceAdapterRegistry) {
  for (const sourceId of LABORATORY_SOURCE_IDS) {
    if (!registry[sourceId] || registry[sourceId].id !== sourceId) {
      throw new Error(`Federated adapter registry is invalid for ${sourceId}.`);
    }
  }
  return registry;
}
