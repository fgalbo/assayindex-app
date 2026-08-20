import { NextResponse } from "next/server";

import { searchGtrTestingIndex } from "@/features/assayindex/testing/gtr-search.server";
import { readBoundedJsonRequest, RequestBodyError } from "@/features/assayindex/server/bounded-json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_REQUEST_BYTES = 2_048;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  } catch (error) {
    const code = error instanceof RequestBodyError ? error.code : "invalid_json";
    return NextResponse.json({ error: code }, { status: 400, headers: NO_STORE_HEADERS });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const input = body as { query?: unknown; limit?: unknown };
  if (Object.keys(input).some((key) => key !== "query" && key !== "limit")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  try {
    const result = await searchGtrTestingIndex({ query: input.query, limit: input.limit });
    return NextResponse.json(result, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const invalidInput = /query must|search limit must/i.test(message);
    return NextResponse.json(
      { error: invalidInput ? "invalid_search" : "testing_source_unavailable" },
      { status: invalidInput ? 400 : 503, headers: NO_STORE_HEADERS },
    );
  }
}
