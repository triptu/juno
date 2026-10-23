import { needsYouOptions, type Instruction } from '@juno/domain'
import { Type } from '../schema'
import { defineStructuredTask } from '../task'
import { messagesState, oneLine, renderMessages, type AiMessage } from './shared'
import { instructionCriterion, instructionQuestion, needsYouCriteria, needsYouQuestion, noneCriterion, prompt } from './notificationReading.prompt'

export interface NotificationReadingInput {
  /** The message's Slack ts, the cache entity. */
  readonly messageTs: string
  /** "#eng", "Maya Chen". */
  readonly where: string
  readonly kind: 'dm' | 'group DM' | 'thread' | 'channel'
  readonly sender: string
  readonly text: string
  readonly mentionsMe: boolean
  readonly now: string
  /** The thread's first message, when the message is a reply. */
  readonly threadRoot?: AiMessage
  /** Up to 10 earlier messages in the same topic, oldest first, the owner's marked. */
  readonly before: ReadonlyArray<AiMessage>
  readonly facts: {
    /** Minutes since the owner last wrote in this topic, when they have. */
    readonly ownerWroteMinutesAgo?: number
    readonly ownerWroteLast: boolean
    readonly ownerStartedThread: boolean
    /** The sender wrote earlier and the owner hasn't written since. */
    readonly senderWroteSinceOwner: boolean
    /** Messages the owner and the sender exchanged in their DM in the last 30 days. */
    readonly exchangesLast30Days: number
  }
  readonly instructions: ReadonlyArray<Instruction>
}

const probability = Type.Number({ minimum: 0, maximum: 1 })

/** The reading as it came, before any threshold: the domain applies those (`decideNotification`). */
export const NotificationReadingOutput = Type.Object({
  needsYou: Type.Union(needsYouOptions.map((option) => Type.Literal(option))),
  probabilities: Type.Record(Type.String(), probability),
  instruction: Type.Union([Type.Object({ id: Type.String(), confidence: probability }), Type.Null()]),
})

const NONE = 'none'

/**
 * Decision. Auto's last step (SPEC 14): one classifier call with two
 * choice questions, `instruction` (only when the owner has instructions)
 * and `needsYou`. The engine waits 2 s and then decides without it.
 */
export const notificationReading = defineStructuredTask<NotificationReadingInput, typeof NotificationReadingOutput>({
  name: 'notificationReading',
  version: 2,
  tier: 'decision',
  timeoutMillis: 2000,
  prompt,
  tool: { name: 'read', description: 'Report the instruction the message is about, if any, and what it needs from the owner.' },
  output: NotificationReadingOutput,
  accept: (out, input) => out.instruction === null || input.instructions.some((item) => item.id === out.instruction?.id),
  classify: {
    ask: (input) => ({
      state: {
        where: input.where,
        kind: input.kind,
        now: input.now,
        ...(input.threadRoot === undefined ? {} : { threadStart: messagesState([input.threadRoot])[0] }),
        before: messagesState(input.before),
        facts: input.facts,
        instructions: Object.fromEntries(input.instructions.map((item) => [item.id, item.text])),
        message: { sender: input.sender, mentionsMe: input.mentionsMe, text: input.text },
      },
      questions: {
        ...(input.instructions.length === 0
          ? {}
          : {
              instruction: {
                type: 'choice' as const,
                instructions: instructionQuestion,
                criteria: { ...Object.fromEntries(input.instructions.map((item) => [item.id, instructionCriterion(item.text)])), [NONE]: noneCriterion },
              },
            }),
        needsYou: { type: 'choice', instructions: needsYouQuestion, criteria: needsYouCriteria },
      },
    }),
    read: (answers) => {
      const needs = answers.needsYou
      if (needs?.type !== 'choice') return undefined
      const chosen = answers.instruction
      const instruction = chosen?.type === 'choice' && chosen.choice !== NONE ? { id: chosen.choice, confidence: chosen.confidence } : null
      return { needsYou: needs.choice, probabilities: needs.probabilities, instruction }
    },
  },
  render: (input) =>
    [
      `Where: ${input.where} (${input.kind})`,
      `Now: ${input.now}`,
      `Facts: ${JSON.stringify(input.facts)}`,
      input.instructions.length === 0
        ? 'Instructions: none'
        : `Instructions:\n${input.instructions.map((item) => `${item.id}: ${oneLine(item.text)}`).join('\n')}`,
      input.threadRoot === undefined ? '' : `Thread started with:\n${renderMessages([input.threadRoot])}`,
      `Before:\n${renderMessages(input.before)}`,
      `New message from ${input.sender}${input.mentionsMe ? ', mentioning me' : ''}: ${oneLine(input.text)}`,
      `Options for needsYou: ${needsYouOptions.join(', ')}. Use null for instruction when none applies.`,
    ]
      .filter((line) => line !== '')
      .join('\n\n'),
  key: (input) => input.messageTs,
})
