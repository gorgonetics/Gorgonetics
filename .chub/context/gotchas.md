---
name: Gotchas & Non-Obvious Behaviors
description: "Things that will trip you up if you don't know about them"
tags: gotchas, debugging, pitfalls
---

# Gotchas & Non-Obvious Behaviors

## Database

- **Named parameters only:** All queries use `$name` syntax, not `?`. The adapter converts these. Using `?` directly breaks queries.
- **In-memory DB limitations:** The test fallback supports basic CRUD but has constraints:
  - `ORDER BY` column refs must not use table prefixes (strips `pi.created_at` → `created_at`)
  - `WHERE` conditions only support `=` equality, not `<`, `>`, `LIKE`
  - `LIMIT/OFFSET` parsing counts `?` manually to find param offsets
- **Species normalization:** `normalizeSpecies()` lowercases species strings. All config lookups assume lowercase. Mismatch causes silent missing effects.

## Asset Protocol (Tauri)

Serving local files via `convertFileSrc()` requires **BOTH** in `tauri.conf.json`:
1. CSP: `img-src` must include `asset: http://asset.localhost`
2. `app.security.assetProtocol` must have `enable: true` + scope array

Missing either causes **silent failure** — broken images, no error in console.

## Gene Templates

- **Built-in path:** `resources/assets/beewasp/file.json`
- **Browser dev path:** `/assets/beewasp/file.json` (strips `resources/`)
- **CI path:** `src/static/assets/` (copied from `assets/` in CI step)
- Using wrong path silently fails — no gene data, no error

## Gene Effects Caching

`getGeneEffectsCached()` loads effects once per species and caches in memory. Fast after first load, but no cache invalidation — restart required after gene data changes.

## Content Hash Deduplication

Pet `content_hash` is SHA-256 of genome text. Computed on upload, used to reject duplicate imports. The hash, not the name, determines uniqueness.

## CI/CD

- **pnpm version:** `version: latest` in CI resolves to pnpm v11 which removed `onlyBuiltDependencies`. Pin to `version: 10`.
- **E2E asset copying is critical:** If CI doesn't copy `assets/` and `data/` to `src/static/`, demo pets won't load and tests fail silently.
- **Annotated tags only:** Release script uses `git tag -a`. Lightweight tags won't trigger the release workflow.
- **Release requires clean main:** Script exits with error if not on main or if working directory is dirty.
- **Dependabot PRs:** Never close them — dependabot won't recreate. Fix underlying issues in a separate PR, merge, then `@dependabot rebase`.

## Styling

- **No Tailwind:** Plain CSS + Svelte scoped styles. CSS frameworks are not used.
- **Biome is strict:** Must pass with zero errors, zero warnings, zero infos. Even style suggestions block commits.
- **Dark mode:** `[data-theme="dark"]` CSS selector overrides custom properties. Theme respects OS preference, overridable in settings.

## Svelte 5

- Components use runes (`$props()`, `$state()`, `$derived()`, `$effect()`) — not legacy reactive syntax (`$:`, `export let`)
- Breaking change from Svelte 4 — old patterns silently fail or produce warnings
