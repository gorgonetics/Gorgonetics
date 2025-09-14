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