import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { HomeItem } from '@juno/contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import { HomeRow } from './Home'
import { quietStyles, Rows } from './HomeQuiet'
import { HomeScene, type HomeSceneName } from './HomeScene'
import { HomeComposer, noop, type Recent, type WriteState } from './HomeWrite'

/**
 * Round 4 of the merged Home (gallery only, `docs/design/home-merged/round-4`).
 * The greeting and its scene come back in every state, with no count line.
 * One quiet "Recent" label sits over the two columns of people and
 * channels. The composer is round 2's, with the destination chip kept on
 * the first line when the text wraps. Two layouts: the recents centred
 * under what needs you (A), or just above the composer, on its left edge (B).
 */

export interface CalmProps {
  /** "Morning, Tushar." by time of day, or "All caught up." */
  readonly title: string
  readonly scene: HomeSceneName
  /** What needs you; empty when caught up. */
  readonly items: ReadonlyArray<HomeItem>
  readonly now: number
  readonly people: ReadonlyArray<Recent>
  readonly channels: ReadonlyArray<Recent>
  readonly write: WriteState
}

function Greeting({ title, scene }: Pick<CalmProps, 'title' | 'scene'>) {
  return (
    <div {...stylex.props(styles.greeting)}>
      <HomeScene name={scene} />
      <h2 {...stylex.props(quietStyles.title)}>{title}</h2>
    </div>
  )
}

function NeedsYou({ items, now }: Pick<CalmProps, 'items' | 'now'>) {
  if (items.length === 0) return null
  return (
    <ul aria-label="Needs you" {...stylex.props(styles.items)}>
      {items.map((item) => (
        <HomeRow key={item.id} item={item} done={false} now={now} onOpen={noop} onMarkDone={noop} onResolveAll={noop} onSort={noop} onItemMenu={noop} />
      ))}
    </ul>
  )
}

/** One label over both columns: the two lists are one group, split by kind. */
function Recents({ people, channels, write }: Pick<CalmProps, 'people' | 'channels' | 'write'>) {
  if (people.length + channels.length === 0) return null
  const chosen = write.destination === 'juno' ? undefined : write.destination.key
  return (
    <section aria-labelledby="home-recent" {...stylex.props(styles.recentsBlock)}>
      <Text id="home-recent" variant="sectionLabel" tone="muted" as="h3" sx={styles.label}>
        Recent
      </Text>
      <div {...stylex.props(styles.scope)}>
        <div {...stylex.props(styles.columns)}>
          <Rows list={people.slice(0, 5)} chosen={chosen} refined />
          <Rows list={channels.slice(0, 5)} chosen={chosen} refined />
        </div>
      </div>
    </section>
  )
}

function Page({ children, composer }: { readonly children: ReactNode; readonly composer: ReactNode }) {
  return (
    <div {...stylex.props(quietStyles.page)}>
      <div {...stylex.props(quietStyles.scroll)}>
        <div {...stylex.props(quietStyles.column)}>{children}</div>
      </div>
      {composer}
    </div>
  )
}

/** A · The recents centred under what needs you, in Home's column. */
export function HomeCalmCentre(props: CalmProps) {
  return (
    <Page composer={<HomeComposer write={props.write} look="chip" refined chipAtTop />}>
      <Greeting {...props} />
      <NeedsYou {...props} />
      <div {...stylex.props(styles.recentsGap)}>
        <Recents {...props} />
      </div>
    </Page>
  )
}

/** B · The recents just above the composer, on its left edge; the greeting and what needs you stay centred. */
export function HomeCalmFoot(props: CalmProps) {
  return (
    <Page composer={<HomeComposer write={props.write} look="chip" refined chipAtTop above={<Recents {...props} />} />}>
      <Greeting {...props} />
      <NeedsYou {...props} />
    </Page>
  )
}

const FOLD = '@container (max-width: 400px)'

const styles = stylex.create({
  greeting: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing['--space-3-5'],
    textAlign: 'center',
  },
  // As far under the greeting as Home's rows sit today.
  items: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    marginTop: spacing['--space-6'],
    marginBottom: 0,
    padding: 0,
    listStyle: 'none',
  },
  recentsGap: {
    marginTop: spacing['--space-8'],
  },
  // As wide as Home's column, wherever it sits; above the composer it starts on the field's edge.
  recentsBlock: {
    width: '100%',
    maxWidth: layout['--home-width'],
    paddingBottom: spacing['--space-1'],
  },
  // On the edge of the rows' 20px marks.
  label: {
    margin: 0,
    paddingInline: spacing['--space-4'],
    paddingBottom: spacing['--space-1'],
  },
  scope: {
    containerType: 'inline-size',
  },
  // Two columns, one below about 400px so names stay whole.
  columns: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr)', [FOLD]: 'minmax(0, 1fr)' },
    columnGap: spacing['--space-2'],
  },
})
