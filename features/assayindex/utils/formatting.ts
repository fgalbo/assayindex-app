import { NOT_LISTED_BY_SOURCE } from "@/features/assayindex/constants";

export function hasListedValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function renderValueOrFallback(value: string | null | undefined) {
  return hasListedValue(value) ? value!.trim() : NOT_LISTED_BY_SOURCE;
}

export function renderListOrFallback(values: Array<string | null | undefined>) {
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return normalized.length > 0 ? normalized.join(", ") : NOT_LISTED_BY_SOURCE;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function downloadTextFile(filename: string, content: string, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function buildAbsoluteUrl(pathname: string) {
  if (typeof window === "undefined") {
    return pathname;
  }

  return new URL(pathname, window.location.origin).toString();
}
