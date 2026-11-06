/**
 * Main's half of sign-out (`src/main/session.ts`). The engine has closed the
 * workspace and waits for `signedOut` before it reports the user signed out,
 * so main must answer whatever a clean-up step does; the whole journey is
 * e2e/session.spec.ts. Electron's session and secrets.bin are faked here.
 */
import { expect, it } from 'bun:test'
import type { MainToEngine } from '@juno/contract'
import { eventually } from '@juno/testing/eventually'
import { SessionHost, type SlackSession } from '../src/main/session'

/** A Slack session that records what was cleared; nothing else is asked of it here. */
function slackSession(cleared: string[]): SlackSession {
  return {
    clearStorageData: async () => { cleared.push('storage') },
    clearCache: async () => { cleared.push('cache') },
    cookies: { get: async () => [], set: async () => {} },
    resolveProxy: async () => 'DIRECT',
    getUserAgent: () => 'test',
  }
}

it('answers signedOut when secrets.bin cannot be deleted, after clearing the Slack session and logging what failed', async () => {
  const sent: MainToEngine[] = []
  const cleared: string[] = []
  const logged: Array<{ level: string; message: string; data: Record<string, unknown> | undefined }> = []
  const host = new SessionHost({
    secrets: {
      read: async () => null,
      write: async () => {},
      delete: async () => { throw Object.assign(new Error('EPERM: operation not permitted, unlink secrets.bin'), { code: 'EPERM' }) },
    },
    send: (message) => sent.push(message),
    importSession: () => Promise.reject(new Error('no import in this test')),
    forgetKeychain: () => {},
    slackSession: () => slackSession(cleared),
    saveSession: () => {},
    log: (level, message, data) => logged.push({ level, message, data }),
  })
  expect(host.handle({ _tag: 'signOut' })).toBe(true)
  await eventually(() => expect(sent).toContainEqual({ _tag: 'signedOut' }), { timeout: 2_000 })
  expect(cleared).toEqual(['storage', 'cache'])
  expect(logged.filter((line) => line.level === 'ERROR').map((line) => line.data?.stage)).toEqual(['delete secrets.bin'])
})
