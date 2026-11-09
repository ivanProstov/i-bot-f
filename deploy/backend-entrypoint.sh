#!/bin/sh
set -e
mkdir -p /data
if [ ! -f /data/settings.json ]; then
  cp /app/server/settings.json /data/settings.json
fi
ln -sfn /data/settings.json /app/server/settings.json
ln -sfn /data/history.json /app/server/history.json
ln -sfn /data/keys.json /app/server/keys.json
ln -sfn /data/trades.json /app/server/trades.json
exec "$@"
