/**
 * The composer's @, # and colon emoji rules, its links and its markup (spec section 8): `@juno/domain` rules the
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
  markupLayout,
  toggleMarkup,
  type MarkupLayout,
  type MarkupStyle,
} from '@juno/domain'
