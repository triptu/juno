import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

// Resolve existing parents too: a new profile may sit below a symlink.
function canonicalProfile(path: string): string {
  try { return realpathSync.native(path) }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(canonicalProfile(parent), basename(path))
  }
}

/** Runs before main's imports read switches or fork utility processes. */
export function gateTestEnvironment(options: {
  readonly isPackaged: boolean
  readonly defaultUserData: string
  readonly env: NodeJS.ProcessEnv
}): void {
  if (!options.isPackaged) return
  const { env, defaultUserData } = options
  const profile = env.JUNO_USER_DATA
  let separate = false
  if (profile && isAbsolute(profile)) {
    try { separate = canonicalProfile(resolve(profile)) !== canonicalProfile(resolve(defaultUserData)) }
    catch { /* An unreadable profile cannot opt into test behaviour. */ }
  }
  if (env.JUNO_E2E === '1' && separate) return
  for (const name of Object.keys(env)) {
    if (/^JUNO_(?:E2E(?:_|$)|FAKE_|TEST_|STRESS(?:_|$))/.test(name)
      || ['JUNO_AI', 'JUNO_AGENT_CRASH_AT', 'JUNO_SLACK_APP_DIR', 'JUNO_SLACK_SAFE_STORAGE_PASSWORD'].includes(name)) delete env[name]
  }
}
