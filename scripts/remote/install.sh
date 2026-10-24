#!/usr/bin/env bash
# Sourced in the unpacked workspace; tstack mounts the persistent Bun cache and store.
mkdir -p "$HOME" || exit 70
# The root preinstall script fails when this Bun is not the pinned version.
bun install --frozen-lockfile --prefer-offline || {
  echo 'juno-stop: {"scope":"run","rule":"setup","signature":"Workspace install failed"}'
  exit 70
}
echo "remote: workspace installed in ${SECONDS} s" >&2
