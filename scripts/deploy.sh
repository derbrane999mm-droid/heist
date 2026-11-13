#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch (served by GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=$(git remote get-url origin)
SHA=$(git rev-parse --short HEAD)
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q
git checkout -q -b gh-pages
git add -A
git commit -qm "Deploy ${SHA}"
git push -f "$REMOTE" gh-pages
rm -rf .git
