#!/usr/bin/env node
/**
 * The engine's idle CPU on your real workspace (read-only) or the large fake
 * seed: the whole engine, synced into a data folder, then left alone. Run
 * with `JUNO_LIVE=1 node --import ./scripts/ts-resolve-hooks.mjs
 * scripts/idle-live.ts`, or with `--fake` and no `JUNO_LIVE`.
 *
 * It waits until the engine is live, not syncing and no call has been made
 * for `--quiet` seconds, then reads the process's CPU every 10 s for
 * `--idle` seconds and prints the share of one core, the Slack calls and
 * the SQL statements run in that window (statement text is Juno's own SQL;
 * never a parameter). `--profile DIR` writes a CPU profile of the idle
 * window there: function names and source locations only.
 *
 * Read-only as `bun run sync:timeline`: every request goes through one fetch
 * that refuses any method outside the read list before it leaves. AI has no
 * key here; `--fake-ai` runs the AI jobs on the engine's fake model, so
 * nothing leaves the Mac. `--dir DIR` keeps the data folder, so a second run is a
 * relaunch on the same cache; without it a temporary folder is deleted at
 * the end. Message text and tokens stay in that folder and in memory.
 *
 * Flags:
 *   --fake        the large fake seed instead of the cached session
 *   --dir DIR     the data folder to sync into and keep
 *   --idle N      seconds to measure once quiet (default 180)
 *   --quiet N     seconds with no call before measuring (default 30)
 *   --seconds N   give up waiting for quiet after N seconds (default 900)
 *   --profile DIR write a CPU profile of the idle window
 *   --fake-ai     run the AI jobs (titles, art, Home, Automated) on the engine's in-process fake model, as with a key
 *   --team T      pick this cached session when several teams are cached
 */
import { existsSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { Session } from 'node:inspector/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { StatementSync } from 'node:sqlite'
import { MessageChannel } from 'node:worker_threads'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { HttpTransport } from '@juno/slack'
import { configureConnection, engineStatusAtom, homeViewAtom, makeRegistry, sessionStatusAtom, topicListAtom, type PortLike } from '@juno/state'
import { memoryHost, startEngine } from '../packages/engine/src/index.ts'
import { memoryTransport, type MessagePortLike } from '../packages/engine/src/protocol/transport.ts'
import { readCachedSession, type CachedSession } from './live-common.ts'

const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const useFake = process.argv.includes('--fake')
const idleSeconds = Number(flag('--idle') ?? 180)
const quietSeconds = Number(flag('--quiet') ?? 30)
const seconds = Number(flag('--seconds') ?? 900)
const keepDir = flag('--dir')
const profileDir = flag('--profile')
const fakeAi = process.argv.includes('--fake-ai')

if (!useFake && process.env.JUNO_LIVE !== '1') {
  console.error('idle-live: set JUNO_LIVE=1 to run against your real workspace, or pass --fake.')
  process.exit(2)
}

// The read list of `bun run sync:timeline` (scripts/first-sync-live.ts).
const READS = new Set([
  'auth.test', 'client.userBoot', 'client.counts', 'client.getWebSocketURL', 'api.getFlannelHttpUrl', 'users.prefs.get',
  'subscriptions.thread.getView', 'conversations.history', 'conversations.replies', 'conversations.info', 'search.modules.messages',
  'files.info', 'dnd.info', 'users.info', 'users.list', 'emoji.list', 'usergroups.list', 'users.getPresence', 'team.info', 'bots.info',
])
const EDGE = /\/(users\/info|users\/list|users\/search|channels\/info|channels\/search|emojis\/list|usergroups\/list)$/

let fake: Awaited<ReturnType<typeof startFakeSlack>> | undefined
let cached: CachedSession | undefined
if (useFake) {
  fake = await startFakeSlack({ seed: largeSeed() })
  const c = fake.credentials()
  cached = { session: { teamId: c.teamId, userId: c.userId, workspaceUrl: c.url, token: c.token }, cookie: `d=${c.cookie}` }
} else {
  cached = await readCachedSession(flag('--team'))
}
if (cached === undefined) {
  console.error('idle-live: no cached session. Run `JUNO_LIVE=1 bun run smoke:live --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached

const t0 = performance.now()
const now = () => Math.round(performance.now() - t0)

// Statements run, by SQL text, counted only while `counting`.
let counting = false
const statements = new Map<string, { n: number; ms: number }>()
for (const name of ['all', 'get', 'run', 'iterate'] as const) {
  const original = StatementSync.prototype[name] as (...args: Array<unknown>) => unknown
  ;(StatementSync.prototype as unknown as Record<string, unknown>)[name] = function (this: StatementSync, ...args: Array<unknown>) {
    if (!counting) return original.apply(this, args)
    const started = performance.now()
    try {
      return original.apply(this, args)
    } finally {
      const key = this.sourceSQL.replace(/\s+/g, ' ').trim().slice(0, 160)
      const entry = statements.get(key) ?? { n: 0, ms: 0 }
      entry.n++
      entry.ms += performance.now() - started
      statements.set(key, entry)
    }
  }
}

const calls: Array<{ readonly m: string; readonly s: number; e?: number }> = []
const refused = new Map<string, number>()
const guarded = async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const api = /^\/api\/([^/]+)$/.exec(url.pathname)?.[1]
  const edge = EDGE.exec(url.pathname)?.[1]
  if (!(api === undefined ? edge !== undefined : READS.has(api))) {
    const key = api ?? 'other url'
    refused.set(key, (refused.get(key) ?? 0) + 1)
    throw new TypeError('idle-live: refused')
  }
  const call: { m: string; s: number; e?: number } = { m: api ?? `edge:${edge}`, s: now() }
  calls.push(call)
  try {
    return await fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie } })
  } finally {
    call.e = now()
  }
}

const host = memoryHost()
host.onEngine((message) => {
  if (message._tag === 'requestSecrets') host.deliver({ _tag: 'secrets', secrets: { teamId: session.teamId, userId: session.userId, workspaceUrl: session.workspaceUrl, token: session.token, teamName: 'Idle' } })
  else if (message._tag === 'handshake') host.deliver({ _tag: 'handshake', id: message.id, cookie, origin: 'https://app.slack.com', userAgent: 'Juno idle check', proxy: 'DIRECT' })
})

const root = existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork/tmp' : tmpdir()
const userData = keepDir ?? join(root, `juno-idle-${process.pid}-${Date.now()}`)
await mkdir(userData, { recursive: true })

const transport = memoryTransport()
const handle = await startEngine(transport, { userData, e2e: false, dev: false, ...(fakeAi ? { ai: 'fake' as const, fakeAiDelayMillis: 300 } : {}) }, { host, httpTransport: HttpTransport.nodeFetch({ fetch: guarded }) })
const registry = makeRegistry()
configureConnection(registry, {
  acquire: async () => {
    const channel = new MessageChannel()
    transport.add(channel.port2 as unknown as MessagePortLike)
    return channel.port1 as unknown as PortLike
  },
})
const unmounts = [registry.mount(sessionStatusAtom), registry.mount(engineStatusAtom), registry.mount(topicListAtom()), registry.mount(homeViewAtom)]

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const phase = () => {
  const status = registry.get(engineStatusAtom)
  return status._tag === 'Success' ? `${status.value.phase._tag}${status.value.syncing ? ' syncing' : ''}` : 'none'
}

let liveSince: number | undefined
let quiet = false
while (now() < seconds * 1000) {
  await sleep(500)
  const p = phase()
  if (p === 'session-expired' || p === 'first-run') {
    if (now() > 30_000) break
  }
  if (p === 'live') liveSince ??= now()
  else liveSince = undefined
  const lastEnd = Math.max(0, ...calls.map((c) => c.e ?? now()))
  if (liveSince !== undefined && calls.every((c) => c.e !== undefined) && now() - lastEnd > quietSeconds * 1000) {
    quiet = true
    break
  }
}
console.log(`idle-live: ${useFake ? 'fake large seed' : 'live workspace'}, ${calls.length} calls, ${quiet ? 'quiet' : 'never quiet'} at ${(now() / 1000).toFixed(1)} s, phase ${phase()}`)

const inspector = profileDir === undefined ? undefined : new Session()
if (inspector !== undefined) {
  inspector.connect()
  await inspector.post('Profiler.enable')
  await inspector.post('Profiler.start')
}
const callsBefore = calls.length
counting = true
const shares: Array<number> = []
const phases = new Set<string>()
const startCpu = process.cpuUsage()
const startElu = performance.eventLoopUtilization()
const idleStart = now()
for (let elapsed = 0; elapsed < idleSeconds; elapsed += 10) {
  const before = process.cpuUsage()
  const at = performance.now()
  await sleep(10_000)
  const used = process.cpuUsage(before)
  shares.push(((used.user + used.system) / 1000 / (performance.now() - at)) * 100)
  phases.add(phase())
}
counting = false
const total = process.cpuUsage(startCpu)
const elu = performance.eventLoopUtilization(startElu)
const window = now() - idleStart
if (inspector !== undefined) {
  const { profile } = await inspector.post('Profiler.stop')
  await mkdir(profileDir!, { recursive: true })
  const file = join(profileDir!, `idle-${Date.now()}.cpuprofile`)
  writeFileSync(file, JSON.stringify(profile))
  console.log(`profile: ${file}`)
}

const idleCalls = new Map<string, number>()
for (const c of calls.slice(callsBefore)) idleCalls.set(c.m, (idleCalls.get(c.m) ?? 0) + 1)
console.log(`idle cpu: ${(((total.user + total.system) / 1000 / window) * 100).toFixed(1)} % of one core over ${(window / 1000).toFixed(0)} s; event loop busy ${(elu.utilization * 100).toFixed(1)} %`)
console.log(`  per 10 s: ${shares.map((s) => s.toFixed(1)).join(' ')}`)
console.log(`  phases: ${[...phases].join(', ')}`)
console.log(`  calls: ${JSON.stringify(Object.fromEntries(idleCalls))}; refused: ${JSON.stringify(Object.fromEntries(refused))}`)
console.log('  statements (n, ms):')
for (const [sql, s] of [...statements].toSorted((a, b) => b[1].n - a[1].n).slice(0, 25)) console.log(`    ${String(s.n).padStart(7)} ${s.ms.toFixed(0).padStart(6)}  ${sql}`)

for (const unmount of unmounts) unmount()
await handle.stop()
await fake?.close()
if (keepDir === undefined) await rm(userData, { recursive: true, force: true })
process.exit(0)
