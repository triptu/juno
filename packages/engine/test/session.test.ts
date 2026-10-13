// The session end to end inside Node: the real engine over a MessageChannel,
// the real state atoms, an in-process fake Slack, and a scripted "main" that
// answers the engine's parentPort requests the way apps/desktop does
// (`harness.ts`).
import { access } from 'node:fs/promises'
import { Cause, Exit } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionImportFromSlackApp, sessionSignIn, sessionSignOut } from '@juno/contract'
import { runCommand } from '@juno/state'
import { workspacePaths } from '@juno/store'
import { sleep, startTestEngine, waitFor, type EngineOptions, type RunningEngine } from './harness'

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

    const exit = await runCommand(e.registry, sessionSignIn, undefined)
    expect(Exit.isSuccess(exit)).toBe(true)

    const ready = await e.status('ready')
    expect(ready).toMatchObject({ teamId: e.fake.teamId, teamName: 'Juno Fake', userId: e.fake.selfId })
    expect(ready._tag === 'ready' && ready.enterprise).toBeUndefined()
    expect(e.fake.callCount('auth.test')).toBe(1)
    expect(e.main.stored?.teamId).toBe(e.fake.teamId)
    expect(sentTags(e)).toEqual(expect.arrayContaining(['requestSecrets', 'signIn', 'storeSecrets']))
    // The socket is up for the life of the session, through main's handshake.
    await waitFor(() => (e.fake.socketCount() === 1 ? true : undefined), undefined, 'the socket')
    expect(sentTags(e)).toContain('handshake')
  })

  it('comes up ready from stored secrets without asking the user', async () => {
    // As after a relaunch: main has secrets.bin, the engine verifies and goes live.
    const e = await boot({ initial: (fake) => fake.signIn() })
    const ready = await e.status('ready')
    expect(ready).toMatchObject({ teamName: 'Juno Fake' })
    expect(sentTags(e)).not.toContain('signIn')
    expect(sentTags(e)).not.toContain('storeSecrets')
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
    expect(['user_session_expiration', 'invalid_auth']).toContain(expired._tag === 'authRequired' && expired.reason)
    expect(sentTags(e)).toContain('authRequired')
    // The session's client is gone with it: no socket comes back on its own.
    await sleep(100)
    expect(e.fake.socketCount()).toBe(0)
  })

  it('signs out of a live workspace: main clears, the cache is deleted, user data stays, and the status is signedOut', async () => {
    const e = await boot()
    await e.status('signedOut')
    expect(Exit.isSuccess(await runCommand(e.registry, sessionSignIn, undefined))).toBe(true)
    await e.status('ready')
    await e.phase('live')
    const paths = workspacePaths(e.userData, e.fake.teamId)
    // The open workspace has written both files by now.
    await expect(access(paths.cacheDb)).resolves.toBeUndefined()
    await expect(access(paths.userDb)).resolves.toBeUndefined()

    expect(Exit.isSuccess(await runCommand(e.registry, sessionSignOut, undefined))).toBe(true)

    await e.status('signedOut')
    expect(sentTags(e)).toContain('signOut')
    expect(e.main.stored).toBeNull()
    await expect(access(paths.cacheDb)).rejects.toThrow()
    await expect(access(paths.userDb)).resolves.toBeUndefined()
    await waitFor(() => (e.fake.socketCount() === 0 ? true : undefined), undefined, 'the socket to close')
  })

  it('reports a failed sign-in as SignInFailed and stays signed out', async () => {
    const e = await boot()
    await e.status('signedOut')
    e.main.failNextSignIn('cancelled', 'The window was closed.')
    const exit = await runCommand(e.registry, sessionSignIn, undefined)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toMatchObject({ _tag: 'SignInFailed', kind: 'cancelled' })
    expect((await e.status('signedOut'))._tag).toBe('signedOut')
    expect(e.main.stored).toBeNull()
  })
})
