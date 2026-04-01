# Copilot Instructions for Gorgonetics

**Read [AGENTS.md](../AGENTS.md) first** — it contains the project architecture, commands, code standards, and development patterns shared across all AI tools.

## Copilot-Specific Instructions

### Response Style
- Do not provide summaries of work completed unless specifically requested
- Keep responses concise and focused on the immediate task
- Only explain what you're doing if there's ambiguity or complexity that needs clarification
- Do not use emojis or emoticons

### Workflow
- Run `pnpm run lint:ci` before committing JS/Svelte changes
- Run `cd src-tauri && cargo check` to verify Rust compilation
- Always create a branch and merge via PR — never push directly to main
