# Data sources and rights

The MIT License covers AssayIndex software, not third-party data or names. The
downloadable release carries machine-readable attribution and provenance in
`public/assayindex/downloads/`.

| Source | Included material | Public-repository decision |
| --- | --- | --- |
| CDC Infectious Diseases Laboratory Test Directory | Source-native public release records with attribution and provenance | Included. CDC attribution, policy link, and no-endorsement language ship with the release. |
| NIH Genetic Testing Registry | No staged index, provider snapshot, or bulk candidate data | Excluded. The repository contains validation and search code only; runtime testing data remains private and release-disabled. |
| ARUP, Mayo Clinic Laboratories, Quest Diagnostics, and Labcorp | Limited manually curated catalog facts, identifiers, and source links | Included as an attributed index. No captured provider pages or bulk provider payloads are distributed. Verify current facts and source terms at the linked laboratory. |
| LOINC | Individual LOINC identifiers referenced by indexed tests; no LOINC table or terminology release | Included with the required notice below. No LOINC release/version applies to this export because AssayIndex does not redistribute a LOINC release. Individual identifiers are transcribed from cited laboratory source pages, whose verification dates are retained in catalog provenance. |
| CPT | No populated CPT codes or descriptions | Excluded from this public repository pending a separate AMA license. The schema remains capable of representing source-listed billing codes when appropriately licensed. |

Required LOINC notice:

> This material contains content from LOINC (http://loinc.org). LOINC is copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is available at no cost under the license at http://loinc.org/license. LOINC® is a registered United States trademark of Regenstrief Institute, Inc.

AssayIndex does not grant rights to laboratory trademarks, source websites, or
third-party content. The source registry records the policy URL and publication
decision used for each acquisition source. See `features/assayindex/acquisition/source-registry.json`.

For the exact release-specific notices, review:

- `public/assayindex/downloads/SOURCE-ATTRIBUTION.json`
- `public/assayindex/downloads/provenance.json`
- `public/assayindex/downloads/manifest.json`
- `public/assayindex/downloads/SHA256SUMS.txt`
