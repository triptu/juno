/**
 * The actions service (WP15): cards, clicks, the dispatcher and grants over
 * one store. `router/open.ts` opens it with the turn engine; the chat server
 * (`serve/`) lists its cards and sends it the renderer's card commands.
 */
import { resolveUndo } from './resolve'
import type { CardBinding } from '@juno/agent-contract'
import { revokeAllGrants, revokeGrant } from '../grants/grants'
import type { Jobs } from '../jobs/jobs'
import type { SpendLedger } from '../spend'
import type { JournalPosition, Mode } from '../store/ledger'
import type { Store } from '../store/store'
import type { ChildBinding } from '../policy/policy'
import {
  cardRow, cardViews, carriesData, carryOutcomes, dismiss, editMessage, prepareChoice, proposeCard, quoteOf, recordClick, settleCardOutcome,
  type CardView, type Choice, type Proposal,
} from './cards'
import { createDispatcher } from './dispatcher'
import type { Executor } from './executor'
import { hostExecutors, type ActionHost } from './host'
import { followOutbox } from './outbox'
import { localExecutors } from './proposals'

export { resolveTool } from './resolve'
export { ACTIONS_MIGRATIONS } from './schema'
export type { ActionHost } from './host'
export type { Executor, ExecutorCall } from './executor'
export type { CardView, Choice, Proposal } from './cards'

export { budgetCard, proposedTask, question, resolveCard, sendMessageTool } from './proposals'

/** What the turn engine takes for actions (`TurnsOptions.actions`). */
export interface ActionsOptions {
  /** The host's action RPCs. No Slack send or resolve without it. */
  readonly host?: ActionHost
  /** Executors other folders own (MCP writes, T3, schedules, removal). */
  readonly decorateCard?: (view: CardView) => CardView
  readonly undoCard?: (identity: Identity) => Promise<boolean>
  readonly executors?: ReadonlyArray<Executor> | (() => ReadonlyArray<Executor>)
}

type Identity = typeof CardBinding.Type['identity']

export function createActions(options: ActionsOptions & {
  readonly store: Store
  readonly onProposed?: (id: string, proposal: Proposal) => void
  readonly position: () => Promise<JournalPosition>
  readonly jobs: Jobs | undefined
  readonly spend: SpendLedger
  readonly place: string
  readonly accept: (input: { readonly opId: string; readonly kind: 'click'; readonly text: string }) => unknown
  readonly onReport?: (error: unknown) => void
}) {
  const { store } = options
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  const resolved = options.host ? resolveUndo(store, options.host, changed) : undefined
  const executors = (): ReadonlyArray<Executor> => [
    ...(options.host ? hostExecutors(options.host) : []),
    ...localExecutors({
      store, jobs: options.jobs, spend: options.spend, place: options.place, accept: options.accept,
      cardRun: (cardId) => cardRow(store, cardId)!.run_id,
    }),
    ...(typeof options.executors === 'function' ? options.executors() : options.executors ?? []),
  ]
  const dispatcher = createDispatcher({
    store, executors, position: options.position, onChange: changed,
    // A connection call or a sign-in a click ran: the run goes on with its outcome, which this input
    // carries (`carryOutcomes`), as a question card's answer does.
    onSettled: (cardId) => {
      const card = cardRow(store, cardId)
      if (card === undefined || card.quiet === 1 || (card.kind !== 'change' && card.kind !== 'connect')) return
      // Only once every child settled and the outcome waits to be carried.
      if (store.db.prepare('SELECT 1 FROM card_outcomes WHERE card_id = ? AND carried_by IS NULL').get(cardId) === undefined) return
      options.accept({ opId: `outcome:${cardId}`, kind: 'click', text: `<card-settled card="${cardId}"/>` })
    },
    ...(options.onReport ? { onReport: options.onReport } : {}),
  })
  let starting: Promise<void> = Promise.resolve()
  const after = <A extends { readonly _tag: string }>(result: A): A => {
    changed()
    return result
  }

  return {
    get executors() { return executors() },
    changed,
    /** Stores a proposal. The same call id is the same card. */
    propose: (proposal: Proposal): string => {
      const id = proposeCard(store, proposal, options.onProposed)
      changed()
      return id
    },
    /** The owner's click on a card's main button. Durable before it returns; dispatch follows in the background. */
    approve: (opId: string, identity: Identity, children: ReadonlyArray<ChildBinding>) => {
      const result = recordClick(store, opId, identity, children)
      if (result._tag === 'accepted') void dispatcher.kick()
      return after(result)
    },
    dismiss: (identity: Identity) => after(dismiss(store, identity)),
    editMessage: (identity: Identity, messageId: string, text: string) => {
      const result = editMessage(store, identity, messageId, text)
      changed()
      return result
    },
    prepare: (identity: Identity, choice: Choice) => {
      const result = prepareChoice(store, identity, choice)
      changed()
      return result
    },
    /** Every card as the chat shows it. */
    views: (now = store.now()): ReadonlyArray<CardView> => cardViews(store, now).map((view) => {
      const decorated = options.decorateCard?.(view) ?? view
      return resolved?.decorate(decorated) ?? decorated
    }),
    undo: async (identity: Identity) => await resolved?.undo(identity) || await options.undoCard?.(identity) || false,
    /** Outcomes the model has not read, as text for input `opId` (§19.5). */
    carry: (opId: string) => carryOutcomes(store, opId),
    /** Whether input `opId` carried a connection call's result. */
    carriesData: (opId: string) => carriesData(store, opId),
    /** A reply's quote of a card. */
    quote: (cardId: string) => quoteOf(store, cardId),
    /**
     * Pause and AI off revoke every grant first (spec `pause`), then the
     * mode stops new authorizations. A crash between leaves fewer grants,
     * never more. Resume lets waiting clicks run.
     */
    beforeMode: (next: Mode) => {
      if (next !== 'on') revokeAllGrants(store, next === 'paused' ? 'pause' : 'off')
    },
    afterMode: (next: Mode) => {
      changed()
      if (next === 'on') void dispatcher.kick()
    },
    /**
     * Looks at waiting clicks again: on a presence change (an account is
     * known), and when this Mac becomes the owner (WP21 calls it).
     */
    kick: () => {
      void dispatcher.kick()
    },
    /** What the host's outbox says of each recent send now (`host.outbox.states`). A Send card's rows follow it. */
    outboxStates: (states: Parameters<typeof followOutbox>[1]) => {
      if (followOutbox(store, states, (cardId) => settleCardOutcome(store, cardId))) changed()
    },
    /** A job's Stop revokes its grant. */
    jobStopped: (jobId: string) => revokeGrant(store, 'job', jobId, 'stop'),
    /** After recovery: reconcile unknown outcomes once, then run any click waiting from before. */
    start: () => {
      starting = dispatcher.reconcile().then(() => dispatcher.kick())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** Resolves when nothing is being dispatched. */
    idle: async () => {
      await starting
      await dispatcher.idle()
    },
    close: () => dispatcher.close(),
  }
}

export type Actions = ReturnType<typeof createActions>
