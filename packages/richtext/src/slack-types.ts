/**
 * Minimal shapes of the Slack message content this package reads and writes.
 *
 * These are input types only. `@juno/slack` will own the full decoded
 * schemas; until it exists, this file is the one place richtext describes
 * what it expects from a Slack message. Shapes follow
 * `docs/research/slack-data-access.md` section 5.
 */

export interface RichTextStyle {
  readonly bold?: boolean
  readonly italic?: boolean
  readonly strike?: boolean
  readonly code?: boolean
}

export type BroadcastRange = 'here' | 'channel' | 'everyone'

export type RichTextInline =
  | { readonly type: 'text'; readonly text: string; readonly style?: RichTextStyle }
  | { readonly type: 'user'; readonly user_id: string; readonly style?: RichTextStyle }
  | { readonly type: 'usergroup'; readonly usergroup_id: string; readonly style?: RichTextStyle }
  | { readonly type: 'channel'; readonly channel_id: string; readonly style?: RichTextStyle }
  | { readonly type: 'broadcast'; readonly range: BroadcastRange; readonly style?: RichTextStyle }
  | {
      readonly type: 'emoji'
      readonly name: string
      /** Hex code points joined by "-", for example "1f44d-1f3fd". */
      readonly unicode?: string
      readonly skin_tone?: number
      readonly style?: RichTextStyle
    }
  | { readonly type: 'link'; readonly url: string; readonly text?: string; readonly style?: RichTextStyle }
  | {
      readonly type: 'date'
      readonly timestamp: number
      readonly format: string
      readonly fallback?: string
      readonly url?: string
    }
  | { readonly type: 'color'; readonly value: string }
  /** Any element kind this package does not render specially. */
  | { readonly type: 'unknown'; readonly text?: string; readonly fallback?: string }

export type RichTextListStyle = 'bullet' | 'ordered' | 'check' | 'checked' | 'unchecked'

export interface RichTextSection {
  readonly type: 'rich_text_section'
  readonly elements: ReadonlyArray<RichTextInline>
}

export interface RichTextQuote {
  readonly type: 'rich_text_quote'
  readonly elements: ReadonlyArray<RichTextInline>
}

export interface RichTextPreformatted {
  readonly type: 'rich_text_preformatted'
  readonly elements: ReadonlyArray<RichTextInline>
  readonly border?: number
}

export interface RichTextList {
  readonly type: 'rich_text_list'
  readonly style: RichTextListStyle
  readonly indent?: number
  readonly offset?: number
  readonly border?: number
  readonly elements: ReadonlyArray<RichTextSection>
}

export interface RichTextHeader {
  readonly type: 'rich_text_header'
  readonly elements: ReadonlyArray<RichTextInline>
}

export interface RichTextDivider {
  readonly type: 'rich_text_divider'
}

export type RichTextElement =
  | RichTextSection
  | RichTextQuote
  | RichTextPreformatted
  | RichTextList
  | RichTextHeader
  | RichTextDivider

export interface RichTextBlock {
  readonly type: 'rich_text'
  readonly block_id?: string
  readonly elements: ReadonlyArray<RichTextElement>
}

export interface TextObject {
  readonly type: 'mrkdwn' | 'plain_text'
  readonly text: string
}

export interface SectionBlock {
  readonly type: 'section'
  readonly block_id?: string
  readonly text?: TextObject
  readonly fields?: ReadonlyArray<TextObject>
}

export interface HeaderBlock {
  readonly type: 'header'
  readonly block_id?: string
  readonly text: TextObject
}

export interface ContextBlock {
  readonly type: 'context'
  readonly block_id?: string
  readonly elements: ReadonlyArray<TextObject | { readonly type: 'image' }>
}

export interface DividerBlock {
  readonly type: 'divider'
  readonly block_id?: string
}

/** Block kinds the renderer understands. Others are skipped at runtime. */
export type MessageBlock = RichTextBlock | SectionBlock | HeaderBlock | ContextBlock | DividerBlock

/** The part of a Slack message that carries its content. */
export interface MessageContent {
  /** mrkdwn, HTML-escaped (`&lt; &gt; &amp;`). */
  readonly text?: string
  readonly blocks?: ReadonlyArray<MessageBlock>
}
