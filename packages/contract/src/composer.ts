/**
 * The composer's @, # and colon emoji rules and its links (spec section 8): `@juno/domain` rules the
 * renderer runs on each keystroke, reached here because the renderer does
 * not import domain (as with `audience.ts`).
 */
export {
  decodeDraft,
  encodeDraft,
  linkAt,
  moveLinks,
  pastedLink,
  setLink,
  shownLinks,
  type LinkRange,
  defaultPersonColor,
  encodeMentions,
  insertMention,
  mentionQueryAt,
  mentionTokens,
  picksIn,
  rankSuggestions,
  removeTokenBefore,
  type MentionPick,
  type MentionQuery,
  type MentionToken,
  customEmoji,
  EMOJI_QUERY_MIN,
  emojiQueryAt,
  matchEmoji,
  mergeEmoji,
} from '@juno/domain'
