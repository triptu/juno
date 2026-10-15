/**
 * The composer's @ and # rules (spec section 8): `@juno/domain` rules the
 * renderer runs on each keystroke, reached here because the renderer does
 * not import domain (as with `audience.ts`).
 */
export {
  decodeMentions,
  defaultPersonColor,
  encodeMentions,
  insertMention,
  mentionQueryAt,
  mentionTokens,
  rankSuggestions,
  removeTokenBefore,
  type MentionPick,
  type MentionQuery,
  type MentionToken,
} from '@juno/domain'
