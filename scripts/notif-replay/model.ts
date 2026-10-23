/** The files the replay commands share. They hold real Slack content: keep them under /Volumes/AgentWork/scratch, never in the repo. */
import { needsYouOptions, type DecidedBy, type Instruction, type NeedsYou, type NotificationOutcome, type ConversationFacts } from '@juno/domain'
import { readFileSync, writeFileSync } from 'node:fs'

export type Kind = 'dm' | 'group DM' | 'thread' | 'channel'

export interface ShownMessage {
  readonly sender: string
  readonly text: string
  readonly at: number
  readonly fromMe: boolean
}

export interface ReplayReading {
  readonly needsYou: NeedsYou
  readonly probabilities: Readonly<Partial<Record<NeedsYou, number>>>
  readonly instruction?: { readonly id: string; readonly confidence: number }
  readonly latencyMillis: number
}

export interface Step {
  readonly outcome: NotificationOutcome
  readonly decidedBy: DecidedBy
  readonly reason: string
}

export interface ReplayItem {
  /** `channel:ts`. */
  readonly id: string
  readonly at: number
  readonly topicId: string
  readonly kind: Kind
  readonly where: string
  readonly sender: string
  readonly text: string
  readonly mentionsMe: boolean
  readonly mentionsMeDirectly: boolean
  readonly facts: ConversationFacts
  readonly threadRoot?: ShownMessage
  readonly before: ReadonlyArray<ShownMessage>
  /** The decision before Auto's live and reading steps, when one of the earlier steps decided. Absent: the message reached them. */
  readonly early?: Step
  /** Absent when the message never reached the reading; `failed` when the classifier gave no answer. */
  readonly reading?: ReplayReading | 'failed'
  /** What `decideNotification` decides now, with the burst rule played over the replay in time order. */
  readonly decision: Step
  /** What the old check decided, from the copy's `notification_log`, when it logged the message. */
  readonly old?: { readonly outcome: NotificationOutcome; readonly reason: string }
}

export interface Replay {
  readonly createdAt: string
  readonly days: number
  readonly from: number
  readonly to: number
  readonly instructions: ReadonlyArray<Instruction>
  readonly model: string
  readonly items: ReadonlyArray<ReplayItem>
}

export interface SampleEntry {
  readonly id: string
  readonly stratum: string
  /** How many replayed messages this one stands for: its stratum's size over its sample count. */
  readonly weight: number
}

export type Label = 'notify' | 'stay'
export type Labels = Record<string, { readonly label: Label; readonly at: string }>

export const readJson = <A>(path: string): A => JSON.parse(readFileSync(path, 'utf8')) as A
export const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`)

/** Flags as `--name value`; a flag with no value is `'true'`. */
export function flags(argv: ReadonlyArray<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[arg.slice(2)] = 'true'
    else {
      out[arg.slice(2)] = next
      i++
    }
  }
  return out
}

export function required(options: Record<string, string>, name: string): string {
  const value = options[name]
  if (value === undefined || value === 'true') throw new Error(`--${name} is required`)
  return value
}

/**
 * The probability the reading puts on the options that count here, as `counts` in
 * `packages/domain/src/notificationDecision.ts` decides: answer, follow-up and
 * serious always; ask in a DM or group DM, or when the owner started the thread,
 * wrote the previous message or is named; decision only in the owner's own thread.
 */
export function needsSum(item: ReplayItem, reading: ReplayReading): number {
  const direct = item.kind === 'dm' || item.kind === 'group DM'
  const ask = direct || item.facts.ownerStartedThread === true || item.facts.ownerWroteLast === true || item.mentionsMeDirectly
  const counts = (option: NeedsYou) => option === 'answer' || option === 'follow_up' || option === 'serious'
    || (option === 'ask' && ask) || (option === 'decision' && item.facts.ownerStartedThread === true)
  return needsYouOptions.filter(counts).reduce((sum, option) => sum + (reading.probabilities[option] ?? 0), 0)
}
