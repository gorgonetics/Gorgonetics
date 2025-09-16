# Development Pitfalls - Lessons Learned

## Communication Issues
- Don't say "you are absolutely right" repeatedly - be direct and factual
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