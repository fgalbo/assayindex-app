import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";

const INSPECTION_BYTES = 16_384;

async function readPrefix(path, length = INSPECTION_BYTES) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function validateGzipSnapshot(path) {
  const prefix = await readPrefix(path, 2);
  if (prefix.length !== 2 || prefix[0] !== 0x1f || prefix[1] !== 0x8b) {
    throw new Error("Downloaded gzip snapshot failed validation (magic mismatch).");
  }
}

export async function validateTextSnapshot(path, { requiredHeaderFields = [] } = {}) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let inspectionText = "";

  for await (const chunk of createReadStream(path)) {
    byteLength += chunk.length;
    if (chunk.includes(0)) {
      throw new Error("Downloaded text snapshot contains binary NUL bytes.");
    }
    try {
      const decoded = decoder.decode(chunk, { stream: true });
      if (inspectionText.length < INSPECTION_BYTES) {
        inspectionText += decoded.slice(0, INSPECTION_BYTES - inspectionText.length);
      }
    } catch {
      throw new Error("Downloaded text snapshot is not valid UTF-8.");
    }
  }
  if (byteLength === 0) throw new Error("Downloaded text snapshot was empty.");
  try {
    const decoded = decoder.decode();
    if (inspectionText.length < INSPECTION_BYTES) {
      inspectionText += decoded.slice(0, INSPECTION_BYTES - inspectionText.length);
    }
  } catch {
    throw new Error("Downloaded text snapshot is not valid UTF-8.");
  }

  const trimmed = inspectionText.replace(/^\uFEFF/, "").trimStart();
  if (/^(?:<!doctype\s+html|<html\b)/i.test(trimmed)) {
    throw new Error("Downloaded text snapshot contains HTML instead of the expected dataset.");
  }

  const header = (trimmed.split(/\r?\n/, 1)[0] ?? "")
    .split("\t")
    .map((field) => field.trim().replace(/^#(?=accession_version$)/, ""));
  const missing = requiredHeaderFields.filter((field) => !header.includes(field));
  if (missing.length > 0) {
    throw new Error(`Downloaded text snapshot is missing required header fields: ${missing.join(", ")}.`);
  }
}

export async function validateXmlSnapshot(
  path,
  { rootElement, recordElement, maxBytes = 64 * 1_048_576 } = {},
) {
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(rootElement ?? "")) {
    throw new Error("XML snapshot validator requires a safe root element name.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(recordElement ?? "")) {
    throw new Error("XML snapshot validator requires a safe record element name.");
  }
  const sourceStats = await stat(path);
  if (sourceStats.size > maxBytes) {
    throw new Error(`Downloaded XML snapshot exceeded ${maxBytes} byte limit.`);
  }
  await validateTextSnapshot(path);
  let xml = (await readFile(path, "utf8")).replace(/^\uFEFF/, "").trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) {
    throw new Error("Downloaded XML snapshot contains a prohibited control character.");
  }
  if (/^(?:<!doctype\s+html|<html\b)/i.test(xml)) {
    throw new Error("Downloaded XML snapshot contains HTML instead of the expected dataset.");
  }
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) {
    throw new Error("Downloaded XML snapshot contains a prohibited DOCTYPE, ENTITY, or CDATA construct.");
  }
  if (
    xml
      .replace(/&(?:#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, "")
      .includes("&")
  ) {
    throw new Error("Downloaded XML snapshot contains a malformed or unsupported entity reference.");
  }
  if (/^<\?xml\b/i.test(xml)) {
    const declarationEnd = xml.indexOf("?>");
    if (declarationEnd < 0) throw new Error("Downloaded XML snapshot has a malformed declaration.");
    xml = xml.slice(declarationEnd + 2).trim();
  }
  if (/<\?|<!--|<!\[|<![A-Za-z]/.test(xml)) {
    throw new Error("Downloaded XML snapshot contains a prohibited processing or declaration construct.");
  }

  const tagPattern = /<\/?([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*?)?\/?>/g;
  const stack = [];
  let rootCount = 0;
  let recordCount = 0;
  let lastIndex = 0;
  for (const match of xml.matchAll(tagPattern)) {
    const gap = xml.slice(lastIndex, match.index);
    if (gap.includes("<") || gap.includes(">")) {
      throw new Error("Downloaded XML snapshot contains malformed XML markup.");
    }
    const raw = match[0];
    const name = match[1];
    const closing = raw.startsWith("</");
    const selfClosing = raw.endsWith("/>");
    if (closing) {
      if (stack.pop() !== name) {
        throw new Error(`Downloaded XML snapshot has malformed closing element ${name}.`);
      }
    } else {
      if (stack.length === 0) {
        rootCount += 1;
        if (name !== rootElement) {
          throw new Error(`Downloaded XML snapshot root must be ${rootElement}.`);
        }
      } else if (stack.length === 1) {
        if (name !== recordElement) {
          throw new Error(`Downloaded XML snapshot root may contain only ${recordElement} records.`);
        }
        recordCount += 1;
      } else if (stack.length > 2) {
        throw new Error("Downloaded XML snapshot contains unsupported nested record markup.");
      }
      if (!selfClosing) stack.push(name);
    }
    lastIndex = (match.index ?? 0) + raw.length;
  }
  const remainder = xml.slice(lastIndex);
  if (remainder.includes("<") || remainder.includes(">") || stack.length > 0 || rootCount !== 1) {
    throw new Error("Downloaded XML snapshot is malformed.");
  }
  if (recordCount === 0) {
    throw new Error(`Downloaded XML snapshot contains no ${recordElement} records.`);
  }
}

export async function validateExpectedPayload(path, source) {
  const expected = new Set((source.expectedContentTypes ?? []).map((value) => value.toLowerCase()));
  if (expected.has("application/gzip") || expected.has("application/x-gzip")) {
    await validateGzipSnapshot(path);
  } else if (expected.has("text/plain")) {
    await validateTextSnapshot(path);
  } else if (expected.has("application/xml") || expected.has("text/xml")) {
    await validateTextSnapshot(path);
  }
}
