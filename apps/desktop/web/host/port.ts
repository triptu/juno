/**
 * The web shell's port: one per worktree, derived from this file's path the
 * way the gallery derives its own (apps/gallery/playwright.config.ts). A
 * collision fails at listen; JUNO_WEB_PORT can select another port. The gallery's ports start at 4174 and
 * these at 5174; each range is 997 ports wide, so they never overlap.
 * JUNO_WEB_PORT overrides it.
 */
const BASE_PORT = 5174

export function webShellPort(env: NodeJS.ProcessEnv = process.env): number {
  if (env['JUNO_WEB_PORT'] !== undefined) return Number(env['JUNO_WEB_PORT'])
  const offset = [...import.meta.dirname].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 997, 7)
  return BASE_PORT + offset
}
