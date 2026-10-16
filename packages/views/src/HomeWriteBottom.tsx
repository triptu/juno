import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { colors, layout, radii, shadows, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Icon, Kbd, Text, tooltip } from '@juno/ui'
import { Home } from './Home'
import { Columns, chosenKey, FirstRunNote, hasRecents, partStyles } from './HomeWriteParts'
import { firstName, HomeComposer, JunoMark, label, RecentMark, type HomeWriteProps, type Recent } from './HomeWrite'

// D2 · Shelf: Home as it is in the middle; above the composer, one band of
// faces and channel art with Juno first, the chosen one lifted. The field
// shows the chosen face at its start.

function Shelf({ people, channels, write, refined = false }: Pick<HomeWriteProps, 'people' | 'channels' | 'write' | 'refined'>) {
  const chosen = chosenKey(write)
  const tileStyle = [styles.tile]
  const tile = (recent: Recent) => (
    <li key={recent.key}>
      <button type="button" aria-pressed={recent.key === chosen} aria-label={label(recent)} {...(refined ? tooltip(label(recent)) : {})} {...stylex.props(...tileStyle, partStyles.ring, recent.key === chosen && styles.tileChosen)}>
        <span {...stylex.props(styles.tileMark)}>
          <RecentMark recent={recent} size={36} />
          {recent.sent === true ? (
            <span {...stylex.props(styles.sentBadge)}>
              <Icon icon={Check} size={12} />
            </span>
          ) : null}
        </span>
        <span {...stylex.props(styles.tileName)}>{firstName(recent)}</span>
      </button>
    </li>
  )
  return (
    <div role="group" aria-label="Send to" {...stylex.props(styles.shelf, refined && styles.shelfRefined)}>
      <ul {...stylex.props(styles.shelfGroup)}>
        <li>
          <button type="button" aria-pressed={chosen === undefined} aria-label="Juno" {...stylex.props(...tileStyle, partStyles.ring, chosen === undefined && styles.tileChosen)}>
            <span {...stylex.props(styles.tileMark)}>
              <JunoMark size={refined ? 36 : 44} />
            </span>
            <span {...stylex.props(styles.tileName)}>Juno</span>
          </button>
        </li>
      </ul>
      {refined && people.length + channels.length === 0 ? (
        <Text variant="meta" tone="muted" as="p" sx={styles.shelfEmpty}>
          Type <Kbd look="key">@</Kbd> or <Kbd look="key">#</Kbd> to write to a person or a channel. The ones you use show here.
        </Text>
      ) : null}
      {people.length === 0 ? null : <ul {...stylex.props(styles.shelfGroup)}>{people.slice(0, 5).map(tile)}</ul>}
      {channels.length === 0 ? null : <ul {...stylex.props(styles.shelfGroup)}>{channels.slice(0, 4).map(tile)}</ul>}
    </div>
  )
}

export function HomeShelf(props: HomeWriteProps) {
  const { home, write } = props
  return (
    <div {...stylex.props(partStyles.page)}>
      <Home {...home} />
      <HomeComposer write={write} look="glyph" above={<Shelf {...props} />} refined={props.refined === true} />
    </div>
  )
}

// ---------------------------------------------------------------------------

// D5 · Dock: Home as it is in the middle; at the bottom, one raised dock
// that holds people and channels in two columns over the field.

export function HomeDock(props: HomeWriteProps) {
  const { home, write } = props
  return (
    <div {...stylex.props(partStyles.page)}>
      <Home {...home} />
      <div {...stylex.props(styles.dockWrap)}>
        <div {...stylex.props(styles.dock)}>
          {hasRecents(props) ? <Columns {...props} rows={3} /> : <FirstRunNote />}
          <div {...stylex.props(styles.dockComposer)}>
            <HomeComposer write={write} look="chip" />
          </div>
        </div>
      </div>
    </div>
  )
}

//

const SHELF_TILE = '68px'
const SHELF_HINT_MAX = '300px'

const HOVER = '@media (hover: hover)'
const PAGE_WIDTH = layout['--composer-width']

const styles = stylex.create({
  shelf: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-4'],
    width: '100%',
    minWidth: 0,
    overflowX: 'auto',
    paddingBottom: spacing['--space-1'],
  },
  // Safe centring: when the band is wider than the composer it starts at Juno and scrolls, instead of cutting Juno off.
  shelfRefined: {
    justifyContent: 'safe center',
  },
  shelfEmpty: {
    alignSelf: 'center',
    margin: 0,
    maxWidth: SHELF_HINT_MAX,
  },
  shelfGroup: {
    display: 'flex',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    width: SHELF_TILE,
    paddingBlock: spacing['--space-2'],
    borderWidth: 0,
    borderRadius: radii['--radius-3xl'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--surface-hover'] } },
    color: colors['--foreground-subtle'],
    cursor: 'default',
  },
  tileChosen: {
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-default'],
  },
  tileMark: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--tile-44'],
    height: sizes['--tile-44'],
  },
  sentBadge: {
    position: 'absolute',
    insetInlineEnd: 0,
    bottom: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-18'],
    height: sizes['--control-18'],
    borderRadius: radii['--radius-pill'],
    backgroundColor: colors['--foreground-default'],
    color: colors['--background'],
    boxShadow: `0 0 0 ${sizes['--avatar-ring']} ${colors['--background']}`,
  },
  tileName: {
    maxWidth: '100%',
    paddingInline: spacing['--space-1'],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    lineHeight: text['--text-meta-leading'],
  },
  dockWrap: {
    flexShrink: 0,
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-4'],
  },
  dock: {
    width: '100%',
    maxWidth: `calc(${PAGE_WIDTH} + 2 * ${spacing['--space-3']})`,
    marginInline: 'auto',
    paddingTop: spacing['--space-3'],
    paddingInline: spacing['--space-3'],
    borderRadius: radii['--radius-card'],
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--card-ring'],
    boxSizing: 'border-box',
  },
  // The composer pads itself for a page edge; inside the dock its field meets the dock's own inset.
  dockComposer: {
    marginTop: spacing['--space-2'],
    marginInline: `calc(-1 * ${spacing['--space-6']} + ${spacing['--space-0-5']})`,
    marginBottom: `calc(-1 * ${spacing['--space-5']} + ${spacing['--space-3']})`,
  },
})
