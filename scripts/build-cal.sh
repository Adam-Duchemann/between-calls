#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
export SKIP_DB_MIGRATIONS=1

yarn turbo run build --filter='@calcom/web^...'
yarn workspace @calcom/web copy-app-store-static
yarn workspace @calcom/web exec next typegen
yarn type-check --force --concurrency=1
# Separate processes release compiler memory before prerendering this large monorepo.
yarn workspace @calcom/web exec next build --webpack --experimental-build-mode compile
node scripts/prepare-next-generate.mjs
yarn workspace @calcom/web exec next build --webpack --experimental-build-mode generate
