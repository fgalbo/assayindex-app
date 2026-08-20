export type FederatedSearchConfig = {
  enabled: boolean;
  autoFallbackEnabled: boolean;
  sourceEnabled: { arup: boolean };
  cacheTtlSeconds: number;
  requestTimeoutMs: number;
};

function booleanSetting(value: string | undefined, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return value.trim().toLowerCase() === "true";
}
function integerSetting(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function getFederatedSearchConfig(
  env: Record<string, string | undefined> = process.env,
): FederatedSearchConfig {
  return {
    enabled: booleanSetting(env.ASSAYINDEX_FEDERATED_SEARCH_ENABLED),
    autoFallbackEnabled: booleanSetting(env.ASSAYINDEX_AUTO_EXTERNAL_FALLBACK_ENABLED),
    sourceEnabled: {
      arup: booleanSetting(env.ASSAYINDEX_ARUP_SEARCH_ENABLED),
    },
    cacheTtlSeconds: integerSetting(env.ASSAYINDEX_SOURCE_SEARCH_CACHE_TTL_SECONDS, 86_400, 60, 604_800),
    requestTimeoutMs: integerSetting(env.ASSAYINDEX_SOURCE_REQUEST_TIMEOUT_MS, 20_000, 1_000, 60_000),
  };
}
