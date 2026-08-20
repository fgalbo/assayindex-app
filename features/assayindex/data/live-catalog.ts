"use client";

import { useEffect, useState } from "react";

import { ASSAYINDEX_PUBLIC_CATALOG_PATH } from "@/features/assayindex/constants";
import { projectPublicCatalog } from "@/features/assayindex/data/public-catalog";
import type { AssayIndexCatalog } from "@/features/assayindex/domain/types";
import { parseCatalog } from "@/features/assayindex/schema/catalog";

type CatalogSource = "embedded" | "live";

type LiveCatalogState = {
  catalog: AssayIndexCatalog;
  source: CatalogSource;
  error: string | null;
};

let cachedCatalogSnapshot: AssayIndexCatalog | null = null;
let inflightCatalogRequest: Promise<AssayIndexCatalog> | null = null;

function getErrorMessage(error: unknown) {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors
      .map((entry) => (entry instanceof Error ? entry.message : "Hosted snapshot request failed."))
      .join(" ");
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load the hosted AssayIndex catalog snapshot.";
}

function getConfiguredCatalogSnapshotUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_ASSAYINDEX_CATALOG_URL?.trim();

  return configuredUrl ? configuredUrl : null;
}

function buildSnapshotRequestUrl(url: string) {
  const timestamp = Date.now().toString();

  if (typeof window === "undefined") {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}ts=${timestamp}`;
  }

  const resolvedUrl = new URL(url, window.location.origin);
  resolvedUrl.searchParams.set("ts", timestamp);
  return resolvedUrl.toString();
}

export function getCatalogSnapshotUrls() {
  const urls = [getConfiguredCatalogSnapshotUrl(), ASSAYINDEX_PUBLIC_CATALOG_PATH].filter(
    (value): value is string => Boolean(value),
  );

  return urls.filter((value, index) => urls.indexOf(value) === index);
}

export async function loadHostedCatalogSnapshot(fetchImpl: typeof fetch = fetch) {
  if (inflightCatalogRequest) {
    return inflightCatalogRequest;
  }

  inflightCatalogRequest = (async () => {
    const errors: Error[] = [];

    for (const snapshotUrl of getCatalogSnapshotUrls()) {
      let response: Response;

      try {
        response = await fetchImpl(buildSnapshotRequestUrl(snapshotUrl), {
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });
      } catch (error) {
        errors.push(
          new Error(`${snapshotUrl} could not be fetched: ${getErrorMessage(error)}`),
        );
        continue;
      }

      if (!response.ok) {
        errors.push(new Error(`${snapshotUrl} responded with status ${response.status}.`));
        continue;
      }

      try {
        const payload = await response.json();
        return projectPublicCatalog(parseCatalog(payload));
      } catch (error) {
        errors.push(
          new Error(`${snapshotUrl} returned an invalid catalog payload: ${getErrorMessage(error)}`),
        );
      }
    }

    throw errors.length === 1 ? errors[0] : new AggregateError(errors);
  })()
    .then((catalog) => {
      cachedCatalogSnapshot = catalog;
      return catalog;
    })
    .finally(() => {
      inflightCatalogRequest = null;
    });

  return inflightCatalogRequest;
}

export function resetHostedCatalogSnapshotCache() {
  cachedCatalogSnapshot = null;
  inflightCatalogRequest = null;
}

export function useLiveCatalog(initialCatalog: AssayIndexCatalog) {
  const [state, setState] = useState<LiveCatalogState>(() => {
    if (cachedCatalogSnapshot) {
      return {
        catalog: cachedCatalogSnapshot,
        source: "live",
        error: null,
      };
    }

    return {
      catalog: initialCatalog,
      source: "embedded",
      error: null,
    };
  });

  useEffect(() => {
    let cancelled = false;

    loadHostedCatalogSnapshot()
      .then((catalog) => {
        if (cancelled) {
          return;
        }

        setState({
          catalog,
          source: "live",
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setState((currentState) => ({
          ...currentState,
          error: getErrorMessage(error),
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [initialCatalog]);

  return {
    catalog: state.catalog,
    catalogSource: state.source,
    catalogError: state.error,
  };
}
