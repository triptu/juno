#!/usr/bin/env node
/**
 * The huddle spike (docs/plans/huddles.md, phase 2): join a Slack huddle
 * from Juno's own session and hand the answer to the open-source Chime SDK
 * in a Playwright Chromium page, with Chromium's fake microphone (a beep).
 * Run with `JUNO_LIVE=1 node --import ./scripts/ts-resolve-hooks.mjs scripts/huddle-live.ts`.
 * It refuses to run without `JUNO_LIVE=1` (or `--fake`).
 *
 * It works in one private test channel, `juno-huddle-test` (or
 * `juno-huddle-test-2` when the first name belongs to someone else's
 * channel), on the session `smoke-live.ts --cache-session` kept.
 *
 * Flags:
 *   --create-only   find or create the test channel, print its name and exit
 *   --status        read only: whether the test channel has a huddle running, and whether it still lists you
 *   --minutes N     stay in the huddle N minutes (default 5), a status line every 10 s
 *   --socket        also open the RTM socket, read-only, and print room frames by type and field names
 *   --headed        show the browser window, to hear the huddle on this Mac
 *   --no-noise-suppression   join without Voice Focus
 *   --fake          run against an in-process fake Slack; stops after `rooms.join` (the fake has no Chime)
 *   --team T        the cached session of this team, when several are kept
 *
 * Writes are guarded below the client: every request goes through one fetch
 * that allows only the calls printed at the start. `conversations.create`
 * only for the two test names, private, at most once per name;
 * `rooms.join` and `rooms.leave` only in the test channel, one join per
 * run. `rooms.leave` is sent on every way out: the end, Ctrl-C, an error
 * or the overall timeout. A join still in flight is awaited first.
 *
 * Output: method names, `ok` or error codes, field-name paths and counts.
 * No token, cookie, join token, id, name or message text is printed.
 */
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect'
import { startFakeSlack } from '@juno/fake-slack'
import { EdgeHuddlesInfoOk, type MethodArgs, type MethodName, type MethodOk } from '@juno/slack-schema'
import { HttpTransport, SlackClient, SlackApi, SlackEdge, SlackSession, SlackSocket, slackConfigLayer, SocketHandshake, type SlackSessionShape } from '@juno/slack'
import { openHuddlePage, type HuddlePage } from './huddle-live-browser.ts'
import { callPlan, Guard, NAMES } from './huddle-live-guard.ts'
import { factsFromFrame, factsFromInfo, factsFromJoin, log, MediaReport, printHuddles, printIdentityFacts, printPaths, safeError, type IdentityFacts } from './huddle-live-report.ts'
import { readCachedSession } from './live-common.ts'

const argv = process.argv.slice(2)
const flags = new Set(argv)
const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const useFake = flags.has('--fake')
const createOnly = flags.has('--create-only')
const statusOnly = flags.has('--status')
const withSocket = flags.has('--socket')
const minutes = Number(flag('--minutes') ?? 5)

const ROOM_FRAME = /^(sh_room_|huddle_|room_)/

if (!useFake && process.env['JUNO_LIVE'] !== '1') {
  console.error('huddle-live: refusing to touch a real workspace without JUNO_LIVE=1 (or pass --fake)')
  process.exit(2)
}
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) {
  console.error('huddle-live: --minutes must be between 0 and 60')
  process.exit(2)
}

const guard = new Guard({ createOnly, statusOnly, useFake, withSocket })

// The session.

interface Target {
  readonly session: SlackSessionShape
  readonly cookie: string
  readonly allowedHosts: ReadonlyArray<string>
  readonly close: () => Promise<void>
}

async function target(): Promise<Target> {
  if (useFake) {
    const fake = await startFakeSlack()
    const c = fake.credentials()
    log('fake Slack started')
    return { session: { teamId: c.teamId, userId: c.userId, workspaceUrl: c.url, token: c.token }, cookie: `d=${c.cookie}`, allowedHosts: ['127.0.0.1', 'localhost'], close: () => fake.close() }
  }
  const cached = await readCachedSession(flag('--team'))
  if (cached === undefined) throw new Error('no cached session; run `JUNO_LIVE=1 pnpm smoke:live -- --cache-session` first')
  log('cached session found')
  return { session: cached.session, cookie: cached.cookie, allowedHosts: ['slack.com'], close: async () => {} }
}

// The run.

let onRawFrame: (data: string) => void = () => {}

let stopRequested: string | undefined
let wake: () => void = () => {}
const sleepUnlessStopped = (ms: number) =>
  new Promise<void>((done) => {
    if (stopRequested !== undefined) return done()
    const timer = setTimeout(done, ms)
    wake = () => {
      clearTimeout(timer)
      done()
    }
  })
function requestStop(reason: string) {
  if (stopRequested !== undefined) return
  stopRequested = reason
  log(`stopping: ${reason}`)
  wake()
}

const call = {
  callId: undefined as string | undefined,
  attendeeId: undefined as string | undefined,
  joinInFlight: undefined as Promise<MethodOk<'rooms.join'> | undefined> | undefined,
  leaveSent: false,
}

let interrupts = 0
process.on('SIGINT', () => {
  interrupts++
  if (interrupts > 1) {
    log(`second Ctrl-C: exiting now; rooms.leave ${call.leaveSent ? 'was sent' : 'was NOT confirmed'}`)
    process.exit(130)
  }
  requestStop('Ctrl-C (press again to exit without waiting for the leave)')
})
process.on('SIGTERM', () => requestStop('SIGTERM'))

type Slack = <M extends MethodName>(method: M, args: MethodArgs<M>, options: { reason: string; singleAttempt?: boolean }) => Promise<MethodOk<M> | undefined>

/** The Slack client on the guarded fetch, and the two ways the run calls it. */
function connect(t: Target) {
  const layer = SlackClient.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        SlackSession.layer(t.session),
        HttpTransport.nodeFetch({ headers: { cookie: t.cookie }, fetch: guard.fetch }),
        SocketHandshake.fixed({ cookie: t.cookie, userAgent: 'Juno huddle check' }),
        slackConfigLayer({
          requestTimeoutMillis: 20_000,
          socket: { allowedHosts: [...t.allowedHosts], onRawFrame: (data) => onRawFrame(data) },
        }),
      ),
    ),
  )
  const runtime = ManagedRuntime.make(layer)
  const slack: Slack = async (method, args, options) => {
    const result = await runtime.runPromise(Effect.result(SlackApi.use((api) => api.call(method, args, options))))
    if (result._tag === 'Failure') {
      log(`${method}: ${guard.describe(result.failure)}`)
      return undefined
    }
    log(`${method}: ok`)
    return result.success
  }
  const huddlesInfo = async (when: string) => {
    const result = await runtime.runPromise(
      Effect.result(SlackEdge.use((edge) => edge.call('huddles/info', { channel_ids: [guard.channel] }, EdgeHuddlesInfoOk, { lane: 'interactive' }))),
    )
    if (result._tag === 'Failure') {
      log(`edge huddles/info ${when}: ${guard.describe(result.failure)}`)
      return undefined
    }
    log(`edge huddles/info ${when}: ok`)
    const answer: unknown = JSON.parse(guard.answers.get('edge huddles/info') ?? '{}')
    printPaths(`edge huddles/info ${when}`, answer)
    return answer
  }
  return { runtime, slack, huddlesInfo }
}
type Connection = ReturnType<typeof connect>

/** What has to be closed on the way out. */
interface Open {
  page?: HuddlePage
  socket?: Fiber.Fiber<void>
}

/** Kept in memory only, for `printIdentityFacts`: never printed. */
const facts: IdentityFacts = {}

/** Keeps the call id and attendee id of a join answer, for the leave. */
function remember(joined: MethodOk<'rooms.join'> | undefined) {
  if (joined === undefined) return
  call.callId = joined.call.call_id
  const id = joined.call.free_willy?.attendee['AttendeeId']
  call.attendeeId = typeof id === 'string' ? id : undefined
  factsFromJoin(facts, joined.call.free_willy?.attendee)
}

async function main(): Promise<number> {
  log(`${useFake ? 'fake' : 'LIVE'} run. Calls, in order:`)
  for (const line of callPlan({ createOnly, statusOnly, useFake, withSocket, minutes })) console.log(`    ${line}`)
  log('nothing else is allowed; the guard refuses it before it leaves')
  const t = await target()
  const connection = connect(t)
  const open: Open = {}
  const overall = setTimeout(() => requestStop('overall timeout'), (minutes + 3) * 60_000)
  let code = 1
  try {
    code = await run(t, connection, open)
  } catch (error) {
    log(`failed: ${safeError(error)}`)
  } finally {
    clearTimeout(overall)
    if (!(await cleanup(connection, open, t.session.userId))) code = 1
    await t.close()
  }
  return code
}

async function run(t: Target, connection: Connection, open: Open): Promise<number> {
  if ((await connection.slack('auth.test', {}, { reason: 'huddle-check' })) === undefined) throw new Error('auth.test failed')
  const channelName = await findChannel(connection.slack, t.session.userId)
  if (channelName === undefined) throw new Error(createOnly || useFake ? 'no usable test channel' : 'no test channel; run with --create-only first')
  if (createOnly) {
    log(`test channel: ${channelName}`)
    return 0
  }
  if (statusOnly) {
    printHuddles(await connection.huddlesInfo('now'), t.session.userId)
    return 0
  }
  if (withSocket) open.socket = startSocket(connection.runtime)

  await connection.huddlesInfo('before the join')
  const region = useFake ? 'us-east-1' : await nearestRegion()
  log(`nearest Chime region: ${useFake ? 'fixed (fake)' : region === undefined ? 'unknown, joining without one' : 'found'}`)
  if (stopRequested !== undefined) return 1

  call.joinInFlight = connection.slack('rooms.join', { channel_id: guard.channel!, ...(region === undefined ? {} : { regions: [region] }), multidevice: false }, { reason: 'calls-api/joinRoom', singleAttempt: true })
  const joined = await call.joinInFlight
  call.joinInFlight = undefined
  remember(joined)
  const raw = guard.answers.get('rooms.join')
  if (raw !== undefined) printPaths('rooms.join answer', JSON.parse(raw))
  if (joined === undefined || stopRequested !== undefined) return 1
  const free = joined.call.free_willy
  log(`call id: present, attendee id: ${call.attendeeId === undefined ? 'missing' : 'present'}, free_willy: ${free === undefined ? 'missing (legacy answer?)' : 'present'}`)
  if (free === undefined || call.attendeeId === undefined) return 1

  const media = new MediaReport(call.attendeeId, t.session.userId, () => wake())
  open.page = await openHuddlePage({ headed: flags.has('--headed'), noiseSuppression: !flags.has('--no-noise-suppression'), onEvent: (event) => media.on(event) })
  if (useFake) {
    log('fake: not starting media (the fake has no Chime)')
    factsFromInfo(facts, await connection.huddlesInfo('after the join'), guard.channel)
    return 0
  }
  if (stopRequested !== undefined) return 1
  await open.page.join(free.meeting, free.attendee)
  log(`in the huddle for up to ${minutes} min; Ctrl-C leaves`)
  const started = Date.now()
  let infoAfter = false
  while (Date.now() - started < minutes * 60_000 && !media.stopped) {
    await sleepUnlessStopped(10_000)
    // Ctrl-C, SIGTERM and the overall timeout set this from outside the loop.
    if (stopRequested !== undefined) break
    console.log(media.status(Date.now() - started, withSocket ? socketReport : undefined))
    if (!infoAfter && media.started) {
      infoAfter = true
      factsFromInfo(facts, await connection.huddlesInfo('after the join'), guard.channel)
    }
  }
  media.summary()
  return media.started ? 0 : 1
}

/** Stops the media, sends `rooms.leave` for any attendee this run got, and closes everything. False when the leave failed or the guard refused something. */
async function cleanup(connection: Connection, open: Open, self: string): Promise<boolean> {
  let ok = true
  if (open.page !== undefined) log(`Chime session: ${await open.page.leave()}`)
  // A join still in flight is awaited, so its attendee gets a leave too.
  if (call.joinInFlight !== undefined) {
    log('waiting for the join in flight before leaving')
    remember(await call.joinInFlight)
  }
  if (guard.joins > 0) {
    if (call.callId !== undefined && call.attendeeId !== undefined) {
      // Does leaving the Chime meeting alone end Slack's huddle? Read it before and after the leave.
      if (!useFake) printHuddles(await connection.huddlesInfo('after the Chime stop, before rooms.leave'), self)
      // As the official client's user leave (`userLeaveEffects`): the form field `reason` is `user_initiated`.
      const left = await connection.slack(
        'rooms.leave',
        { channel_id: guard.channel!, call_id: call.callId, attendee_id: call.attendeeId, reason: 'user_initiated' },
        { reason: 'calls-api/leaveRoom' },
      )
      call.leaveSent = true
      // On a workspace with huddles_arch_v2 Slack answers `feature_not_enabled`; the official client logs it as an arch mismatch and goes on. Stopping Chime is what removes the attendee there.
      const archV2 = left === undefined && (JSON.parse(guard.answers.get('rooms.leave') ?? '{}') as { error?: unknown }).error === 'feature_not_enabled'
      log(`rooms.leave ${left !== undefined ? 'succeeded' : archV2 ? 'not used by this workspace (feature_not_enabled, as the official client expects)' : 'FAILED (see above)'}`)
      ok = left !== undefined || archV2
      if (!useFake) {
        await new Promise((done) => setTimeout(done, 3_000))
        printHuddles(await connection.huddlesInfo('3 s after rooms.leave'), self)
      }
    } else {
      log('rooms.leave not sent: the join gave no call id or attendee id, so there is nothing to leave')
    }
  }
  if (guard.joins > 0) printIdentityFacts(facts, call.callId)
  if (open.socket !== undefined) {
    await connection.runtime.runPromise(Fiber.interrupt(open.socket))
    log(`socket room frame types: ${[...socketReport.seenTypes].map(([type, n]) => `${type} x${n}`).join(', ') || 'none'}`)
  }
  await open.page?.close()
  await connection.runtime.dispose()
  if (guard.refused.length > 0) {
    ok = false
    log(`refused by the guard: ${guard.refused.join(', ')}`)
  }
  return ok
}

/** Finds the test channel (or creates it, with --create-only or --fake) and fixes the guard on it. Returns its name. */
async function findChannel(slack: Slack, self: string): Promise<string | undefined> {
  const boot = await slack('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, { reason: 'huddle-check' })
  if (boot === undefined) return undefined
  for (const name of NAMES) {
    const listed = boot.channels.find((c) => c.name === name && c.is_private === true && c.is_archived !== true)
    if (listed !== undefined) {
      guard.candidate = listed.id
      const info = await slack('conversations.info', { channel: listed.id, include_num_members: true }, { reason: 'huddle-check' })
      const usable = info !== undefined && info.channel.is_member === true && info.channel.is_archived !== true && (info.channel.num_members === 1 || info.channel.creator === self)
      log(`${name}: exists, ${info === undefined ? 'info failed' : `member ${info.channel.is_member === true ? 'yes' : 'no'}, ${info.channel.num_members ?? '?'} member(s), made by you ${info.channel.creator === self ? 'yes' : 'no'}`}`)
      if (usable) {
        guard.channel = listed.id
        log(`${name}: reused`)
        return name
      }
      continue
    }
    if (!(createOnly || useFake)) continue
    const created = await slack('conversations.create', { name, is_private: true }, { reason: 'huddle-check' })
    if (created !== undefined) {
      guard.created = true
      guard.channel = created.channel.id
      log(`${name}: created, private`)
      return name
    }
    log(`${name}: not created, trying the next name`)
  }
  return undefined
}

async function nearestRegion(): Promise<string | undefined> {
  try {
    const response = await fetch('https://nearest-media-region.l.chime.aws', { signal: AbortSignal.timeout(10_000) })
    const json = (await response.json()) as { region?: unknown }
    return typeof json.region === 'string' ? json.region : undefined
  } catch {
    return undefined
  }
}

// The socket, read-only: room frames by type with field-name paths.

const socketReport = { roomFrames: 0, aboutThisRoom: 0, seenTypes: new Map<string, number>() }

function startSocket(runtime: ManagedRuntime.ManagedRuntime<SlackSocket, never>): Fiber.Fiber<void> {
  onRawFrame = (data) => {
    let frame: { type?: unknown }
    try {
      frame = JSON.parse(data) as { type?: unknown }
    } catch {
      return
    }
    if (typeof frame.type !== 'string' || !ROOM_FRAME.test(frame.type)) return
    socketReport.roomFrames++
    const mine = (guard.channel !== undefined && data.includes(guard.channel)) || (call.callId !== undefined && data.includes(call.callId))
    if (mine) socketReport.aboutThisRoom++
    if (frame.type === 'sh_room_join' && mine) factsFromFrame(facts, frame)
    const seen = socketReport.seenTypes.get(frame.type) ?? 0
    socketReport.seenTypes.set(frame.type, seen + 1)
    if (seen === 0) printPaths(`socket frame ${frame.type} (${mine ? 'this room' : 'another room'})`, frame)
    else log(`socket frame ${frame.type} again (${mine ? 'this room' : 'another room'})`)
  }
  return runtime.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* SlackSocket
        const events = yield* socket.events
        yield* Stream.runForEach(events, (event) =>
          Effect.sync(() => {
            if (event._tag === 'Connected') log('socket connected')
            else if (event._tag === 'Disconnected') log(`socket disconnected: ${event.reason}`)
          }),
        )
      }),
    ).pipe(Effect.catch((error) => Effect.sync(() => log(`socket ended: ${error._tag}`)))),
  )
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`huddle-live: ${safeError(error)}`)
    process.exit(1)
  },
)
