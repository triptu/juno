/**
 * Main's half of sign-out (`src/main/session.ts`). The engine has closed the
 * workspace and waits for `signedOut` before it reports the user signed out,
 * so main must answer whatever a clean-up step does; the whole journey is
 * e2e/session.spec.ts. Electron's session and secrets.bin are faked here.
 */
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'bun:test'
import type { MainToEngine } from '@juno/contract'
import { eventually } from '@juno/testing/eventually'
import { plainCipher, SecretsStore } from '../src/main/secrets'
import { SessionHost, type SessionHostDeps, type SlackSession } from '../src/main/session'

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

/** A host whose deps are the fakes above unless a test replaces one. */
function sessionHost(sent: MainToEngine[], overrides: Partial<SessionHostDeps> = {}) {
  const logged: Array<{ level: string; message: string; data: Record<string, unknown> | undefined }> = []
  const host = new SessionHost({
    secrets: { read: async () => null, write: async () => {}, delete: async () => {} },
    send: (message) => sent.push(message),
    importSession: () => Promise.reject(new Error('no import in this test')),
    forgetKeychain: () => {},
    slackSession: () => slackSession([]),
    saveSession: () => {},
    log: (level, message, data) => logged.push({ level, message, data }),
    ...overrides,
  })
  return { host, logged }
}

const session = { teamId: 'T1', userId: 'U1', workspaceUrl: 'https://juno.slack.com/', token: 'xoxc-test', teamName: 'Juno' }

it('serves no stored session after a sign-out whose unlink the folder refused, as at the next launch', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'juno-session-'))
  const secrets = new SecretsStore(userData, plainCipher)
  await secrets.write(session)
  // A userData folder restored read-only: the unlink fails, the file itself is still writable.
  await chmod(userData, 0o500)
  try {
    const sent: MainToEngine[] = []
    const { host, logged } = sessionHost(sent, { secrets })
    host.handle({ _tag: 'signOut' })
    await eventually(() => expect(sent).toContainEqual({ _tag: 'signedOut' }), { timeout: 2_000 })
    // The next engine, or the next launch, asks for the stored session.
    host.handle({ _tag: 'requestSecrets', id: 'next-engine' })
    await eventually(() => expect(sent.at(-1)?._tag).toBe('secrets'), { timeout: 2_000 })
    expect(sent.at(-1)).toEqual({ _tag: 'secrets', id: 'next-engine', secrets: null })
    expect(logged.filter((line) => line.level === 'ERROR')).toEqual([])
  } finally {
    await chmod(userData, 0o700)
    await rm(userData, { recursive: true, force: true })
  }
})

it('a secrets.bin emptied by such a sign-out reads as no session at the next launch, with nothing to warn about', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'juno-session-'))
  const secrets = new SecretsStore(userData, plainCipher)
  await secrets.write(session)
  await chmod(userData, 0o500)
  const warned = vi.spyOn(console, 'warn')
  try {
    await secrets.delete()
    expect(await secrets.read()).toBeNull()
    expect(warned).not.toHaveBeenCalled()
  } finally {
    warned.mockRestore()
    await chmod(userData, 0o700)
    await rm(userData, { recursive: true, force: true })
  }
})

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
