export class RequestBodyError extends Error {
  constructor(readonly code: "invalid_json" | "request_too_large") {
    super(code);
    this.name = "RequestBodyError";
  }
}
export async function readBoundedJsonRequest(request: Request, maximumBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestBodyError("request_too_large");
  }
  if (!request.body) throw new RequestBodyError("invalid_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > maximumBytes) {
      await reader.cancel();
      throw new RequestBodyError("request_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RequestBodyError("invalid_json");
  }
}
