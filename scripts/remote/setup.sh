#!/usr/bin/env bash
# Prepares a fresh Namespace Linux machine for `scripts/remote.mjs`. Safe to
# run again. Downloads are kept on the /cache volume, so a later machine
# starts from them. Runs as root; the tests run as the `juno` user (run.sh),
# because Chrome and Electron refuse to start sandboxed as root.
set -euo pipefail

NODE_VERSION=26.11.1
PNPM_VERSION=12.11.2
mkdir -p /cache/node /cache/pnpm-store /cache/ms-playwright

if ! command -v java >/dev/null || ! command -v xvfb-run >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # Java runs Apalache for specs:check; xvfb gives Electron a display.
  apt-get install -y -qq --no-install-recommends openjdk-21-jre-headless xvfb xauth ca-certificates curl xz-utils git >/dev/null
fi

node_dir=/cache/node/node-v$NODE_VERSION-linux-x64
if [ ! -x "$node_dir/bin/node" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" | tar -xJ -C /cache/node
fi
ln -sf "$node_dir/bin/node" /usr/local/bin/node
ln -sf "$node_dir/bin/npm" /usr/local/bin/npm
ln -sf "$node_dir/bin/npx" /usr/local/bin/npx
[ -x "$node_dir/bin/pnpm" ] || npm install -g --silent "pnpm@$PNPM_VERSION"
ln -sf "$node_dir/bin/pnpm" /usr/local/bin/pnpm

id juno >/dev/null 2>&1 || useradd --create-home --shell /bin/bash juno
chown -R juno /work /cache/pnpm-store /cache/ms-playwright

cd /work
sudo -u juno -H env PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright pnpm install --frozen-lockfile --store-dir /cache/pnpm-store --reporter=silent
# The gallery uses Playwright's Chromium on Linux (GALLERY_BROWSER=chromium in run.sh).
PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright pnpm --filter @juno/gallery exec playwright install --with-deps chromium >/dev/null
chown -R juno /cache/ms-playwright
