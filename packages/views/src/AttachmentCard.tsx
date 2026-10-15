import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import type { BodyBlock } from '@juno/contract'
import { colors, spacing, text, tints, layout, radii } from '@juno/tokens/tokens.stylex'
import { Button } from '@juno/ui'
import { thumbnailBox } from './FileCard'

type Attachment = Extract<BodyBlock, { kind: 'attachment' }>

export function AttachmentCard({ attachment, title, children, footer, tabbable }: { readonly attachment: Attachment; readonly title: ReactNode; readonly children: ReactNode; readonly footer: ReactNode; readonly tabbable: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const long = attachment.blocks.some((block) => block.kind === 'paragraph' && block.children.reduce((size, inline) => size + ('text' in inline ? inline.text.length : inline.kind === 'break' ? 80 : 0), 0) > 700 || block.kind === 'code' && block.text.length > 700)
  return <section aria-label="Attachment" {...stylex.props(styles.card, tintStyles[attachment.tint])}>
    {attachment.title.length > 0 && <div {...stylex.props(styles.title)}>{title}</div>}
    <div {...stylex.props(styles.content, long && !expanded && styles.collapsed)}>{children}</div>
    {long && <div {...stylex.props(styles.more)}><Button size="sm" variant="ghost" tabIndex={tabbable ? 0 : -1} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show more'}</Button></div>}
    {attachment.footer.length > 0 && <div {...stylex.props(styles.footer)}>{footer}</div>}
  </section>
}

export function AttachmentImage({ image }: { readonly image: Extract<BodyBlock, { kind: 'image' }> }) {
  const box = image.width && image.height && image.width > 0 && image.height > 0 ? thumbnailBox(image.width, image.height) : thumbnailBox()
  return <div {...stylex.props(styles.imageBox(box.width, box.height))}><img src={image.url} alt={image.alt} loading="lazy" decoding="async" {...stylex.props(styles.image)} /></div>
}

const styles = stylex.create({
  card: { borderInlineStartWidth: spacing['--space-0-5'], borderInlineStartStyle: 'solid', paddingInline: spacing['--space-3'], paddingBlock: spacing['--space-2'], marginBlock: spacing['--space-1'], display: 'flex', flexDirection: 'column', gap: spacing['--space-2'], minWidth: 0 },
  title: { fontWeight: text['--text-heading-weight'] },
  content: { display: 'flex', flexDirection: 'column', gap: spacing['--space-2'], minWidth: 0 },
  // The cut fades out, so a half line never reads as a whole one.
  collapsed: { maxHeight: layout['--thumb-max-height'], overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 70%, transparent)' },
  // Show more starts where the text starts: the ghost button's inset and 1px border are pulled back.
  more: { display: 'flex', marginInlineStart: `calc(-1 * (${spacing['--space-2-5']} + 1px))`, marginBlock: `calc(-1 * ${spacing['--space-1']})` }, // tokens-allow: the button's 1px border.
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
