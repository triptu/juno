import * as stylex from '@stylexjs/stylex'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import type { ReactNode } from 'react'
import { layout, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { ContextPill, HeaderBand, Surface, Text } from '@juno/ui'
import { TextControl } from './HuddleControls'
import { placeIcons, placeKindLabels, placeTints } from './look'
import type { HuddlePlace } from './model'

export interface HuddlePageHeaderProps {
  readonly place: HuddlePlace
  /** The status line; absent once the huddle is over. */
  readonly status?: ReactNode
  /** What a screen reader hears: the status line's notice or the container's announcement, never the duration. */
  readonly spoken: ReactNode
  readonly onPlace?: (() => void) | undefined
  readonly onOpenThread?: (() => void) | undefined
}

/**
 * The tab's header islands (SPEC 20): the place pill, the title and the
 * status line on the left, Thread on the right, at the tab's 24px edges so
 * they line up with the shares.
 */
export function HuddlePageHeader({ place, status, spoken, onPlace, onOpenThread }: HuddlePageHeaderProps) {
  return (
    <header {...stylex.props(styles.header)}>
      <HeaderBand />
      <div {...stylex.props(styles.islands)}>
        <Surface kind="island" data-island="left" sx={styles.left}>
          <ContextPill
            size={24}
            tint={placeTints[place.kind]}
            icon={placeIcons[place.kind]}
            name={place.name}
            kindLabel={placeKindLabels[place.kind]}
            label={`${place.name}, ${placeKindLabels[place.kind].toLowerCase()}. Show in sidebar.`}
            {...(onPlace === undefined ? {} : { onClick: onPlace })}
          />
          <h1 {...stylex.props(styles.title)}>Huddle</h1>
          {status === undefined ? null : (
            <Text variant="meta" tone="muted" numeric truncate tooltipWhenTruncated sx={styles.status}>
              {status}
            </Text>
          )}
          <span role="status" {...stylex.props(styles.announce)}>
            {spoken}
          </span>
        </Surface>
        {onOpenThread === undefined ? null : (
          <Surface kind="island" data-island="right" sx={styles.right}>
            <TextControl shape="island" icon={ChatsCircle} label="Thread" onClick={onOpenThread} />
          </Surface>
        )}
      </div>
    </header>
  )
}

const styles = stylex.create({
  header: {
    position: 'absolute',
    top: 0,
    insetInline: 0,
    height: layout['--header-band'],
    pointerEvents: 'none',
  },
  // The page's edges: the same 24px the stage keeps, so the islands line up with the shares.
  islands: {
    position: 'absolute',
    top: layout['--header-island-top'],
    insetInline: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
    paddingInline: spacing['--space-6'],
    pointerEvents: 'none',
  },
  // The pill sits 2px further in than the island's even inset, so its round end clears the island's (HeaderIslands).
  left: {
    flexShrink: 1,
    minWidth: 0,
    paddingInlineStart: `calc((${layout['--header-island-height']} - ${sizes['--control-28']}) / 2 - 1px + ${spacing['--space-0-5']})`, // tokens-allow: Subtract the 1px island border from the inset.
    paddingInlineEnd: spacing['--space-3'],
    pointerEvents: 'auto',
  },
  right: {
    flexShrink: 0,
    pointerEvents: 'auto',
  },
  title: {
    flexShrink: 0,
    margin: 0,
    paddingInline: spacing['--space-2'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-body-small-size'],
    fontWeight: weights['--weight-semibold'],
    lineHeight: sizes['--control-28'],
  },
  status: {
    minWidth: 0,
  },
  // Heard, not seen: what changed, never the ticking duration.
  announce: {
    position: 'absolute',
    width: '1px', // tokens-allow: the visually hidden pattern
    height: '1px', // tokens-allow: the visually hidden pattern
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
