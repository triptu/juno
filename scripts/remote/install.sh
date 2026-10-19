#!/usr/bin/env bash
# Sourced in the unpacked workspace; tstack mounts the persistent pnpm store.
mkdir -p "$HOME" || exit 70
pnpm install --frozen-lockfile --prefer-offline --reporter=append-only || exit 70
test "$(pnpm exec bun --version)" = "$(node -p "require('./node_modules/bun/package.json').version")" || exit 70
echo "remote: workspace installed in ${SECONDS} s" >&2
