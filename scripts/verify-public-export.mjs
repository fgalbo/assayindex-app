import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MAX_PUBLIC_FILE_BYTES = 10 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([".git", ".next", "node_modules", "output", "test-results"]);
const FORBIDDEN_SEGMENTS = new Set([".assayindex", ".vercel", "private-downloads", "archive"]);
const REQUIRED_FILES = [
  ".env.example",
  "DATA-LICENSES.md",
  "LICENSE",
  "NOTICE",
  "PROVENANCE.md",
  "public/assayindex/downloads/SOURCE-ATTRIBUTION.json",
  "public/assayindex/downloads/SHA256SUMS.txt",
];
const TEXT_SECRET_PATTERNS = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "service-account private key", pattern: /"private_key"\s*:/ },
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{30,}/ },
  { label: "GitHub token", pattern: /(?:gh[opusr]_|github_pat_)[0-9A-Za-z_]{20,}/ },
  { label: "OpenAI API key", pattern: /sk-(?:proj-)?[0-9A-Za-z_-]{20,}/ },
  { label: "Slack token", pattern: /xox[baprs]-[0-9A-Za-z-]{20,}/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "Vercel or Blob token", pattern: /(?:vercel_|vercel_blob_rw_)[0-9A-Za-z_-]{20,}/ },
  {
    label: "populated secret environment variable",
    pattern: /^[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*=\S+/m,
  },
  { label: "local Windows user path", pattern: /[A-Za-z]:\\Users\\[^\s"']+/i },
];

function normalizedRelativePath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function runGit(args, encoding = null) {
  return execFileSync("git", ["-c", `safe.directory=${ROOT}`, ...args], {
    cwd: ROOT,
    encoding,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
}

function splitNullTerminated(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

async function collectFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(path, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function validatePath(relativePath, origin, failures) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    failures.push(`${origin}:${relativePath}: forbidden private path`);
  }
  if (relativePath === ".github/workflows/assayindex-acquisition.yml") {
    failures.push(`${origin}:${relativePath}: private acquisition workflow must not be public`);
  }
  if (basename(relativePath).startsWith(".env") && relativePath !== ".env.example") {
    failures.push(`${origin}:${relativePath}: environment file must not be public`);
  }
}

function validateContent(relativePath, content, origin, failures) {
  validatePath(relativePath, origin, failures);
  if (content.byteLength > MAX_PUBLIC_FILE_BYTES) {
    failures.push(`${origin}:${relativePath}: ${content.byteLength} bytes exceeds the 10 MiB public limit`);
  }

  const text = content.toString("utf8");
  for (const { label, pattern } of TEXT_SECRET_PATTERNS) {
    if (pattern.test(text)) failures.push(`${origin}:${relativePath}: matches ${label} pattern`);
  }
}

const failures = [];
const files = await collectFiles(ROOT);

for (const path of files) {
  const relativePath = normalizedRelativePath(path);
  validateContent(relativePath, await readFile(path), "working-tree", failures);
}

let trackedPaths = [];
let historyCommitCount = 0;
if (existsSync(resolve(ROOT, ".git"))) {
  trackedPaths = splitNullTerminated(runGit(["ls-files", "-z"]));
  for (const relativePath of trackedPaths) {
    validateContent(relativePath, runGit(["show", `:${relativePath}`]), "git-index", failures);
  }

  const commits = runGit(["rev-list", "--all"], "utf8").split(/\r?\n/).filter(Boolean);
  historyCommitCount = commits.length;
  for (const commit of commits) {
    const shortCommit = commit.slice(0, 12);
    const paths = splitNullTerminated(runGit(["ls-tree", "-r", "--name-only", "-z", commit]));
    for (const relativePath of paths) {
      validateContent(
        relativePath,
        runGit(["show", `${commit}:${relativePath}`]),
        `git-history@${shortCommit}`,
        failures,
      );
    }
  }
}

const envExample = await readFile(resolve(ROOT, ".env.example"), "utf8");
for (const line of envExample.split(/\r?\n/)) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const [, name, value] = match;
  if (/TOKEN|SECRET|KEY|PASSWORD/.test(name) && value) {
    failures.push(`working-tree:.env.example: ${name} must not contain a value`);
  }
}

const releasePaths = trackedPaths.length > 0 ? trackedPaths : files.map(normalizedRelativePath);
for (const required of REQUIRED_FILES) {
  if (!releasePaths.includes(required)) {
    failures.push(`release:${required}: required public-release file is missing or untracked`);
  }
}

const uniqueFailures = [...new Set(failures)].toSorted();
if (uniqueFailures.length > 0) {
  console.error("Public export verification failed:");
  for (const failure of uniqueFailures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Public export verification passed (${files.length} working files, ${trackedPaths.length} indexed files, ${historyCommitCount} history commits checked).`,
  );
}
