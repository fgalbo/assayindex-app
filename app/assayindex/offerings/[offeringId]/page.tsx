import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import releaseJson from "@/features/assayindex/data/published/release.json";
import { SourceOfferingDetailPage } from "@/features/assayindex/pages/source-offering-detail-page";
import {
  getSourceOfferingByRouteSegment,
  getSourceOfferingRouteSegment,
} from "@/features/assayindex/selectors/source-offerings";

type SourceOfferingDetailRouteProps = {
  params: Promise<{
    offeringId: string;
  }>;
};

export const dynamicParams = false;

export async function generateStaticParams() {
  return (publishedCatalog.sourceOfferings ?? []).map((offering) => ({
    offeringId: getSourceOfferingRouteSegment(offering),
  }));
}

export async function generateMetadata({
  params,
}: SourceOfferingDetailRouteProps): Promise<Metadata> {
  const { offeringId } = await params;
  const offering = getSourceOfferingByRouteSegment(publishedCatalog, offeringId);

  if (!offering) {
    return { title: "Source offering not found | AssayIndex" };
  }

  return {
    title: `${offering.testName} | AssayIndex`,
    description: `${offering.testName}, source-listed by ${offering.sourcePublisherId}.`,
  };
}

export default async function SourceOfferingDetailRoute({
  params,
}: SourceOfferingDetailRouteProps) {
  const { offeringId } = await params;
  const offering = getSourceOfferingByRouteSegment(publishedCatalog, offeringId);
  const lab = offering
    ? publishedCatalog.labs.find((entry) => entry.id === offering.labId) ?? null
    : null;
  const assay = offering?.assaySlug
    ? publishedCatalog.assays.find((entry) => entry.slug === offering.assaySlug) ?? null
    : null;
  const sourceAttribution = offering
    ? releaseJson.sourceAttributions.find((entry) => entry.sourceId === offering.sourceId) ?? null
    : null;

  return (
    <SourceOfferingDetailPage
      assay={assay}
      lab={lab}
      offering={offering}
      sourceAttribution={sourceAttribution ? {
        label: sourceAttribution.requiredAttribution,
        url: sourceAttribution.requiredAttributionUrl,
        disclaimer: sourceAttribution.disclaimer,
      } : null}
    />
  );
}
