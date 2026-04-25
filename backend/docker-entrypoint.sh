#!/bin/sh
set -e

if [ "$1" = "api" ]; then
  echo "Applying database schema..."
  npx prisma db push --accept-data-loss --skip-generate
  echo "Starting API..."
  exec node dist/index.js
elif [ "$1" = "worker" ]; then
  echo "Starting miner worker..."
  exec node dist/worker.js
else
  exec "$@"
fi
