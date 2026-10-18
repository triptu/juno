// The turn engine in-process for the flow tests: the real store, pi journal, router, compactor and
// guard, with the scripted fake provider behind the guard and fake Slack reads behind the host port.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeProvider, type FakeProviderOptions } from '@juno/agent-testing'
import type { BubbleId, ChatMention, ReplyTarget, SendContext } from '@juno/agent-contract'
import { createProviderGuard, openTurns, type ActionsOptions, type TurnsOptions, type HostReads, type MigrationSet, type ModelRef, type TurnEvent, type Turns } from '../src/index'

export const SONNET: ModelRef = { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' }
export const HAIKU: ModelRef = { provider: 'openrouter', modelId: 'anthropic/claude-haiku-5.5' }
export const GROK: ModelRef = { provider: 'openrouter', modelId: 'x-ai/grok-4.7' }

type Fake = ReturnType<typeof fakeProvider>
type Ended = Extract<TurnEvent, { _tag: 'ended' }>

export interface HarnessOptions {
  readonly online?: () => boolean
  readonly now?: () => number
  readonly schedule?: import('../src/router/open').TurnsOptions['schedule']
  readonly watchHost?: import('../src/schedule/commands').WatchHost
  readonly fake?: FakeProviderOptions
  readonly model?: ModelRef
  /** No compactor without it. */
  readonly compaction?: boolean
  readonly subagent?: ModelRef
  readonly views?: import('../src/view-tools/host').ViewHost
  readonly host?: HostReads
  /** Wraps the fake's models, for example to hold compaction requests. */
  readonly transport?: (fake: Fake) => Fake['models']
  readonly migrations?: ReadonlyArray<MigrationSet>
  /** The host's actions and extra executors. */
  readonly actions?: ActionsOptions
  /** Open on an existing agent directory, as a restart does. */
  readonly dir?: string
  /** The encrypted backup, move and restore. */
  readonly backup?: TurnsOptions['backup']
  /** A fake of removal's backup hooks, in place of the backup's own. */
  readonly removalBackup?: import('../src/redaction').RemovalBackup
  /** The `agent.codemode` flag: pi's code mode tool for reads. */
  readonly codemode?: TurnsOptions['codemode']
  /** Tools a connection adapter supplies. */
  readonly tools?: TurnsOptions['tools']
  /** The app's provider and models (`providerTurns`) in place of the scripted fake. */
  readonly app?: Pick<TurnsOptions, 'provider' | 'model' | 'compaction'>
}

export async function turnsHarness(options: HarnessOptions = {}) {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), 'juno-turns-')))
  const fake = fakeProvider(options.fake)
  const reports: unknown[] = []
  const opened = await openTurns({
    agentDir: dir,
    ...(options.online ? { online: options.online } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.schedule ? { schedule: options.schedule } : {}),
    provider: options.app?.provider ?? ((store) => createProviderGuard({ store, transport: options.transport?.(fake) ?? fake.models })),
    model: options.app?.model ?? options.model ?? SONNET,
    ...(options.compaction === false ? {} : { compaction: options.app?.compaction ?? HAIKU }),
    ...(options.subagent ? { subagent: options.subagent } : {}),
    ...(options.views ? { views: options.views } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.migrations ? { migrations: options.migrations } : {}),
    ...(options.actions ? { actions: options.actions } : {}),
    ...(options.backup ? { backup: options.backup } : {}),
    ...(options.removalBackup ? { removalBackup: options.removalBackup } : {}),
    ...(options.codemode ? { codemode: options.codemode } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    onReport: (error) => reports.push(error),
  })
  if (opened._tag !== 'running') throw new Error('a fresh engine did not open')
  const turns: Turns = opened
  const events: TurnEvent[] = []
  turns.subscribe((event) => events.push(event))
  let sent = 0

  /** The first event, already seen or still to come, that passes `test`. */
  const next = <E extends TurnEvent>(test: (event: TurnEvent) => event is E): Promise<E> =>
    new Promise((resolve) => {
      const seen = events.find(test)
      if (seen) return resolve(seen)
      const off = turns.subscribe((event) => {
        if (!test(event)) return
        off()
        resolve(event)
      })
    })

  return {
    dir, fake, turns, events, reports,
    /** An owner send, maybe a reply. Returns its op id. */
    send: (text: string, input: { readonly opId?: string; readonly replyTo?: ReplyTarget; readonly context?: SendContext; readonly mentions?: ReadonlyArray<ChatMention> } = {}) => {
      const opId = input.opId ?? `op-${++sent}`
      const data = { ...(input.context ? { context: input.context } : {}), ...(input.mentions ? { mentions: input.mentions } : {}) }
      const accepted = turns.accept({ opId, kind: 'send', text, ...(input.replyTo ? { replyTo: input.replyTo } : {}), ...(Object.keys(data).length > 0 ? { data } : {}) })
      if (accepted._tag !== 'accepted') throw new Error(`send refused: ${accepted._tag === 'refused' ? accepted.reason : 'recorded'}`)
      return opId
    },
    /** The owner's reaction on a Juno bubble. Returns its op id. */
    react: (bubbleId: string, emoji: string | null, opId = `op-${++sent}`) => {
      turns.accept({ opId, kind: 'react', target: { _tag: 'bubble', id: bubbleId as BubbleId }, emoji })
      return opId
    },
    /** The bubbles the owner has seen, in order: text and the owner op each replies to. */
    bubbles: () => events.flatMap((e) => (e._tag === 'bubble' ? [e.replyTo ? [e.text, e.replyTo] : [e.text]] : [])),
    next,
    started: (opId: string) => next((e): e is Extract<TurnEvent, { _tag: 'started' }> => e._tag === 'started' && e.opId === opId),
    /** The run that `opId` started has ended. */
    ended: (opId: string) => next((e): e is Ended => e._tag === 'ended' && e.opId === opId),
    /** The events of one run, by tag. */
    tags: (runId: string) => events.filter((e) => 'runId' in e && e.runId === runId).map((e) => e._tag),
    chatRequests: () => fake.requests.filter((r) => r.model !== HAIKU.modelId),
    /** Closes the engine and keeps its directory, for a restart. */
    stop: () => turns.close(),
    close: async () => {
      await turns.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** One bubble in the model's output. */
export const say = (text: string) => `<say>${text}</say>`

/** A complete answer, for a reply factory (the fake builds it itself only for plain content). */
export function answer(text: string) {
  return {
    role: 'assistant', content: [{ type: 'text', text }], api: 'faux', provider: 'openrouter', model: SONNET.modelId,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  } as never
}

/** An answer that calls one tool, for a reply factory. */
export function toolCall(name: string, args: Record<string, unknown>) {
  return () => ({
    role: 'assistant', content: [{ type: 'toolCall', id: `call-${name}`, name, arguments: args }], api: 'faux', provider: 'openrouter', model: SONNET.modelId,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'toolUse', timestamp: Date.now(),
  }) as never
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** A message's text as the provider got it. */
export function textOf(message: unknown): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? '').join('') : ''
}

/** Fake Slack reads through the host port, counting calls. */
export function fakeHost() {
  let calls = 0
  const page = { messages: [] as never[] }
  const host: HostReads = {
    search: async () => (calls++, page),
    history: async () => (calls++, page),
    replies: async () => (calls++, page),
    topics: async () => (calls++, { topics: [] }),
    person: async (id) => (calls++, { id, name: 'maya', displayName: 'Maya' }),
  }
  return { host, calls: () => calls }
}
