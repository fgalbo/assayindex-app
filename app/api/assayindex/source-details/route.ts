import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  FederatedInvalidSourceReferenceError,
  FederatedRefreshNotAuthorizedError,
  fetchLaboratorySourceDetails,
} from "@/features/assayindex/federated/orchestrator";
import { federatedDetailRequestSchema } from "@/features/assayindex/federated/schema";
import { readBoundedJsonRequest, RequestBodyError } from "@/features/assayindex/server/bounded-json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_REQUEST_BYTES = 2_048;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function projectPublicSourceDetails(
  result: Awaited<ReturnType<typeof fetchLaboratorySourceDetails>>,
) {
  if (result.status !== "success") {
    return result;
  }

  const fieldProvenance = { ...result.parsed.fieldProvenance };
  delete fieldProvenance.cptCodes;

  return {
    ...result,
    parsed: {
      ...result.parsed,
      cptCodes: [],
      fieldProvenance,
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
    const input = federatedDetailRequestSchema.parse(body);
    if (input.refresh) {
      return NextResponse.json(
        { error: "refresh_not_authorized" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    const result = await fetchLaboratorySourceDetails({
      sourceLab: input.sourceLab,
      sourceRef: input.sourceRef,
      requestId: randomUUID(),
    });
    return NextResponse.json(projectPublicSourceDetails(result), { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.code }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (error instanceof ZodError || error instanceof FederatedInvalidSourceReferenceError) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (error instanceof FederatedRefreshNotAuthorizedError) {
      return NextResponse.json(
        { error: "refresh_not_authorized" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "source_detail_unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
