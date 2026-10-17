/**
 * The row id of a suggestion, for `activeId` and `aria-activedescendant`.
 * On its own so the composer can use it without loading `MentionSuggestions`.
 */
export const mentionRowId = (listId: string, id: string) => `${listId}-${id}`
