# AssayIndex Deployment Notes

AssayIndex is a standalone Next.js application whose public demo currently runs
at `filippogalbo.com/assayindex`.

## Hosting assumptions

- Next.js App Router build deployed on Vercel or another static-friendly host
- Published catalog browsing remains static; the optional validated GTR testing search uses one bounded Node API route
- Routes live under `/assayindex/*`
- The browser fetches a same-origin hosted snapshot from `/assayindex/catalog.json` and falls back to the embedded build-time catalog if that fetch fails or the payload is invalid
- When `NEXT_PUBLIC_ASSAYINDEX_CATALOG_URL` is configured, the browser tries that hosted snapshot first and then falls back to `/assayindex/catalog.json`

## Important constraints

- No Google services for fonts or analytics
- No runtime scraping of third-party lab sites in-browser
- Published catalog browsing requires no private environment variables. GTR testing search requires server-only `ASSAYINDEX_GTR_READ_WRITE_TOKEN` and `ASSAYINDEX_GTR_TESTING_MANIFEST_BLOB_PATH`; neither is exposed to the browser.
- Acquisition is a separate Node/CI concern and never runs in a public page or build hook

## Deployment checklist

1. Run `npm install`
2. Run `npm run sync:assayindex-catalog` to regenerate the public catalog and download release
3. Run `npm run lint`
4. Run `npm run typecheck`
5. Run `npm run test`
6. Run `npm run build`
7. Deploy the resulting Next build

For staged GTR testing search, also run `npm run generate:assayindex-gtr-search`, publish it with `npm run publish:assayindex-gtr-search`, and set `ASSAYINDEX_GTR_TESTING_MANIFEST_BLOB_PATH=assayindex/testing/gtr/latest.json` in Vercel. The stable private manifest means later weekly snapshots can be updated without changing the application environment variables.

## Published catalog flow

- Source-controlled catalog content combines `features/assayindex/data/published/catalog.json` with generated, validated slices under `features/assayindex/data/published/source-offering-slices/`
- `npm run sync:assayindex-catalog` creates a published-only projection at `public/assayindex/catalog.json` and regenerates `public/assayindex/downloads/*`
- `predev` and `prebuild` run the sync automatically
- Public AssayIndex pages fetch `/assayindex/catalog.json` client-side with `cache: "no-store"` so the deployed app can refresh from the latest hosted snapshot without adding a custom API
- Source-offering detail routes are statically enumerated with `dynamicParams = false`. A release that introduces a new offering ID therefore requires a site rebuild/deploy; a JSON-only snapshot refresh can update existing IDs but cannot create new static routes.

## Optional no-rebuild publish flow

If you want to refresh the live catalog snapshot without rebuilding the whole site:

1. Create a public Vercel Blob store and obtain `BLOB_READ_WRITE_TOKEN`
2. Run `npm run publish:assayindex-catalog:blob`; the script first regenerates the schema-validated, public-only release and verifies the catalog SHA-256 against its manifest
3. Set `NEXT_PUBLIC_ASSAYINDEX_CATALOG_URL` to the public Blob URL returned by the publish script
4. Redeploy once so the app knows which hosted snapshot URL to check first
5. Future catalog refreshes can publish the JSON to the same Blob pathname and the app will pick up the new snapshot on the next browser load

The local `/assayindex/catalog.json` snapshot remains the browser-safe fallback if the hosted Blob URL is missing, unreachable, or invalid.

## Source acquisition

The public repository intentionally does not include the operational acquisition
workflow because that workflow handles private snapshots and staged candidates.
The same registry-driven updater can be run in a controlled private environment
and:

1. runs the Node acquisition safety tests
2. restores the last private snapshot state for ETag/Last-Modified requests
3. explicitly accounts for every registry entry and downloads every enabled, policy-approved source with an implemented acquisition adapter
4. keeps release-blocked sources such as GTR staged-only and promotes only sources with an explicit, approved promotion adapter
5. preflights all selected promotions before applying one recoverable public update and one catalog sync
6. runs the acquisition tests, complete AssayIndex suite, typecheck, scoped lint, and Next build after generation
7. creates the validated GTR testing-search index and, when the Blob secret is configured, publishes its private content-addressed artifact and stable manifest
8. saves continuity state only after verification and keeps private-source artifacts separate from public-safe release artifacts
9. never deploys, commits, pushes, or writes to a live catalog

Acquisition or validation failures do not update the last validated snapshot.

Run the same path locally with:

```powershell
npm run test:assayindex-acquisition
npm run update:assayindex-sources -- --all --allow-network
npm run update:assayindex-sources -- --all --allow-network --write
npm run review:assayindex -- --gene FMR1 --condition "Fragile X" --limit 10
```

Acquisition is networked and writes private snapshots only to ignored `.assayindex/runtime` storage. Candidate review is local and read-only and currently covers GTR discovery records. Without `--write`, the shared updater changes no canonical or public files. With `--write`, it preflights all releasable sources, applies the public update as a recoverable set, and syncs the catalog once. It does not deploy a site.

## Source rollback or takedown

1. Set the affected source to `releaseEnabled: false` to block it from release generation while preserving private acquisition evidence.
2. Run `npm run update:assayindex-sources -- --all --allow-network --write`; registry-derived generation removes the inactive generated slice and excludes it from the embedded catalog and downloads inside the rollback-protected update.
3. Verify the regenerated manifest, checksums, attribution files, and updater accounting.
4. Run the AssayIndex tests, typecheck, and build.
5. Rebuild and deploy the site so stale static offering routes and public files are removed. Do not rely on a JSON-only snapshot refresh for a route-level takedown.

## Public repository boundary

The standalone repository contains no Firebase dependency, registrar settings,
Vercel project link, provider credentials, or private acquisition artifacts.
Hosting configuration belongs to the deployment environment.
