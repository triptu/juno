/**
 * Local Codex for the "Set up Juno" step (SPEC section 4, "Sign-in"):
 * whether the CLI is installed and signed in, in Juno's own Codex home
 * (`<agentDir>/codex`), never the owner's. Signing in runs `codex login`
 * with that home, which opens the browser, as the Codex README asks the
 * owner to do in Terminal. The agent keeps its own check
 * (`packages/agent/src/providers/codex/local.ts`); main may not import the
 * agent (architecture 3). One sign-in runs at a time: a second click joins
 * it. Quitting kills the `codex login` child (`stop`). The executable comes
 * from `index.ts`: under JUNO_E2E it is `JUNO_E2E_CODEX`, or none, so a
 * developer's own Codex never shows in a test.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexSetup } from '@juno/contract'

/** Codex's browser sign-in gets this long before Juno stops waiting for it. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000

export interface CodexHome {
  readonly status: () => Promise<CodexSetup>
  /** Runs `codex login`, or joins the one running, and answers with the status after it. */
  readonly signIn: () => Promise<CodexSetup>
  /** Kills a running `codex login`, on quit. */
  readonly stop: () => void
}

/** The Codex executable for this run: the owner's `codex`, or the test's stand-in under JUNO_E2E. */
export const codexExecutable = (e2e: boolean): string => (e2e ? (process.env.JUNO_E2E_CODEX ?? 'juno-e2e-no-codex') : 'codex')

export function codexHome(agentDir: string, executable: string): CodexHome {
  const home = join(agentDir, 'codex')
  // Juno's own Codex home, and nothing else from the environment: no inherited keys or configuration.
  const env: Record<string, string> = { CODEX_HOME: home }
  for (const name of ['PATH', 'HOME', 'TMPDIR']) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  const status = async (): Promise<CodexSetup> => {
    await mkdir(home, { recursive: true, mode: 0o700 })
    return new Promise((resolve) => {
      execFile(executable, ['login', 'status'], { env, timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
        if (error !== null && 'code' in error && error.code === 'ENOENT') return resolve('missing')
        // Signed in prints the ChatGPT account; anything else, a failure included, reads as signed out.
        resolve(error === null && /ChatGPT/i.test(`${stdout}${stderr}`) ? 'signedIn' : 'signedOut')
      })
    })
  }
  let login: ChildProcess | undefined
  let signingIn: Promise<CodexSetup> | undefined
  const signIn = async (): Promise<CodexSetup> => {
    if ((await status()) === 'missing') return 'missing'
    await new Promise<void>((resolve) => {
      const child = spawn(executable, ['login'], { env, stdio: 'ignore' })
      login = child
      const timer = setTimeout(() => child.kill(), SIGN_IN_TIMEOUT_MS)
      const done = () => {
        clearTimeout(timer)
        if (login === child) login = undefined
        resolve()
      }
      child.once('exit', done)
      child.once('error', done)
    })
    return status()
  }
  return {
    status,
    signIn: () => {
      signingIn ??= signIn().finally(() => {
        signingIn = undefined
      })
      return signingIn
    },
    stop: () => login?.kill(),
  }
}
