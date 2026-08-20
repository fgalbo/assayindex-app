import type {
  LaboratorySourceId,
  SourceCandidateStatus,
} from "@/features/assayindex/federated/types";

const STATUS_TRANSITIONS: Record<SourceCandidateStatus, SourceCandidateStatus[]> = {
  discovered: ["fetched", "error"],
  fetched: ["parsed", "error"],
  parsed: ["needs-review", "error"],
  "needs-review": ["approved", "rejected", "error"],
  approved: [],
  rejected: [],
  error: ["fetched"],
};

export function canTransitionSourceCandidate(
  current: SourceCandidateStatus,
  next: SourceCandidateStatus,
) {
  return STATUS_TRANSITIONS[current].includes(next);
}
export function assertSourceCandidateTransition(
  current: SourceCandidateStatus,
  next: SourceCandidateStatus,
) {
  if (!canTransitionSourceCandidate(current, next)) {
    throw new Error(`Invalid source candidate transition: ${current} -> ${next}.`);
  }
}

export function sourceCandidateIdentity(
  sourceLab: LaboratorySourceId,
  sourceRef: string,
  contentHash: string,
) {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Candidate content hash is invalid.");
  return `${sourceLab}:${sourceRef}:${contentHash}`;
}
