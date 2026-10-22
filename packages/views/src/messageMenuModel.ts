/**
 * What a container needs to fill the message menu (`MessageMenu.tsx`)
 * without importing it, so the menu, its icons and the emoji picker stay in
 * their own chunk.
 */

/** One cell of the menu's emoji grid. */
export interface GridReaction {
  /** Slack's name, for example `+1`. */
  readonly name: string
  /** The glyph; for a custom emoji, `:name:`, its text alternative. */
  readonly unicode: string
  /** A custom emoji's image. */
  readonly url?: string
  /** You already reacted with it: it shows chosen, and choosing it again takes it back. */
  readonly selected: boolean
}

/** Two rows of six cells: eleven emoji and More reactions. */
export const GRID_REACTIONS = 11

/** The icons a menu row may have, by name, so containers need no icon set. */
export type MessageMenuIcon = 'thread' | 'reply' | 'quote' | 'juno' | 'copy' | 'forward' | 'open' | 'bell' | 'edit' | 'delete' | 'pin' | 'broadcast'

/** A row of the message menu, or a separator between groups. */
export type MessageMenuEntry = { readonly id: string; readonly label: string; readonly icon: MessageMenuIcon; readonly disabled?: boolean } | { readonly separator: true }
