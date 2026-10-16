import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import type { HomeItem } from '@juno/contract'
import { accent, colors, radii, shadows, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { Icon, Text, TopicArt } from '@juno/ui'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { Columns, chosenKey, FirstRunNote, Greeting, hasRecents, Items, partStyles, SectionLabel, tintRows } from './HomeWriteParts'
import { HomeComposer, label, RecentMark, tintOf, type HomeWriteProps, type Recent } from './HomeWrite'

// D1 · Address book: a page column as wide as the composer. The greeting
// sits at its start with the scene at its end; what needs you, then people
// and channels in two columns. The destination is a chip on the field.

export function HomeAddressBook(props: HomeWriteProps) {
  const { home, write } = props
  return (
    <div {...stylex.props(partStyles.page)}>
      <div {...stylex.props(partStyles.scroll)}>
        <div {...stylex.props(partStyles.wide)}>
          <header {...stylex.props(partStyles.header)}>
            <div {...stylex.props(partStyles.headerText)}>
              <h2 {...stylex.props(partStyles.title)}>{home.title}</h2>
              <Text variant="body" tone="muted" as="p" sx={partStyles.line}>
                {home.line}
              </Text>
            </div>
            <HomeScene name={home.scene as HomeSceneName} />
          </header>
          {home.items.length === 0 ? null : (
            <section aria-label="Needs you" {...stylex.props(partStyles.block)}>
              <SectionLabel>Needs you</SectionLabel>
              <Items home={home} />
            </section>
          )}
          <div {...stylex.props(partStyles.block)}>{hasRecents(props) || props.refined === true ? <Columns {...props} /> : <FirstRunNote />}</div>
        </div>
      </div>
      <HomeComposer write={write} look="chip" refined={props.refined === true} />
    </div>
  )
}

// ---------------------------------------------------------------------------

// D3 · Mosaic: one grid of cards. What needs you comes first as cards with
// the topic's art, then the people and channels with their last line. The
// chosen destination is the first word of the field, a chip Backspace removes.

function ItemCard({ item, now }: { readonly item: HomeItem; readonly now: number }) {
  const topic = item.topics[0]
  return (
    <li {...stylex.props(styles.card, styles.cardItem)}>
      {topic === undefined ? null : <TopicArt topicId={topic.id} recipe={topic.art} size={40} />}
      <span {...stylex.props(styles.cardText)}>
        <span {...stylex.props(styles.cardTitle)}>{item.title}</span>
        <span {...stylex.props(styles.cardMeta)}>{[topic?.title, topic?.place].filter(Boolean).join(' · ')}</span>
      </span>
      <span hidden>{now}</span>
    </li>
  )
}

function RecentCard({ recent, chosen }: { readonly recent: Recent; readonly chosen: boolean }) {
  return (
    <li>
      <button type="button" aria-pressed={chosen} {...stylex.props(styles.card, partStyles.ring, chosen && tintRows[tintOf(recent)])}>
        <RecentMark recent={recent} size={32} />
        <span {...stylex.props(styles.cardText)}>
          <span {...stylex.props(styles.cardTitle)}>{recent.name}</span>
          <span {...stylex.props(styles.cardMeta)}>{recent.sent === true ? 'Sent just now' : (recent.preview ?? recent.at)}</span>
        </span>
      </button>
    </li>
  )
}

export function HomeMosaic(props: HomeWriteProps) {
  const { home, write, people, channels } = props
  const chosen = chosenKey(write)
  const recents = [...people.slice(0, 4), ...channels.slice(0, 5)]
  const caughtUp = home.items.length === 0
  return (
    <div {...stylex.props(partStyles.page)}>
      <div {...stylex.props(partStyles.scroll)}>
        <div {...stylex.props(partStyles.wide)}>
          <Greeting home={home} scene={caughtUp} />
          {caughtUp ? null : (
            <section aria-label="Needs you" {...stylex.props(partStyles.block)}>
              <SectionLabel>Needs you</SectionLabel>
              <ul {...stylex.props(styles.grid)}>
                {home.items.map((item) => (
                  <ItemCard key={item.id} item={item} now={home.now} />
                ))}
              </ul>
            </section>
          )}
          <section aria-label="Recent" {...stylex.props(partStyles.block)}>
            {recents.length === 0 ? (
              <FirstRunNote />
            ) : (
              <>
                <SectionLabel>Recent</SectionLabel>
                <ul {...stylex.props(styles.grid)}>
                  {recents.map((recent) => (
                    <RecentCard key={recent.key} recent={recent} chosen={recent.key === chosen} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
      <HomeComposer write={write} look="token" />
    </div>
  )
}

// ---------------------------------------------------------------------------

// D4 · Inbox: one list. What needs you and the people and channels you
// write to are the same kind of row, the first with what they want, the
// rest with when you last wrote. A "To" line above the field.

function InboxItemRow({ item }: { readonly item: HomeItem }) {
  const topic = item.topics[0]
  return (
    <li {...stylex.props(styles.inboxRow)}>
      {topic === undefined ? null : <TopicArt topicId={topic.id} recipe={topic.art} size={40} />}
      <span {...stylex.props(styles.cardText)}>
        <span {...stylex.props(styles.cardTitle)}>{topic?.title ?? item.title}</span>
        <span {...stylex.props(styles.cardMeta)}>{topic?.place}</span>
      </span>
      <span {...stylex.props(styles.want)}>{item.title}</span>
    </li>
  )
}

function InboxRecentRow({ recent, chosen }: { readonly recent: Recent; readonly chosen: boolean }) {
  return (
    <li>
      <button type="button" aria-pressed={chosen} {...stylex.props(styles.inboxRow, styles.inboxButton, partStyles.ring, chosen && tintRows[tintOf(recent)])}>
        <RecentMark recent={recent} size={32} />
        <span {...stylex.props(styles.cardText)}>
          <span {...stylex.props(styles.cardTitle)}>{label(recent)}</span>
          <span {...stylex.props(styles.cardMeta)}>{recent.preview ?? ''}</span>
        </span>
        <span {...stylex.props(partStyles.recentAt, recent.sent === true && partStyles.sentAt)}>
          {recent.sent === true ? <Icon icon={Check} size={12} /> : null}
          {recent.sent === true ? 'Sent' : recent.at}
        </span>
      </button>
    </li>
  )
}

export function HomeInbox(props: HomeWriteProps) {
  const { home, write, people, channels } = props
  const chosen = chosenKey(write)
  const recents = [...people, ...channels].slice(0, 8)
  return (
    <div {...stylex.props(partStyles.page)}>
      <div {...stylex.props(partStyles.scroll)}>
        <div {...stylex.props(partStyles.wide)}>
          <Greeting home={home} align="start" scene={false} />
          {home.items.length === 0 ? null : (
            <section aria-label="Needs you" {...stylex.props(partStyles.block)}>
              <SectionLabel>Needs you</SectionLabel>
              <ul {...stylex.props(partStyles.recentList)}>
                {home.items.map((item) => (
                  <InboxItemRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
          <section aria-label="Write to" {...stylex.props(partStyles.block)}>
            {recents.length === 0 ? (
              <FirstRunNote />
            ) : (
              <>
                <SectionLabel>Write to</SectionLabel>
                <ul {...stylex.props(partStyles.recentList)}>
                  {recents.map((recent) => (
                    <InboxRecentRow key={recent.key} recent={recent} chosen={recent.key === chosen} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
      <HomeComposer write={write} look="to" />
    </div>
  )
}

// ---------------------------------------------------------------------------

const CARD_ROW = '60px'

const HOVER = '@media (hover: hover)'

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', // tokens-allow: The narrowest card that holds a name and a line.
    gap: spacing['--space-2'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    width: '100%',
    height: CARD_ROW,
    minWidth: 0,
    paddingInline: spacing['--space-3'],
    borderWidth: 0,
    borderRadius: radii['--radius-3xl'],
    backgroundColor: { default: colors['--surface-default'], ':hover': { default: null, [HOVER]: colors['--surface-hover'] } },
    boxShadow: shadows['--card-ring'],
    boxSizing: 'border-box',
    textAlign: 'start',
    cursor: 'default',
  },
  cardItem: {
    boxShadow: `inset 0 0 0 1px ${accent['--hl-ring']}, ${shadows['--card-ring']}`, // tokens-allow: A 1px inset ring.
  },
  cardText: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
  },
  cardTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    fontWeight: weights['--weight-medium'],
    lineHeight: text['--text-ui-leading'],
    color: colors['--foreground-default'],
  },
  cardMeta: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    lineHeight: text['--text-meta-leading'],
    color: colors['--foreground-muted'],
  },
  inboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    width: '100%',
    height: sizes['--row-52'],
    minWidth: 0,
    paddingInline: spacing['--space-3'],
    borderRadius: radii['--radius-3xl'],
    boxSizing: 'border-box',
  },
  inboxButton: {
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': { default: null, [HOVER]: colors['--surface-hover'] } },
    textAlign: 'start',
    cursor: 'default',
  },
  want: {
    flexShrink: 0,
    maxWidth: '45%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    lineHeight: text['--text-meta-leading'],
    color: accent['--hl-text'],
  },
})
