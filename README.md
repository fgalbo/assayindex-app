# AssayIndex

AssayIndex is a testing-phase, source-transparent laboratory test index. It keeps curated catalog records, validated staged NIH Genetic Testing Registry submissions, and explicit live-directory candidates separate while preserving provenance and downloadable release files.

## Live demo

[Open AssayIndex](https://www.filippogalbo.com/assayindex)

The current public snapshot includes curated assay records and source-native CDC offerings. NIH GTR results are exposed through a bounded, server-side testing index; live reference-laboratory lookups require an explicit user action and remain clearly labeled as source candidates.

## Data tiers

- **Verified AssayIndex records** are curated, versioned catalog entries with source documents.
- **Validated staged NIH GTR** results are integrity-checked discovery records. They are not curated or published catalog entries.
- **Live source candidates** come from explicit directory lookups and are not automatically imported or published.

AssayIndex is informational and independent. It does not establish clinical validity, medical appropriateness, current orderability, coverage, reimbursement, or laboratory endorsement. Always verify current requirements with the source laboratory.

## Features

- Search across curated records, CDC source offerings, and separately labeled NIH GTR testing data
- Explicit reference-laboratory directory lookup with isolated per-source status
- Laboratory, code, comparison, saved-record, and browser-local curator views
- JSON and CSV downloads with source attribution, provenance, and SHA-256 checksums
- Deterministic acquisition, validation, promotion, and release tooling

## Local development

Requirements: Node.js 24 and npm.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000/assayindex`. The static catalog works without secrets. Optional server features use the server-only variables documented in [`.env.example`](.env.example).

## Verification

```bash
npm run test:assayindex-acquisition
npm test -- tests/assayindex
npm run typecheck
npm run lint
npm run build
```

After a successful build:

```bash
npm run test:e2e -- tests/e2e/assayindex.spec.ts
```

## Architecture

AssayIndex uses Next.js App Router and a strict separation between acquisition, staged review, public projection, and downloadable releases. Provider snapshots and private testing indexes are never committed. See [`docs/assayindex-architecture.md`](docs/assayindex-architecture.md) and [`docs/assayindex-data-model.md`](docs/assayindex-data-model.md).

## Licensing and attribution

The original software in this repository is licensed under the MIT License. Source data, laboratory names, terminology, and third-party material are not relicensed by that software license. See [`NOTICE`](NOTICE), [`DATA-LICENSES.md`](DATA-LICENSES.md), and the release attribution files under [`public/assayindex/downloads`](public/assayindex/downloads).
