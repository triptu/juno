/**
 * What the chat views call back with. One command union for every card
 * button, so the container maps a click to one RPC and a card view never
 * knows which. The decline buttons (Skip, Keep on a Remove card, Wait until
 * tomorrow) are `dismiss`, as the M1 review documents.
 */
import type { MouseEvent } from 'react'
import type { CardId, ChatMessageId, OpId, OpenTarget, ProposedMessageId, QuestionOptionId, RunId } from '@juno/agent-contract'
import type { ActivateEvent } from '@juno/ui'

export type CardCommand =
  /** Send every row; `texts` carries the edited text of each. */
  | { readonly _tag: 'send'; readonly texts: ReadonlyArray<{ readonly id: ProposedMessageId; readonly text: string }> }
  /** One row's Try again (after Not sent) or Send again (after can't-tell). A new click, a new authorization. */
  | { readonly _tag: 'sendRow'; readonly messageId: ProposedMessageId }
  | { readonly _tag: 'dismiss' }
  | { readonly _tag: 'resolve' }
  | { readonly _tag: 'undo' }
  /** The card's own Try again, offered by a `failed` status. */
  | { readonly _tag: 'retry' }
  /** On an expired card: Juno is sent a message quoting the request. */
  | { readonly _tag: 'askAgain' }
  | { readonly _tag: 'start' }
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

/** The message a context menu was opened on. An owner bubble is keyed by its op until it is stored. */
export type ChatMenuTarget = { readonly kind: 'owner'; readonly opId: OpId; readonly id?: ChatMessageId } | { readonly kind: 'juno'; readonly id: ChatMessageId }

export type GroupLabelAction = 'why' | 'pauseSchedule' | 'muteUpdates'

/** Every callback the chat list and its rows share. Created once by the container; rows are memoised on it. */
export interface ChatActions {
  readonly onCard: (id: CardId, command: CardCommand) => void
  /** A topic, a chat message (citation), a URL, or a page. `metaKey` asks for a new tab. */
  readonly onOpen: (target: OpenTarget, event: ActivateEvent) => void
  /** "Try again" under an owner bubble or an ending line: resubmit the same op. */
  readonly onRetry: (opId: OpId) => void
  /** Stop on the status bubble. Ends the run only, never a background job. */
  readonly onStop: (runId: RunId) => void
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
  onStop: () => {},
  onUndoNote: () => {},
  onGroupLabel: () => {},
}
