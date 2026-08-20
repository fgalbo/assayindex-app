import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

export type DownloadRelease = {
  catalogVersion: string;
  generatedAt: string;
  downloads: Array<{
    id: string;
    label: string;
    href: string;
    sha256: string;
    bytes?: number;
  }>;
  manifest: {
    contributingSourcePublishers?: string[];
    contributingAcquisitionSources?: string[];
    contributingReferenceLaboratories: string[];
  };
  sourcePublishers?: Array<{
    sourcePublisherId: string;
    label: string;
    href: string | null;
    notice: string;
  }>;
  sourceAttributions?: Array<{
    sourceId: string;
    sourcePublisherId: string;
    datasetName: string;
    requiredAttribution: string;
    requiredAttributionUrl: string;
    policyUrl: string;
    disclaimer: string | null;
  }>;
  referenceLaboratories: Array<{
    referenceLaboratoryId: string;
    label: string;
    href: string;
    notice: string;
  }>;
};

type DownloadsPageProps = {
  release: DownloadRelease | null;
};

function formatBytes(bytes?: number) {
  if (typeof bytes !== "number") return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DownloadsPage({ release }: DownloadsPageProps) {
  return (
    <AssayIndexShell
      title="AssayIndex downloads"
      description="Download integrity-checked, versioned catalog data for research, public-health reference, local search, and downstream analysis. Authorized source batches publish after automated integrity, provenance, and release-policy validation—not page-by-page approval."
    >
      {release ? (
        <>
          <section className="assayindex-metrics grid gap-4 md:grid-cols-3">
            <article className="assayindex-metric assayindex-panel p-5">
              <p className="assayindex-kicker">Catalog version</p>
              <p className="mt-3 text-xl font-semibold text-[#102435]">{release.catalogVersion}</p>
            </article>
            <article className="assayindex-metric assayindex-panel p-5">
              <p className="assayindex-kicker">Published</p>
              <p className="mt-3 text-base font-semibold text-[#102435]">
                {new Date(release.generatedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </p>
            </article>
            <article className="assayindex-metric assayindex-panel p-5">
              <p className="assayindex-kicker">Integrity</p>
              <p className="mt-3 text-base font-semibold text-[#102435]">SHA-256 checksums included</p>
            </article>
          </section>

          <section className="assayindex-panel p-5 md:p-7">
            <p className="assayindex-kicker">Integrity-checked release files</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {release.downloads.map((download) => (
                <article key={download.id} className="assayindex-download-card p-5">
                  <a
                    className="assayindex-focus-ring text-lg font-semibold text-[#174964] underline-offset-4 hover:underline"
                    download
                    href={download.href}
                  >
                    Download {download.label}
                  </a>
                  <p className="mt-3 break-all font-mono text-xs leading-6 text-[#526574]">
                    SHA-256 {download.sha256}
                  </p>
                  {formatBytes(download.bytes) ? (
                    <p className="mt-2 text-xs text-[#526574]">{formatBytes(download.bytes)}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="assayindex-panel p-5 md:p-7">
            <p className="assayindex-kicker">Contributing data publishers</p>
            <div className="mt-4 space-y-4">
              {(release.sourcePublishers ?? []).map((publisher) => (
                <article key={publisher.sourcePublisherId} className="assayindex-source-card p-4">
                  {publisher.href ? (
                    <a
                      className="assayindex-focus-ring font-semibold text-[#174964] underline-offset-4 hover:underline"
                      href={publisher.href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {publisher.label}
                    </a>
                  ) : (
                    <p className="font-semibold text-[#174964]">{publisher.label}</p>
                  )}
                  <p className="mt-2 text-sm leading-6 text-[#526574]">{publisher.notice}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="assayindex-panel p-5 md:p-7">
            <p className="assayindex-kicker">Contributing reference laboratories</p>
            <div className="mt-4 space-y-4">
              {release.referenceLaboratories
                .filter((laboratory) =>
                  release.manifest.contributingReferenceLaboratories.includes(laboratory.referenceLaboratoryId),
                )
                .map((laboratory) => (
                  <article key={laboratory.referenceLaboratoryId} className="assayindex-source-card p-4">
                    <a
                      className="assayindex-focus-ring font-semibold text-[#174964] underline-offset-4 hover:underline"
                      href={laboratory.href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {laboratory.label}
                    </a>
                    <p className="mt-2 text-sm leading-6 text-[#526574]">{laboratory.notice}</p>
                  </article>
                ))}
            </div>
          </section>

          <section className="assayindex-panel p-5 text-sm leading-7 text-[#526574] md:p-7">
            <p>
              These files contain validated source-native offerings and curated AssayIndex records, not raw source snapshots. Attention notices remain visible and do not suppress records. The data are informational and do not establish clinical validity, ordering availability, reimbursement, or a laboratory relationship. Verify current requirements with the source laboratory.
            </p>
          </section>
        </>
      ) : (
        <section className="assayindex-panel p-7">
          <p className="text-lg font-semibold text-[#102435]">No release-validated catalog is available.</p>
          <p className="mt-3 text-sm leading-7 text-[#526574]">
            No source-authorized batch has completed the integrity, provenance, and release-policy gates yet.
          </p>
        </section>
      )}
    </AssayIndexShell>
  );
}
