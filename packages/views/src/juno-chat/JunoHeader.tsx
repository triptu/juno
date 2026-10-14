import * as stylex from '@stylexjs/stylex'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { chatCopy, type Banner, type JunoPage } from '@juno/agent-contract'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Chip, IconButton, OptionList, OptionRow, Popover, Text } from '@juno/ui'
import { TextButton } from './TextButton'

export interface JunoHeaderProps {
  readonly banner: Banner
  readonly menuOpen: boolean
  readonly onMenu: (open: boolean) => void
  readonly onOpenPage: (page: JunoPage) => void
  /** The paused chip's Resume. */
  readonly onResume: () => void
}

const pages: ReadonlyArray<{ readonly page: JunoPage; readonly label: string }> = [
  { page: 'scheduled', label: 'Scheduled' },
  { page: 'remembers', label: 'What Juno remembers' },
  { page: 'memory', label: 'Memory of this chat' },
  { page: 'activity', label: 'Activity' },
  { page: 'connections', label: 'Connections' },
  { page: 'settings', label: 'Settings › Juno' },
]

/**
 * The 44px bar over the chat (inventory 12): "Juno", the one banner chip
 * when the chat is not in its normal state, and the More menu with the six
 * pages. The chip is a 26px pill whose action is a text button: Resume on
 * paused, Review on recovery.
 */
export function JunoHeader({ banner, menuOpen, onMenu, onOpenPage, onResume }: JunoHeaderProps) {
  return (
    <header aria-label="Juno" {...stylex.props(styles.root)}>
      <Text variant="heading" tone="default" as="h1">
        Juno
      </Text>
      <span {...stylex.props(styles.chip)}>
        <BannerChip banner={banner} onResume={onResume} onOpenPage={onOpenPage} />
      </span>
      <span {...stylex.props(styles.menu)}>
        <Popover
          open={menuOpen}
          onClose={() => onMenu(false)}
          width="menu"
          placement="bottom-end"
          role="menu"
          label="Juno menu"
          anchor={<IconButton icon={DotsThree} label="More" size={30} iconSize={18} pressed={menuOpen} onClick={() => onMenu(!menuOpen)} />}
        >
          <OptionList role="menu" label="Juno pages" focusable>
            {pages.map((entry) => (
              <OptionRow
                key={entry.page}
                id={`juno-page-${entry.page}`}
                label={entry.label}
                onSelect={() => {
                  onMenu(false)
                  onOpenPage(entry.page)
                }}
              />
            ))}
          </OptionList>
        </Popover>
      </span>
    </header>
  )
}

/** One chip at a time, by the precedence the container applied. Its title is the full line. */
function BannerChip({ banner, onResume, onOpenPage }: { readonly banner: Banner; readonly onResume: () => void; readonly onOpenPage: (page: JunoPage) => void }) {
  const copy = chatCopy.banner
  if (banner._tag === 'none') return null
  const text = copy[banner._tag]
  return (
    <Chip variant="filled" size={26} title={text.line} data-banner={banner._tag}>
      {text.chip}
      {banner._tag === 'paused' ? (
        <>
          {' · '}
          <TextButton tone="muted" onClick={onResume}>
            {copy.paused.resume}
          </TextButton>
        </>
      ) : banner._tag === 'recovery' ? (
        <>
          {' · '}
          <TextButton tone="muted" onClick={() => onOpenPage('review')}>
            {copy.recovery.review}
          </TextButton>
        </>
      ) : null}
    </Chip>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    flexShrink: 0,
    height: layout['--titlebar-height'],
    paddingInline: spacing['--space-5'],
    boxSizing: 'border-box',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
    color: colors['--foreground-default'],
    userSelect: 'none',
  },
  chip: {
    display: 'inline-flex',
    minWidth: 0,
    flexShrink: 1,
  },
  menu: {
    display: 'inline-flex',
    marginInlineStart: 'auto',
    flexShrink: 0,
  },
})
