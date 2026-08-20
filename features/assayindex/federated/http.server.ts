type BoundedFetchOptions = {
  signal: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
  expectedContentTypes: string[];
  assertUrl: (url: URL) => URL;
  accept: string;
  fetchImpl?: typeof fetch;
};

const MAX_REDIRECTS = 2;
const USER_AGENT = "AssayIndex/0.1 federated-search (+https://filippogalbo.com/assayindex)";

export class SourceTimeoutError extends Error {
  constructor() {
    super("The source request timed out.");
    this.name = "SourceTimeoutError";
  }
}
function contentTypeIsAllowed(response: Response, expected: string[]) {
  const actual = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return Boolean(actual && expected.some((value) => value.toLowerCase() === actual));
}

async function readBoundedBody(response: Response, maxBytes: number) {
  if (!response.body) throw new Error("Source response did not include a body.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body.cancel();
    throw new Error("Source response exceeded the configured size limit.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      throw new Error("Source response exceeded the configured size limit.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (text.includes("\u0000")) throw new Error("Source response contained a NUL character.");
  return text;
}

export async function fetchBoundedSourceText(initialUrl: URL, options: BoundedFetchOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = AbortSignal.any([options.signal, timeoutSignal]);
  let current = options.assertUrl(initialUrl);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetchImpl(current, {
        method: "GET",
        headers: {
          Accept: options.accept,
          "User-Agent": USER_AGENT,
        },
        redirect: "manual",
        cache: "no-store",
        signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new Error("Source returned an invalid or excessive redirect chain.");
        }
        current = options.assertUrl(new URL(location, current));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Source returned HTTP ${response.status}.`);
      }
      if (!contentTypeIsAllowed(response, options.expectedContentTypes)) {
        await response.body?.cancel();
        throw new Error("Source returned an unexpected content type.");
      }
      return {
        body: await readBoundedBody(response, options.maxBytes),
        mediaType: response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "application/octet-stream",
        responseMetadata: Object.fromEntries(
          ["etag", "last-modified"].flatMap((name) => {
            const value = response.headers.get(name);
            return value ? [[name, value]] : [];
          }),
        ),
        finalUrl: current,
      };
    }
    throw new Error("Source redirect validation failed.");
  } catch (error) {
    if (timeoutSignal.aborted && !options.signal.aborted) throw new SourceTimeoutError();
    throw error;
  }
}
