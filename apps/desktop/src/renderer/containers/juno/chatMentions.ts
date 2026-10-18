import type { ChatMention } from '@juno/agent-contract'
import { picksIn, type MentionPick } from '@juno/contract'

/** The people and channels picked with @ and # that still stand in `text`, as Juno takes them. Groups are Slack's only. */
export const chatMentions = (text: string, picks: ReadonlyArray<MentionPick>): ReadonlyArray<ChatMention> =>
  picksIn(text, picks).flatMap(({ kind, id, name }) => (kind === 'group' ? [] : [{ kind, id, name }]))
