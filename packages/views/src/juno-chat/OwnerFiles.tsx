import * as stylex from '@stylexjs/stylex'
import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import type { ReactNode } from 'react'
import { thumbBox, type OpId, type OwnerFile } from '@juno/agent-contract'
import { chat, colors, radii, spacing } from '@juno/tokens/tokens.stylex'
import { Icon, Text } from '@juno/ui'

export type OwnerImageFile = Extract<OwnerFile, { _tag: 'image' }>

export interface OwnerImageProps {
  readonly file: OwnerImageFile
  /** The thumbnail's data URL; the box shows its shape until it is in. */
  readonly src: string | undefined
}

/**
 * An image the owner sent Juno, at its own shape within 160px, so the row
 * keeps its size while the thumbnail loads. Hidden while sharing the screen,
 * as message images are (`data-sensitive`).
 */
export function OwnerImage({ file, src }: OwnerImageProps) {
  const box = thumbBox(file.width, file.height)
  return (
    <div role="img" aria-label={file.name} title={file.name} data-owner-image={file.n} {...stylex.props(styles.image(box.width, box.height))}>
      {src !== undefined ? <img src={src} alt="" data-sensitive="" draggable={false} decoding="async" {...stylex.props(styles.picture)} /> : null}
    </div>
  )
}

export interface OwnerFilesProps {
  readonly opId: OpId
  readonly files: ReadonlyArray<OwnerFile>
  /** Draws one image with its thumbnail; the container reads it. Without it the box shows its shape only. */
  readonly renderImage?: ((opId: OpId, file: OwnerImageFile) => ReactNode) | undefined
}

/**
 * What an owner message gave Juno, over its bubble (SPEC 13.1): the images
 * as thumbnails, then each text file by name. Right-aligned, as the bubble is.
 */
export function OwnerFiles({ opId, files, renderImage }: OwnerFilesProps) {
  const images = files.filter((file): file is OwnerImageFile => file._tag === 'image')
  const texts = files.filter((file) => file._tag === 'text')
  return (
    <div data-owner-files="" {...stylex.props(styles.stack)}>
      {images.length > 0 ? (
        <div {...stylex.props(styles.images)}>
          {images.map((file) => (
            <span key={file.n}>{renderImage?.(opId, file) ?? <OwnerImage file={file} src={undefined} />}</span>
          ))}
        </div>
      ) : null}
      {texts.map((file) => (
        <div key={file.n} data-owner-text-file="" title={file.name} {...stylex.props(styles.textFile)}>
          <Icon icon={FileText} size={14} />
          <Text variant="meta" tone="inherit" truncate dir="auto">
            {file.name}
          </Text>
        </div>
      ))}
    </div>
  )
}

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: spacing['--space-1'],
    maxWidth: '100%',
    marginBottom: spacing['--space-0-5'],
    minWidth: 0,
  },
  images: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing['--space-1'],
  },
  image: (width: number, height: number) => ({
    position: 'relative',
    width,
    height,
    borderRadius: radii['--radius-lg'],
    overflow: 'hidden',
    backgroundColor: colors['--secondary-default'],
  }),
  picture: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  textFile: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    maxWidth: '100%',
    minWidth: 0,
    paddingBlock: spacing['--space-1'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: chat['--owner-bubble-bg'],
    color: colors['--foreground-subtle'],
  },
})
