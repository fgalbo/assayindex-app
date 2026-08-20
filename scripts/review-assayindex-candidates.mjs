#!/usr/bin/env node

import {
  parseCandidateReviewArguments,
  reviewCandidates,
} from "./assayindex/acquisition/candidate-review.mjs";

function usage() {
  return [
    "Usage: node scripts/review-assayindex-candidates.mjs [filters]",
    "",
    "Streams the latest validated private NIH GTR candidates without publishing them.",
    "",
    "Filters (combined with AND):",
    "  --query <text>       Match any provider, test, identifier, method, gene, or condition",
    "  --gene <text>        Match source-listed gene symbols or identifiers",
    "  --condition <text>   Match source-listed condition names or identifiers",
    "  --lab <text>         Match laboratory, institution, location, or GTR laboratory ID",
    "  --review-required    Return only candidates carrying source-status review flags",
    "  --limit <1-100>      Maximum records in results (default: 25)",
    "  --help               Show this help",
    "",
    "This command is read-only. It never changes canonical or public AssayIndex files.",
  ].join("\n");
}

async function main() {
  const options = parseCandidateReviewArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await reviewCandidates(options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`AssayIndex candidate review failed: ${error.message}`);
  process.exitCode = 1;
});
