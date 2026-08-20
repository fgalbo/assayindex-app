import { redirect } from "next/navigation";

type AssayCatalogRouteProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AssayCatalogRoute({ searchParams }: AssayCatalogRouteProps) {
  const requestedParams = await searchParams;
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(requestedParams)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) nextParams.append(key, entry);
    }
  }

  const queryString = nextParams.toString();
  redirect(queryString ? `/assayindex/search?${queryString}` : "/assayindex/search");
}
