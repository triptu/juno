#!/usr/bin/env node
/**
 * The live smoke (architecture 13 and 16 M2): read-only calls against a real
 * workspace, decoded through @juno/slack-schema, plus 30 s of socket events.
 * Run with `pnpm smoke:live`. It refuses to run without `JUNO_LIVE=1`.
 *
 * Session: imported from the installed Slack app the way the desktop app does
 * it (copies of its files, the "Slack Safe Storage" keychain password, which
 * makes macOS ask). Nothing secret is printed or written: the console gets
 * method names, counts, decode issue paths and frame types; the fixtures
 * under packages/slack-schema/test/fixtures/recorded/ hold shapes only,
 * with ids, text and URLs replaced.
 *
 * This script never calls a write method. The allow-list below is checked
 * before every call, and the call list is printed before the first one.
 *
 * Flags:
 *   --fake         run against an in-process fake Slack instead (no keychain, no JUNO_LIVE)
 *   --seconds N    how long to read socket events (default 30; 2 with --fake)
 *   --team T       pick this team id out of localConfig_v2 when several are signed in
 *   --no-record    do not write fixtures
 */
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect, Exit, Fiber, Layer, Queue, Schema, Scope, Stream } from 'effect'
import type { SchemaIssue } from 'effect'
import { startFakeSlack } from '@juno/fake-slack'
import { Methods, RtmFrame, type MethodName } from '@juno/slack-schema'
import {
  HttpTransport,
  SlackClient,
  SlackApi,
  SlackSession,
  SlackSocket,
  slackConfigLayer,
  SocketHandshake,
  type HttpResponse,
  type SlackSessionShape,
} from '@juno/slack'
import { COOKIES_FILE, LOCAL_STORAGE_DIR, readSlackAppSession } from '@juno/slack/import'

const READ_ONLY_METHODS = [
  'auth.test',
  'client.userBoot',
  'client.counts',
  'subscriptions.thread.getView',
  'conversations.history',
  'client.getWebSocketURL',
] as const satisfies ReadonlyArray<MethodName>
type ReadOnlyMethod = (typeof READ_ONLY_METHODS)[number]

const flags = new Set(process.argv.slice(2))
const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const useFake = flags.has('--fake')
const record = !flags.has('--no-record')
const seconds = Number(flag('--seconds') ?? (useFake ? 2 : 30))
const teamId = flag('--team')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'packages/slack-schema/test/fixtures/recorded')

async function main(): Promise<number> {
  if (!useFake && process.env['JUNO_LIVE'] !== '1') {
    console.error('smoke-live: refusing to touch a real workspace without JUNO_LIVE=1 (or pass --fake)')
    return 2
  }
  console.log('smoke-live: read-only. Calls, in order:')
  for (const method of READ_ONLY_METHODS) console.log(`  ${method}`)
  console.log(`  socket: connect, wait for hello, read ${seconds} s of events`)
  console.log(`  fixtures: ${record ? fixtureDir : 'not written (--no-record)'}`)

  const target = useFake ? await fakeTarget() : await liveTarget()
  try {
    return await run(target)
  } finally {
    await target.close()
  }
}

interface Target {
  readonly session: SlackSessionShape
  readonly cookie: string
  readonly allowedHosts: ReadonlyArray<string>
  readonly onConnected?: () => void
  readonly close: () => Promise<void>
}

async function liveTarget(): Promise<Target> {
  const slackDir = join(homedir(), 'Library', 'Application Support', 'Slack')
  const copy = await mkdtemp(join(tmpdir(), 'juno-smoke-'))
  try {
    await cp(join(slackDir, LOCAL_STORAGE_DIR), join(copy, LOCAL_STORAGE_DIR), { recursive: true })
    await cp(join(slackDir, COOKIES_FILE), join(copy, COOKIES_FILE))
    console.log('smoke-live: reading the "Slack Safe Storage" keychain item (macOS will ask)')
    const keychainPassword = await new Promise<string>((resolvePassword, reject) => {
      execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', 'Slack Safe Storage'], { timeout: 120_000 }, (error, stdout) => {
        if (error) reject(new Error('keychain access was declined or the item is missing'))
        else resolvePassword(stdout.replace(/\n$/, ''))
      })
    })
    const { team, cookie } = await readSlackAppSession({ dir: copy, keychainPassword, ...(teamId === undefined ? {} : { teamId }) })
    console.log(`smoke-live: team ${team.id}${team.enterprise_id === undefined ? '' : ' (Enterprise Grid)'}, user ${team.user_id}`)
    return {
      session: {
        teamId: team.id,
        userId: team.user_id,
        workspaceUrl: team.url,
        token: team.token,
        ...(team.enterprise_id === undefined ? {} : { enterprise: { id: team.enterprise_id } }),
      },
      cookie: `${cookie.name}=${cookie.value}`,
      allowedHosts: ['slack.com'],
      close: async () => {},
    }
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
}

async function fakeTarget(): Promise<Target> {
  const fake = await startFakeSlack()
  const credentials = fake.credentials()
  console.log(`smoke-live: fake Slack at ${fake.url}`)
  return {
    session: { teamId: credentials.teamId, userId: credentials.userId, workspaceUrl: credentials.url, token: credentials.token },
    cookie: `d=${credentials.cookie}`,
    allowedHosts: ['127.0.0.1', 'localhost'],
    // Something to see on the socket.
    onConnected: () => fake.injectMessage({ channel: 'C0ENG', text: 'smoke' }),
    close: () => fake.close(),
  }
}

/** The raw response text of every call, keyed by method, for decoding and recording. */
const responses = new Map<string, string>()

function recordingTransport(cookie: string): Layer.Layer<HttpTransport> {
  return Layer.effect(
    HttpTransport,
    Effect.map(HttpTransport, (inner) =>
      HttpTransport.of({
        request: (request) => {
          const method = /\/api\/([^?]+)/.exec(request.url)?.[1] ?? 'unknown'
          if (!(READ_ONLY_METHODS as ReadonlyArray<string>).includes(method)) {
            return Effect.die(new Error(`smoke-live: refusing to call ${method}; it is not on the read-only list`))
          }
          return Effect.tap(inner.request(request), (response: HttpResponse) => Effect.sync(() => responses.set(method, response.text)))
        },
      }),
    ),
  ).pipe(Layer.provide(HttpTransport.nodeFetch({ headers: { cookie } })))
}

async function run(target: Target): Promise<number> {
  let problems = 0
  const rawFrames: Array<string> = []
  const layer = SlackClient.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        SlackSession.layer(target.session),
        recordingTransport(target.cookie),
        SocketHandshake.fixed({ cookie: target.cookie, userAgent: 'Juno smoke' }),
        slackConfigLayer({
          socket: { allowedHosts: [...target.allowedHosts], helloTimeoutMillis: 20_000, onRawFrame: (data) => rawFrames.push(data) },
        }),
      ),
    ),
  )

  const program = Effect.gen(function* () {
    const api = yield* SlackApi
    const call = <M extends ReadOnlyMethod>(method: M, args: Parameters<typeof api.call<M>>[1]) =>
      Effect.gen(function* () {
        const started = Date.now()
        const result = yield* Effect.result(api.call(method, args, { reason: 'smoke' }))
        const elapsed = Date.now() - started
        if (result._tag === 'Failure') {
          problems++
          console.log(`  ${method}: ${result.failure._tag} after ${elapsed} ms`)
          return undefined
        }
        console.log(`  ${method}: ok in ${elapsed} ms`)
        return result.success
      })

    console.log('smoke-live: calls')
    const auth = yield* call('auth.test', {})
    if (auth !== undefined) console.log(`    team ${auth.team_id}, user ${auth.user_id}${auth.enterprise_id === undefined ? '' : ', enterprise present'}`)
    const boot = yield* call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true })
    if (boot !== undefined) console.log(`    ${boot.channels.length} channels, ${boot.ims.length} ims, enterprise ${boot.team.enterprise_id === undefined ? 'absent' : 'present'}`)
    const counts = yield* call('client.counts', { thread_counts_by_channel: true })
    if (counts !== undefined) console.log(`    counts for ${counts.channels.length} channels`)
    const view = yield* call('subscriptions.thread.getView', { limit: 20 })
    if (view !== undefined) console.log(`    ${view.threads.length} followed threads`)
    const channel = boot?.channels.find((c) => c.is_member === true && c.is_archived !== true) ?? boot?.channels[0]
    if (channel !== undefined) {
      const history = yield* call('conversations.history', { channel: channel.id, limit: 20, ignore_replies: true })
      if (history !== undefined) console.log(`    ${history.messages.length} messages in one channel`)
    } else {
      console.log('    no channel to read history from')
    }

    console.log('smoke-live: decoding recorded responses')
    for (const [method, text] of responses) {
      const schema = Methods[method as MethodName].response
      const issues = decodeIssues(schema, text)
      if (issues.length > 0) {
        problems++
        console.log(`  ${method}: ${issues.length} issue(s)`)
        for (const issue of issues) console.log(`    ${issue}`)
      } else {
        console.log(`  ${method}: decodes`)
      }
    }

    console.log(`smoke-live: socket, reading for ${seconds} s`)
    const socket = yield* SlackSocket
    const scope = yield* Scope.make()
    const events = yield* Scope.provide(socket.events, scope)
    const queue = yield* Queue.unbounded<string>()
    const frameTypes = new Map<string, number>()
    const reader = yield* Effect.forkChild(
      Stream.runForEach(events, (event) =>
        Effect.sync(() => {
          if (event._tag === 'Connected') {
            console.log(`  connected${event.fast ? ' (reconnect url)' : ''}`)
            target.onConnected?.()
            Queue.offerUnsafe(queue, 'hello')
          } else if (event._tag === 'Disconnected') {
            console.log(`  disconnected: ${event.reason}, retry in ${event.retryInMillis} ms`)
          } else {
            frameTypes.set(event.frame.type, (frameTypes.get(event.frame.type) ?? 0) + 1)
          }
        }),
      ).pipe(Effect.catchTag('SlackAuthRequired', (error) => Effect.sync(() => console.log(`  auth required: ${error.error}`)))),
    )
    const hello = yield* Queue.take(queue).pipe(Effect.timeoutOption(30_000))
    if (hello._tag === 'None') {
      problems++
      console.log('  no hello within 30 s')
    } else {
      yield* Effect.sleep(seconds * 1000)
    }
    yield* Scope.close(scope, Exit.void)
    yield* Fiber.interrupt(reader)
    console.log(`  ${rawFrames.length} frames: ${[...frameTypes].map(([type, n]) => `${type} x${n}`).join(', ') || 'none'}`)

    const frameIssues = new Map<string, Array<string>>()
    for (const data of rawFrames) {
      const type = frameTypeOf(data)
      const issues = decodeIssues(RtmFrame, data)
      if (issues.length > 0) frameIssues.set(type, issues)
    }
    for (const [type, issues] of frameIssues) {
      problems++
      console.log(`  frame ${type}: ${issues.length} issue(s)`)
      for (const issue of issues) console.log(`    ${issue}`)
    }
  })

  const exit = await Effect.runPromiseExit(Effect.scoped(Effect.provide(program, layer)) as Effect.Effect<void, never, never>)
  if (Exit.isFailure(exit)) {
    problems++
    console.log(`smoke-live: failed: ${String(exit.cause).slice(0, 200)}`)
  }

  if (record) {
    await mkdir(join(fixtureDir, 'rtm'), { recursive: true })
    for (const [method, text] of responses) {
      await writeFile(join(fixtureDir, `${method}.json`), JSON.stringify(redact(JSON.parse(text)), null, 2) + '\n')
    }
    const seen = new Set<string>()
    for (const data of rawFrames) {
      const type = frameTypeOf(data)
      if (seen.has(type)) continue
      seen.add(type)
      await writeFile(join(fixtureDir, 'rtm', `${type}.json`), JSON.stringify(redact(JSON.parse(data)), null, 2) + '\n')
    }
    console.log(`smoke-live: wrote ${responses.size} response shapes and ${seen.size} frame shapes`)
  }

  console.log(problems === 0 ? 'smoke-live: ok' : `smoke-live: ${problems} problem(s)`)
  return problems === 0 ? 0 : 1
}

// Decode issues as paths, never values.

function decodeIssues(schema: Schema.Codec<unknown, unknown>, text: string): Array<string> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return ['(not JSON)']
  }
  const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(schema)(json))
  if (Exit.isSuccess(exit)) return []
  const error = Exit.isFailure(exit) ? (exit.cause as { failures?: ReadonlyArray<{ error?: unknown }> }) : undefined
  const failure = findSchemaError(error)
  return failure === undefined ? ['(decode failed, no issue tree)'] : issuePaths(failure.issue, [])
}

function findSchemaError(cause: unknown): { issue: SchemaIssue.Issue } | undefined {
  const stack: Array<unknown> = [cause]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === null || typeof current !== 'object') continue
    if ('issue' in current && current.issue !== null && typeof current.issue === 'object' && '_tag' in (current.issue as object)) {
      return current as { issue: SchemaIssue.Issue }
    }
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object') stack.push(value)
    }
  }
  return undefined
}

function issuePaths(issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>): Array<string> {
  switch (issue._tag) {
    case 'Pointer':
      return issuePaths(issue.issue, [...path, ...issue.path])
    case 'Composite':
      return issue.issues.flatMap((child) => issuePaths(child, path))
    case 'AnyOf':
      // A union: report the deepest problems of the longest-matching member only, to keep the list short.
      return issue.issues.length === 0 ? [`${format(path)}: no union member matched`] : issuePaths(issue.issues[0]!, path)
    case 'Filter':
    case 'Encoding':
      return issuePaths(issue.issue, path)
    default:
      return [`${format(path)}: ${issue._tag}`]
  }
}

const format = (path: ReadonlyArray<PropertyKey>) => (path.length === 0 ? '(root)' : path.map(String).join('.'))

function frameTypeOf(data: string): string {
  try {
    const parsed = JSON.parse(data) as { type?: unknown }
    return typeof parsed.type === 'string' ? parsed.type : 'untyped'
  } catch {
    return 'not-json'
  }
}

// Redaction: the shape survives, the values do not.

const KEEP_KEYS = new Set(['ok', 'type', 'subtype', 'error', 'kind', 'presence', 'mode', 'variant', 'reason', 'priority', 'style'])
const TS = /^\d{10}\.\d{6}$/
const ID = /^[A-Z][A-Z0-9]{4,}$/

function redact(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => redact(item))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[ID.test(k) ? 'ID' : k] = redact(v, k)
    return out
  }
  if (typeof value === 'string') {
    if (key !== undefined && KEEP_KEYS.has(key)) return value
    if (TS.test(value)) return '1700000000.000001'
    if (ID.test(value)) return `${value[0]}0REDACTED`
    if (/^https?:\/\//.test(value)) return 'https://redacted.invalid/'
    if (value.startsWith('xox')) return 'xoxc-redacted'
    return value === '' ? '' : 'redacted'
  }
  if (typeof value === 'number') return Number.isInteger(value) ? (value > 1_000_000_000 ? 1_700_000_000 : value) : 0.5
  return value
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`smoke-live: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
