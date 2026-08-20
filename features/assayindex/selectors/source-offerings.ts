import type {
  AssayIndexCatalog,
  SourceOffering,
} from "@/features/assayindex/domain/types";

const ROUTE_COMPONENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

export function getPublishedSourceOfferings(catalog: AssayIndexCatalog): SourceOffering[] {
  return (catalog.sourceOfferings ?? [])
    .filter((offering) => offering.publicationStatus === "published")
    .toSorted(
      (left, right) =>
        left.testName.localeCompare(right.testName) || left.id.localeCompare(right.id),
    );
}

export function getSourceOfferingById(
  catalog: AssayIndexCatalog,
  offeringId: string,
): SourceOffering | null {
  return (
    getPublishedSourceOfferings(catalog).find((offering) => offering.id === offeringId) ?? null
  );
}

export function getSourceOfferingRouteSegment(
  offering: Pick<SourceOffering, "sourceId" | "externalRecordId">,
): string {
  for (const [label, value] of [
    ["sourceId", offering.sourceId],
    ["externalRecordId", offering.externalRecordId],
  ] as const) {
    if (!ROUTE_COMPONENT_PATTERN.test(value) || value.includes("--")) {
      throw new Error(`Source offering ${label} cannot be represented by the static route.`);
    }
  }
  return `${offering.sourceId}--${offering.externalRecordId}`;
}

export function getSourceOfferingByRouteSegment(
  catalog: AssayIndexCatalog,
  routeSegment: string,
): SourceOffering | null {
  return (
    getPublishedSourceOfferings(catalog).find(
      (offering) => getSourceOfferingRouteSegment(offering) === routeSegment,
    ) ?? null
  );
}

export function getSourceOfferingsForLab(
  catalog: AssayIndexCatalog,
  labId: string,
): SourceOffering[] {
  return getPublishedSourceOfferings(catalog).filter((offering) => offering.labId === labId);
}
