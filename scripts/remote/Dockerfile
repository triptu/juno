# The image `pnpm remote` runs in. Built by scripts/remote.mjs with `nsc build`
# and tagged with a hash of this file and the lockfile, so it is rebuilt only
# when one of them changes. The context holds the lockfile, the workspace file
# and every package.json, nothing else.
#
# Playwright's image brings Ubuntu, Chromium for the gallery, its system
# libraries (which Electron also needs) and xvfb.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

ARG NODE_VERSION=26.11.1
ARG PNPM_VERSION=12.11.2
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" | tar -xJ -C /usr/local --strip-components=1 \
  && npm install -g --silent "pnpm@${PNPM_VERSION}"

# Chrome and Electron refuse to run sandboxed as root, so everything runs as pwuser.
RUN mkdir -p /work && chown pwuser /work
USER pwuser
WORKDIR /work
ENV QUINT_HOME=/home/pwuser/.quint
COPY --chown=pwuser . /work
RUN pnpm install --frozen-lockfile

# Quint downloads its Rust evaluator and Apalache on first use; do it here.
RUN printf 'module warm {\n  var x: int\n  action init = x'"'"' = 0\n  action step = x'"'"' = x\n  val ok = x == 0\n}\n' > /tmp/warm.qnt \
  && node node_modules/@informalsystems/quint/dist/src/cli.js run /tmp/warm.qnt --backend rust --max-samples 1 --max-steps 1 --invariant ok \
  && node node_modules/@informalsystems/quint/dist/src/cli.js verify /tmp/warm.qnt --max-steps 1 --invariant ok --apalache-version 0.62.1 \
  && rm -rf /tmp/warm.qnt _apalache-out
