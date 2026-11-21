#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ -z "${NEXT_PUBLIC_WEBAPP_URL:-}" ]; then
  echo "NEXT_PUBLIC_WEBAPP_URL is required to start CAL." >&2
  exit 1
fi

if [ "${BUILT_NEXT_PUBLIC_WEBAPP_URL:-$NEXT_PUBLIC_WEBAPP_URL}" != "$NEXT_PUBLIC_WEBAPP_URL" ]; then
  scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"
fi

# Database setup is an explicit release step, not a side effect of a container restart.
exec yarn workspace @calcom/web start
