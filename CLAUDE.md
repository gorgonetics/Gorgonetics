# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read [AGENTS.md](AGENTS.md) first** — it contains the project architecture, commands, code standards, and development patterns shared across all AI tools.

## Claude-Specific Instructions

### Mandatory: Lint Before Committing

After modifying **any** Python or JavaScript/Svelte file, you MUST run the relevant linters and fix all errors before committing. These are the same checks CI runs:

```bash
# After changing Python files:
uv run ruff check .          # Fix all errors
uv run ruff format --check . # Fix any formatting issues

# After changing JS/Svelte files:
pnpm run lint:ci             # Fix all errors (zero warnings)
```

Do not leave lint errors for a follow-up fix.

### Development Servers
- Backend runs on port 8000 (API only)
- Frontend dev server on port 5173 (proxies API calls to backend)
- Access the web application at http://localhost:5173 during development

### Integration Testing Shortcuts
```bash
./test.sh quick       # Fast integration tests
./test.sh all         # Full suite (integration + client)
./test.sh genes       # Gene endpoint tests
./test.sh pets        # Pet endpoint tests
./test.sh consistency # Data consistency tests
```
