import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/assayindex/acquisition/source-registry.json", async (importOriginal) => {
  const original = await importOriginal<{
    default: { sources: Array<Record<string, unknown>> };
  }>();
  return {
    default: {
      ...original.default,
      sources: original.default.sources.map((source) =>
        source.id === "arup-curated-catalog"
          ? { ...source, enabled: false, permissionStatus: "disabled" }
          : source,
      ),
    },
  };
});

import { MemoryFederatedSearchCache, searchLaboratorySources } from "@/features/assayindex/federated/orchestrator";
import { createLaboratorySourceAdapterRegistry } from "@/features/assayindex/federated/registry";
import sourceRegistryJson from "@/features/assayindex/acquisition/source-registry.json";
import { parseSourceRegistry } from "@/features/assayindex/acquisition/source-policy";

describe("federated source policy revocation", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("allows policy disablement to override true environment flags without making a request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const registry = createLaboratorySourceAdapterRegistry({}, {
      env: {
        ASSAYINDEX_FEDERATED_SEARCH_ENABLED: "true",
        ASSAYINDEX_ARUP_SEARCH_ENABLED: "true",
      },
      fetchImpl,
    });

    expect(registry.arup.status).toBe("disabled");
    const result = await searchLaboratorySources(
      { query: "HLA-B27", sources: ["arup"], requestId: "policy-test" },
      { registry, cache: new MemoryFederatedSearchCache() },
    );

    expect(result.sources.arup).toMatchObject({
      status: "disabled",
      results: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows the federated policy switch to override authorization and true environment flags", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const sourceRegistry = parseSourceRegistry({
      ...sourceRegistryJson,
      sources: sourceRegistryJson.sources.map((source) =>
        source.id === "arup-curated-catalog"
          ? {
              ...source,
              permissionStatus: "evaluation-authorized",
              federatedSearchEnabled: false,
            }
          : source,
      ),
    });
    const registry = createLaboratorySourceAdapterRegistry({}, {
      env: {
        ASSAYINDEX_FEDERATED_SEARCH_ENABLED: "true",
        ASSAYINDEX_ARUP_SEARCH_ENABLED: "true",
      },
      fetchImpl,
      sourceRegistry,
    });

    expect(registry.arup.status).toBe("disabled");
    const result = await searchLaboratorySources(
      { query: "HLA-B27", sources: ["arup"], requestId: "federated-policy-test" },
      { registry, cache: new MemoryFederatedSearchCache() },
    );

    expect(result.sources.arup).toMatchObject({
      status: "disabled",
      results: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
