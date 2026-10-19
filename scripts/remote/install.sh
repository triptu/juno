#!/usr/bin/env bash
# Sourced in the unpacked workspace before starting the requested script.
if [ "${JUNO_REMOTE_INSTALL:-}" = 1 ]; then
  mkdir -p "$HOME" || exit 70
  pnpm install --frozen-lockfile --prefer-offline --reporter=append-only || exit 70
  test "$(pnpm exec bun --version)" = "$(node -p "require('./node_modules/bun/package.json').version")" || exit 70
  echo "remote: workspace installed in ${SECONDS} s" >&2
else
  pnpm install --frozen-lockfile --offline --reporter=silent || exit 70
  echo "remote: workspace linked in ${SECONDS} s" >&2
fi
