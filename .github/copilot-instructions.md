# Copilot Instructions for Gorgonetics

**Read [AGENTS.md](../AGENTS.md) first** — it contains the project architecture, commands, code standards, and development patterns shared across all AI tools.

## Copilot-Specific Instructions

### Response Style
- Do not provide summaries of work completed unless specifically requested
- Keep responses concise and focused on the immediate task
- Only explain what you're doing if there's ambiguity or complexity that needs clarification
- Do not use emojis or emoticons

### Workflow
- Never run bare `python`, always use `uv run python`
- Avoid creating new terminal tabs; reuse existing ones
- Always run `uv sync --dev` after pulling to ensure dependencies are current
- Run `uv run ruff check` and `uv run ruff format` before committing Python changes
- Run `pnpm run lint:ci` before committing JS/Svelte changes

### CLI Design Principles
- Use typer for command-line interface
- Use rich for beautiful terminal output
- Provide helpful error messages
- Include progress indicators for long-running operations
