/**
 * The renderer-agnostic view model for a message body.
 *
 * Views draw this; the engine stores or derives it. It has no Slack ids
 * left unresolved: every mention already carries a display name, and every
 * emoji carries either a unicode string or a custom image url.
 */

export interface InlineStyle {
  readonly bold?: true
  readonly italic?: true
  readonly strike?: true
  readonly code?: true
}

export type BroadcastRange = 'here' | 'channel' | 'everyone'

export type Inline =
  | { readonly kind: 'text'; readonly text: string; readonly style?: InlineStyle }
  | { readonly kind: 'link'; readonly url: string; readonly text: string; readonly style?: InlineStyle }
  | { readonly kind: 'user'; readonly id: string; readonly name: string; readonly isMe: boolean }
  | { readonly kind: 'channel'; readonly id: string; readonly name: string }
  /** A user group. `name` is the group's full name, for a tooltip; `isMine` when the user belongs to it. */
  | { readonly kind: 'usergroup'; readonly id: string; readonly handle: string; readonly name?: string; readonly isMine: boolean }
  | { readonly kind: 'broadcast'; readonly range: BroadcastRange }
  | { readonly kind: 'emoji'; readonly name: string; readonly unicode?: string; readonly url?: string }
  | { readonly kind: 'date'; readonly timestamp: number; readonly format: string; readonly fallback: string; readonly url?: string }
  | { readonly kind: 'break' }

export type ListStyle = 'bullet' | 'ordered' | 'checked' | 'unchecked'

export type ContentBlock =
  | { readonly kind: 'paragraph'; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: 'quote'; readonly children: ReadonlyArray<Inline> }
  /**
   * `text` is the code as written. When its first line is only a language
   * tag (```ts), `language` names it and `tagLine` says to show the code
   * without that line.
   */
  | { readonly kind: 'code'; readonly text: string; readonly language?: string; readonly tagLine?: true }
  | {
      readonly kind: 'list'
      readonly style: ListStyle
      readonly indent: number
      readonly items: ReadonlyArray<ReadonlyArray<Inline>>
    }
  | { readonly kind: 'heading'; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: 'divider' }
  | { readonly kind: 'fields'; readonly items: ReadonlyArray<ReadonlyArray<Inline>> }
  | { readonly kind: 'context'; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: 'image'; readonly url: string; readonly alt: string; readonly width?: number; readonly height?: number }
  | { readonly kind: 'file'; readonly id: string; readonly name: string; readonly mimetype: string; readonly width?: number; readonly height?: number }

export type PlaceKind = 'public' | 'private' | 'im' | 'mpim'

/** A conversation as a reader names it: a channel's name without "#", or the people of a DM. */
export interface PlaceName {
  readonly kind: PlaceKind
  readonly name: string
}

/**
 * Where a shared Slack message was posted, when Juno knows the place.
 * `url` is its permalink; `thread` when it was a reply in a thread.
 */
export interface SharedSource extends PlaceName {
  readonly url: string
  readonly thread: boolean
}

export type Block = ContentBlock | {
  readonly kind: 'attachment'
  readonly author?: { readonly name: string; readonly icon?: string }
  readonly footerIcon?: string
  readonly tint: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  readonly title: ReadonlyArray<Inline>
  readonly blocks: ReadonlyArray<ContentBlock>
  /** A shared message's place. With it, `footer` holds only the date; the view draws the place before it. */
  readonly source?: SharedSource
  readonly footer: ReadonlyArray<Inline>
}

export interface MessageBody {
  readonly blocks: ReadonlyArray<Block>
}

/**
 * How ids become names. Every function is optional; a missing lookup falls
 * back to a label from the text, a placeholder, or the shortcode, so
 * nothing ever renders blank.
 */
export interface Lookups {
  /** The signed-in user's id. Sets `isMe` on user mentions. */
  readonly me?: string
  /** Display name for a user id, without "@". */
  readonly user?: (id: string) => string | undefined
  /** Channel name for a channel id, without "#". */
  readonly channel?: (id: string) => string | undefined
  /** The kind and name of any conversation by id, DMs included: where a shared message came from. */
  readonly place?: (id: string) => PlaceName | undefined
  /** Handle (without "@") and full name for a usergroup id. */
  readonly usergroup?: (id: string) => UsergroupName | undefined
  /** The user groups the signed-in user belongs to. Sets `isMine` on usergroup mentions. */
  readonly myUsergroups?: ReadonlyArray<string>
  /** Image url for a custom emoji name. */
  readonly emoji?: (name: string) => string | undefined
  /** The standard emoji a custom alias names, for an alias with no image of its own. */
  readonly emojiAlias?: (name: string) => string | undefined
}

export interface UsergroupName {
  readonly handle: string
  readonly name?: string
}

/** All inline runs of a body in reading order, including list items. */
export function inlinesOf(body: MessageBody): ReadonlyArray<Inline> {
  const out: Inline[] = []
  for (const block of body.blocks) {
    switch (block.kind) {
      case 'attachment':
        out.push(...block.title, ...inlinesOf({ blocks: block.blocks }), ...block.footer)
        break
      case 'image':
        out.push({ kind: 'text', text: block.alt })
        break
      case 'fields':
        for (const item of block.items) out.push(...item)
        break
      case 'context':
      case 'paragraph':
      case 'quote':
      case 'heading':
        out.push(...block.children)
        break
      case 'list':
        for (const item of block.items) out.push(...item)
        break
      case 'code':
        out.push({ kind: 'text', text: block.text, style: { code: true } })
        break
      case 'divider':
        break
      case 'file':
        out.push({ kind: 'text', text: block.name })
        break
    }
  }
  return out
}
