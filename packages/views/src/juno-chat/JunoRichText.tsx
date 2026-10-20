import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { JunoBlock, JunoInline } from '@juno/agent-contract'
import { colors, radii, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import type { ChatActions } from './commands'
import { HighlightedCodeBlock } from '../CodeHighlight'
import { InlineLink } from './InlineLink'
import { messageTime } from '../time'

export interface JunoRichTextProps {
  readonly body: ReadonlyArray<JunoBlock>
  readonly now: number
  readonly actions: ChatActions
}

/**
 * The blocks of a Juno bubble (SPEC 13.1): paragraphs, short headings as a
 * bold line, bullet and numbered lists, and code blocks, with bold, italic,
 * inline code and links inside. The agent parsed them; this only draws.
 */
export function JunoRichText({ body, now, actions }: JunoRichTextProps) {
  return body.map((block, index) => <Block key={index} block={block} now={now} actions={actions} />)
}

function Block({ block, now, actions }: { readonly block: JunoBlock; readonly now: number; readonly actions: ChatActions }) {
  const inlines = (list: ReadonlyArray<JunoInline>) => list.map((inline, index) => <Inline key={index} inline={inline} now={now} actions={actions} />)
  switch (block._tag) {
    case 'paragraph':
      return <p {...stylex.props(styles.paragraph)}>{inlines(block.inlines)}</p>
    case 'heading':
      return <p {...stylex.props(styles.paragraph, styles.heading)}>{inlines(block.inlines)}</p>
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index} {...stylex.props(styles.item)}>
          {inlines(item)}
        </li>
      ))
      return block.ordered ? (
        <ol start={block.start} {...stylex.props(styles.list)}>
          {items}
        </ol>
      ) : (
        <ul {...stylex.props(styles.list)}>{items}</ul>
      )
    }
    case 'codeBlock':
      return <HighlightedCodeBlock text={block.text} language={block.language} />
  }
}

/** A Slack message's `ts` ("1760500000.000123", seconds) as epoch milliseconds. */
const tsMillis = (ts: string) => Math.round(Number(ts) * 1000)

function marked(inline: { readonly bold?: true; readonly italic?: true }, node: ReactNode): ReactNode {
  let out = node
  if (inline.italic) out = <em {...stylex.props(styles.italic)}>{out}</em>
  if (inline.bold) out = <strong {...stylex.props(styles.bold)}>{out}</strong>
  return out
}

function Inline({ inline, now, actions }: { readonly inline: JunoInline; readonly now: number; readonly actions: ChatActions }) {
  switch (inline._tag) {
    case 'text':
      return marked(inline, inline.text)
    case 'code':
      return <code {...stylex.props(styles.code)}>{inline.text}</code>
    case 'cite':
      return (
        <InlineLink data-cite={inline.messageId} onOpen={(event) => actions.onOpen({ _tag: 'chatMessage', messageId: inline.messageId }, event)}>
          {marked(inline, inline.text)}
        </InlineLink>
      )
    case 'source':
      return (
        <InlineLink
          data-source={`${inline.channelId}/${inline.ts}`}
          title={`${inline.place} · ${messageTime(tsMillis(inline.ts), now)}`}
          onOpen={(event) => actions.onOpen({ _tag: 'message', channelId: inline.channelId, ts: inline.ts }, event)}
        >
          {marked(inline, inline.text)}
        </InlineLink>
      )
  }
}

const styles = stylex.create({
  paragraph: {
    margin: 0,
  },
  // A heading is a bold line at the bubble's size: a chat has no large type.
  heading: {
    fontWeight: weights['--weight-semibold'],
  },
  list: {
    margin: 0,
    paddingInlineStart: spacing['--space-5'],
  },
  item: {
    display: 'list-item',
  },
  bold: {
    fontWeight: weights['--weight-semibold'],
  },
  italic: {
    fontStyle: 'italic',
  },
  code: {
    fontFamily: text['--text-code-family'],
    fontSize: text['--text-code-size'],
    fontVariantLigatures: text['--text-code-ligatures'],
    paddingInline: spacing['--space-1'],
    borderRadius: radii['--radius-xs'],
    backgroundColor: colors['--secondary-active'],
  },
})
