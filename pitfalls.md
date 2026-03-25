# Development Pitfalls - Lessons Learned

## Linting — ALWAYS run before committing
- **After ANY code change**, run `uv run ruff check .` and `uv run ruff format --check .` for Python, and `pnpm run lint:ci` for JS/Svelte
- Fix all lint errors immediately — do NOT leave them for a follow-up commit
- These are the same checks CI runs; if they fail locally they will fail in the PR
- Sprint 2/3 CI failures were caused by pushing code without running ruff first — this wasted a CI cycle

## Communication Issues
- Don't say "you are absolutely right", "you are correct", or any stuff like that - be direct and factual
- Avoid empty flattery or excessive agreement
- Don't write meaningless summaries when user wants working solutions

## Docker & Database Issues
- Don't suggest manual file copying for containerized databases - modify Dockerfile instead
- Don't recommend deleting and recreating database files manually - use proper CLI tools
- Check volume mount paths in docker-compose before assuming database persistence issues
- Ensure sample data files are included in Docker build via proper .dockerignore configuration

## Frontend Development Issues
- When pets don't load for anonymous users, check App.svelte onMount() - it may only load for authenticated users
- Always verify both API endpoint and frontend loading logic when demo data isn't visible
- Test both direct API calls and frontend proxy endpoints separately

## Problem-Solving Approach
- Test solutions immediately rather than explaining what should work
- Focus on making things actually work rather than providing explanations
- Don't suggest workarounds when systematic solutions are needed
- Refactor code mercilessly. Any construct that gets used more than once should be refactored and reused

## SQL Code Quality
- Avoid parameterized queries with unnamed placeholders like `(?, ?, ?, ?)` - they are hard to read and maintain
- Always use named parameters or explicit field mapping for better clarity
- **DuckDB named parameter syntax**: Use `$parameter_name` (not `:parameter_name` like SQLite)
  - Correct: `SELECT * FROM users WHERE username = $username`
  - Incorrect: `SELECT * FROM users WHERE username = :username` (SQLite syntax)
- Replace `VALUES (?, ?, ?, ?)` with `VALUES ($field1, $field2, $field3, $field4)` for DuckDB

## Testing
- ALWAYS run the tests after changing functionality - failing tests indicate incomplete implementation
- When adding authentication features, create corresponding test fixtures and test users
- Use pytest fixtures for test users to ensure proper setup/teardown

## Cross-Platform Development Issues
- **Windows UTF-8 encoding problems**: Never use Unicode characters (✓, ❌, 🔥, etc.) in test scripts or console output
  - Windows console uses CP-1252 encoding by default, which can't handle Unicode symbols
  - macOS and Linux use UTF-8 by default, so Unicode works there but fails on Windows
  - Always use ASCII characters in tests: `[OK]`, `[FAILED]`, `[SUCCESS]` instead of Unicode symbols
  - This affects both test runners and any custom test scripts

## Svelte Development
- **Always use Svelte 5 syntax**: This project uses Svelte 5, never use Svelte 4 patterns
  - Use `$props()` for props, not `export let prop`
  - Use `$state()` for reactive state, not `let variable = $state(value)`
  - Use `{#snippet name}...{/snippet}` for snippets, not slots
  - Use `{@render snippet()}` to render snippets
  - Component children should be passed as snippets in Svelte 5
  - When creating reusable components, design them to accept snippets as children
- **Flowbite components don't support `class:` directives**: Use template literals instead
  - Wrong: `class:p-6={!collapsed}` (causes compile error)
  - Correct: `class="{collapsed ? 'p-2' : 'p-6'}"` or `class={collapsed ? 'p-2' : 'p-6'}`
- **Don't reinvent the wheel** - instead of creating custom code for things, check if there are already made components that can do the job!
- In case of doubt, check the docs in https://svelte.dev/docs/svelte/overview

## Flowbite Development
- Whenever possible, use Flowbite Svelte components for standard behaviour
- **Do not attempt to use PostCSS, we already have @tailwind/vite installed**
- If something doesn't work, check the documentation at https://flowbite-svelte.com/docs/pages/introduction

## TailwindCSS v4 with SvelteKit (2025)
- **ONLY use `@import 'tailwindcss';` in CSS files** - the old `@tailwind base;`, `@tailwind components;`, `@tailwind utilities;` directives are REMOVED in v4
- **Vite config**: Must use `@tailwindcss/vite` plugin BEFORE sveltekit plugin: `plugins: [tailwindcss(), sveltekit()]`
- **Import order matters**: TailwindCSS plugin must come first in vite.config.js
- **Style blocks**: For component `<style>` blocks that need Tailwind, use `@reference "path/to/app.css"` at the top
- **Component styles not working**: TailwindCSS v4 processes each `<style>` block in isolation - add `@reference "../../../app.css";` to make component styles work
- **Never mix v3 and v4 syntax** - stick to v4's simplified approach

## Dependency Management
- **NEVER attempt solve problems by downgrading dependencies** - this happens because of relying on obsolete knowledge
- Instead of downgrading, search the web for proper ways to solve issues with modern dependencies
- Modern toolchains change frequently and require up-to-date configuration approaches

## Work Verification
- **DO NOT CLAIM WORK IS DONE WITHOUT VERIFYING** - Always test and verify functionality before declaring completion
- Check for compilation errors, runtime errors, and visual verification
- Test actual functionality, not just that code compiles

## Git History Investigation
- **If the user tells you something used to look different, check a prior git commit first** - Don't change things at random
- Use `git show commit_hash:file_path` to see how files looked in previous commits
- Compare the previous state to current state to identify exact differences
- Restore the original styling/behavior based on the historical evidence, not guesswork

## Gene View Scrolling (CRITICAL - DO NOT BREAK AGAIN)
- **The gene table scrolling with sticky headers is extremely fragile** - it has been broken multiple times
- **WORKING CSS configuration** (from commit dd41bce):
  - `.gene-visualizer`: Use `min-height: 0` NOT `overflow: hidden`
  - `.visualizer-content` and `.gene-section`: Use `min-height: 0` NOT `overflow: hidden/visible`
  - `.gene-grid-container`: Must have `overflow: auto` to be the scroll container
  - `.gene-visualizer-container` (in PetVisualization): Must have `overflow: auto`
- **Sticky headers work ONLY when**:
  - The table headers have `position: sticky; top: 0; z-index: 1`
  - The chromosome labels have `position: sticky; left: 0; z-index: 2`
  - The scroll container (`.gene-grid-container`) has proper `overflow: auto`
  - Parent containers use `min-height: 0` instead of `overflow: hidden`
- **DO NOT randomly change overflow properties** - check git history first if scrolling breaks
- **Test scrolling after ANY CSS changes** to gene visualization components