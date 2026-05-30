#!/bin/sh
set -e

echo "========================================"
echo "ModelTruth startup"
echo "========================================"

cd /app

echo "[startup] initializing database"
node --import tsx scripts/db-init.ts
echo "[startup] database ready"

export SKIP_RUNTIME_DB_INIT=true

echo "[startup] starting supervisord"
exec supervisord -c infra/supervisord.conf
