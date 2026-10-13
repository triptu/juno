// The session end to end inside Node: the real engine over a MessageChannel,
// the real state atoms, an in-process fake Slack, and a scripted "main" that
// answers the engine's parentPort requests the way apps/desktop does.
import { mkdir, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { Cause, Exit } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpTransport } from '@juno/slack'
import { startFakeSlack, type Credentials, type FakeSlack } from '@juno/fake-slack'
import { sessionImportFromSlackApp, sessionSignIn, sessionSignOut, type SessionSecrets, type SessionStatus } from '@juno/contract'
import { configureConnection, makeRegistry, runCommand, sessionStatusAtom, type PortLike } from '@juno/state'
import { workspacePaths } from '@juno/store'
import { memoryHost, startEngine } from '../src/index'
import { memoryTransport, type MessagePortLike } from '../src/protocol/transport'

const stops: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})

function waitFor<A>(f: () => A | undefined, timeoutMs = 5000): Promise<Exclude<A, undefined>> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const value = f()
      if (value !== undefined) return resolve(value as Exclude<A, undefined>)
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 5)
    }
    tick()
  })
}

const toSecrets = (c: Credentials): SessionSecrets => ({
  teamId: c.teamId,
  userId: c.userId,
  workspaceUrl: c.url,
  token: c.token,
  teamName: 'Juno Fake',
})

/**
 * What main does for the engine, in miniature: keeps `stored`, answers
 * `requestSecrets`, performs a "sign-in" by minting a fresh fake session,
 * serialises the cookie for the socket, and clears on sign-out.
 */
function fakeMain(fake: FakeSlack, initial?: Credentials) {
  const host = memoryHost()
  let current = initial
  let stored: SessionSecrets | null = initial === undefined ? null : toSecrets(initial)
  let nextSignIn: (() => Credentials | { failed: { kind: 'cancelled' | 'keychain'; message: string } }) | undefined
  host.onEngine((message) => {
    switch (message._tag) {
      case 'requestSecrets':
        host.deliver({ _tag: 'secrets', secrets: stored })
        break
      case 'signIn':
      case 'importFromSlackApp': {
        const outcome = nextSignIn === undefined ? fake.signIn() : nextSignIn()
        if ('failed' in outcome) {
          host.deliver({ _tag: 'sessionFailed', method: message._tag === 'signIn' ? 'window' : 'import', ...outcome.failed })
        } else {
          current = outcome
          host.deliver({ _tag: 'secrets', secrets: toSecrets(outcome) })
        }
        break
      }
      case 'storeSecrets':
        stored = message.secrets
        break
      case 'signOut':
        stored = null
        current = undefined
        host.deliver({ _tag: 'signedOut' })
        break
      case 'handshake':
        host.deliver({
          _tag: 'handshake',
          id: message.id,
          cookie: current === undefined ? '' : `d=${current.cookie}`,
          origin: 'https://app.slack.com',
          userAgent: 'Juno test',
          proxy: 'DIRECT',
        })
        break
      default:
        break
    }
  })
  // The engine's HTTP transport: the cookie Chromium would attach comes from the "session".
  const httpTransport = HttpTransport.nodeFetch({
    fetch: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(current === undefined ? {} : { cookie: `d=${current.cookie}` }) } }),
  })
  return {
    host,
    httpTransport,
    get stored() {
      return stored
    },
    failNextSignIn: (kind: 'cancelled' | 'keychain', message: string) => {
      nextSignIn = () => ({ failed: { kind, message } })
    },
  }
}

async function engine(options: { initial?: (fake: FakeSlack) => Credentials; enterpriseId?: string } = {}) {
  const fake = await startFakeSlack(options.enterpriseId === undefined ? {} : { enterpriseId: options.enterpriseId })
  stops.push(() => fake.close())
  const main = fakeMain(fake, options.initial?.(fake))
  const userData = join(tmpdir(), `juno-session-test-${process.pid}-${Date.now()}`)
  await mkdir(userData, { recursive: true })
  const transport = memoryTransport()
  const handle = await startEngine(transport, { userData, e2e: true, dev: false, fakeSlackUrl: fake.url }, { host: main.host, httpTransport: main.httpTransport })
  stops.push(handle.stop)
  const registry = makeRegistry()
  configureConnection(registry, {
    acquire: async () => {
      const channel = new MessageChannel()
      transport.add(channel.port2 as unknown as MessagePortLike)
      return channel.port1 as unknown as PortLike
    },
  })
  const unmount = registry.mount(sessionStatusAtom)
  stops.push(async () => unmount())
  const status = (tag: SessionStatus['_tag']) =>
    waitFor(() => {
      const result = registry.get(sessionStatusAtom)
      return result._tag === 'Success' && result.value._tag === tag ? result.value : undefined
    })
  return { fake, main, registry, userData, status }
}

const sentTags = (main: ReturnType<typeof fakeMain>) => main.host.fromEngine.map((m) => m._tag)

describe('session', () => {
  it('starts signed out, signs in through main, verifies with auth.test and has main store the secrets', async () => {
    const { fake, main, registry, status } = await engine()
    expect((await status('signedOut'))._tag).toBe('signedOut')
    expect(main.stored).toBeNull()

    const exit = await runCommand(registry, sessionSignIn, undefined)
    expect(Exit.isSuccess(exit)).toBe(true)

    const ready = await status('ready')
    expect(ready).toMatchObject({ teamId: fake.teamId, teamName: 'Juno Fake', userId: fake.selfId })
    expect(ready._tag === 'ready' && ready.enterprise).toBeUndefined()
    expect(fake.callCount('auth.test')).toBe(1)
    expect(main.stored?.teamId).toBe(fake.teamId)
    expect(sentTags(main)).toEqual(expect.arrayContaining(['requestSecrets', 'signIn', 'storeSecrets']))
    // The socket is up for the life of the session, through main's handshake.
    await waitFor(() => (fake.socketCount() === 1 ? true : undefined))
    expect(sentTags(main)).toContain('handshake')
  })

  it('comes up ready from stored secrets without asking the user', async () => {
    // As after a relaunch: main has secrets.bin, the engine verifies and goes live.
    const { main, status } = await engine({ initial: (fake) => fake.signIn() })
    const ready = await status('ready')
    expect(ready).toMatchObject({ teamName: 'Juno Fake' })
    expect(sentTags(main)).not.toContain('signIn')
    expect(sentTags(main)).not.toContain('storeSecrets')
  })

  it('imports through main the same way and records the enterprise on Grid', async () => {
    const { registry, status } = await engine({ enterpriseId: 'E0ORG' })
    await status('signedOut')
    expect(Exit.isSuccess(await runCommand(registry, sessionImportFromSlackApp, undefined))).toBe(true)
    const ready = await status('ready')
    expect(ready._tag === 'ready' && ready.enterprise?.id).toBe('E0ORG')
  })

  it('moves to authRequired and tells main when Slack expires the session', async () => {
    const { fake, main, status } = await engine({ initial: (f) => f.signIn() })
    await status('ready')
    await waitFor(() => (fake.socketCount() === 1 ? true : undefined))

    fake.expireSession()

    const expired = await status('authRequired')
    // Whichever notices first: the socket's `user_session_expiration` frame or a sync call answered `invalid_auth`.
    expect(['user_session_expiration', 'invalid_auth']).toContain(expired._tag === 'authRequired' && expired.reason)
    expect(sentTags(main)).toContain('authRequired')
    // The session's client is gone with it: no socket comes back on its own.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fake.socketCount()).toBe(0)
  })

  it('signs out: main clears, the workspace cache is deleted, and the status is signedOut', async () => {
    const { fake, main, registry, userData, status } = await engine()
    await status('signedOut')
    expect(Exit.isSuccess(await runCommand(registry, sessionSignIn, undefined))).toBe(true)
    await status('ready')
    const paths = workspacePaths(userData, fake.teamId)
    await mkdir(paths.dir, { recursive: true })
    await writeFile(paths.cacheDb, 'cache')
    await writeFile(paths.userDb, 'user')

    expect(Exit.isSuccess(await runCommand(registry, sessionSignOut, undefined))).toBe(true)

    await status('signedOut')
    expect(sentTags(main)).toContain('signOut')
    expect(main.stored).toBeNull()
    await expect(access(paths.cacheDb)).rejects.toThrow()
    await expect(access(paths.userDb)).resolves.toBeUndefined()
    await waitFor(() => (fake.socketCount() === 0 ? true : undefined))
  })

  it('reports a failed sign-in as SignInFailed and stays signed out', async () => {
    const { main, registry, status } = await engine()
    await status('signedOut')
    main.failNextSignIn('cancelled', 'The window was closed.')
    const exit = await runCommand(registry, sessionSignIn, undefined)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toMatchObject({ _tag: 'SignInFailed', kind: 'cancelled' })
    expect((await status('signedOut'))._tag).toBe('signedOut')
    expect(main.stored).toBeNull()
  })
})
