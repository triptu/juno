import * as stylex from '@stylexjs/stylex'
import type { MouseEvent, ReactNode } from 'react'
import type { BodyBlock, BodyInline, MessageBody as MessageBodyModel } from '@juno/contract'
import { accent, colors, radii, spacing, text, weights, sizes } from '@juno/tokens/tokens.stylex'
import { Chip, CodeBlock, Divider, Text, type HueName } from '@juno/ui'
import { slackDate } from './time'

export interface MessageBodyProps {
  readonly body: MessageBodyModel
  /** Epoch milliseconds, for `date` inlines that say "Today". */
  readonly now: number
  /** The person hue for @mention chips, by user id. A missing entry falls back to the id's hash. */
  readonly hueOf: (id: string) => HueName
  /** A `#channel` chip was clicked: scope the sidebar to it. */
  readonly onChannel?: (id: string) => void
  /** A link was clicked: open it in the browser. */
  readonly onLink?: (url: string) => void
  /**
   * The message row is the list's tabbable one (roving tabindex). The
   * #channel chips and links follow it, so Tab does not stop at every chip
   * in every message. Default false.
   */
  readonly tabbable?: boolean
}

// An emoji-only message (one to three emoji and nothing else) is drawn
// larger, as Slack does. A ratio of the body size, used nowhere else.
const EMOJI_ONLY_SCALE = '1.75em'
// Custom emoji images sit on the text line at a little over its size.
const INLINE_EMOJI_SIZE = '1.25em'
const MAX_EMOJI_ONLY = 3

const isSpace = (inline: BodyInline) => inline.kind === 'text' && inline.text.trim() === ''

/** One to three emoji, and nothing else, in one paragraph. */
export function isEmojiOnly(body: MessageBodyModel): boolean {
  if (body.blocks.length !== 1) return false
  const block = body.blocks[0]
  if (block === undefined || block.kind !== 'paragraph') return false
  const content = block.children.filter((inline) => !isSpace(inline))
  return content.length > 0 && content.length <= MAX_EMOJI_ONLY && content.every((inline) => inline.kind === 'emoji')
}

/**
 * Draws a `MessageBody`: paragraphs, quotes, code, lists, headings and
 * rules, with mentions as chips, links that open outside, emoji and dates.
 * Files are not drawn here; the message draws them from its `files`. Text
 * is selectable and follows its own direction.
 */
export function MessageBody({ body, now, hueOf, onChannel, onLink, tabbable = false }: MessageBodyProps) {
  const jumbo = isEmojiOnly(body)
  const tabIndex = tabbable ? 0 : -1
  return (
    <div data-msg-text="" {...stylex.props(styles.body, jumbo && styles.jumbo)}>
      {body.blocks.map((block, index) => (
        <Block key={index} block={block} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} tabIndex={tabIndex} />
      ))}
    </div>
  )
}

interface BlockProps {
  readonly block: BodyBlock
  readonly now: number
  readonly hueOf: (id: string) => HueName
  readonly onChannel: ((id: string) => void) | undefined
  readonly onLink: ((url: string) => void) | undefined
  readonly tabIndex: 0 | -1
}

function Block({ block, now, hueOf, onChannel, onLink, tabIndex }: BlockProps) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p dir="auto" {...stylex.props(styles.paragraph)}>
          <Inlines inlines={block.children} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} tabIndex={tabIndex} />
        </p>
      )
    case 'quote':
      return (
        <blockquote dir="auto" {...stylex.props(styles.quote)}>
          <Inlines inlines={block.children} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} tabIndex={tabIndex} />
        </blockquote>
      )
    case 'code':
      return (
        <div {...stylex.props(styles.code)}>
          <CodeBlock>{block.text}</CodeBlock>
        </div>
      )
    case 'list': {
      const ordered = block.style === 'ordered'
      const Tag = ordered ? 'ol' : 'ul'
      const checklist = block.style === 'checked' || block.style === 'unchecked'
      return (
        <Tag dir="auto" {...stylex.props(styles.list, checklist && styles.checklist, indents[Math.min(block.indent, 3) as 0 | 1 | 2 | 3])}>
          {block.items.map((item, index) => (
            <li key={index} {...stylex.props(styles.item)}>
              {checklist ? (
                <span aria-hidden {...stylex.props(styles.check, block.style === 'checked' && styles.checked)}>
                  {block.style === 'checked' ? '✓' : ''}
                </span>
              ) : null}
              <span {...stylex.props(checklist && block.style === 'checked' && styles.done)}>
                <Inlines inlines={item} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} tabIndex={tabIndex} />
              </span>
            </li>
          ))}
        </Tag>
      )
    }
    case 'heading':
      return (
        <Text variant="heading" tone="default" as="p" dir="auto" selectable sx={styles.heading}>
          <Inlines inlines={block.children} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} tabIndex={tabIndex} />
        </Text>
      )
    case 'divider':
      return (
        <div {...stylex.props(styles.rule)}>
          <Divider inset="sm" />
        </div>
      )
    case 'file':
      // Drawn by the message from its `files`, which carry the thumbnail.
      return null
  }
}

interface InlinesProps {
  readonly inlines: ReadonlyArray<BodyInline>
  readonly now: number
  readonly hueOf: (id: string) => HueName
  readonly onChannel: ((id: string) => void) | undefined
  readonly onLink: ((url: string) => void) | undefined
  readonly tabIndex: 0 | -1
}

function Inlines({ inlines, now, hueOf, onChannel, onLink, tabIndex }: InlinesProps) {
  return inlines.map((inline, index) => <Inline key={index} inline={inline} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} tabIndex={tabIndex} />)
}

interface InlineProps {
  readonly inline: BodyInline
  readonly now: number
  readonly hueOf: (id: string) => HueName
  readonly onChannel: ((id: string) => void) | undefined
  readonly onLink: ((url: string) => void) | undefined
  readonly tabIndex: 0 | -1
}

function Inline({ inline, now, hueOf, onChannel, onLink, tabIndex }: InlineProps) {
  switch (inline.kind) {
    case 'text':
      return styled(inline.text, inline.style)
    case 'link': {
      const open = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onLink?.(inline.url)
      }
      return (
        <a href={inline.url} onClick={open} draggable={false} tabIndex={tabIndex} {...stylex.props(styles.link)}>
          {styled(inline.text, inline.style)}
        </a>
      )
    }
    // Chip text sits in <bdi> so "@Name" keeps its own direction inside a
    // right-to-left paragraph (otherwise the "@" jumps to the other end).
    case 'user':
      return inline.isMe ? (
        <Chip variant="accent" size="inline" title="Mentions you">
          <bdi>@{inline.name}</bdi>
        </Chip>
      ) : (
        <Chip variant="person" size="inline" hue={hueOf(inline.id)} data-person={inline.id} data-person-name={inline.name}>
          <bdi>@{inline.name}</bdi>
        </Chip>
      )
    case 'channel':
      return (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onChannel?.(inline.id)
          }}
          title={`Show only #${inline.name}`}
          tabIndex={tabIndex}
          data-channel={inline.id}
          data-channel-name={inline.name}
          {...stylex.props(styles.channelButton)}
        >
          <Chip variant="filled" size="inline">
            <bdi>#{inline.name}</bdi>
          </Chip>
        </button>
      )
    case 'usergroup':
      return (
        <Chip variant="filled" size="inline">
          <bdi>@{inline.handle}</bdi>
        </Chip>
      )
    case 'broadcast':
      return (
        <Chip variant="soft" size="inline">
          <bdi>@{inline.range}</bdi>
        </Chip>
      )
    case 'emoji':
      if (inline.url !== undefined) {
        return <img src={inline.url} alt={`:${inline.name}:`} title={`:${inline.name}:`} draggable={false} decoding="async" loading="lazy" {...stylex.props(styles.customEmoji)} />
      }
      return inline.unicode ?? `:${inline.name}:`
    case 'break':
      return <br />
    case 'date': {
      const label = slackDate(inline.timestamp, inline.format, now)
      const time = <time dateTime={new Date(inline.timestamp * 1000).toISOString()}>{label}</time>
      if (inline.url === undefined) return time
      const open = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onLink?.(inline.url ?? '')
      }
      return (
        <a href={inline.url} onClick={open} draggable={false} tabIndex={tabIndex} {...stylex.props(styles.link)}>
          {time}
        </a>
      )
    }
  }
}

function styled(value: string, style: { bold?: true; italic?: true; strike?: true; code?: true } | undefined): ReactNode {
  if (style === undefined) return value
  let node: ReactNode = value
  if (style.code) node = <code {...stylex.props(styles.inlineCode)}>{node}</code>
  if (style.bold) node = <strong {...stylex.props(styles.bold)}>{node}</strong>
  if (style.italic) node = <em>{node}</em>
  if (style.strike) node = <s>{node}</s>
  return node
}

const styles = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    fontWeight: text['--text-body-weight'],
    lineHeight: text['--text-body-leading'],
    letterSpacing: text['--text-body-tracking'],
    color: colors['--foreground-default'],
    overflowWrap: 'anywhere',
    textWrap: 'pretty',
    userSelect: 'text',
    cursor: 'text',
  },
  jumbo: {
    fontSize: EMOJI_ONLY_SCALE,
    lineHeight: 1.3,
  },
  paragraph: {
    margin: 0,
    whiteSpace: 'pre-wrap',
  },
  // Lines that started with ">" (inventory 6.3): one soft block in the
  // subtle colour.
  quote: {
    marginBlock: spacing['--space-0-5'],
    marginInline: 0,
    paddingBlock: spacing['--space-1'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-md'],
    backgroundColor: 'color-mix(in oklch, currentColor 6%, transparent)',
    color: colors['--foreground-subtle'],
    whiteSpace: 'pre-wrap',
  },
  code: {
    marginBlock: spacing['--space-0-5'],
    // The block sets its own width; without this a long line would widen the row.
    minWidth: 0,
    maxWidth: '100%',
  },
  list: {
    margin: 0,
    paddingInlineStart: spacing['--space-5'],
    whiteSpace: 'pre-wrap',
  },
  checklist: {
    listStyleType: 'none',
    paddingInlineStart: 0,
  },
  item: {
    display: 'list-item',
  },
  check: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--inline-em'],
    height: sizes['--inline-em'],
    marginInlineEnd: spacing['--space-1-5'],
    borderRadius: radii['--radius-xs'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-strongest'],
    fontSize: text['--text-tag-small-size'],
    lineHeight: 1,
    color: colors['--foreground-subtle'],
    verticalAlign: `calc(-1 * ${spacing['--space-0-5']})`,
    // Chrome inside selectable text: the arrow, not the text cursor.
    userSelect: 'none',
    cursor: 'default',
  },
  // A done item stays quiet: a filled grey box, not the accent.
  checked: {
    backgroundColor: colors['--secondary-active'],
    borderColor: colors['--border-strongest'],
  },
  done: {
    color: colors['--foreground-muted'],
    textDecorationLine: 'line-through',
  },
  heading: {
    marginTop: spacing['--space-1'],
  },
  rule: {
    marginBlock: spacing['--space-1'],
  },
  link: {
    color: accent['--hl-text'],
    textDecorationLine: 'underline',
    textDecorationColor: 'color-mix(in oklch, currentColor 35%, transparent)',
    textUnderlineOffset: sizes['--link-underline-offset'],
    cursor: 'default',
  },
  bold: {
    fontWeight: weights['--weight-semibold'],
  },
  inlineCode: {
    fontFamily: text['--text-code-family'],
    fontSize: text['--text-code-size'],
    paddingInline: spacing['--space-1'],
    borderRadius: radii['--radius-xs'],
    backgroundColor: colors['--secondary-default'],
  },
  customEmoji: {
    display: 'inline-block',
    width: INLINE_EMOJI_SIZE,
    height: INLINE_EMOJI_SIZE,
    objectFit: 'contain',
    verticalAlign: 'text-bottom',
  },
  // A #channel chip is a control inside selectable text: it resets the
  // button and keeps the chip's own look.
  channelButton: {
    appearance: 'none',
    display: 'inline',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'default',
    borderRadius: radii['--radius-tag'],
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
})

const indents = stylex.create({
  0: {},
  1: { marginInlineStart: spacing['--space-5'] },
  2: { marginInlineStart: spacing['--space-10'] },
  3: { marginInlineStart: `calc(${spacing['--space-10']} + ${spacing['--space-5']})` },
})
