# AssayIndex Data Model

AssayIndex uses a normalized catalog with nine top-level collections:

- `meta`
- `assays`
- `labs`
- `assayLabRecords`
- `sourceDocuments`
- `assayLevelCodes`
- `curatedAssayRelationships`
- `coOrderRelationships`
- `sourceOfferings`

## Key entities

- `Assay`: normalized assay concept above any one lab
- `Lab`: laboratory organization and metadata
- `AssayLabRecord`: lab-specific offering or source-backed assay record
- `SourceDocument`: official source page, PDF, FAQ, or related reference
- `AssayLevelCode`: assay-level CPT, ICD-10, LOINC, or other mapping
- `CuratedAssayRelationship`: reviewed, source-backed directional relationship between assay concepts
- `CoOrderRelationship`: disclosure-reviewed aggregate co-occurrence between assay concepts
- `SourceOffering`: a source-native provider offering that remains fully browsable even before an explicit normalized assay mapping exists

## Important modeling rules

- Missing source values stay `null`
- UI rendering converts missing values to `Not listed by source`
- Supporting references remain distinct from orderable test records
- Assay-level codes are stored separately from lab-specific record code arrays
- ICD-10 entries remain informational and are not presented as billing guarantees
- Draft assays and records are removed by the public-catalog projection
- IDs are unique and record/source/code relationships must resolve before catalog validation succeeds
- A published lab record requires source provenance
- A published source offering requires an exact acquisition source, publisher, provider, external identity, immutable snapshot and candidate hashes, and source links
- Source status facts such as offline, non-CLIA, prior approval, or source-missing remain visible attention metadata and do not suppress a valid offering
- Turnaround time, methodology, and source-listed price belong to the lab-specific offering, not the normalized assay concept
- Price observations preserve the source text, price type, currency, effective date, and a URL already present in the offering provenance
- A CMS fee-schedule amount is labeled as a Medicare payment reference, never as a laboratory cash price or patient cost

## Related-test evidence

Curated and statistical relationships remain separate:

- `curatedAssayRelationships` captures reviewed relationships such as reflex, confirmatory, alternative, or component relationships. Every published relationship has direct source links.
- `coOrderRelationships` captures historical aggregate co-occurrence. It stores auditable counts and derives the directional percentage shown for the assay being viewed. It is observational and is not a clinical recommendation.

Co-order endpoints are normalized assay slugs. Source order codes and their mapping method remain in relationship provenance. The source observation basis is explicit: `same-order`, `same-claim`, `same-visit-ordered-or-provided`, `same-visit-measurement`, or `synthetic`. These terms are not interchangeable.

For a relationship with `pairSetCount` co-occurrences and `focalSetCount` observations containing the current assay, the displayed percentage is:

`pairSetCount / focalSetCount * 100`

Percentages do not need to total 100 because a single order, claim, or visit can contain more than one other assay. Associations below 10% are collapsed by default for readability, but the control reveals every published association. The threshold is presentation only and never removes data.

Only approved aggregate artifacts enter the catalog. Patient, respondent, beneficiary, claim, visit, encounter, requisition, order, specimen, or accession identifiers are not valid relationship fields. Each admitted dataset records its cohort, observation window, immutable source hash, code mapping, and completed disclosure review.

## Acquisition records

Private acquisition data is deliberately separate from the nine-collection published catalog:

- `AcquisitionSource`: a policy-controlled dataset, API, PDF, or HTML source owned by a source publisher
- `AcquisitionManifest`: retrieval URL, `retrievedAt`, `sourceUpdatedAt`, ETag, Last-Modified, byte count, and SHA-256
- `ReferenceLabCandidate`: an upstream laboratory identity discovered from a source, including its stable publisher-provided ID
- `TestCandidate`: a private source-native test offering awaiting either semantic curation or an approved deterministic source projection
- `SourceOffering`: the public projection of a complete validated source batch; it keeps provider and source-publisher identity separate and can have `assaySlug: null`

`NIH GTR` is a source publisher/registry. A university, hospital, public-health, specialty, or commercial laboratory found inside GTR is a reference-laboratory candidate. Those identities are never collapsed merely because their display names look alike.

## Published seed content

The published catalog edition includes:

- 8 assay concepts
- 4 labs: ARUP, Mayo Clinic Laboratories, Quest Diagnostics, Labcorp
- 16 lab records
- 1 additional CDC public-health laboratory and 250 source-native CDC offerings in a generated, provenance-backed slice
- Multiple specialties, code categories, and source document types
