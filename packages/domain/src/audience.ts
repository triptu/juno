/**
 * The audience check (spec section 8): a quiet warning while typing when the
 * draft reads like hiring or people details and the channel is public.
 */
import { channelLabelBare, type ChannelNaming } from './channel'

const TERMS = /\b(offer|salary|salaries|comp|compensation|candidate|candidates|layoffs?|performance review|headcount|fired|onsite|severance|pip|promotion|resign(?:ed|ation)?|terminat(?:ed|ion))\b/gi

export interface AudienceWarning {
  readonly matched: ReadonlyArray<string>
  /** "This reads like hiring or people detail. eng is a public channel." */
  readonly message: string
}

/** Returns a warning for a public channel whose draft matches, otherwise `undefined`. */
export function audienceCheck(draft: string, channel: ChannelNaming): AudienceWarning | undefined {
  if (channel.kind !== 'public') return undefined
  const matched = Array.from(draft.matchAll(TERMS), (m) => m[0].toLowerCase())
  if (matched.length === 0) return undefined
  const unique = Array.from(new Set(matched))
  return {
    matched: unique,
    message: `This reads like hiring or people detail. ${channelLabelBare(channel)} is a public channel.`,
  }
}
