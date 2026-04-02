# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read [AGENTS.md](AGENTS.md) first** — it contains the project architecture, commands, code standards, and development patterns shared across all AI tools.

## Claude-Specific Instructions

### Mandatory: Lint Before Committing

After modifying **any** JavaScript, TypeScript, or Svelte file, you MUST run the linter and fix all errors before committing:

```bash
pnpm run lint:ci             # Biome check (zero errors)
pnpm run lint:fix            # Auto-fix formatting and lint issues
```

### Never Fabricate External Facts

This project relates to the game **Project Gorgon**. Do NOT invent, guess, or assume game mechanics, commands, terminology, URLs, or any other external facts. If you don't know something about the game (or any external system), either leave it out or explicitly flag it as unverified. Misleading users with made-up information is worse than leaving a gap.

### Development
- Native app: `pnpm tauri:dev` (launches Tauri + Vite on port 5174)
- Frontend only: `pnpm dev` (Vite on port 5174)
- Access the app at http://localhost:5174 during frontend-only dev

### Testing
```bash
pnpm test:e2e                # Playwright E2E tests (30 tests)
pnpm test:e2e:headed         # With visible browser
```

### Build
```bash
cd src-tauri && cargo check        # Verify Rust compiles
pnpm tauri:build                   # macOS production bundle (.app/.dmg)
pnpm tauri:build:windows           # Cross-compile Windows NSIS installer from macOS
```
