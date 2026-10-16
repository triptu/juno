import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import type { BodyBlock, BodyInline } from '@juno/contract'
import { colors, spacing, text, tints, layout, radii } from '@juno/tokens/tokens.stylex'
import { Button } from '@juno/ui'
import { thumbnailBox } from './MediaGrid'

type Attachment = Extract<BodyBlock, { kind: 'attachment' }>

export function AttachmentCard({ attachment, title, children, footer, tabbable }: { readonly attachment: Attachment; readonly title: ReactNode; readonly children: ReactNode; readonly footer: ReactNode; readonly tabbable: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const long = attachment.blocks.some((block) => block.kind === 'paragraph' && block.children.reduce((size, inline) => size + ('text' in inline ? inline.text.length : inline.kind === 'break' ? 80 : 0), 0) > 700 || block.kind === 'code' && block.text.length > 700)
  return <section aria-label="Attachment" {...stylex.props(styles.card, tintStyles[attachment.tint])}>
    {attachment.author && <div {...stylex.props(styles.identity)}>{attachment.author.icon && <AttachmentIcon url={attachment.author.icon} />}<span>{attachment.author.name}</span></div>}
    {attachment.title.length > 0 && <div {...stylex.props(styles.title)}>{title}</div>}
    <div {...stylex.props(styles.content, long && !expanded && styles.collapsed)}>{children}</div>
    {long && <div data-expands-in-place="" {...stylex.props(styles.more)}><Button size="sm" variant="ghost" tabIndex={tabbable ? 0 : -1} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show more'}</Button></div>}
    {attachment.footer.length > 0 && <div {...stylex.props(styles.footer, styles.identity)}>{attachment.footerIcon && <AttachmentIcon url={attachment.footerIcon} />}{footer}</div>}
  </section>
}

/** Two-column fields, in attachments and Block Kit sections. `render` draws a run of inlines. */
export function AttachmentFields({ items, render }: { readonly items: ReadonlyArray<ReadonlyArray<BodyInline>>; readonly render: (inlines: ReadonlyArray<BodyInline>) => ReactNode }) {
  return <div {...stylex.props(styles.fields)}>{items.map((item, index) => {
    const { label, value } = fieldParts(item)
    return <div key={index} data-field="" {...stylex.props(styles.field)}>
      {label !== undefined && <div data-field-label="" {...stylex.props(styles.fieldLabel)}>{label}</div>}
      <div>{render(value)}</div>
    </div>
  })}</div>
}

/**
 * Slack writes a field as "*Label*\nValue" (attachment fields, and most
 * Block Kit section fields): bold text, then a line break. That first line
 * is the field's label, shown above the value in the secondary style.
 */
function fieldParts(item: ReadonlyArray<BodyInline>): { readonly label?: string; readonly value: ReadonlyArray<BodyInline> } {
  const end = item.findIndex((inline) => inline.kind === 'break')
  if (end <= 0) return { value: item }
  const lead = item.slice(0, end)
  if (!lead.every((inline) => inline.kind === 'text' && inline.style?.bold === true)) return { value: item }
  return { label: lead.map((inline) => (inline.kind === 'text' ? inline.text : '')).join(''), value: item.slice(end + 1) }
}

export function AttachmentImage({ image }: { readonly image: Extract<BodyBlock, { kind: 'image' }> }) {
  const [failed, setFailed] = useState<string>()
  if (failed === image.url) return null
  const box = image.width && image.height && image.width > 0 && image.height > 0 ? thumbnailBox(image.width, image.height) : thumbnailBox()
  return <div {...stylex.props(styles.imageBox(box.width, box.height))}><img src={imageSource(image.url)} alt={image.alt} onError={() => setFailed(image.url)} loading="lazy" decoding="async" {...stylex.props(styles.image)} /></div>
}

function imageSource(url: string): string {
  return url.startsWith('data:') || url.startsWith('juno:') || url.startsWith('/') ? url : `juno://images/?url=${encodeURIComponent(url)}`
}

function AttachmentIcon({ url }: { readonly url: string }) {
  const [failed, setFailed] = useState<string>()
  if (failed === url) return null
  return <img src={imageSource(url)} alt="" onError={() => setFailed(url)} {...stylex.props(styles.icon)} />
}

const styles = stylex.create({
  identity: { display: 'flex', alignItems: 'center', gap: spacing['--space-2'] },
  icon: { width: spacing['--space-4'], height: spacing['--space-4'], objectFit: 'contain', borderRadius: radii['--radius-full'] },
  // Slack's short fields: two columns, each a label above its value.
  fields: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: spacing['--space-3'], whiteSpace: 'pre-wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: spacing['--space-0-5'], minWidth: 0 },
  fieldLabel: { color: colors['--foreground-muted'], fontFamily: text['--text-tag-small-family'], fontSize: text['--text-tag-small-size'], fontWeight: text['--text-tag-small-weight'], lineHeight: text['--text-tag-small-leading'], letterSpacing: text['--text-tag-small-tracking'] },
  card: { borderInlineStartWidth: spacing['--space-0-5'], borderInlineStartStyle: 'solid', paddingInline: spacing['--space-3'], paddingBlock: spacing['--space-2'], marginBlock: spacing['--space-1'], display: 'flex', flexDirection: 'column', gap: spacing['--space-2'], minWidth: 0 },
  title: { fontWeight: text['--text-heading-weight'] },
  content: { display: 'flex', flexDirection: 'column', gap: spacing['--space-2'], minWidth: 0 },
  // The cut fades out, so a half line never reads as a whole one.
  collapsed: {
    maxHeight: layout['--thumb-max-height'],
    overflow: 'hidden',
    maskImage: 'linear-gradient(to bottom, black 70%, transparent)', // tokens-allow: a mask's alpha, not a colour that shows.
  },
  // Show more starts where the text starts: the ghost button's inset and 1px border are pulled back.
  more: {
    display: 'flex',
    marginInlineStart: `calc(-1 * (${spacing['--space-2-5']} + 1px))`, // tokens-allow: the button's 1px border.
    marginBlock: `calc(-1 * ${spacing['--space-1']})`,
  },
  footer: { fontSize: text['--text-tag-small-size'], color: colors['--foreground-muted'] },
  imageBox: (width: number, height: number) => ({ position: 'relative', flexShrink: 0, width, height, maxWidth: '100%', aspectRatio: `${width} / ${height}`, backgroundColor: colors['--background-subtle'], borderRadius: radii['--radius-md'], overflow: 'hidden' }),
  image: { position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
})
// The bar is the card's only colour, so it takes the status colour itself:
// the pale tint fills vanish against the dark background.
const tintStyles = stylex.create({
  neutral: { borderInlineStartColor: colors['--border-strongest'] },
  info: { borderInlineStartColor: colors['--info'] },
  success: { borderInlineStartColor: tints['--tint-resolved-fg'] },
  warning: { borderInlineStartColor: colors['--warning'] },
  danger: { borderInlineStartColor: colors['--danger'] },
})
