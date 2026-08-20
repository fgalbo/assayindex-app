import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { LabDetailPage } from "@/features/assayindex/pages/lab-detail-page";

type LabDetailRouteProps = {
  params: Promise<{
    labId: string;
  }>;
};

export async function generateStaticParams() {
  return publishedCatalog.labs.map((lab) => ({
    labId: lab.id,
  }));
}

export async function generateMetadata({
  params,
}: LabDetailRouteProps): Promise<Metadata> {
  const { labId } = await params;
  const lab = publishedCatalog.labs.find((entry) => entry.id === labId);

  if (!lab) {
    return {
      title: "Lab not found | AssayIndex",
    };
  }

  return {
    title: `${lab.displayName} | AssayIndex`,
    description: lab.notes ?? `Lab profile for ${lab.displayName} in AssayIndex.`,
  };
}

export default async function LabDetailRoute({ params }: LabDetailRouteProps) {
  const { labId } = await params;

  return <LabDetailPage catalog={publishedCatalog} labId={labId} />;
}
