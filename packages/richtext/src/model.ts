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
  | { readonly kind: 'usergroup'; readonly id: string; readonly handle: string }
  | { readonly kind: 'broadcast'; readonly range: BroadcastRange }
  | { readonly kind: 'emoji'; readonly name: string; readonly unicode?: string; readonly url?: string }
  | { readonly kind: 'date'; readonly timestamp: number; readonly format: string; readonly fallback: string; readonly url?: string }
  | { readonly kind: 'break' }

export type ListStyle = 'bullet' | 'ordered' | 'checked' | 'unchecked'

export type ContentBlock =
  | { readonly kind: 'paragraph'; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: 'quote'; readonly children: ReadonlyArray<Inline> }
  | { readonly kind: 'code'; readonly text: string }
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

export type Block = ContentBlock | {
  readonly kind: 'attachment'
  readonly author?: { readonly name: string; readonly icon?: string }
  readonly footerIcon?: string
  readonly tint: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  readonly title: ReadonlyArray<Inline>
  readonly blocks: ReadonlyArray<ContentBlock>
  readonly footer: ReadonlyArray<Inline>
}

export interface MessageBody {
  readonly blocks: ReadonlyArray<Block>
}

/**
 * How ids become names. Every function is optional; a missing lookup falls
 * back to the raw id or shortcode so nothing ever renders blank.
 */
export interface Lookups {
  /** The signed-in user's id. Sets `isMe` on user mentions. */
  readonly me?: string
  /** Display name for a user id, without "@". */
  readonly user?: (id: string) => string | undefined
  /** Channel name for a channel id, without "#". */
  readonly channel?: (id: string) => string | undefined
  /** Handle for a usergroup id, without "@". */
  readonly usergroup?: (id: string) => string | undefined
  /** Image url for a custom emoji name. */
  readonly emoji?: (name: string) => string | undefined
  /** The standard emoji a custom alias names, for an alias with no image of its own. */
  readonly emojiAlias?: (name: string) => string | undefined
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
