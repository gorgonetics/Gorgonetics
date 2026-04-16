---
name: CI/CD & Release
description: "CI workflows, release process, build matrix, and version sync requirements"
tags: ci, cd, release, github-actions
---

# CI/CD & Release

## CI Workflows

### ci.yml (Push to main/develop, PRs)
Three parallel jobs:
1. **frontend-quality:** `pnpm lint:ci` (Biome, zero tolerance) + `pnpm build`
2. **e2e-tests:** Copy test assets → `pnpm test:e2e` (Playwright)
3. **rust-check:** `cargo check` in src-tauri/

### integration.yml (Push to main/develop, PRs)
Single job running E2E tests with asset copying.

### release.yml (Tag push `v*` or manual dispatch)
Build matrix:
| Platform | Target | Output |
|----------|--------|--------|
| macOS (latest) | aarch64-apple-darwin | .app + .dmg |
| Ubuntu 24.04 | x86_64-unknown-linux-gnu | .deb + .AppImage |
| Windows (latest) | x86_64-pc-windows-msvc | NSIS installer |

Uses `tauri-apps/tauri-action@v0` with signing keys from GitHub secrets.

### pages.yml
Deploys docs/ site on release publish.

## CI Requirements

- **pnpm version:** Pinned to major version 10 (not `latest` — v11 breaks `onlyBuiltDependencies`)
- **Asset copying:** CI must run `cp -r assets/* src/static/assets/ && cp -r data/* src/static/data/` before E2E tests
- **Biome strictness:** Zero errors, zero warnings, zero infos

## Release Process

```bash
pnpm release patch   # or: minor, major
```

The `scripts/release.sh` script:
1. Bumps version in package.json, tauri.conf.json, Cargo.toml, docs/index.html
2. Runs `pnpm screenshots` (starts dev server, captures screenshots, kills server)
3. Runs `pnpm lint:ci` + `pnpm test:e2e`
4. Generates changelog from git log since last tag
5. Commits, creates **annotated** tag (lightweight tags won't trigger release workflow)
6. Pushes — triggers release workflow
7. **Manual step:** Edit draft release on GitHub and publish

## Version Sync

These files must always have matching version strings:
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `docs/index.html`

The release script handles this automatically. Manual edits must update all four.

## Cross-Compilation (Windows from macOS)

```bash
brew install nsis llvm
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
pnpm tauri:build:windows
```
First build downloads Windows SDK (~1 GB, cached). Produces NSIS installer only.
