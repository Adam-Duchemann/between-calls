#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
yarn prisma migrate deploy
yarn workspace @calcom/prisma seed-app-store
