/**
 * What the chat views call back with. Card buttons use one command union,
 * `CardCommand` (in `@juno/agent-contract`, so the state layer can map it to
 * the card RPCs without importing views).
 */
import type { MouseEvent, ReactNode } from 'react'
import type { AskAnswer, AskId, BubbleId, CardCommand, CardId, ChatMessageId, OpId, Reaction, OpenTarget, OwnerFile, ReplyTarget } from '@juno/agent-contract'
import type { ActivateEvent } from '@juno/ui'

export type { CardCommand } from '@juno/agent-contract'

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
  /** The container draws badges from the workspace data already loaded by the picker. Stable for the chat's life. */
  readonly renderReactions?: (reactions: ReadonlyArray<Reaction>, corner: 'start' | 'end') => ReactNode
  readonly onCard: (id: CardId, command: CardCommand) => void
  /** A topic, a chat message (citation), a Slack message (source), a URL, or a page. `metaKey` asks for a new tab. */
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
  /** Undo on an "Updated memory" note: puts back what that run or learning pass changed. */
  readonly onUndoMemory: (run: string) => void
  /** Start, Not now or Stop on a proactive ask. */
  readonly onAsk: (id: AskId, answer: AskAnswer) => void
  readonly onGroupLabel: (id: string, action: GroupLabelAction) => void
  /** Right-click on a bubble: the container shows the native menu. */
  readonly onContextMenu?: (target: ChatMenuTarget, event: MouseEvent<HTMLElement>) => void
  /** An image the owner sent, with its thumbnail (`OwnerImage`): the container reads it from the agent. */
  readonly renderOwnerImage?: (opId: OpId, file: Extract<OwnerFile, { _tag: 'image' }>) => ReactNode
}

export const noopActions: ChatActions = {
  onCard: () => {},
  onOpen: () => {},
  onRetry: () => {},
  onReactions: () => {},
  onReply: () => {},
  onQuote: () => {},
  onUndoNote: () => {},
  onUndoMemory: () => {},
  onAsk: () => {},
  onGroupLabel: () => {},
}
