import * as stylex from '@stylexjs/stylex'
import { EmptyState } from '@juno/ui'

export interface PageNoteProps {
  readonly title: string
  readonly body: string
}

/** A short note in the middle of a whole page, in place of the app, such as why it cannot show here. */
export function PageNote({ title, body }: PageNoteProps) {
  return (
    <div role="status" {...stylex.props(styles.root)}>
      <EmptyState title={title} body={body} padding="page" enter={false} />
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Fills the page column, which lays its children out at the start.
    flexGrow: 1,
    alignSelf: 'stretch',
  },
})
