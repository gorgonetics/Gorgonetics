#!/usr/bin/env bash
set -euo pipefail

# Gorgonetics release script
# Usage: bash scripts/release.sh <major|minor|patch> [notes-file]
#
# Steps:
#   1. Bumps version in package.json, tauri.conf.json, Cargo.toml, Cargo.lock
#   2. Regenerates screenshots (starts dev server, runs pnpm screenshots)
#   3. Runs lint and E2E tests
#   4. Reads release notes from notes-file (defaults to RELEASE_NOTES.md),
#      falling back to a git-log changelog if neither is present
#   5. Commits, creates annotated tag, pushes to trigger release workflow
#
# Write RELEASE_NOTES.md (human narrative) before running this script — the
# script uses its contents verbatim for the tag body and appends a Full
# Changelog compare link.
#
# Note: docs/index.html used to carry the version in its download links,
# but those links are now populated at runtime from the GitHub releases
# API, so there's nothing to bump there anymore.

BUMP_TYPE="${1:-}"
NOTES_FILE="${2:-RELEASE_NOTES.md}"
if [[ ! "$BUMP_TYPE" =~ ^(major|minor|patch)$ ]]; then
  echo "Usage: bash scripts/release.sh <major|minor|patch> [notes-file]"
  exit 1
fi

# Ensure we're on main and clean
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main branch (currently on $BRANCH)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working directory is not clean"
  exit 1
fi

git pull --ff-only

# --- Read current version ---
CURRENT=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "New version: $NEW_VERSION"

# --- Bump version in all files (using node for cross-platform compat) ---
echo "Bumping version..."

# package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# tauri.conf.json
node -e "
const fs = require('fs');
const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf-8'));
conf.version = '$NEW_VERSION';
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
"

# Cargo.toml
node -e "
const fs = require('fs');
const path = 'src-tauri/Cargo.toml';
const content = fs.readFileSync(path, 'utf-8');
const updated = content.replace(/^version = \".*\"/m, 'version = \"$NEW_VERSION\"');
fs.writeFileSync(path, updated);
"

# Update Cargo.lock
(cd src-tauri && cargo check --quiet 2>/dev/null || true)

echo "Version bumped to $NEW_VERSION in package.json, tauri.conf.json, Cargo.toml, Cargo.lock"

# --- Update screenshots ---
echo "Updating screenshots (starting dev server)..."

# Kill any existing dev server on the port
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PID=$(lsof -ti:5174 2>/dev/null || true)
  if [[ -n "$EXISTING_PID" ]]; then
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 1
  fi
fi

pnpm dev &
DEV_PID=$!

# Wait for dev server with retry loop
DEV_READY=false
for i in $(seq 1 20); do
  if curl -s http://localhost:5174 > /dev/null 2>&1; then
    DEV_READY=true
    break
  fi
  sleep 1
done

if $DEV_READY; then
  pnpm screenshots || echo "Warning: screenshot capture failed, continuing"
  echo "Screenshots updated"
else
  echo "Warning: dev server not responding after 20s, skipping screenshots"
fi

kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true

# --- Lint and test ---
echo "Running lint..."
pnpm run lint:ci

echo "Running tests..."
pnpm test:e2e

# --- Assemble release notes ---
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
COMPARE_LINK="**Full Changelog**: https://github.com/gorgonetics/Gorgonetics/compare/${LAST_TAG:-initial}...v$NEW_VERSION"

if [[ -f "$NOTES_FILE" ]]; then
  echo "Using release notes from $NOTES_FILE"
  BODY=$(cat "$NOTES_FILE")
else
  echo "No notes file at $NOTES_FILE — generating changelog from git log"
  if [[ -n "$LAST_TAG" ]]; then
    CHANGELOG=$(git log "$LAST_TAG"..HEAD --pretty=format:"- %s" --no-merges | grep -v "Co-Authored-By" || true)
  else
    CHANGELOG=$(git log --pretty=format:"- %s" --no-merges | grep -v "Co-Authored-By" || true)
  fi
  BODY="## What's Changed

$CHANGELOG"
fi

RELEASE_NOTES="$BODY

$COMPARE_LINK"

echo "$RELEASE_NOTES"
echo ""

# --- Commit, tag, push ---
echo "Committing release..."
git add -A
git commit -m "Release v$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION

$RELEASE_NOTES"

echo "Pushing..."
git push
git push origin "v$NEW_VERSION"

echo ""
echo "=== Release v$NEW_VERSION ==="
echo "Tag pushed. The release workflow will build binaries for all platforms."
echo "Check progress: https://github.com/gorgonetics/Gorgonetics/actions"
echo "Once built, edit the draft release at:"
echo "https://github.com/gorgonetics/Gorgonetics/releases"
