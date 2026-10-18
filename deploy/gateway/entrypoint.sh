#!/bin/sh
set -eu
umask 077
data_dir="${FALKORDB_DATA_DIR:-/data}"
mkdir -p "$data_dir"
# Railway attaches its volume as root; initialize permissions at runtime.
chown node:node "$data_dir"
chmod 700 "$data_dir"
# The advisory lock survives exec and prevents a second owner of the same AOF.
# --no-fork preserves normal Node SIGTERM delivery through tini.
exec gosu node flock --exclusive --nonblock --no-fork "$data_dir/.gateway.lock" node /app/main.mjs
