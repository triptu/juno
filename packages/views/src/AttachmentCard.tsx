import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import type { BodyBlock } from '@juno/contract'
import { colors, spacing, text, tints, layout, radii } from '@juno/tokens/tokens.stylex'
import { Button } from '@juno/ui'

type Attachment = Extract<BodyBlock, { kind: 'attachment' }>

export function AttachmentCard({ attachment, title, children, footer, tabbable }: { readonly attachment: Attachment; readonly title: ReactNode; readonly children: ReactNode; readonly footer: ReactNode; readonly tabbable: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const long = attachment.blocks.some((block) => block.kind === 'paragraph' && block.children.reduce((size, inline) => size + ('text' in inline ? inline.text.length : inline.kind === 'break' ? 80 : 0), 0) > 700 || block.kind === 'code' && block.text.length > 700)
  return <section aria-label="Attachment" {...stylex.props(styles.card, tintStyles[attachment.tint])}>
    {attachment.title.length > 0 && <div {...stylex.props(styles.title)}>{title}</div>}
    <div {...stylex.props(styles.content, long && !expanded && styles.collapsed)}>{children}</div>
    {long && <Button size="sm" variant="ghost" tabIndex={tabbable ? 0 : -1} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show more'}</Button>}
    {attachment.footer.length > 0 && <div {...stylex.props(styles.footer)}>{footer}</div>}
  </section>
}

export function AttachmentImage({ image }: { readonly image: Extract<BodyBlock, { kind: 'image' }> }) {
  const ratio = image.width && image.height && image.width > 0 && image.height > 0 ? image.width / image.height : 1.5
  return <div {...stylex.props(styles.imageBox(ratio))}><img src={image.url} alt={image.alt} loading="lazy" decoding="async" {...stylex.props(styles.image)} /></div>
}

const styles = stylex.create({
  card: { borderInlineStartWidth: spacing['--space-0-5'], borderInlineStartStyle: 'solid', paddingInline: spacing['--space-3'], paddingBlock: spacing['--space-2'], marginBlock: spacing['--space-1'], display: 'flex', flexDirection: 'column', gap: spacing['--space-2'], minWidth: 0 },
  title: { fontWeight: text['--text-heading-weight'] },
  content: { display: 'flex', flexDirection: 'column', gap: spacing['--space-2'], minWidth: 0 },
  collapsed: { maxHeight: layout['--thumb-max-height'], overflow: 'hidden' },
  footer: { fontSize: text['--text-tag-small-size'], color: colors['--foreground-muted'] },
  imageBox: (ratio: number) => ({ position: 'relative', flexShrink: 0, width: `min(100%, ${layout['--thumb-max-width']}, calc(${layout['--thumb-max-height']} * ${ratio}))`, aspectRatio: ratio, backgroundColor: colors['--background-subtle'], borderRadius: radii['--radius-md'], overflow: 'hidden' }),
  image: { position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
})
const tintStyles = stylex.create({
  neutral: { borderInlineStartColor: colors['--border-strongest'] },
  info: { borderInlineStartColor: tints['--tint-dm-bg'] },
  success: { borderInlineStartColor: tints['--tint-resolved-bg'] },
  warning: { borderInlineStartColor: tints['--tint-warning-bg'] },
  danger: { borderInlineStartColor: `color-mix(in oklch, ${colors['--danger']} 25%, ${colors['--surface-default']})` },
})
