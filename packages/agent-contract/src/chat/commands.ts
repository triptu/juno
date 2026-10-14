/**
 * What a card button asks for. One command union for every card button, so
 * the container maps a click to one call (`@juno/state`'s `cardCommand`)
 * and a card view never knows which RPC it is. The decline buttons (Skip,
 * Keep on a Remove card, Wait until tomorrow) are `dismiss`, as the M1
 * review documents.
 */
import type { ProposedMessageId, QuestionOptionId } from './ids'

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
