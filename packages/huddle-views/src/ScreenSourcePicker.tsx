import * as stylex from '@stylexjs/stylex'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import type { KeyboardEvent } from 'react'
import { accent, colors, layout, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, moveFocus, ringRoom, Surface, Text } from '@juno/ui'

export interface ScreenSource {
  readonly id: string
  /** "Entire screen", "Built-in display", or a window's title. */
  readonly name: string
  readonly kind: 'screen' | 'window'
  /** The snapshot taken when the sheet opened, at most 480 by 480. */
  readonly thumbnailUrl?: string
  /** A window's app icon, drawn before its name. */
  readonly appIconUrl?: string
}

/** What macOS says about recording the screen: not asked yet, off for Juno, or allowed. */
export type ScreenPermission = 'unknown' | 'denied' | 'granted'

export interface ScreenSourcePickerProps {
  readonly permission: ScreenPermission
  /** The screens and windows, Juno's own left out. Absent while they are read. */
  readonly sources?: ReadonlyArray<ScreenSource>
  readonly chosen?: string
  readonly onChoose: (id: string) => void
  readonly onShare: (id: string) => void
  readonly onCancel: () => void
  /** Continue: shows the macOS prompt. */
  readonly onAllow: () => void
  readonly onOpenSettings: () => void
  /** Hide message text while sharing is on, so the sheet says message text will be hidden. */
  readonly hidesText?: boolean
}

/**
 * The sheet Share screen opens (SPEC 20): the screens, then the windows,
 * as thumbnails to choose from, with Share and Cancel at the bottom right.
 * Before macOS allows recording the screen it explains and asks instead.
 * The container places it in a SheetLayer; this is the panel. Its list is
 * one fixed height in every state, so nothing moves when the thumbnails
 * arrive.
 */
export function ScreenSourcePicker({ permission, sources, chosen, onChoose, onShare, onCancel, onAllow, onOpenSettings, hidesText = false }: ScreenSourcePickerProps) {
  const screens = sources?.filter((source) => source.kind === 'screen') ?? []
  const windows = sources?.filter((source) => source.kind === 'window') ?? []
  const current = chosen ?? screens[0]?.id ?? windows[0]?.id
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && current !== undefined) {
      event.preventDefault()
      onShare(current)
      return
    }
    moveFocus(event, '[role="radio"]', { orientation: 'both', select: true })
  }
  return (
    <Surface kind="popover" as="section" role="dialog" aria-label="Share your screen" aria-modal data-source-picker="" padding="none" sx={styles.sheet}>
      <div {...stylex.props(styles.inner)}>
        <Text variant="heading" tone="default" as="h2">
          {permission === 'granted' ? 'Share your screen' : permission === 'unknown' ? 'Allow screen recording' : 'Screen recording is off for Juno'}
        </Text>
        <div {...stylex.props(styles.list)}>
          {permission === 'unknown' ? (
            <Explain body="macOS asks once. Juno shares only the screen or window you pick." />
          ) : permission === 'denied' ? (
            <Explain body="Turn on Juno in System Settings, Privacy & Security, Screen & System Audio Recording. macOS may ask you to quit and reopen Juno." />
          ) : sources === undefined ? (
            <Explain body="Getting your screens and windows…" />
          ) : (
            <div role="radiogroup" aria-label="Screens and windows" onKeyDown={onKeyDown} {...stylex.props(styles.scroller, ringRoom.all)}>
              {[
                { title: 'Screens', items: screens },
                { title: 'Windows', items: windows },
              ].map((group) =>
                group.items.length === 0 ? null : (
                  <section key={group.title} aria-label={group.title} {...stylex.props(styles.group)}>
                    <Text variant="sectionLabel" tone="muted" as="h3">
                      {group.title}
                    </Text>
                    <div {...stylex.props(styles.grid)}>
                      {group.items.map((source) => (
                        <SourceTile key={source.id} source={source} checked={source.id === current} onChoose={() => onChoose(source.id)} onShare={() => onShare(source.id)} />
                      ))}
                    </div>
                  </section>
                ),
              )}
            </div>
          )}
        </div>
        <PickerFooter permission={permission} hidesText={hidesText} current={current} onCancel={onCancel} onShare={onShare} onAllow={onAllow} onOpenSettings={onOpenSettings} />
      </div>
    </Surface>
  )
}

interface PickerFooterProps {
  readonly permission: ScreenPermission
  readonly hidesText: boolean
  readonly current: string | undefined
  readonly onCancel: () => void
  readonly onShare: (id: string) => void
  readonly onAllow: () => void
  readonly onOpenSettings: () => void
}

/** The note on the left and the buttons at the bottom right, the default action last, as a Mac sheet has them. */
function PickerFooter({ permission, hidesText, current, onCancel, onShare, onAllow, onOpenSettings }: PickerFooterProps) {
  return (
    <div {...stylex.props(styles.footer)}>
      {permission === 'granted' && hidesText ? (
        <span {...stylex.props(styles.note)}>
          <Icon icon={EyeSlash} size={14} />
          <Text variant="meta" tone="subtle" truncate>
            Message text is hidden while you share.
          </Text>
        </span>
      ) : (
        <span {...stylex.props(styles.note)} />
      )}
      <span {...stylex.props(styles.buttons)}>
        <Button variant="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
        {permission === 'granted' ? (
          <Button variant="primary" size="md" disabled={current === undefined} onClick={() => current !== undefined && onShare(current)}>
            Share
          </Button>
        ) : permission === 'unknown' ? (
          <Button variant="primary" size="md" autoFocus onClick={onAllow}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" size="md" autoFocus onClick={onOpenSettings}>
            Open System Settings
          </Button>
        )}
      </span>
    </div>
  )
}

function Explain({ body }: { readonly body: string }) {
  return (
    <div {...stylex.props(styles.explain)}>
      <Text variant="bodySmall" tone="subtle" as="p" sx={styles.explainText}>
        {body}
      </Text>
    </div>
  )
}

interface SourceTileProps {
  readonly source: ScreenSource
  readonly checked: boolean
  readonly onChoose: () => void
  readonly onShare: () => void
}

/**
 * A thumbnail and its name. A click chooses it, a double-click shares it.
 * Only the picture is outlined: the chosen one has the accent's edge on the
 * picture, and keyboard focus is the usual ring a gap outside the picture.
 */
function SourceTile({ source, checked, onChoose, onShare }: SourceTileProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={source.name}
      tabIndex={checked ? 0 : -1}
      onClick={onChoose}
      onDoubleClick={onShare}
      autoFocus={checked}
      {...stylex.props(stylex.defaultMarker(), styles.tile)}
    >
      <span {...stylex.props(styles.thumb)}>
        {source.thumbnailUrl === undefined ? null : <img alt="" src={source.thumbnailUrl} draggable={false} {...stylex.props(styles.image)} />}
        <span aria-hidden {...stylex.props(styles.edge, checked && styles.edgeChecked)} />
      </span>
      <span {...stylex.props(styles.name)}>
        {source.appIconUrl === undefined ? null : <img alt="" src={source.appIconUrl} draggable={false} {...stylex.props(styles.appIcon)} />}
        <Text variant="meta" tone={checked ? 'default' : 'subtle'} weight={checked ? 'medium' : undefined} truncate tooltipWhenTruncated dir="auto">
          {source.name}
        </Text>
      </span>
    </button>
  )
}

const styles = stylex.create({
  sheet: {
    width: '100%',
    maxWidth: layout['--source-picker-width'],
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-5'],
  },
  // One height in every state: the explanation, the wait and the thumbnails all fill it.
  list: {
    display: 'flex',
    flexDirection: 'column',
    height: layout['--source-picker-list-height'],
    minHeight: 0,
  },
  explain: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--secondary-default'],
    paddingInline: spacing['--space-8'],
  },
  explainText: {
    textAlign: 'center',
    maxWidth: layout['--home-width'],
  },
  scroller: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-4'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: spacing['--space-3'],
  },
  // Its focus ring is on the picture (thumb), so it scrolls clear of the ring's room.
  tile: {
    appearance: 'none',
    outlineStyle: 'none',
    scrollMargin: sizes['--focus-ring-room'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    backgroundColor: 'transparent',
    textAlign: 'start',
    cursor: 'default',
    transitionProperty: 'scale',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
    scale: { default: '1', ':active': motion['--press-scale'] },
  },
  // The snapshot fits a 16:10 box on a quiet fill. Keyboard focus on the tile rings the picture, not its name.
  thumb: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    aspectRatio: '16 / 10',
    overflow: 'hidden',
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--secondary-default'],
    outlineStyle: { default: 'none', [stylex.when.ancestor(':focus-visible')]: 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: accent['--focus-ring'],
  },
  // An edge inside the picture, over the snapshot: grey under the pointer, the accent on the chosen one.
  // As wide as the focus ring, which sits a gap outside it, so the two read apart.
  edge: {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    pointerEvents: 'none',
    boxShadow: {
      default: 'none',
      [stylex.when.ancestor(':hover')]: { default: null, '@media (hover: hover)': `inset 0 0 0 ${sizes['--focus-ring-width']} ${colors['--border-strongest']}` },
    },
  },
  edgeChecked: {
    boxShadow: `inset 0 0 0 ${sizes['--focus-ring-width']} ${accent['--hl']}`,
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  name: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    paddingInline: spacing['--space-0-5'],
  },
  appIcon: {
    flexShrink: 0,
    width: sizes['--icon-16'],
    height: sizes['--icon-16'],
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    paddingTop: spacing['--space-1'],
  },
  note: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    flexGrow: 1,
    minWidth: 0,
    color: colors['--foreground-subtle'],
  },
  buttons: {
    display: 'flex',
    flexShrink: 0,
    gap: spacing['--space-1-5'],
  },
})
