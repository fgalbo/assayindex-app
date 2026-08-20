import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { finished, pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { once } from "node:events";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(scriptDirectory, "../../..");
export const RUNTIME_ROOT = resolve(PROJECT_ROOT, ".assayindex/runtime");

export function resolveWithinRuntime(...parts) {
  const target = resolve(RUNTIME_ROOT, ...parts);
  if (target !== RUNTIME_ROOT && !target.startsWith(`${RUNTIME_ROOT}${sep}`)) {
    throw new Error(`Refusing path outside AssayIndex runtime root: ${target}`);
  }
  return target;
}

export async function ensureRuntimeDirectory(path) {
  const resolved = resolve(path);
  if (resolved !== RUNTIME_ROOT && !resolved.startsWith(`${RUNTIME_ROOT}${sep}`)) {
    throw new Error(`Refusing directory outside AssayIndex runtime root: ${resolved}`);
  }
  await mkdir(resolved, { recursive: true });
}

export async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonAtomic(path, value) {
  await ensureRuntimeDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeWithBackpressure(stream, value) {
  if (!stream.write(value)) await once(stream, "drain");
}

export async function writeJsonArrayEnvelopeAtomic(path, { metadata, arrayName, entries, footer }) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(arrayName)) {
    throw new Error(`Invalid streamed JSON envelope array name: ${arrayName}`);
  }
  await ensureRuntimeDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const output = createWriteStream(temporary, { flags: "wx", encoding: "utf8" });
  const completion = finished(output).then(
    () => null,
    (error) => error,
  );

  try {
    await writeWithBackpressure(
      output,
      `${JSON.stringify(metadata).slice(0, -1)},"${arrayName}":[\n`,
    );
    let entryCount = 0;
    for await (const entry of entries) {
      await writeWithBackpressure(output, `${entryCount > 0 ? ",\n" : ""}${JSON.stringify(entry)}`);
      entryCount += 1;
    }
    await writeWithBackpressure(output, `\n],${JSON.stringify(footer).slice(1)}\n`);
    output.end();
    const outputError = await completion;
    if (outputError) throw outputError;
    await rename(temporary, path);
    return { entryCount };
  } catch (error) {
    if (!output.destroyed) output.destroy();
    await completion;
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function streamToHashedTemporaryFile(body, destination, maxBytes) {
  await ensureRuntimeDirectory(dirname(destination));
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const hash = createHash("sha256");
  let byteLength = 0;

  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        callback(new Error(`Download exceeded ${maxBytes} byte limit.`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(body, limiter, createWriteStream(temporary, { flags: "wx" }));
    return { temporary, byteLength, sha256: hash.digest("hex") };
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function hashFileBounded(path, maxBytes) {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    byteLength += chunk.length;
    if (byteLength > maxBytes) {
      throw new Error(`Cached snapshot exceeded ${maxBytes} byte limit.`);
    }
    hash.update(chunk);
  }
  return { byteLength, sha256: hash.digest("hex") };
}

export async function replaceFileAtomic(temporary, destination) {
  await ensureRuntimeDirectory(dirname(destination));
  await rename(temporary, destination);
}
