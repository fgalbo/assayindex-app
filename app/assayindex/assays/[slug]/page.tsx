import type { Metadata } from "next";

import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import { AssayDetailPage } from "@/features/assayindex/pages/assay-detail-page";
import { getAssayReport } from "@/features/assayindex/selectors/catalog";

type AssayDetailRouteProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateStaticParams() {
  return publishedCatalog.assays.map((assay) => ({
    slug: assay.slug,
  }));
}

export async function generateMetadata({
  params,
}: AssayDetailRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const report = getAssayReport(publishedCatalog, slug);

  if (!report) {
    return {
      title: "Assay not found | AssayIndex",
    };
  }

  return {
    title: `${report.assay.displayName} | AssayIndex`,
    description: report.assay.summary,
  };
}

export default async function AssayDetailRoute({ params }: AssayDetailRouteProps) {
  const { slug } = await params;

  return <AssayDetailPage catalog={publishedCatalog} slug={slug} />;
}
