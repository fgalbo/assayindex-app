import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  FederatedRefreshNotAuthorizedError,
  searchLaboratorySources,
} from "@/features/assayindex/federated/orchestrator";
import { federatedSearchRequestSchema } from "@/features/assayindex/federated/schema";
import { readBoundedJsonRequest, RequestBodyError } from "@/features/assayindex/server/bounded-json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_REQUEST_BYTES = 4_096;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
    const input = federatedSearchRequestSchema.parse(body);
    if (input.refresh) {
      return NextResponse.json(
        { error: "refresh_not_authorized" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    const result = await searchLaboratorySources({
      ...input,
      requestId: randomUUID(),
    });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.code }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (error instanceof FederatedRefreshNotAuthorizedError) {
      return NextResponse.json(
        { error: "refresh_not_authorized" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "federated_search_unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
