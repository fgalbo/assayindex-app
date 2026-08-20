# AssayIndex Curator Workflow

Curator mode lives at `/assayindex/curator`.

## What it is

- Local browser authoring utility
- Import, validation, edit, preview, diff, and export workflow
- Draft persistence using IndexedDB with localStorage fallback helpers

## What it is not

- Not a secure admin dashboard
- Not protected by server-side auth
- Not a multi-user editing system

## Supported actions

- Import catalog JSON
- Validate structure plus unique IDs, relationships, publication status, and minimum provenance with Zod
- Show human-readable validation issues
- Browse assays, labs, records, sources, and assay-level codes
- Edit structured fields
- Add and remove entities
- Add and remove source links
- Add and remove ICD-10 associations on records
- Preview the public assay detail renderer against the current draft
- Compare draft vs published paths
- Export canonical JSON
- Import, validate, preview, and export sourced price observations plus curated and aggregate assay relationships through canonical JSON

Nested price and relationship editing is JSON-first in the current curator. Dedicated form controls are a follow-up; schema validation, preview, public projection, and export still apply before publication.

## Acquisition candidates and systemic source batches

Scheduled acquisition first produces immutable snapshot manifests and staged candidates under `.assayindex/runtime`. Sources needing semantic normalization, such as NIH GTR discovery records, remain private and use bounded curator review for:

- the upstream laboratory identity and stable source ID
- whether the test is orderable and public
- every populated clinical field and its provenance
- new, changed, ambiguous, and source-missing records
- source completeness and unexpected deletion volume

Unknown values remain `null`. A missing upstream record becomes a reviewable source-missing candidate, never an automatic deletion.

The CDC Test Directory follows a source-level approval path. A curator approves the source policy once; the shared updater then reconciles and validates the complete batch through its registered promotion adapter. There is no 250-page approval queue. Offline, non-CLIA, prior-approval, unavailable, and source-missing records are published with visible attention notices. Only genuine schema, identity, provenance, hash, count, adapter-configuration, or release-policy failures block the batch.

```powershell
npm run update:assayindex-sources -- --all --allow-network
npm run update:assayindex-sources -- --all --allow-network --write
npm run update:assayindex-sources -- --source cdc-infectious-diseases-test-directory --allow-network --write
```

The first command acquires and validates every enabled source, then performs public-promotion preflights without changing public files. `--write` applies the recoverable source-slice update set and regenerates the release once. The selected-source form is useful for diagnosis or an on-demand refresh. None of these commands deploys, commits, or pushes.

Price, turnaround, and method facts remain attached to the laboratory offering that published them. Do not copy one provider's values onto the normalized assay or another provider's offering. Statistical co-order relationships are admitted only as aggregate, disclosure-reviewed artifacts and remain separate from curator-authored clinical relationships.

Use the private read-only review command to find a bounded working set before manually curating records:

```powershell
npm run review:assayindex -- --gene FMR1 --condition "Fragile X" --limit 10
npm run review:assayindex -- --lab University --limit 25
npm run review:assayindex -- --review-required --limit 10
```

All supplied filters are combined. The command validates and scans the full staged test artifact, optionally joins the independently validated condition/gene artifact, and returns no more than 100 results. It does not import into curator mode or modify the catalog. GTR promotion remains a future, explicitly designed semantic-curation path rather than inheriting the CDC batch mapper.
