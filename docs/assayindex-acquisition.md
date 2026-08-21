# AssayIndex Acquisition and Source Policy

AssayIndex is a noncommercial public-health reference project for finding orderable tests across national, university, hospital, public-health, regional, and specialty reference laboratories. It stores public laboratory catalog information, not patient records or PHI.

## Product direction

- Official bulk databases and documented APIs come first.
- Public PDFs and downloadable test menus are retained as dated source snapshots.
- Source-specific HTML collection is a last-resort adapter when no structured source exists.
- OCR and AI extraction are not part of the core pipeline. Deterministic parsers, source-level policy, complete-batch reconciliation, and exception-only review are preferred; semantic normalization still uses curator review where needed.
- Public browsing remains static and browser-first; collection never runs in a visitor's browser.

## Source controls

Every acquisition source is a record in `features/assayindex/acquisition/source-registry.json`. The registry is open-ended and is not limited to known national vendors. Each source records:

- source publisher and dataset identity
- exact URL and HTTPS host allowlist
- enabled/disabled kill switch
- acquisition and redistribution status
- policy URL and policy review date
- attribution and source disclaimer
- cadence, timeout, compressed size, expanded size, content-type, malformed-row, and candidate-count limits
- an acquisition adapter and, when complete-batch public projection is supported, a separate promotion adapter
- an explicit testing-search switch and public/non-patient classification when validated staged data may be queried without entering the downloadable release

Evaluation access is authorized for this implementation. Redistribution remains a separate reviewed decision. Disabling acquisition immediately stops future retrieval. Revoking `releaseEnabled` or redistribution approval excludes that source's generated slice on the next complete `--all --write` update; a deliberate release-policy change therefore acts as the source-level takedown control without deleting private evidence.

Use `npm run update:assayindex-sources -- --all --allow-network` to acquire every enabled source and preflight every allowed promotion without changing public files. Add `--write` to apply the validated public update and regenerate the release. The updater reports disabled and unapproved registry entries explicitly rather than silently omitting them. A release-approved acquisition source without a registered promotion adapter is a configuration error; it is never auto-mapped through another source's logic.

## Three dates

- `retrievedAt`: when AssayIndex fetched the bytes
- `sourceUpdatedAt`: the provider's `Last-Modified` or published/effective date when available
- `reviewedAt`: when a curator approved the normalized change for publication

ETag and Last-Modified values support conditional updates. A separate `latest-validated.json` marker records the last snapshot that passed parsing and count gates; that immutable snapshot remains available when a refresh fails.

## First source family: NIH GTR

The first live adapters download two complementary official GTR reports:

- The weekly `test_version.gz` report supplies submitted test versions and laboratory identity; AssayIndex retains only the latest version indicated by `now_current=1` as a discovery candidate.
- The daily `test_condition_gene.txt` report supplies condition and gene relationships keyed by the exact accession version. AssayIndex currently checks both reports on its weekly acquisition schedule.

The adapters:

- require `--allow-network` and an exact registered source ID
- allow only `https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_version.gz` and `https://ftp.ncbi.nlm.nih.gov/pub/GTR/data/test_condition_gene.txt`
- validate redirects, timeout, retry ceiling, content type, declared/streamed size, gzip or full-file UTF-8 integrity, and expanded size
- hashes raw bytes with SHA-256 and stores immutable raw/manifests
- keeps GTR accession and GTR laboratory ID as source identities
- stages arbitrary laboratory organizations without a hardcoded provider list
- treats `now_current=1` as the latest-version row for an accession, not proof that a test is active or orderable
- preserves source status codes and deletion dates, and flags deleted or unrecognized-status rows for curator review
- fails validation on malformed rows, an implausibly small first snapshot, or retention below 90% of the previous validated candidate count
- filters nothing into the canonical catalog automatically
- leaves missing fields as `null`

The condition/gene parser accepts the official `#accession_version` header, keeps MedGen identifiers distinct from NCBI Gene and SNOMED CT identifiers, and fails on required-column drift, malformed rows, conflicting test types, oversized data, or a material record-count regression. It enriches private review results only; it does not create canonical assay, laboratory, or orderable-test records.

GTR data are submitted by laboratories and are not independently verified by NIH. Preserve the GTR attribution and disclaimer whenever GTR-derived records enter a public release. See the [official GTR access documentation](https://www.ncbi.nlm.nih.gov/gtr/docs/maintenance_use/).

### Verified live discovery baseline

The 2026-08-12 adapter probe downloaded the GTR snapshot last updated 2026-08-09:

- raw bytes: `13,060,813`
- SHA-256: `a5ffc076a135c97f6d85b36f8d8a83f7e1bad225cd75b38ac35e64bee7a94b2e`
- latest-version staged candidates (`now_current=1`): `64,065`
- non-latest versions skipped: `160,074`
- parsing issues after quote/list normalization: `0`
- source-status review candidates: `5` (one deletion-dated row; `testCurrentStatus` values `72` once and `1029` four times)
- second conditional request: unchanged snapshot reused successfully

The complementary condition/gene probe used the source report last updated 2026-08-09:

- raw bytes: `47,762,523`
- SHA-256: `9c09fab61f99f2a5ee873bc2acf8a30bc8b42203d01d931c01f64e83663b17f0`
- staged accession-version records: `64,102`
- parsing issues: `0`
- second conditional request: unchanged snapshot reused successfully

`now_current` is used only to select the latest source version. It does not establish current orderability. Source status codes are retained verbatim; deletion-dated and unrecognized-status candidates remain review-required until their semantics and upstream state are confirmed. This baseline is acquisition evidence only. None of these candidates have been promoted to the public catalog.

### Private candidate review

Review only accepts staged artifacts that match their `latest-validated.json` marker, snapshot SHA-256, adapter version, record counts, and per-record normalized hashes. It scans the complete staged candidate artifact but returns at most 100 results. Filters are combined with AND semantics, and the condition/gene report is joined automatically when its validated artifact is available.

```powershell
npm run review:assayindex -- --gene FMR1 --condition "Fragile X" --limit 10
npm run review:assayindex -- --lab University --limit 25
npm run review:assayindex -- --review-required --limit 10
```

The review command is read-only: it performs no network request and writes neither runtime files nor the canonical/public catalog.

### Validated staged testing search

The public Search page can query the complete validated GTR discovery snapshot without promoting it into the curated catalog. `npm run generate:assayindex-gtr-search` reuses the same marker, adapter, record-hash, footer, issue-count, and condition/gene validation as candidate review, then creates a content-addressed SQLite FTS index beneath ignored `.assayindex/runtime` storage. The result contains only allowlisted test, laboratory, gene, condition, method, source-status, and provenance fields; it contains no patient records, raw source rows, or contact records.

`npm run publish:assayindex-gtr-search` uploads the compressed index and a stable `latest.json` manifest to private Vercel Blob storage. The server-side API authenticates with the namespaced `ASSAYINDEX_GTR_READ_WRITE_TOKEN`, verifies both hashes, byte limits, SQLite integrity, source identities, counts, and zero-issue status, and returns at most 50 clearly labeled staged results. Browsers cannot download the private index directly. GTR results link to the official GTR record and remain excluded from Catalog, Labs normalization, Saved, Compare, and public downloads.

## CDC Infectious Diseases Test Directory

The CDC adapter downloads the structured XML used by CDC's searchable Infectious Diseases Laboratory Test Directory. It preserves every source record, including tests that are temporarily offline, and stages source-listed test identity, method, turnaround text, specimen and transport requirements, status, CLIA flag, prior-approval flag, professional directory contacts, internal source identifiers, and version. Missing values remain `null`; structured turnaround is created only when CDC supplies a coherent numeric value and unit.

The adapter:

- allows only `https://www.cdc.gov/laboratory/specimen-submission/js-app/data.xml`
- rejects DTD/entity declarations, CDATA, malformed or unexpected XML structure, duplicate CDC test codes, unsupported status values, invalid UTF-8, oversized files, and material count regressions
- converts source-escaped presentation markup to plain text while retaining the immutable raw XML snapshot
- uses a fixed CDC provider identity and preserves internal `LabID`, `TestID`, and `UnitNumber` values only as source identifiers
- preserves offline, unavailable, non-CLIA, and prior-approval facts as visible attention notices instead of hiding, discarding, or requiring page-by-page approval
- writes acquisition output only as a private, staged-only candidate artifact; the separate source-policy-gated promotion command produces the public source-offering slice

CDC states that the directory is continually updated. Preserve CDC attribution, identify AssayIndex as independent and not CDC/HHS endorsed, and link to the free original directory whenever CDC-derived records are approved for a public release. See the [CDC Test Directory](https://www.cdc.gov/infectious-diseases-labs/php/test-directory/index.html) and [CDC agency materials policy](https://www.cdc.gov/other/agencymaterials.html).

### Verified live CDC baseline

The 2026-08-12 adapter probe used the directory generated 2026-08-03 and last modified 2026-08-03:

- raw bytes: `1,356,277`
- SHA-256: `2d1744ec809a53970ecc8681b5485972dd3add319de69088df46549a4544e360`
- staged test offerings: `250`
- source-offline offerings retained: `21`
- source-identified CLIA offerings: `104`
- attention-flagged candidates: `201` (offline, non-CLIA, and/or prior-approval facts; none are suppressed)
- parsing issues: `0`
- second conditional request: unchanged snapshot rehashed, revalidated, and restaged successfully

The validated batch is now projected into 250 public source offerings with exact source/provider identities and provenance. It is not force-mapped to normalized assay concepts, and all 201 attention-flagged records remain searchable.

## Source roadmap

### Federated reference-laboratory status

The Search page uses one server-side federated boundary. By default it contacts a source adapter only after an explicit directory-search action. In testing deployments, `ASSAYINDEX_AUTO_EXTERNAL_FALLBACK_ENABLED=true` instead submits a query when the local catalog has no match and validated GTR either returns no match or is unavailable. The UI discloses this behavior before a fallback can run. Neither mode accepts a client-supplied source URL or writes a live result into the published catalog.

- **ARUP:** the evaluation adapter performs bounded server-side search and detail retrieval, validates canonical ARUP URLs, and returns source-linked, unverified candidates without persistence. ARUP's current online policy limits non-personal electronic reproduction without prior written consent, so this remains an explicitly labeled testing connection rather than a durable publication feed.
- **Mayo Clinic Laboratories:** the connector is `official-directory-only`. Mayo's robots policy excludes catalog search/print/setup paths and its terms restrict unapproved automated access, so AssayIndex provides a direct handoff instead of making a server request.
- **Quest Diagnostics:** the connector is `official-directory-only`. No documented public test-directory API or universal service-area contract was identified, so AssayIndex provides a direct handoff and does not call the directory application's internal services.
- **Labcorp:** the connector is `official-directory-only`. The current user agreement expressly prohibits automated collection without written permission, so AssayIndex provides a direct handoff to the official Test Finder.
- **LOINC:** LOINC is terminology, not a reference laboratory. Valid codes link to their official LOINC records. Authenticated Search/Download API ingestion remains a separate enrichment task and requires server-side account credentials, release-version provenance, and LOINC attribution.

These handoffs are complete connections for testing: every provider has a usable official path. A server-side adapter additionally requires explicit evaluation authorization and its source-policy gate; testing responses remain nonpersistent and are never promoted automatically. Turning an environment flag on cannot bypass that gate.

| Source | Intended role | Current implementation state |
| --- | --- | --- |
| NIH GTR | First bulk discovery source for genetic and microbial tests | Latest-test and condition/gene download, staging, private review, and separately labeled testing search implemented |
| CDC Infectious Diseases Test Directory | Public-health catalog for rare CDC reference testing | XML download, deterministic staging, complete-batch source-offering promotion, downloads, and weekly release-artifact generation implemented |
| LOINC | Licensed terminology enrichment, not a laboratory catalog | Official record links implemented; authenticated versioned enrichment feed pending credentials |
| ARUP | Reference-lab directory and per-test interface maps | Evaluation search/detail adapter implemented with explicit submit and opt-in unmatched-query fallback; no persistence or automatic publication |
| Mayo Clinic Laboratories | Full catalog PDF and test pages | `official-directory-only` handoff implemented; automated catalog paths not requested |
| Quest Diagnostics | Test directory | `official-directory-only` handoff implemented; documented API and service-area contract unavailable |
| Labcorp | Test directory | `official-directory-only` handoff implemented; automated collection not requested |
| University, hospital, public-health, and specialty labs | Rare-test discovery from databases, menus, PDFs, or approved HTML | Supported by the open-ended source/lab identity model; adapters added per source |

## Federal enrichment roadmap

- The CDC Infectious Diseases Test Directory adapter supplies published source-native specimen, method, turnaround, status, CLIA, and access facts for rare CDC reference testing after complete-batch gates pass.
- CMS CLIA Provider of Services can discover and validate laboratory organizations, but does not prove that a specific assay is offered.
- NCBI Gene and MedGen can normalize gene and condition identifiers without asserting that a laboratory offers a test.
- CMS Clinical Laboratory Fee Schedule values may be imported only as dated Medicare payment references tied to a source-backed HCPCS mapping. They are not provider cash prices, patient costs, or coverage decisions.
- CMS hospital price-transparency files may eventually provide provider-specific source-listed prices. They require conservative code mapping and hospital-level provenance.
- CDC NHANES and NNDSS/WONDER can support separately labeled population context. Their measurements or case counts are not clinical co-order behavior.

No open federal download identified in the current review provides true same-requisition pair counts. Genuine `same-order` percentages require an approved laboratory or LIS aggregate. Claims and research datasets must retain their actual basis, such as `same-claim` or `same-visit`, rather than being relabeled as orders.

LOINC downloads/API access remain subject to the [LOINC license](https://loinc.org/license). Source-policy review is required even for noncommercial use because public visibility, acquisition permission, and redistribution permission are separate questions.

## Provider agreement request checklist

When formalizing access with a reference laboratory, request:

- a bulk file or documented API and its schema
- the fields permitted for collection and republication
- a recommended refresh cadence
- permission to redistribute normalized factual records and provenance
- attribution and disclaimer text
- caching and source-archive rights
- rate limits and required user-agent/contact details
- a takedown/disable contact and effective date

## Publication and downloads

`npm run sync:assayindex-catalog` validates the merged catalog, creates the public-only projection, and passes it through the release gate before writing deterministic catalog JSON, formula-safe lab-record and source-offering CSV files, per-record provenance, source documents, exact source-ID attribution, a manifest, and SHA-256 checksums. The source-offering CSV carries attribution and disclaimer fields, and the companion `SOURCE-ATTRIBUTION.json` is included in the checksum set and release bundle. Curated records require their review/provenance gates; acquisition-derived offerings additionally require exact source-ID approval. Reference laboratories are labeled separately from upstream database publishers in release metadata.

The existing curated ARUP, Mayo Clinic Laboratories, Quest, and Labcorp records have explicit evaluation release approvals in the source registry. The CDC source has source-level release approval and contributes its complete validated batch. NIH GTR acquisition remains `releaseEnabled: false`: its staged candidates are private discovery input, not part of the downloadable catalog. Raw snapshots and staged candidates stay below `.assayindex/runtime`, are excluded from Vercel upload contexts, and are never copied into `public`.
