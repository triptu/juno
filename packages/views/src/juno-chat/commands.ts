/**
 * What the chat views call back with. One command union for every card
 * button, so the container maps a click to one RPC and a card view never
 * knows which. The decline buttons (Skip, Keep on a Remove card, Wait until
 * tomorrow) are `dismiss`, as the M1 review documents.
 */
import type { MouseEvent } from 'react'
import type { BubbleId, CardId, ChatMessageId, OpId, OpenTarget, ProposedMessageId, QuestionOptionId, ReplyTarget } from '@juno/agent-contract'
import type { ActivateEvent } from '@juno/ui'

export type CardCommand =
  /** Send every row; `texts` carries the edited text of each. */
  | { readonly _tag: 'send'; readonly texts: ReadonlyArray<{ readonly id: ProposedMessageId; readonly text: string }> }
  | { readonly _tag: 'dismiss' }
  | { readonly _tag: 'resolve' }
  | { readonly _tag: 'undo' }
  /** On an expired card: Juno is sent a message quoting the request. */
  | { readonly _tag: 'askAgain' }
  | { readonly _tag: 'start' }
  /** The Task card's Stop: ends a running job. It is not a chat Stop; the chat has none. */
  | { readonly _tag: 'stop' }
  /** The task card's Sign in, when the T3 sign-in lapsed. */
  | { readonly _tag: 'signIn' }
  | { readonly _tag: 'choose'; readonly optionId: QuestionOptionId }
  | { readonly _tag: 'reply'; readonly text: string }
  | { readonly _tag: 'keep' }
  | { readonly _tag: 'pause' }
  | { readonly _tag: 'delete' }
  | { readonly _tag: 'connect' }
  | { readonly _tag: 'apply' }
  | { readonly _tag: 'remove'; readonly alsoReply: boolean }
  | { readonly _tag: 'allow' }
  | { readonly _tag: 'setUp'; readonly provider: 'openrouter' | 'codex' }

/** What the owner can react to: a Juno bubble or a card. */
export type ReactionTarget = Extract<ReplyTarget, { _tag: 'bubble' | 'card' }>

/** The item a context menu was opened on. An owner bubble is keyed by its op until it is stored. */
export type ChatMenuTarget =
  | { readonly kind: 'owner'; readonly opId: OpId; readonly id?: ChatMessageId }
  | { readonly kind: 'juno'; readonly id: BubbleId }
  | { readonly kind: 'card'; readonly id: CardId }

export type GroupLabelAction = 'why' | 'pauseSchedule' | 'muteUpdates'

/** Every callback the chat list and its rows share. Created once by the container; rows are memoised on it. */
export interface ChatActions {
  readonly onCard: (id: CardId, command: CardCommand) => void
  /** A topic, a chat message (citation), a URL, or a page. `metaKey` asks for a new tab. */
  readonly onOpen: (target: OpenTarget, event: ActivateEvent) => void
  /** "Try again" under an owner bubble or an ending line: resubmit the same op. */
  readonly onRetry: (opId: OpId) => void
  /** React on a Juno bubble or card: the container opens the reaction picker at `event`'s target. */
  readonly onReactions: (target: ReactionTarget, event: MouseEvent<HTMLElement>) => void
  /** Reply on a Juno bubble or card: the composer shows the quote. Not a click on the card. */
  readonly onReply: (target: ReactionTarget) => void
  /** A reply's quote was clicked: scroll to the original and flash it. */
  readonly onQuote: (target: ReplyTarget) => void
  /** Undo on a "Remembered" note. */
  readonly onUndoNote: (id: ChatMessageId) => void
  readonly onGroupLabel: (id: string, action: GroupLabelAction) => void
  /** Right-click on a bubble: the container shows the native menu. */
  readonly onContextMenu?: (target: ChatMenuTarget, event: MouseEvent<HTMLElement>) => void
}

export const noopActions: ChatActions = {
  onCard: () => {},
  onOpen: () => {},
  onRetry: () => {},
  onReactions: () => {},
  onReply: () => {},
  onQuote: () => {},
  onUndoNote: () => {},
  onGroupLabel: () => {},
}
