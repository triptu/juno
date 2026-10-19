import { existsSync } from 'node:fs'
import { nsc } from './image.mjs'

export const namespaceStorePath = '/var/cache/juno-runner'

export function namespaceStoreVolume(env = process.env) {
  if (env.JUNO_REMOTE_STORE_CACHE === 'off') return []
  const tag = env.JUNO_REMOTE_STORE_TAG ?? 'juno-workspace-v1'
  if (!/^[\w.-]+$/.test(tag)) throw new Error('JUNO_REMOTE_STORE_TAG must contain only letters, numbers, dots, underscores and hyphens')
  return ['--volume', `cache:${tag}:${namespaceStorePath}:4gb`]
}

// Retry without storage only for a rejected cache feature, before an instance exists.
// Network, authentication, capacity and partially completed creates keep their normal recovery.
export function createWithStore(args, cidfile, log, { env = process.env, run = nsc } = {}) {
  const volume = namespaceStoreVolume(env)
  try { return run([...args, ...volume], { timeout: 10 * 60_000 }) } catch (error) {
    if (!volume.length || existsSync(cidfile) || !/cache|volume|storage/i.test(error.message) || !/not (supported|available|enabled|included)|unsupported|disabled|not allowed.*plan|requires.*plan|plan.*(does not|doesn't|not include|not support)/i.test(error.message)) throw error
    log('workspace cache volume unavailable; using the machine disk (cold on a new machine)')
    return run(args, { timeout: 10 * 60_000 })
  }
}

export function namespaceCache() {
  return `cache=${namespaceStorePath}; electron_cache="$cache/electron"; mkdir -p "$cache/pnpm-store" "$cache/builds" "$cache/runtime" "$electron_cache" || exit 70; chown 1001:1001 "$cache/pnpm-store" "$cache/builds" "$cache/runtime" "$electron_cache" || exit 70; chmod 700 "$cache/runtime" || exit 70; if awk '$2 == "${namespaceStorePath}" { found=1 } END { exit !found }' /proc/mounts; then echo 'remote: workspace cache volume' >&2; else echo 'remote: workspace cache on machine disk' >&2; fi`
}

export const workspaceMounts = '-e HOME=/tmp/juno-home -e JUNO_REMOTE_INSTALL=1 -e PNPM_CONFIG_STORE_DIR=/cache/pnpm-store -e PNPM_CONFIG_CACHE_DIR=/cache/pnpm-store/metadata -e JUNO_BUILD_CACHE_DIR=/cache/builds -e XDG_RUNTIME_DIR=/cache/runtime -e electron_config_cache=/cache/electron -v "$cache/pnpm-store:/cache/pnpm-store" -v "$cache/builds:/cache/builds" -v "$cache/runtime:/cache/runtime" -v "$electron_cache:/cache/electron"'
