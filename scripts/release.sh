#!/usr/bin/env bash
set -euo pipefail

# Gorgonetics release script
# Usage: ./scripts/release.sh <major|minor|patch>
#
# Steps:
#   1. Bumps version in package.json, tauri.conf.json, Cargo.toml
#   2. Regenerates screenshots (requires dev server on port 5174)
#   3. Runs lint and tests
#   4. Commits, tags, and pushes to trigger the release workflow

BUMP_TYPE="${1:-}"
if [[ ! "$BUMP_TYPE" =~ ^(major|minor|patch)$ ]]; then
  echo "Usage: ./scripts/release.sh <major|minor|patch>"
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

# --- Bump version in all files ---
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

# Cargo.toml (only the first version = line)
sed -i '' "0,/^version = /s/^version = \".*\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml

# Update Cargo.lock
(cd src-tauri && cargo check --quiet 2>/dev/null || true)

# docs/index.html download links and version display
sed -i '' "s/$CURRENT/$NEW_VERSION/g" docs/index.html

echo "Version bumped to $NEW_VERSION in package.json, tauri.conf.json, Cargo.toml, docs/index.html"

# --- Update screenshots ---
echo "Updating screenshots (starting dev server)..."
# Kill any existing dev server on the port
kill $(lsof -ti:5174) 2>/dev/null || true
sleep 1

pnpm dev &
DEV_PID=$!
sleep 4

if curl -s http://localhost:5174 > /dev/null 2>&1; then
  pnpm screenshots || echo "Warning: screenshot capture failed, continuing"
  echo "Screenshots updated"
else
  echo "Warning: dev server not responding, skipping screenshots"
fi

kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true

# --- Lint and test ---
echo "Running lint..."
pnpm run lint:ci

echo "Running tests..."
pnpm test:e2e

# --- Build changelog since last tag ---
echo "Building changelog..."
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  CHANGELOG=$(git log "$LAST_TAG"..HEAD --pretty=format:"- %s" --no-merges | grep -v "Co-Authored-By" || true)
else
  CHANGELOG=$(git log --pretty=format:"- %s" --no-merges | grep -v "Co-Authored-By" || true)
fi

RELEASE_NOTES="## What's Changed

$CHANGELOG

**Full Changelog**: https://github.com/gorgonetics/Gorgonetics/compare/${LAST_TAG:-initial}...v$NEW_VERSION"

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
