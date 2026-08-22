# AssayIndex Architecture

AssayIndex is implemented inside the existing Next.js App Router site as a route cluster under `/assayindex/*`.

## Runtime model

- Published catalog content is loaded from repo-controlled data files at build time
- Published catalog pages render from local catalog data; the Search page also calls bounded same-origin routes for bundled terminology and explicitly labeled testing connections
- Search, compare, save, export, and curator draft handling run in the browser
- Client pages that read URL search params are wrapped in `Suspense` so static generation remains intact

## Main feature boundaries

- `features/assayindex/domain` for shared product types
- `features/assayindex/schema` for Zod validation
- `features/assayindex/data` for published catalog input
- `features/assayindex/data/published/source-offering-slices` for deterministic, source-native public batches
- `features/assayindex/selectors` for report, lab, code, and comparison transforms
- `features/assayindex/selectors` also derives directional co-order percentages from validated counts; percentages are not stored independently
- `features/assayindex/search` for Fuse.js-based browser search
- `features/assayindex/terminology` for validated common-order and supplemental-concept search, strict short-mnemonic matching, and disclosed evidence-backed interpretations
- `features/assayindex/data/terminology` for the generated NLM Common Lab Orders snapshot and versioned audited mnemonic supplement bundled with the application
- `features/assayindex/storage` for saved state and curator draft persistence
- `features/assayindex/export` for JSON and DOCX export
- `features/assayindex/acquisition` for pure source-policy, GTR/CDC parsing, publication-gate, and release contracts
- `features/assayindex/curator` for draft defaults, diffing, and import/export helpers
- `features/assayindex/components` and `features/assayindex/pages` for UI
- `scripts/assayindex/acquisition` for Node-only network retrieval, immutable snapshots, and staged candidates
- `scripts/update-assayindex-common-orders.mjs` for explicit, bounded refresh of the public common-order terminology snapshot and 100%-validated fixed-code supplement

## Acquisition and publication boundary

`source policy -> immutable raw snapshot -> source adapter -> staged candidates -> semantic validation -> curated normalization OR deterministic source projection -> release gates -> static release`

- Acquisition is never imported by browser code and never runs during development or build.
- Network access requires both an enabled source policy and the explicit CLI flag `--allow-network`.
- Source publishers such as NIH GTR and CDC are separate from reference laboratories or provider offerings represented in their data.
- New university, hospital, public-health, specialty, and commercial laboratories use source identifiers from the upstream dataset; no vendor allowlist exists.
- Acquisition writes only beneath the ignored `.assayindex/runtime` directory.
- Acquisition itself cannot overwrite or publish the catalog.
- `npm run update:assayindex-sources -- --all --allow-network --write` is the shared maintenance entry point. It plans sources from the registry in deterministic order, acquires every enabled and approved adapter, keeps release-blocked sources staged-only, preflights every explicitly configured and source-policy-approved promotion, and generates the public release once.
- Acquisition and promotion use separate closed adapter registries. Adding a source therefore requires an explicit parser/stager and, only when public projection is approved, an explicit promotion adapter; release permission never causes one source's mapper to be reused for another.
- Public writes are wrapped as one recoverable update set. Private validated snapshots may remain after a later failure, but generated slices, the embedded slice module, release metadata, and public files roll back together.
- Integrity failures stop the batch; offline, non-CLIA, prior-approval, and source-missing facts remain visible instead of becoming per-page approval tasks.

## Static-host compatibility

- Assay detail and lab detail pages use `generateStaticParams`
- No AssayIndex core feature requires runtime environment secrets
- Common-order terminology search reads the bundled snapshot server-side and never forwards visitor queries to NLM
- AssayIndex uses system/local fonts rather than Google-hosted fonts
- Verified releases are prebuilt under `public/assayindex/downloads` rather than generated in the browser
- Provider offerings are presented in deterministic laboratory/test-name order. Provider size, catalog coverage, price completeness, and co-order strength do not affect default offering order.
- The co-order expand control is a small client component. All relationship data remains part of the static catalog and download; the 10% threshold only controls initial visibility.
