// The session end to end inside Node: the real engine over a MessageChannel,
// the real state atoms, an in-process fake Slack, and a scripted "main" that
// answers the engine's parentPort requests the way apps/desktop does
// (`harness.ts`).
import { existsSync } from 'node:fs'
import { Cause, Exit } from 'effect'
import { afterEach, describe, expect, it } from 'bun:test'
import { sessionImportFromSlackApp, sessionSignOut } from '@juno/contract'
import { runCommand } from '@juno/state'
import { workspacePaths } from '@juno/store'
import { startTestEngine, waitFor, type EngineOptions, type RunningEngine } from './harness'

const running: Array<RunningEngine> = []
afterEach(async () => {
  for (const started of running.splice(0)) await started.stop()
})

async function boot(options: EngineOptions = {}): Promise<RunningEngine> {
  const started = await startTestEngine(options)
  running.push(started)
  return started
}

const sentTags = (e: RunningEngine) => e.main.host.fromEngine.map((m) => m._tag)

describe('session', () => {
  it('starts signed out, signs in through main, verifies with auth.test and has main store the secrets', async () => {
    const e = await boot()
    expect((await e.status('signedOut'))._tag).toBe('signedOut')
    expect(e.main.stored).toBeNull()

    const exit = await runCommand(e.registry, sessionImportFromSlackApp, undefined)
    expect(Exit.isSuccess(exit)).toBe(true)

    const ready = await e.status('ready')
    expect(ready).toMatchObject({ teamId: e.fake.teamId, teamName: 'Juno Fake', userId: e.fake.selfId })
    expect(ready._tag === 'ready' && ready.enterprise).toBeUndefined()
    expect(e.fake.callCount('auth.test')).toBe(1)
    expect(e.main.stored?.teamId).toBe(e.fake.teamId)
    expect(sentTags(e)).toEqual(expect.arrayContaining(['requestSecrets', 'importFromSlackApp', 'storeSecrets']))
    // The socket is up for the life of the session, through main's handshake.
    await waitFor(() => (e.fake.socketCount() === 1 ? true : undefined), undefined, 'the socket')
    expect(sentTags(e)).toContain('handshake')
  })

  it('comes up ready from stored secrets without asking the user', async () => {
    // As after a relaunch: main has secrets.bin, the engine verifies and goes live.
    const e = await boot({ initial: (fake) => fake.signIn() })
    const ready = await e.status('ready')
    expect(ready).toMatchObject({ teamName: 'Juno Fake' })
    expect(sentTags(e)).not.toContain('importFromSlackApp')
    expect(sentTags(e)).not.toContain('storeSecrets')
    // Main keeps the verified session, without secrets, so the next launch opens on the shell.
    expect(e.main.host.fromEngine.find((m) => m._tag === 'sessionReady')).toMatchObject({ session: { teamName: 'Juno Fake' } })
  })

  it('ignores the answer to an import a crashed engine asked for, and starts signed out', async () => {
    // Main was still importing the Slack app's session when the engine crashed. The new engine asks for the
    // stored session; the import's answer lands first. That session was never verified or written to secrets.bin,
    // so taking it would sign the user in until the next launch, and then not.
    const e = await boot({ staleImport: true })
    expect((await e.status('signedOut'))._tag).toBe('signedOut')
    expect(e.fake.callCount('auth.test')).toBe(0)
    expect(e.main.stored).toBeNull()
  })

  it('imports through main the same way and records the enterprise on Grid', async () => {
    const e = await boot({ enterpriseId: 'E0ORG' })
    await e.status('signedOut')
    expect(Exit.isSuccess(await runCommand(e.registry, sessionImportFromSlackApp, undefined))).toBe(true)
    const ready = await e.status('ready')
    expect(ready._tag === 'ready' && ready.enterprise?.id).toBe('E0ORG')
  })

  it('moves to authRequired and tells main when Slack expires the session', async () => {
    const e = await boot({ initial: (f) => f.signIn() })
    await e.status('ready')
    await waitFor(() => (e.fake.socketCount() === 1 ? true : undefined), undefined, 'the socket')

    e.fake.expireSession()

    const expired = await e.status('authRequired')
    // Whichever notices first: the socket's `user_session_expiration` frame or a sync call answered `invalid_auth`.
    expect<unknown>(['user_session_expiration', 'invalid_auth']).toContain(expired._tag === 'authRequired' && expired.reason)
    expect(sentTags(e)).toContain('authRequired')
    // The session's client is gone with it: no socket comes back on its own.
    await waitFor(() => e.fake.socketCount() === 0 ? true : undefined, undefined, 'expired session socket closed')
    await e.workPass('post')
    expect(e.fake.socketCount()).toBe(0)
  })

  it('signs out of a live workspace: main clears, the cache is deleted, user data stays, and the status is signedOut', async () => {
    const e = await boot()
    await e.status('signedOut')
    expect(Exit.isSuccess(await runCommand(e.registry, sessionImportFromSlackApp, undefined))).toBe(true)
    await e.status('ready')
    await e.phase('live')
    const paths = workspacePaths(e.userData, e.fake.teamId)
    // The open workspace has written both files by now.
    expect(existsSync(paths.cacheDb)).toBe(true)
    expect(existsSync(paths.userDb)).toBe(true)

    expect(Exit.isSuccess(await runCommand(e.registry, sessionSignOut, undefined))).toBe(true)

    await e.status('signedOut')
    expect(sentTags(e)).toContain('signOut')
    expect(e.main.stored).toBeNull()
    expect(existsSync(paths.cacheDb)).toBe(false)
    expect(existsSync(paths.userDb)).toBe(true)
    await waitFor(() => (e.fake.socketCount() === 0 ? true : undefined), undefined, 'the socket to close')
  })

  it('reports a failed sign-in as SignInFailed and stays signed out', async () => {
    const e = await boot()
    await e.status('signedOut')
    e.main.failNextSignIn('keychain', 'Keychain access was declined.')
    const exit = await runCommand(e.registry, sessionImportFromSlackApp, undefined)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toMatchObject({ _tag: 'SignInFailed', kind: 'keychain' })
    expect((await e.status('signedOut'))._tag).toBe('signedOut')
    expect(e.main.stored).toBeNull()
  })
})
